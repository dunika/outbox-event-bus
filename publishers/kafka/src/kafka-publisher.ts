import type { Producer } from "kafkajs"
import type { BusEvent, IOutboxEventBus, IPublisher, ErrorHandler } from "outbox-event-bus"

export interface KafkaPublisherConfig {
  producer: Producer
  topic: string
  onError?: ErrorHandler
}

export class KafkaPublisher implements IPublisher {
  private readonly producer: Producer
  private readonly topic: string
  private readonly onError: ErrorHandler | undefined

  constructor(
    private readonly bus: IOutboxEventBus,
    config: KafkaPublisherConfig
  ) {
    this.producer = config.producer
    this.topic = config.topic
    this.onError = config.onError
  }

  subscribe(eventTypes: string[]): void {
    this.bus.subscribe(eventTypes, async (event: BusEvent) => {
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
      } catch (error) {
        if (this.onError) {
          this.onError(error)
        } else {
          console.error("Failed to publish event to Kafka:", error)
        }
      }
    })
  }
}
