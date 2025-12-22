import type { Producer } from "kafkajs"
import type { BusEvent, IOutboxEventBus, IPublisher, PublisherConfig } from "outbox-event-bus"
import { EventPublisher } from "outbox-event-bus"

export interface KafkaPublisherConfig extends PublisherConfig {
  producer: Producer
  topic: string
}

export class KafkaPublisher<TTransaction = unknown> implements IPublisher {
  private readonly producer: Producer
  private readonly topic: string
  private readonly publisher: EventPublisher<TTransaction>

  constructor(bus: IOutboxEventBus<TTransaction>, config: KafkaPublisherConfig) {
    this.producer = config.producer
    this.topic = config.topic
    this.publisher = new EventPublisher(bus, config)
  }

  subscribe(eventTypes: string[]): void {
    this.publisher.subscribe(eventTypes, async (events: BusEvent[]) => {
      await this.producer.send({
        topic: this.topic,
        messages: events.map((event) => ({
          key: event.id,
          value: JSON.stringify(event),
          headers: {
            eventType: event.type,
          },
        })),
      })
    })
  }
}
