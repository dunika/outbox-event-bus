import type { SNSClient } from "@aws-sdk/client-sns"
import { PublishBatchCommand } from "@aws-sdk/client-sns"
import type { BusEvent, IOutboxEventBus, IPublisher, PublisherConfig } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

export interface SNSPublisherConfig extends PublisherConfig {
  snsClient: SNSClient
  topicArn: string
}

const MAX_BATCH_SIZE = 10 // SNS PublishBatch has a limit of 10 messages

export class SNSPublisher<TTransaction = unknown> implements IPublisher {
  private readonly snsClient: SNSClient
  private readonly topicArn: string
  private readonly publisher: EventPublisher<TTransaction>

  constructor(bus: IOutboxEventBus<TTransaction>, config: SNSPublisherConfig) {
    this.snsClient = config.snsClient
    this.topicArn = config.topicArn
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

      for (let offset = 0; offset < events.length; offset += MAX_BATCH_SIZE) {
        const chunk = events.slice(offset, offset + MAX_BATCH_SIZE)
        await this.snsClient.send(
          new PublishBatchCommand({
            TopicArn: this.topicArn,
            PublishBatchRequestEntries: chunk.map((event, index) => ({
              Id: event.id || `msg-${offset + index}`,
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
      }
    })
  }
}
