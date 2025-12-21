import type { Redis } from "ioredis"
import type { BusEvent, IOutboxEventBus, IPublisher, ErrorHandler, RetryOptions } from "outbox-event-bus"
import { withRetry } from "outbox-event-bus"

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
      await withRetry(
        async () => {
          await this.redisClient.xadd(
            this.streamKey,
            "*",
            "eventId", event.id,
            "eventType", event.type,
            "payload", JSON.stringify(event.payload),
            "occurredAt", (event.occurredAt ?? new Date()).toISOString(),
            "metadata", JSON.stringify(event.metadata ?? {})
          )
        },
        this.retryOptions
      )
    })
  }
}
