import type { SNSClient } from "@aws-sdk/client-sns"
import { PublishCommand } from "@aws-sdk/client-sns"
import type { BusEvent, IOutboxEventBus, IPublisher, ErrorHandler } from "outbox-event-bus"

export interface SNSPublisherConfig {
  snsClient: SNSClient
  topicArn: string
  onError?: ErrorHandler
}

export class SNSPublisher implements IPublisher {
  private readonly snsClient: SNSClient
  private readonly topicArn: string
  private readonly onError: ErrorHandler | undefined

  constructor(
    private readonly bus: IOutboxEventBus,
    config: SNSPublisherConfig
  ) {
    this.snsClient = config.snsClient
    this.topicArn = config.topicArn
    this.onError = config.onError
  }

  subscribe(eventTypes: string[]): void {
    this.bus.subscribe(eventTypes, async (event: BusEvent) => {
      try {
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
      } catch (error) {
        if (this.onError) {
          this.onError(error)
        } else {
          console.error("Failed to publish event to SNS:", error)
        }
      }
    })
  }
}
