import type { Producer } from "kafkajs"
import type { BusEvent, IOutboxEventBus, IPublisher, RetryOptions } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

export interface KafkaPublisherConfig {
  producer: Producer
  topic: string
  retryOptions?: RetryOptions
}

export class KafkaPublisher implements IPublisher {
  private readonly producer: Producer
  private readonly topic: string
  private readonly publisher: EventPublisher

  constructor(
    bus: IOutboxEventBus,
    config: KafkaPublisherConfig
  ) {
    this.producer = config.producer
    this.topic = config.topic
    this.publisher = new EventPublisher(bus, config.retryOptions)
  }

  subscribe(eventTypes: string[]): void {
    this.publisher.subscribe(eventTypes, async (event: BusEvent) => {
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
    })
  }
}
