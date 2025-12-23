import type {
  BusEventInput,
  HandlerMiddlewareContext,
  Next,
  OutboxEventBus,
} from "outbox-event-bus"
import { SAGA_EVENT_TYPES } from "../types/events.js"
import type { RoutingSlip, SagaStoreAdapter } from "../types/interfaces.js"
import type { ActivityRegistry } from "./activity-registry.js"
import {
  DEFAULT_CLAIM_CHECK_THRESHOLD,
  DEFAULT_COMPRESSION_THRESHOLD,
  PayloadProcessor,
} from "./payload-processor.js"
import { SagaLogger } from "./saga-logger.js"

export interface SagaEngineConfig {
  bus: OutboxEventBus<unknown>
  registry: ActivityRegistry
  compressionThreshold?: number
  claimCheckStore?: SagaStoreAdapter
  claimCheckThreshold?: number
}

export class SagaEngine {
  private bus: OutboxEventBus<unknown>
  private registry: ActivityRegistry
  private payloadProcessor: PayloadProcessor
  private logger: SagaLogger

  constructor(config: SagaEngineConfig) {
    this.bus = config.bus
    this.registry = config.registry
    this.payloadProcessor = new PayloadProcessor({
      compressionThreshold: config.compressionThreshold ?? DEFAULT_COMPRESSION_THRESHOLD,
      ...(config.claimCheckStore ? { claimCheckStore: config.claimCheckStore } : {}),
      claimCheckThreshold: config.claimCheckThreshold ?? DEFAULT_CLAIM_CHECK_THRESHOLD,
    })
    this.logger = new SagaLogger()
  }

  public async execute(slip: RoutingSlip): Promise<void> {
    if (slip.status === "Completed" || slip.status === "Faulted") {
      return
    }

    if (new Date() > new Date(slip.expiresAt)) {
      this.logger.log("Saga timeout detected", slip)
      return this.compensate(slip, "Timeout")
    }

    if (slip.mode === "compensate") {
      return this.compensate(slip)
    }

    const activityDef = slip.itinerary[0]
    if (!activityDef) {
      slip.status = "Completed"
      this.logger.log("Saga completed", slip)
      await this.emitSlip(SAGA_EVENT_TYPES.ROUTING_SLIP_COMPLETED, slip)
      return
    }

    const alreadyExecuted = slip.log.some((entry) => entry.name === activityDef.name)
    if (alreadyExecuted) {
      this.logger.log("Activity already executed, skipping", slip, { activity: activityDef.name })
      // Move to next activity
      const nextSlip = {
        ...slip,
        itinerary: slip.itinerary.slice(1),
      }
      return this.execute(nextSlip)
    }

    const activity = this.registry.get(activityDef.name)
    if (!activity) {
      const errorMsg = `Activity "${activityDef.name}" not found in registry`
      this.logger.log("Activity not found", slip, { activity: activityDef.name })
      throw new Error(errorMsg)
    }

    try {
      this.logger.log("Executing activity", slip, {
        activity: activityDef.name,
        retryCount: activityDef.retryCount,
      })
      const result = await activity.execute(activityDef.arguments, slip.variables)

      const updatedSlip: RoutingSlip = {
        ...slip,
        itinerary: slip.itinerary.slice(1),
        log: [
          ...slip.log,
          {
            name: activityDef.name,
            timestamp: new Date().toISOString(),
            compensationData: result,
          },
        ],
      }

      await this.advanceExecution(updatedSlip)
    } catch (error) {
      const errorMessage = this.getErrorMessage(error)
      this.logger.log("Activity execution failed", slip, {
        activity: activityDef.name,
        error: errorMessage,
      })

      // Retry logic
      const retryPolicy = activityDef.retryPolicy
      const currentRetryCount = activityDef.retryCount ?? 0

      if (retryPolicy && currentRetryCount < retryPolicy.maxRetries) {
        const retrySlip: RoutingSlip = {
          ...slip,
          itinerary: [
            {
              ...activityDef,
              retryCount: currentRetryCount + 1,
            },
            ...slip.itinerary.slice(1),
          ],
        }

        this.logger.log("Retrying activity", retrySlip, {
          activity: activityDef.name,
          retryCount: retrySlip.itinerary[0]?.retryCount,
        })
        await this.emitSlip(activityDef.name, retrySlip)
        return
      }

      await this.compensate(slip, errorMessage)
    }
  }

  public async compensate(slip: RoutingSlip, reason?: string): Promise<void> {
    slip.mode = "compensate"
    slip.status = "Compensating"

    const logEntry = slip.log[slip.log.length - 1]
    if (!logEntry) {
      await this.failSaga(slip, "Saga faulted (nothing to compensate)", reason)
      return
    }

    const activity = this.registry.get(logEntry.name)
    if (!activity) {
      await this.failSaga(
        slip,
        "Compensation failed: Activity not found",
        `Compensation failed: Activity "${logEntry.name}" not found`
      )
      return
    }

    try {
      this.logger.log("Compensating activity", slip, { activity: logEntry.name })
      await activity.compensate(logEntry.compensationData, slip.variables)

      const updatedSlip: RoutingSlip = {
        ...slip,
        log: slip.log.slice(0, -1),
      }

      await this.advanceCompensation(updatedSlip, reason)
    } catch (error) {
      const errorMessage = this.getErrorMessage(error)
      await this.failSaga(
        slip,
        "Terminal compensation failure",
        `Compensation failed: ${errorMessage}`,
        { activity: logEntry.name, error: errorMessage }
      )
    }
  }

  private async advanceExecution(slip: RoutingSlip): Promise<void> {
    if (slip.itinerary.length === 0) {
      slip.status = "Completed"
      this.logger.log("Saga completed", slip)
      await this.emitSlip(SAGA_EVENT_TYPES.ROUTING_SLIP_COMPLETED, slip)
      return
    }

    const nextActivity = slip.itinerary[0]
    if (nextActivity) {
      this.logger.log("Transitioning to next activity", slip, {
        nextActivity: nextActivity.name,
      })
      await this.emitSlip(nextActivity.name, slip)
    }
  }

  private async advanceCompensation(slip: RoutingSlip, reason?: string): Promise<void> {
    if (slip.log.length === 0) {
      slip.status = "Faulted"
      this.logger.log("Saga fully compensated", slip, { reason })
      await this.emitSlip(SAGA_EVENT_TYPES.ROUTING_SLIP_FAULTED, slip, reason)
      return
    }

    const nextLogEntry = slip.log[slip.log.length - 1]
    if (nextLogEntry) {
      this.logger.log("Transitioning to next compensation", slip, {
        nextActivity: nextLogEntry.name,
      })
      await this.emitSlip(nextLogEntry.name, slip)
    }
  }

  private async failSaga(
    slip: RoutingSlip,
    logMsg: string,
    reason?: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    slip.status = "Faulted"
    this.logger.log(logMsg, slip, { ...details, reason })
    await this.emitSlip(SAGA_EVENT_TYPES.ROUTING_SLIP_FAULTED, slip, reason)
  }

  private async emitSlip(type: string, slip: RoutingSlip, reason?: string) {
    let finalPayload: unknown
    const metadata = reason ? { reason } : undefined

    try {
      finalPayload = await this.payloadProcessor.processForEmission(slip)
    } catch (error) {
      this.logger.log("Failed to process payload for emission", slip, {
        error: this.getErrorMessage(error),
      })
      throw error
    }

    const event = {
      type,
      payload: finalPayload,
      ...(metadata ? { metadata } : {}),
    }
    await this.bus.emit(event as unknown as BusEventInput<string, unknown>)
  }

  public middleware() {
    return async (ctx: HandlerMiddlewareContext, next: Next) => {
      let { event } = ctx

      const resolvedPayload = await this.payloadProcessor.resolve(event)

      if (resolvedPayload && resolvedPayload !== event.payload) {
        event = { ...event, payload: resolvedPayload }
      }

      if (this.payloadProcessor.isRoutingSlip(event.payload)) {
        await this.execute(event.payload)
        // Since it is a routing slip and we've executed it, we stop propagation
        return next({ dropEvent: true })
      }

      return next()
    }
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
