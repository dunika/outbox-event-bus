import type { Redis } from "ioredis"
import type { BusEvent, IOutboxEventBus, IPublisher, ErrorHandler, RetryOptions } from "outbox-event-bus"

export interface RedisStreamsPublisherConfig {
  redisClient: Redis
  streamKey: string
  retryOptions?: RetryOptions
}

export class RedisStreamsPublisher implements IPublisher {
  private readonly redisClient: Redis
  private readonly streamKey: string
  private readonly retryOptions: Required<RetryOptions>

  constructor(
    private readonly bus: IOutboxEventBus,
    config: RedisStreamsPublisherConfig
  ) {
    this.redisClient = config.redisClient
    this.streamKey = config.streamKey
    this.retryOptions = {
      maxAttempts: config.retryOptions?.maxAttempts ?? 3,
      initialDelayMs: config.retryOptions?.initialDelayMs ?? 1000,
      maxDelayMs: config.retryOptions?.maxDelayMs ?? 10000,
    }
  }

  subscribe(eventTypes: string[]): void {
    this.bus.subscribe(eventTypes, async (event: BusEvent) => {
      let lastError: unknown
      let delay = this.retryOptions.initialDelayMs

      for (let attempt = 1; attempt <= this.retryOptions.maxAttempts; attempt++) {
        try {
          await this.redisClient.xadd(
            this.streamKey,
            "*",
            "eventId", event.id,
            "eventType", event.type,
            "payload", JSON.stringify(event.payload),
            "occurredAt", (event.occurredAt ?? new Date()).toISOString(),
            "metadata", JSON.stringify(event.metadata ?? {})
          )
          return // Success
        } catch (error) {
          lastError = error
          if (attempt < this.retryOptions.maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, delay))
            delay = Math.min(delay * 2, this.retryOptions.maxDelayMs)
          }
        }
      }

      throw lastError
    })
  }
}
