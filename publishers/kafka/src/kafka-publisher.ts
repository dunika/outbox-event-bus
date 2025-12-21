import type { Producer } from "kafkajs"
import type { BusEvent, IOutboxEventBus, IPublisher, ErrorHandler, RetryOptions } from "outbox-event-bus"

export interface KafkaPublisherConfig {
  producer: Producer
  topic: string
  retryOptions?: RetryOptions
}

export class KafkaPublisher implements IPublisher {
  private readonly producer: Producer
  private readonly topic: string
  private readonly retryOptions: Required<RetryOptions>

  constructor(
    private readonly bus: IOutboxEventBus,
    config: KafkaPublisherConfig
  ) {
    this.producer = config.producer
    this.topic = config.topic
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
          await this.producer.send({
            topic: this.topic,
            messages: [
              {
                key: event.id,
                value: JSON.stringify(event),
                headers: {
                  eventType: event.type
                }
              }
            ]
          })
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
