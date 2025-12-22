import type { SNSClient } from "@aws-sdk/client-sns"
import { PublishBatchCommand } from "@aws-sdk/client-sns"
import type { BusEvent, IOutboxEventBus, IPublisher, PublisherConfig } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

export interface SNSPublisherConfig extends PublisherConfig {
  snsClient: SNSClient
  topicArn: string
}

const AWS_BATCH_LIMIT = 10 // SNS PublishBatch has a limit of 10 messages

export class SNSPublisher<TTransaction = unknown> implements IPublisher {
  private readonly snsClient: SNSClient
  private readonly topicArn: string
  private readonly publisher: EventPublisher<TTransaction>

  constructor(bus: IOutboxEventBus<TTransaction>, config: SNSPublisherConfig) {
    this.snsClient = config.snsClient
    this.topicArn = config.topicArn
    this.publisher = new EventPublisher(
      bus,
      EventPublisher.withOverrides(config, { maxBatchSize: AWS_BATCH_LIMIT })
    )
  }

  subscribe(eventTypes: string[]): void {
    this.publisher.subscribe(eventTypes, async (events: BusEvent[]) => {
      if (events.length === 0) return

      await this.snsClient.send(
        new PublishBatchCommand({
          TopicArn: this.topicArn,
          PublishBatchRequestEntries: events.map((event, index) => ({
            Id: event.id,
            Message: JSON.stringify(event),
            MessageAttributes: {
              EventType: {
                DataType: "String",
                StringValue: event.type,
              },
            },
          })),
        })
      )
    })
  }
}
