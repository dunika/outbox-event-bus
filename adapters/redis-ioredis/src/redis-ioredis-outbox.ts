
import type { Redis, ChainableCommander } from "ioredis"
import { type BusEvent, type IOutbox, type OutboxConfig, PollingService, formatErrorMessage, type FailedBusEvent, MaxRetriesExceededError, type ErrorHandler } from "outbox-event-bus"
import { pollEventsScript, recoverEventsScript } from "./scripts"

export interface RedisIoRedisOutboxConfig extends OutboxConfig {
  redis: Redis
  keyPrefix?: string
  processingTimeoutMs?: number
  getPipeline?: (() => ChainableCommander | undefined) | undefined
}

export class RedisIoRedisOutbox implements IOutbox<ChainableCommander> {
  private readonly config: Required<RedisIoRedisOutboxConfig>
  private readonly redis: Redis
  private readonly poller: PollingService
  private readonly KEYS: {
    PENDING: string
    PROCESSING: string
    FAILED: string
    EVENT_PREFIX: string
  }

  constructor(config: RedisIoRedisOutboxConfig) {
    this.config = {
      batchSize: config.batchSize ?? 50,
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      maxRetries: config.maxRetries ?? 5,
      baseBackoffMs: config.baseBackoffMs ?? 1000,
      maxErrorBackoffMs: config.maxErrorBackoffMs ?? 30000,
      processingTimeoutMs: config.processingTimeoutMs ?? 30000,
      redis: config.redis,
      keyPrefix: config.keyPrefix ?? "outbox",
      getPipeline: config.getPipeline,
    }


    this.redis = config.redis

    this.KEYS = {
      PENDING: `${this.config.keyPrefix}:pending`,
      PROCESSING: `${this.config.keyPrefix}:processing`,
      FAILED: `${this.config.keyPrefix}:failed`,
      EVENT_PREFIX: `${this.config.keyPrefix}:event:`
    }

    this.registerLuaScripts()

    this.poller = new PollingService({
      pollIntervalMs: this.config.pollIntervalMs,
      baseBackoffMs: this.config.baseBackoffMs,
      maxErrorBackoffMs: this.config.maxErrorBackoffMs,
      performMaintenance: () => this.recoverStuckEvents(),
      processBatch: (handler) => this.processBatch(handler),
    })
  }

  private registerLuaScripts() {
    this.redis.defineCommand("pollOutboxEvents", {
      numberOfKeys: 2,
      lua: pollEventsScript
    })

    this.redis.defineCommand("recoverOutboxEvents", {
      numberOfKeys: 2,
      lua: recoverEventsScript
    })
  }

  async publish(events: BusEvent[], transaction?: unknown): Promise<void> {
    if (events.length === 0) return

    const externalExecutor = (transaction ?? this.config.getPipeline?.()) as ChainableCommander | undefined
    const pipeline = externalExecutor ?? this.redis.pipeline()
    
    for (const event of events) {
      const key = `${this.KEYS.EVENT_PREFIX}${event.id}`
      // Use hmset for ioredis-mock compatibility (multiple hset calls don't work in pipelines)
      pipeline.hmset(key, 
        "id", event.id,
        "type", event.type,
        "payload", JSON.stringify(event.payload),
        "occurredAt", event.occurredAt.toISOString(),
        "status", "created",
        "retryCount", "0"
      )
      pipeline.zadd(this.KEYS.PENDING, event.occurredAt.getTime(), event.id)
    }

    if (!externalExecutor) {
      await pipeline.exec()
    }
  }

  async getFailedEvents(): Promise<FailedBusEvent[]> {
    const eventIds = await this.redis.zrevrange(this.KEYS.FAILED, 0, 99)
    if (!eventIds || eventIds.length === 0) return []

    const pipeline = this.redis.pipeline()
    for (const id of eventIds) {
      pipeline.hgetall(`${this.KEYS.EVENT_PREFIX}${id}`)
    }
    const results = await pipeline.exec()

    const failedEvents: FailedBusEvent[] = []
    if (results) {
      results.forEach((res, index) => {
        const [err, data] = res
        if (!err && data && Object.keys(data).length > 0) {
          const message = data as Record<string, string>
          const event: FailedBusEvent = {
            id: message.id || "",
            type: message.type || "",
            payload: message.payload ? JSON.parse(message.payload) : {},
            occurredAt: message.occurredAt ? new Date(message.occurredAt) : new Date(),
            retryCount: Number.parseInt(message.retryCount || '0', 10),
          }
          if (message.lastError) event.error = message.lastError
           // Redis stores string, so we don't have start/end times unless we added them.
           // We can assume ZSCORE matches failure time roughly or add failureAt field.
           // For now, minimal implementation.
          failedEvents.push(event)
        }
      })
    }
    return failedEvents
  }

  async retryEvents(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return

    const pipeline = this.redis.pipeline()
    const now = Date.now()

    for (const id of eventIds) {
      pipeline.zrem(this.KEYS.FAILED, id)
      pipeline.zadd(this.KEYS.PENDING, now, id)
      pipeline.hmset(`${this.KEYS.EVENT_PREFIX}${id}`,
        "status", "created",
        "retryCount", "0"
      )
      pipeline.hdel(`${this.KEYS.EVENT_PREFIX}${id}`, "lastError")
    }
    
    await pipeline.exec()
  }

  start(
    handler: (event: BusEvent) => Promise<void>,
    onError: ErrorHandler
  ): void {
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }

  private async recoverStuckEvents() {
    const now = Date.now()
    // Custom Lua script handles recovery logic atomically
    // @ts-expect-error - recoverOutboxEvents is a custom command defined via defineCommand
    await this.redis.recoverOutboxEvents(
      this.KEYS.PROCESSING,
      this.KEYS.PENDING,
      this.config.processingTimeoutMs,
      now
    )
  }

  private createCleanupPipeline(eventId: string): ChainableCommander {
    const pipeline = this.redis.pipeline()
    pipeline.zrem(this.KEYS.PROCESSING, eventId)
    pipeline.del(`${this.KEYS.EVENT_PREFIX}${eventId}`)
    return pipeline
  }

  private createRetryPipeline(eventId: string, retryCount: number, error: unknown): ChainableCommander {
    const pipeline = this.redis.pipeline()
    
    if (retryCount >= this.config.maxRetries) {
      pipeline.zrem(this.KEYS.PROCESSING, eventId)
      pipeline.zadd(this.KEYS.FAILED, Date.now(), eventId)
      pipeline.hmset(`${this.KEYS.EVENT_PREFIX}${eventId}`,
        "retryCount", retryCount.toString(),
        "status", "FAILED",
        "lastError", formatErrorMessage(error)
      )
    } else {
      const delay = this.poller.calculateBackoff(retryCount)
      const nextAttemptTime = Date.now() + delay

      pipeline.zrem(this.KEYS.PROCESSING, eventId)
      pipeline.zadd(this.KEYS.PENDING, nextAttemptTime, eventId)
      pipeline.hmset(`${this.KEYS.EVENT_PREFIX}${eventId}`,
        "retryCount", retryCount.toString(),
        "lastError", formatErrorMessage(error)
      )
    }
    
    return pipeline
  }

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
    const now = Date.now()

    // Custom Lua script atomically moves events from PENDING to PROCESSING
    // @ts-expect-error - pollOutboxEvents is a custom command defined via defineCommand
    const eventIds: string[] = await this.redis.pollOutboxEvents(
      this.KEYS.PENDING,
      this.KEYS.PROCESSING,
      now,
      this.config.batchSize
    )

    if (!eventIds || eventIds.length === 0) return

    const pipelineFetch = this.redis.pipeline()
    for (const id of eventIds) {
      pipelineFetch.hgetall(`${this.KEYS.EVENT_PREFIX}${id}`)
    }
    const results = await pipelineFetch.exec()

    if (!results) return

    for (let i = 0; i < results.length; i++) {
        const res = results[i]
        const id = eventIds[i]
        if (!res || !id) continue

        const [err, messageRaw] = res
        if (err || !messageRaw || Object.keys(messageRaw).length === 0) continue

        const message = messageRaw as Record<string, unknown>
        
        const event: BusEvent = {
            id: message.id as string,
            type: message.type as string,
            payload: JSON.parse(message.payload as string),
            occurredAt: new Date(message.occurredAt as string)
        }

        try {
            await handler(event)

            const pipelineCleanup = this.createCleanupPipeline(id)
            await pipelineCleanup.exec()
        } catch (error) {
            const data = message as Record<string, string>
            const retryCount = Number.parseInt(data.retryCount || '0', 10) + 1

            if (retryCount >= this.config.maxRetries) {
              this.poller.onError?.(new MaxRetriesExceededError(error, retryCount), { ...event, retryCount })
            } else {
              this.poller.onError?.(error, { ...event, retryCount })
            }

            const pipelineRetry = this.createRetryPipeline(id, retryCount, error)
            await pipelineRetry.exec()
        }
    }
  }
}
