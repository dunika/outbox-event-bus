import type { SNSClient } from "@aws-sdk/client-sns"
import { PublishCommand } from "@aws-sdk/client-sns"
import type { BusEvent, IOutboxEventBus, IPublisher, ErrorHandler, RetryOptions } from "outbox-event-bus"
import { withRetry } from "outbox-event-bus"

export interface SNSPublisherConfig {
  snsClient: SNSClient
  topicArn: string
  retryOptions?: RetryOptions
}

export class SNSPublisher implements IPublisher {
  private readonly snsClient: SNSClient
  private readonly topicArn: string
  private readonly retryOptions: Required<RetryOptions>

  constructor(
    private readonly bus: IOutboxEventBus,
    config: SNSPublisherConfig
  ) {
    this.snsClient = config.snsClient
    this.topicArn = config.topicArn
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
        },
        this.retryOptions
      )
    })
  }
}
