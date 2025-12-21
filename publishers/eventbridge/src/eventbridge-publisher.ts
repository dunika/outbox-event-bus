import type { EventBridgeClient } from "@aws-sdk/client-eventbridge"
import { PutEventsCommand } from "@aws-sdk/client-eventbridge"
import type { BusEvent, IOutboxEventBus, IPublisher, ErrorHandler, RetryOptions } from "outbox-event-bus"
import { withRetry } from "outbox-event-bus"

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
  private readonly retryOptions: Required<RetryOptions>

  constructor(
    private readonly bus: IOutboxEventBus,
    config: EventBridgePublisherConfig
  ) {
    this.eventBridgeClient = config.eventBridgeClient
    this.eventBusName = config.eventBusName
    this.source = config.source
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
        },
        this.retryOptions
      )
    })
  }
}
