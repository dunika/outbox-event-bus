import type { IOutbox, IOutboxEventBus } from "./interfaces"
import type { BusEvent, EventHandler, AnyListener, ErrorHandler } from "./types"

const DEFAULT_WAIT_TIMEOUT_MS = 5000

export class OutboxEventBus implements IOutboxEventBus {
  private readonly handlers = new Map<string, EventHandler<string, unknown>[]>()
  private maxListeners = 10

  constructor(
    private readonly outbox: IOutbox,
    private readonly onMaxListeners: (
      bus: OutboxEventBus,
      eventType: string,
      count: number
    ) => void,
    private readonly onError: ErrorHandler
  ) {}

  async emit<T extends string, P>(event: BusEvent<T, P>): Promise<void> {
    const eventWithTimestamp = {
      ...event,
      occurredAt: event.occurredAt ?? new Date(),
    }
    await this.outbox.publish([eventWithTimestamp])
  }

  async emitMany<T extends string, P>(events: BusEvent<T, P>[]): Promise<void> {
    const eventsWithTimestamps = events.map((event) => ({
      ...event,
      occurredAt: event.occurredAt ?? new Date(),
    }))
    await this.outbox.publish(eventsWithTimestamps)
  }

  on<T extends string, P = unknown>(eventType: T, handler: EventHandler<T, P>): this {
    return this.addListenerInternal(eventType, handler, false)
  }

  addListener<T extends string, P = unknown>(eventType: T, handler: EventHandler<T, P>): this {
    return this.on(eventType, handler)
  }

  prependListener<T extends string, P = unknown>(eventType: T, handler: EventHandler<T, P>): this {
    return this.addListenerInternal(eventType, handler, true)
  }

  once<T extends string, P = unknown>(eventType: T, handler: EventHandler<T, P>): this {
    const onceHandler: EventHandler<T, P> = async (event) => {
      this.off(eventType, onceHandler)
      await handler(event)
    }
    return this.on(eventType, onceHandler)
  }

  prependOnceListener<T extends string, P = unknown>(
    eventType: T,
    handler: EventHandler<T, P>
  ): this {
    const onceHandler: EventHandler<T, P> = async (event) => {
      this.off(eventType, onceHandler)
      await handler(event)
    }
    return this.prependListener(eventType, onceHandler)
  }

  off<T extends string, P = unknown>(eventType: T | T[], handler: EventHandler<T, P>): this {
    const eventTypes = Array.isArray(eventType) ? eventType : [eventType]

    for (const type of eventTypes) {
      const handlers = this.handlers.get(type)
      if (!handlers) continue

      const index = handlers.indexOf(handler as EventHandler<string, unknown>)
      if (index !== -1) {
        handlers.splice(index, 1)
        if (handlers.length === 0) {
          this.handlers.delete(type)
        }
      }
    }

    return this
  }

  removeListener<T extends string, P = unknown>(
    eventType: T | T[],
    handler: EventHandler<T, P>
  ): this {
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

  setMaxListeners(n: number): this {
    this.maxListeners = n
    return this
  }

  rawListeners(eventType: string): AnyListener[] {
    return [...(this.handlers.get(eventType) ?? [])] as AnyListener[]
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
    return new Promise((resolve, reject) => {
      let cleanup: (() => void) | undefined

      async function handler(event: BusEvent<T, P>): Promise<void> {
        cleanup?.()
        resolve(event)
      }

      const timer = setTimeout(() => {
        cleanup?.()
        reject(new Error(`Timed out waiting for event "${eventType}" after ${timeoutMs}ms`))
      }, timeoutMs)

      cleanup = () => {
        clearTimeout(timer)
        this.off(eventType, handler)
        cleanup = undefined
      }

      this.on(eventType, handler)
    })
  }

  start(): void {
    this.outbox.start(
      async (events) => {
        await Promise.all(events.map((event) => this.processEvent(event)))
      },
      this.onError
    )
  }

  async stop(): Promise<void> {
    await this.outbox.stop()
  }

  getSubscriptionCount(): number {
    let sum = 0
    for (const handlers of this.handlers.values()) {
      sum += handlers.length
    }
    return sum
  }

  listenerCount(eventType: string): number {
    return this.handlers.get(eventType)?.length ?? 0
  }

  eventNames(): string[] {
    return Array.from(this.handlers.keys())
  }

  private addListenerInternal<T extends string, P = unknown>(
    eventType: T,
    handler: EventHandler<T, P>,
    prepend: boolean
  ): this {
    let handlers = this.handlers.get(eventType)
    if (!handlers) {
      handlers = []
      this.handlers.set(eventType, handlers)
    }

    if (handlers.length >= this.maxListeners) {
      this.onMaxListeners(this, eventType, handlers.length)
    }

    if (prepend) {
      handlers.unshift(handler as EventHandler<string, unknown>)
    } else {
      handlers.push(handler as EventHandler<string, unknown>)
    }

    return this
  }

  private async processEvent(event: BusEvent): Promise<void> {
    const handlers = this.handlers.get(event.type)
    if (!handlers?.length) return

    // Use a shallow copy so that mutations (remove/add) during handler
    // execution do not affect this loop
    const promises = [...handlers].map(async (handler) => {
      try {
        await handler(event)
      } catch (err) {
        this.onError(err)
      }
    })

    await Promise.all(promises)
  }
}
