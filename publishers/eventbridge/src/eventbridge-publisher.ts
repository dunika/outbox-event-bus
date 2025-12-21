import type { EventBridgeClient } from "@aws-sdk/client-eventbridge"
import { PutEventsCommand } from "@aws-sdk/client-eventbridge"
import type { BusEvent, IOutboxEventBus, IPublisher, PublisherConfig } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

export interface EventBridgePublisherConfig extends PublisherConfig {
  eventBridgeClient: EventBridgeClient
  eventBusName?: string
  source: string
}

const MAX_BATCH_SIZE = 10 // EventBridge PutEvents has a limit of 10 entries per request

export class EventBridgePublisher<TTransaction = unknown> implements IPublisher {
  private readonly eventBridgeClient: EventBridgeClient
  private readonly eventBusName: string | undefined
  private readonly source: string
  private readonly publisher: EventPublisher<TTransaction>

  constructor(bus: IOutboxEventBus<TTransaction>, config: EventBridgePublisherConfig) {
    this.eventBridgeClient = config.eventBridgeClient
    this.eventBusName = config.eventBusName
    this.source = config.source
    this.publisher = new EventPublisher(bus, {
      ...config,
      batchConfig: {
        batchSize: config.batchConfig?.batchSize ?? MAX_BATCH_SIZE,
        batchTimeoutMs: config.batchConfig?.batchTimeoutMs ?? 100,
      },
    })
  }

  subscribe(eventTypes: string[]): void {
    this.publisher.subscribe(eventTypes, async (events: BusEvent[]) => {
      if (events.length === 0) return

      for (let i = 0; i < events.length; i += MAX_BATCH_SIZE) {
        const chunk = events.slice(i, i + MAX_BATCH_SIZE)
        await this.eventBridgeClient.send(
          new PutEventsCommand({
            Entries: chunk.map((event) => ({
              Source: this.source,
              DetailType: event.type,
              Detail: JSON.stringify(event),
              EventBusName: this.eventBusName,
              Time: event.occurredAt,
            })),
          })
        )
      }
    })
  }
}
