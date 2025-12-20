import type { EventBridgeClient } from "@aws-sdk/client-eventbridge"
import { PutEventsCommand } from "@aws-sdk/client-eventbridge"
import type { BusEvent, IOutboxEventBus, IPublisher, ErrorHandler } from "outbox-event-bus"

export interface EventBridgePublisherConfig {
  eventBridgeClient: EventBridgeClient
  eventBusName?: string
  source: string
  onError?: ErrorHandler
}

export class EventBridgePublisher implements IPublisher {
  private readonly eventBridgeClient: EventBridgeClient
  private readonly eventBusName: string | undefined
  private readonly source: string
  private readonly onError: ErrorHandler | undefined

  constructor(
    private readonly bus: IOutboxEventBus,
    config: EventBridgePublisherConfig
  ) {
    this.eventBridgeClient = config.eventBridgeClient
    this.eventBusName = config.eventBusName
    this.source = config.source
    this.onError = config.onError
  }

  subscribe(eventTypes: string[]): void {
    this.bus.subscribe(eventTypes, async (event: BusEvent) => {
      try {
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
      } catch (error) {
        if (this.onError) {
          this.onError(error)
        } else {
          console.error("Failed to publish event to Event Bridge:", error)
        }
      }
    })
  }
}
