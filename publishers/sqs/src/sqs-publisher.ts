import type { SQSClient } from "@aws-sdk/client-sqs"
import { SendMessageCommand } from "@aws-sdk/client-sqs"
import type { BusEvent, IOutboxEventBus, IPublisher, RetryOptions } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

export interface SQSPublisherConfig {
  sqsClient: SQSClient
  queueUrl: string
  retryOptions?: RetryOptions
}

export class SQSPublisher implements IPublisher {
  private readonly sqsClient: SQSClient
  private readonly queueUrl: string
  private readonly publisher: EventPublisher

  constructor(
    bus: IOutboxEventBus,
    config: SQSPublisherConfig
  ) {
    this.sqsClient = config.sqsClient
    this.queueUrl = config.queueUrl
    this.publisher = new EventPublisher(bus, config.retryOptions)
  }

  subscribe(eventTypes: string[]): void {
    this.publisher.subscribe(eventTypes, async (event: BusEvent) => {
      await this.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(event),
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
