# RabbitMQ Publisher

RabbitMQ publisher for [outbox-event-bus](../../README.md). Forwards events from the outbox to RabbitMQ exchanges.

```typescript
import amqp from 'amqplib';
import { RabbitMQPublisher } from '@outbox-event-bus/rabbitmq-publisher';

const connection = await amqp.connect('amqp://localhost');
const channel = await connection.createChannel();

const publisher = new RabbitMQPublisher(bus, {
  channel,
  exchange: 'events',
  routingKey: '' // optional
});

publisher.subscribe(['user.created', 'order.placed']);
```

- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Back to Main Documentation](../../README.md)

## Installation

```bash
npm install @outbox-event-bus/rabbitmq-publisher amqplib
npm install -D @types/amqplib
```

## Configuration

### RabbitMQPublisherConfig

```typescript
interface RabbitMQPublisherConfig {
  channel: Channel;          // amqplib channel instance
  exchange: string;          // Exchange name
  routingKey?: string;       // Routing key (optional, defaults to event type)
  onError?: ErrorHandler;    // Error handler (optional)
}
```

## Usage

### Basic Setup

```typescript
import amqp from 'amqplib';
import { RabbitMQPublisher } from '@outbox-event-bus/rabbitmq-publisher';

const connection = await amqp.connect('amqp://localhost');
const channel = await connection.createChannel();

// Declare exchange
await channel.assertExchange('events', 'topic', { durable: true });

const publisher = new RabbitMQPublisher(bus, {
  channel,
  exchange: 'events',
  onError: (error) => console.error('RabbitMQ error:', error)
});

publisher.subscribe(['user.created', 'order.placed']);
```

### Message Format

Messages are published with:
- **Content-Type**: `application/json`
- **Headers**: `eventType` and `eventId`
- **Routing Key**: Configured routing key or event type

## Back to Main Documentation

[← Back to outbox-event-bus](../../README.md)
