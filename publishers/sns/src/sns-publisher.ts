import type { SNSClient } from "@aws-sdk/client-sns"
import { PublishCommand } from "@aws-sdk/client-sns"
import type { BusEvent, IOutboxEventBus, IPublisher, ErrorHandler, RetryOptions } from "outbox-event-bus"

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
      let lastError: unknown
      let delay = this.retryOptions.initialDelayMs

      for (let attempt = 1; attempt <= this.retryOptions.maxAttempts; attempt++) {
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
          return // Success
        } catch (error) {
          lastError = error
          if (attempt < this.retryOptions.maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, delay))
            delay = Math.min(delay * 2, this.retryOptions.maxDelayMs)
          }
        }
      }

      throw lastError
    })
  }
}
