import type { SendMessageBatchRequestEntry, SQSClient } from "@aws-sdk/client-sqs"
import { SendMessageBatchCommand } from "@aws-sdk/client-sqs"
import type { BusEvent, IOutboxEventBus, IPublisher, PublisherConfig } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

export interface SQSPublisherConfig extends PublisherConfig {
  sqsClient: SQSClient
  queueUrl: string
}

const AWS_BATCH_LIMIT = 10 // SQS SendMessageBatch has a limit of 10 messages

export class SQSPublisher<TTransaction = unknown> implements IPublisher {
  private readonly sqsClient: SQSClient
  private readonly queueUrl: string
  private readonly publisher: EventPublisher<TTransaction>

  constructor(bus: IOutboxEventBus<TTransaction>, config: SQSPublisherConfig) {
    this.sqsClient = config.sqsClient
    this.queueUrl = config.queueUrl
    this.publisher = new EventPublisher(
      bus,
      EventPublisher.withOverrides(config, { maxBatchSize: AWS_BATCH_LIMIT })
    )
  }

  subscribe(eventTypes: string[]): void {
    this.publisher.subscribe(eventTypes, (events) => this.processEvents(events))
  }

  private async processEvents(events: BusEvent[]): Promise<void> {
    if (events.length === 0) return

    const isFifo = this.queueUrl.endsWith(".fifo")

    await this.sqsClient.send(
      new SendMessageBatchCommand({
        QueueUrl: this.queueUrl,
        Entries: events.map((event) => {
          const entry: SendMessageBatchRequestEntry = {
            Id: event.id,
            MessageBody: JSON.stringify(event),
            MessageAttributes: {
              EventType: {
                DataType: "String",
                StringValue: event.type,
              },
            },
          }

          if (isFifo) {
            entry.MessageGroupId = event.type
            entry.MessageDeduplicationId = event.id
          }

          return entry
        }),
      })
    )
  }
}
