import type { EventBridgeClient } from "@aws-sdk/client-eventbridge"
import { PutEventsCommand } from "@aws-sdk/client-eventbridge"
import type { BusEvent, IOutboxEventBus, IPublisher, PublisherConfig } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

export interface EventBridgePublisherConfig extends PublisherConfig {
  eventBridgeClient: EventBridgeClient
  eventBusName?: string
  source: string
}

const AWS_BATCH_LIMIT = 10

export class EventBridgePublisher<TTransaction = unknown> implements IPublisher {
  private readonly eventBridgeClient: EventBridgeClient
  private readonly eventBusName: string | undefined
  private readonly source: string
  private readonly publisher: EventPublisher<TTransaction>

  constructor(bus: IOutboxEventBus<TTransaction>, config: EventBridgePublisherConfig) {
    this.eventBridgeClient = config.eventBridgeClient
    this.eventBusName = config.eventBusName
    this.source = config.source
    this.publisher = new EventPublisher(
      bus,
      EventPublisher.withOverrides(config, { maxBatchSize: AWS_BATCH_LIMIT })
    )
  }

  subscribe(eventTypes: string[]): void {
    this.publisher.subscribe(eventTypes, async (events: BusEvent[]) => {
      if (events.length === 0) return

      await this.eventBridgeClient.send(
        new PutEventsCommand({
          Entries: events.map((event) => ({
            Source: this.source,
            DetailType: event.type,
            Detail: JSON.stringify(event),
            EventBusName: this.eventBusName,
            Time: event.occurredAt,
          })),
        })
      )
    })
  }
}
