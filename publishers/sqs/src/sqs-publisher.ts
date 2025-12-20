import type { SQSClient } from "@aws-sdk/client-sqs"
import { SendMessageCommand } from "@aws-sdk/client-sqs"
import type { BusEvent, IOutboxEventBus, IPublisher, ErrorHandler } from "outbox-event-bus"

export interface SQSPublisherConfig {
  sqsClient: SQSClient
  queueUrl: string
  onError?: ErrorHandler
}

export class SQSPublisher implements IPublisher {
  private readonly sqsClient: SQSClient
  private readonly queueUrl: string
  private readonly onError: ErrorHandler | undefined

  constructor(
    private readonly bus: IOutboxEventBus,
    config: SQSPublisherConfig
  ) {
    this.sqsClient = config.sqsClient
    this.queueUrl = config.queueUrl
    this.onError = config.onError
  }

  subscribe(eventTypes: string[]): void {
    this.bus.subscribe(eventTypes, async (event: BusEvent) => {
      try {
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
      } catch (error) {
        if (this.onError) {
          this.onError(error)
        } else {
          // Fallback to console error if no error handler is provided
          console.error("Failed to publish event to SQS:", error)
        }
      }
    })
  }
}
