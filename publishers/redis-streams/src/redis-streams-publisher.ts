import type { Redis } from "ioredis"
import type { BusEvent, IOutboxEventBus, IPublisher, PublisherConfig } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

export interface RedisStreamsPublisherConfig extends PublisherConfig {
  redisClient: Redis
  streamKey: string
}

export class RedisStreamsPublisher<TTransaction = unknown> implements IPublisher {
  private readonly redisClient: Redis
  private readonly streamKey: string
  private readonly publisher: EventPublisher<TTransaction>

  constructor(
    bus: IOutboxEventBus<TTransaction>,
    config: RedisStreamsPublisherConfig
  ) {
    this.redisClient = config.redisClient
    this.streamKey = config.streamKey
    this.publisher = new EventPublisher(bus, config)
  }

  subscribe(eventTypes: string[]): void {
    this.publisher.subscribe(eventTypes, async (events: BusEvent[]) => {
      if (events.length === 0) return

      const pipeline = this.redisClient.pipeline()
      for (const event of events) {
        pipeline.xadd(
          this.streamKey,
          "*",
          "eventId", event.id || "",
          "eventType", event.type,
          "payload", JSON.stringify(event.payload),
          "occurredAt", (event.occurredAt ?? new Date()).toISOString(),
          "metadata", JSON.stringify(event.metadata ?? {})
        )
      }
      await pipeline.exec()
    })
  }
}

