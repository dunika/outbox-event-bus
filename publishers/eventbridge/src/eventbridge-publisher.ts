import type { EventBridgeClient } from "@aws-sdk/client-eventbridge"
import { PutEventsCommand } from "@aws-sdk/client-eventbridge"
import type { BusEvent, IOutboxEventBus, IPublisher, RetryOptions } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

export interface EventBridgePublisherConfig {
  eventBridgeClient: EventBridgeClient
  eventBusName?: string
  source: string
  retryOptions?: RetryOptions
}

export class EventBridgePublisher implements IPublisher {
  private readonly eventBridgeClient: EventBridgeClient
  private readonly eventBusName: string | undefined
  private readonly source: string
  private readonly publisher: EventPublisher

  constructor(
    bus: IOutboxEventBus,
    config: EventBridgePublisherConfig
  ) {
    this.eventBridgeClient = config.eventBridgeClient
    this.eventBusName = config.eventBusName
    this.source = config.source
    this.publisher = new EventPublisher(bus, config.retryOptions)
  }

  subscribe(eventTypes: string[]): void {
    this.publisher.subscribe(eventTypes, async (event: BusEvent) => {
      await this.eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: this.source,
              DetailType: event.type,
              Detail: JSON.stringify(event),
              EventBusName: this.eventBusName,
              Time: event.occurredAt
            }
          ]
        })
      )
    })
  }
}
