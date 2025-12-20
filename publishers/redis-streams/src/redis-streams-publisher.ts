import type { Redis } from "ioredis"
import type { BusEvent, IOutboxEventBus, IPublisher, ErrorHandler } from "outbox-event-bus"

export interface RedisStreamsPublisherConfig {
  redisClient: Redis
  streamKey: string
  onError?: ErrorHandler
}

export class RedisStreamsPublisher implements IPublisher {
  private readonly redisClient: Redis
  private readonly streamKey: string
  private readonly onError: ErrorHandler | undefined

  constructor(
    private readonly bus: IOutboxEventBus,
    config: RedisStreamsPublisherConfig
  ) {
    this.redisClient = config.redisClient
    this.streamKey = config.streamKey
    this.onError = config.onError
  }

  subscribe(eventTypes: string[]): void {
    this.bus.subscribe(eventTypes, async (event: BusEvent) => {
      try {
        await this.redisClient.xadd(
          this.streamKey,
          "*",
          "eventId", event.id,
          "eventType", event.type,
          "payload", JSON.stringify(event.payload),
          "occurredAt", event.occurredAt.toISOString(),
          "metadata", JSON.stringify(event.metadata ?? {})
        )
      } catch (error) {
        if (this.onError) {
          this.onError(error)
        } 
      }
    })
  }
}
