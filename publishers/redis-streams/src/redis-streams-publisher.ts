import type { Redis } from "ioredis"
import type { BusEvent, IOutboxEventBus, IPublisher, RetryOptions } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

export interface RedisStreamsPublisherConfig {
  redisClient: Redis
  streamKey: string
  retryOptions?: RetryOptions
}

export class RedisStreamsPublisher implements IPublisher {
  private readonly redisClient: Redis
  private readonly streamKey: string
  private readonly publisher: EventPublisher

  constructor(
    bus: IOutboxEventBus,
    config: RedisStreamsPublisherConfig
  ) {
    this.redisClient = config.redisClient
    this.streamKey = config.streamKey
    this.publisher = new EventPublisher(bus, config.retryOptions)
  }

  subscribe(eventTypes: string[]): void {
    this.publisher.subscribe(eventTypes, async (event: BusEvent) => {
      await this.redisClient.xadd(
        this.streamKey,
        "*",
        "eventId", event.id,
        "eventType", event.type,
        "payload", JSON.stringify(event.payload),
        "occurredAt", (event.occurredAt ?? new Date()).toISOString(),
        "metadata", JSON.stringify(event.metadata ?? {})
      )
    })
  }
}
