import type { SNSClient } from "@aws-sdk/client-sns"
import { PublishCommand } from "@aws-sdk/client-sns"
import type { BusEvent, IOutboxEventBus, IPublisher, RetryOptions } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

export interface SNSPublisherConfig {
  snsClient: SNSClient
  topicArn: string
  retryOptions?: RetryOptions
}

export class SNSPublisher implements IPublisher {
  private readonly snsClient: SNSClient
  private readonly topicArn: string
  private readonly publisher: EventPublisher

  constructor(
    bus: IOutboxEventBus,
    config: SNSPublisherConfig
  ) {
    this.snsClient = config.snsClient
    this.topicArn = config.topicArn
    this.publisher = new EventPublisher(bus, config.retryOptions)
  }

  subscribe(eventTypes: string[]): void {
    this.publisher.subscribe(eventTypes, async (event: BusEvent) => {
      await this.snsClient.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Message: JSON.stringify(event),
          MessageAttributes: {
            EventType: {
              DataType: "String",
              StringValue: event.type
            }
          }
        })
      )
    })
  }
}
