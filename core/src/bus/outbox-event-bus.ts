import { DuplicateListenerError, TimeoutError, UnsupportedOperationError } from "../errors/errors"
import type { IOutbox, IOutboxEventBus } from "../types/interfaces"
import type {
  AnyListener,
  BusEvent,
  BusEventInput,
  ErrorHandler,
  EventHandler,
  FailedBusEvent,
} from "../types/types"
import { createTimedPromise } from "../utils/time-utils"

const DEFAULT_WAIT_TIMEOUT_MS = 5000

type WrappedEventHandler<T extends string = string, P = unknown> = EventHandler<T, P> & {
  _original?: EventHandler<T, P>
}

export class OutboxEventBus<TTransaction> implements IOutboxEventBus<TTransaction> {
  private handlers = new Map<string, EventHandler<string, unknown>>()

  constructor(
    private readonly outbox: IOutbox<TTransaction>,
    private readonly onError: ErrorHandler
  ) {}

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

    const now = new Date()
    const eventsWithDefaults = events.map((event) => ({
      id: event.id ?? crypto.randomUUID(),
      occurredAt: event.occurredAt ?? now,
      ...event,
    })) as BusEvent[]
    await this.outbox.publish(eventsWithDefaults, transaction)
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
    const onceHandler: EventHandler<T, P> = async (event) => {
      this.off(eventType, onceHandler)
      await handler(event)
    }

    // Store original handler to allow .off(type, originalHandler) to work
    Object.assign(onceHandler, { _original: handler })
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
    return [...this.handlers.keys()]
  }

  async getFailedEvents(): Promise<FailedBusEvent[]> {
    if (this.outbox.getFailedEvents) {
      return this.outbox.getFailedEvents()
    }
    throw new UnsupportedOperationError("getFailedEvents")
  }

  async retryEvents(eventIds: string[]): Promise<void> {
    if (this.outbox.retryEvents) {
      return this.outbox.retryEvents(eventIds)
    }
    throw new UnsupportedOperationError("retryEvents")
  }

  private processEvent = async (event: BusEvent): Promise<void> => {
    const handler = this.handlers.get(event.type)
    if (!handler) return

    await handler(event)
  }
}
