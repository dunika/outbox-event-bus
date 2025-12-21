import type { Channel } from "amqplib"
import type { BusEvent, IOutboxEventBus, IPublisher, RetryOptions } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

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
  private readonly publisher: EventPublisher

  constructor(
    bus: IOutboxEventBus,
    config: RabbitMQPublisherConfig
  ) {
    this.channel = config.channel
    this.exchange = config.exchange
    this.routingKey = config.routingKey ?? ""
    this.publisher = new EventPublisher(bus, config.retryOptions)
  }

  subscribe(eventTypes: string[]): void {
    this.publisher.subscribe(eventTypes, async (event: BusEvent) => {
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
    })
  }
}
