import type { Channel } from "amqplib"
import type { BusEvent, IOutboxEventBus, IPublisher, PublisherConfig } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

export interface RabbitMQPublisherConfig extends PublisherConfig {
  channel: Channel
  exchange: string
  routingKey?: string
}

export class RabbitMQPublisher<TTransaction = unknown> implements IPublisher {
  private readonly channel: Channel
  private readonly exchange: string
  private readonly routingKey: string
  private readonly publisher: EventPublisher<TTransaction>

  constructor(
    bus: IOutboxEventBus<TTransaction>,
    config: RabbitMQPublisherConfig
  ) {
    this.channel = config.channel
    this.exchange = config.exchange
    this.routingKey = config.routingKey ?? ""
    this.publisher = new EventPublisher(bus, config)
  }

  subscribe(eventTypes: string[]): void {
    this.publisher.subscribe(eventTypes, async (events: BusEvent[]) => {
      for (const event of events) {
        const message = JSON.stringify(event)
        const published = this.channel.publish(
          this.exchange,
          this.routingKey || event.type,
          Buffer.from(message),
          {
            contentType: "application/json",
            headers: {
              eventType: event.type,
              eventId: event.id,
            },
          }
        )

        if (!published) {
          throw new Error("Failed to publish message to RabbitMQ: channel buffer full (backpressure)")
        }
      }
    })
  }
}

