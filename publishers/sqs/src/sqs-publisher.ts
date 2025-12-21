import type { SQSClient } from "@aws-sdk/client-sqs"
import { SendMessageBatchCommand } from "@aws-sdk/client-sqs"
import type { BusEvent, IOutboxEventBus, IPublisher, PublisherConfig } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

export interface SQSPublisherConfig extends PublisherConfig {
  sqsClient: SQSClient
  queueUrl: string
}

const MAX_BATCH_SIZE = 10 // SQS SendMessageBatch has a limit of 10 messages

export class SQSPublisher<TTransaction = unknown> implements IPublisher {
  private readonly sqsClient: SQSClient
  private readonly queueUrl: string
  private readonly publisher: EventPublisher<TTransaction>

  constructor(bus: IOutboxEventBus<TTransaction>, config: SQSPublisherConfig) {
    this.sqsClient = config.sqsClient
    this.queueUrl = config.queueUrl
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
        await this.sqsClient.send(
          new SendMessageBatchCommand({
            QueueUrl: this.queueUrl,
            Entries: chunk.map((event, index) => ({
              Id: event.id || `msg-${offset + index}`,
              MessageBody: JSON.stringify(event),
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
