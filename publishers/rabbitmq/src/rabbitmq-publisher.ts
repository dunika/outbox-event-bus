import type { Channel } from "amqplib"
import type { BusEvent, IOutboxEventBus, IPublisher, ErrorHandler } from "outbox-event-bus"

export interface RabbitMQPublisherConfig {
  channel: Channel
  exchange: string
  routingKey?: string
  onError?: ErrorHandler
}

export class RabbitMQPublisher implements IPublisher {
  private readonly channel: Channel
  private readonly exchange: string
  private readonly routingKey: string
  private readonly onError: ErrorHandler | undefined

  constructor(
    private readonly bus: IOutboxEventBus,
    config: RabbitMQPublisherConfig
  ) {
    this.channel = config.channel
    this.exchange = config.exchange
    this.routingKey = config.routingKey ?? ""
    this.onError = config.onError
  }

  subscribe(eventTypes: string[]): void {
    this.bus.subscribe(eventTypes, async (event: BusEvent) => {
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
      } catch (error) {
        if (this.onError) {
          this.onError(error)
        } else {
          console.error("Failed to publish event to RabbitMQ:", error)
        }
      }
    })
  }
}
