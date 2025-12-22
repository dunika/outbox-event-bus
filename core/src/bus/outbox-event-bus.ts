import { DuplicateListenerError, TimeoutError, UnsupportedOperationError } from "../errors/errors"
import type { IOutbox, IOutboxEventBus } from "../types/interfaces"
import type {
  ConsumeMiddlewareContext,
  EmitMiddlewareContext,
  Middleware,
} from "../types/middleware"
import type {
  AnyListener,
  BusEvent,
  BusEventInput,
  ErrorHandler,
  EventHandler,
  FailedBusEvent,
} from "../types/types"
import { executeMiddleware } from "../utils/middleware-utils"
import { promiseMap } from "../utils/promise-utils"
import { createTimedPromise } from "../utils/time-utils"

const DEFAULT_WAIT_TIMEOUT_MS = 5000

type WrappedEventHandler<T extends string = string, P = unknown> = EventHandler<T, P> & {
  _original?: EventHandler<T, P>
}

export type OutboxBusConfig = {
  onError: ErrorHandler
  middlewareConcurrency?: number
}

export class OutboxEventBus<TTransaction> implements IOutboxEventBus<TTransaction> {
  private readonly handlers = new Map<string, EventHandler<string, unknown>>()
  private readonly middlewares: Middleware<TTransaction>[] = []
  private readonly onError: ErrorHandler
  private readonly middlewareConcurrency: number

  constructor(
    private readonly outbox: IOutbox<TTransaction>,
    onErrorOrConfig: ErrorHandler | OutboxBusConfig
  ) {
    if (typeof onErrorOrConfig === "function") {
      this.onError = onErrorOrConfig
      this.middlewareConcurrency = 10
    } else {
      this.onError = onErrorOrConfig.onError
      this.middlewareConcurrency = Math.max(1, onErrorOrConfig.middlewareConcurrency ?? 10)
    }
  }

  use(...middlewares: Middleware<TTransaction>[]): this {
    this.middlewares.push(...middlewares)
    return this
  }

  async emit<T extends string, P>(
    event: BusEventInput<T, P>,
    transaction?: TTransaction
  ): Promise<void> {
    await this.emitMany([event], transaction)
  }

  async emitMany<T extends string, P>(
    events: BusEventInput<T, P>[],
    transaction?: TTransaction
  ): Promise<void> {
    if (events.length === 0) return

    const eventsWithDefaults = this.prepareEvents(events)

    const middlewareSnapshot = [...this.middlewares]
    if (middlewareSnapshot.length === 0) {
      await this.outbox.publish(eventsWithDefaults, transaction)
      return
    }

    const results = await promiseMap(
      eventsWithDefaults,
      (event) => this.runEmitMiddleware(event, middlewareSnapshot, transaction),
      this.middlewareConcurrency
    )

    const eventsToPublish = results.filter((e): e is BusEvent => !!e)
    if (eventsToPublish.length > 0) {
      await this.outbox.publish(eventsToPublish, transaction)
    }
  }

  private prepareEvents<T extends string, P>(events: BusEventInput<T, P>[]): BusEvent[] {
    return events.map((event) => ({
      ...event,
      id: event.id ?? crypto.randomUUID(),
      occurredAt: event.occurredAt ?? new Date(),
    })) as BusEvent[]
  }

  private async runEmitMiddleware(
    event: BusEvent,
    middlewares: Middleware<TTransaction>[],
    transaction?: TTransaction
  ): Promise<BusEvent | null> {
    let shouldPublish = false
    const ctx: EmitMiddlewareContext<TTransaction> = {
      event,
      phase: "emit",
      transaction,
    }

    await executeMiddleware(middlewares, ctx, async () => {
      shouldPublish = true
    })

    return shouldPublish ? ctx.event : null
  }

  on<T extends string, P = unknown>(eventType: T, handler: EventHandler<T, P>): this {
    if (this.handlers.has(eventType)) {
      throw new DuplicateListenerError(eventType)
    }

    this.handlers.set(eventType, handler as EventHandler<string, unknown>)
    return this
  }

  addListener<T extends string, P = unknown>(eventType: T, handler: EventHandler<T, P>): this {
    return this.on(eventType, handler)
  }

  once<T extends string, P = unknown>(eventType: T, handler: EventHandler<T, P>): this {
    const onceHandler: WrappedEventHandler<T, P> = async (event) => {
      this.off(eventType, onceHandler)
      await handler(event)
    }

    onceHandler._original = handler
    return this.on(eventType, onceHandler)
  }

  off<T extends string, P = unknown>(eventType: T, handler: EventHandler<T, P>): this {
    const currentHandler = this.handlers.get(eventType) as
      | WrappedEventHandler<string, unknown>
      | undefined

    if (currentHandler === handler || currentHandler?._original === handler) {
      this.handlers.delete(eventType)
    }

    return this
  }

  removeListener<T extends string, P = unknown>(eventType: T, handler: EventHandler<T, P>): this {
    return this.off(eventType, handler)
  }

  removeAllListeners<T extends string>(eventType?: T): this {
    if (eventType) {
      this.handlers.delete(eventType)
    } else {
      this.handlers.clear()
    }
    return this
  }

  getListener(eventType: string): AnyListener | undefined {
    return this.handlers.get(eventType) as unknown as AnyListener | undefined
  }

  subscribe<T extends string, P = unknown>(eventTypes: T[], handler: EventHandler<T, P>): this {
    for (const type of eventTypes) {
      this.on(type, handler)
    }
    return this
  }

  async waitFor<T extends string, P = unknown>(
    eventType: T,
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
  ): Promise<BusEvent<T, P>> {
    const timedPromise = createTimedPromise<BusEvent<T, P>>(
      timeoutMs,
      () => new TimeoutError(`event "${eventType}"`, timeoutMs, { eventType })
    )

    async function handler(event: BusEvent<T, P>) {
      timedPromise.resolve(event)
    }

    timedPromise.addCleanup(() => this.off(eventType, handler))
    this.on(eventType, handler)

    return timedPromise.start()
  }

  start(): void {
    this.outbox.start(this.processEvent, this.onError)
  }

  async stop(): Promise<void> {
    await this.outbox.stop()
  }

  getSubscriptionCount(): number {
    return this.handlers.size
  }

  listenerCount(eventType: string): number {
    return this.handlers.has(eventType) ? 1 : 0
  }

  eventNames(): string[] {
    return Array.from(this.handlers.keys())
  }

  async getFailedEvents(): Promise<FailedBusEvent[]> {
    if (!this.outbox.getFailedEvents) {
      throw new UnsupportedOperationError("getFailedEvents")
    }
    return this.outbox.getFailedEvents()
  }

  async retryEvents(eventIds: string[]): Promise<void> {
    if (!this.outbox.retryEvents) {
      throw new UnsupportedOperationError("retryEvents")
    }
    return this.outbox.retryEvents(eventIds)
  }

  private processEvent = async (event: BusEvent): Promise<void> => {
    const middlewareSnapshot = [...this.middlewares]

    if (middlewareSnapshot.length === 0) {
      const handler = this.handlers.get(event.type)
      if (handler) {
        await handler(event)
      }
      return
    }

    const ctx: ConsumeMiddlewareContext<TTransaction> = { event, phase: "consume" }
    await executeMiddleware(middlewareSnapshot, ctx, async () => {
      const handler = this.handlers.get(ctx.event.type)
      if (handler) {
        await handler(ctx.event)
      }
    })
  }
}
