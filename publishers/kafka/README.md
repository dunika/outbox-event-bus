# Kafka Publisher

Apache Kafka publisher for [outbox-event-bus](../../README.md). Forwards events from the outbox to Kafka topics.

```typescript
import { Kafka } from 'kafkajs';
import { KafkaPublisher } from '@outbox-event-bus/kafka-publisher';

const kafka = new Kafka({ brokers: ['localhost:9092'] });
const producer = kafka.producer();
await producer.connect();

const publisher = new KafkaPublisher(bus, {
  producer,
  topic: 'events'
});

publisher.subscribe(['user.created', 'order.placed']);
```

- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Back to Main Documentation](../../README.md)

## Installation

```bash
npm install @outbox-event-bus/kafka-publisher kafkajs
```

## Configuration

### KafkaPublisherConfig

```typescript
interface KafkaPublisherConfig {
  producer: Producer;        // KafkaJS producer instance
  topic: string;             // Kafka topic name
  onError?: ErrorHandler;    // Error handler (optional)
}
```

## Usage

### Basic Setup

```typescript
import { Kafka } from 'kafkajs';
import { KafkaPublisher } from '@outbox-event-bus/kafka-publisher';

const kafka = new Kafka({
  clientId: 'my-app',
  brokers: ['kafka:9092']
});

const producer = kafka.producer();
await producer.connect();

const publisher = new KafkaPublisher(bus, {
  producer,
  topic: 'application-events',
  onError: (error) => console.error('Kafka error:', error)
});

publisher.subscribe(['user.created', 'order.placed']);
```

### Message Format

Messages are published with:
- **key**: Event ID
- **value**: Full event object as JSON
- **headers**: `eventType` header with the event type

## Back to Main Documentation

[← Back to outbox-event-bus](../../README.md)
