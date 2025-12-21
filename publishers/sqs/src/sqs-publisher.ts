import type { SQSClient } from "@aws-sdk/client-sqs"
import { SendMessageCommand } from "@aws-sdk/client-sqs"
import type { BusEvent, IOutboxEventBus, IPublisher, ErrorHandler, RetryOptions } from "outbox-event-bus"
import { withRetry } from "outbox-event-bus"

export interface SQSPublisherConfig {
  sqsClient: SQSClient
  queueUrl: string
  retryOptions?: RetryOptions
}

export class SQSPublisher implements IPublisher {
  private readonly sqsClient: SQSClient
  private readonly queueUrl: string
  private readonly retryOptions: Required<RetryOptions>

  constructor(
    private readonly bus: IOutboxEventBus,
    config: SQSPublisherConfig
  ) {
    this.sqsClient = config.sqsClient
    this.queueUrl = config.queueUrl
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
        },
        this.retryOptions
      )
    })
  }
}
