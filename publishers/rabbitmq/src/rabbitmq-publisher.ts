import type { Channel } from "amqplib"
import type { BusEvent, IOutboxEventBus, IPublisher, ErrorHandler, RetryOptions } from "outbox-event-bus"

export interface RabbitMQPublisherConfig {
  channel: Channel
  exchange: string
  routingKey?: string
  retryOptions?: RetryOptions
}

export class RabbitMQPublisher implements IPublisher {
  private readonly channel: Channel
  private readonly exchange: string
  private readonly routingKey: string
  private readonly retryOptions: Required<RetryOptions>

  constructor(
    private readonly bus: IOutboxEventBus,
    config: RabbitMQPublisherConfig
  ) {
    this.channel = config.channel
    this.exchange = config.exchange
    this.routingKey = config.routingKey ?? ""
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
          const message = JSON.stringify(event)
          const published = this.channel.publish(
            this.exchange,
            this.routingKey || event.type,
            Buffer.from(message),
            {
              contentType: "application/json",
              headers: {
                eventType: event.type,
                eventId: event.id
              }
            }
          )

          if (!published) {
            throw new Error("Failed to publish message to RabbitMQ: channel buffer full")
          }
          
          return // Success
        } catch (error) {
          lastError = error
          if (attempt < this.retryOptions.maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, delay))
            delay = Math.min(delay * 2, this.retryOptions.maxDelayMs)
          }
        }
      }

      // If we reach here, all attempts failed
      throw lastError
    })
  }
}
