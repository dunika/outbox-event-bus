# RabbitMQ Publisher

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/rabbitmq-publisher?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/rabbitmq-publisher?style=flat-square&color=2563eb)

> **Enterprise-Grade Message Routing**

RabbitMQ (AMQP) publisher for [outbox-event-bus](../../README.md). Forwards events to RabbitMQ exchanges with intelligent routing and configurable retries.

```typescript
import { RabbitMQPublisher } from '@outbox-event-bus/rabbitmq-publisher';

const publisher = new RabbitMQPublisher(bus, {
  channel: amqpChannel,
  exchange: 'events-exchange',
  routingKey: 'my-app.events' // Optional
});

publisher.subscribe(['user.created']);
```

## When to Use

**Choose RabbitMQ Publisher when:**
- You need **complex routing** (fanout, topic, direct).
- You require **message prioritization**.
- You want to use **standard AMQP** protocols.
- You need to integrate with heterogeneous systems that support RabbitMQ.

**Consider alternatives when:**
- You want a **fully managed serverless service** (use AWS SNS/EventBridge).
- You need **distributed log streaming** (use Kafka).
- You want the **simplest possible setup** (use Redis Streams).

## Installation

```bash
npm install @outbox-event-bus/rabbitmq-publisher amqplib
```

## Configuration

### RabbitMQPublisherConfig

```typescript
interface RabbitMQPublisherConfig {
  channel: Channel;                 // amqplib Channel instance
  exchange: string;                 // Target exchange name
  routingKey?: string;              // Optional static routing key
  onError?: ErrorHandler;           // Error callback
  retryOptions?: RetryOptions;      // Custom retry logic
}
```

## Usage

### Basic Setup

```typescript
import { RabbitMQPublisher } from '@outbox-event-bus/rabbitmq-publisher';

const publisher = new RabbitMQPublisher(bus, {
  channel: myChannel,
  exchange: 'app-events',
  onError: (err) => console.error('RabbitMQ Publish Error:', err)
});

publisher.subscribe(['*']);
```

### Dynamic Routing
If `routingKey` is not provided, the **event type** is used as the routing key automatically.

## Message Format

Messages are published as JSON buffers:
- **Body**: `JSON.stringify(event)`
- **Content Type**: `application/json`
- **Headers**:
    - `eventType`: The event type string.
    - `eventId`: The unique event UUID.

## Error Handling

### Built-in Retries
Unlike AWS publishers, the RabbitMQ publisher implements **exponential backoff retries** internally to handle channel buffer saturation or temporary connection drops.

```typescript
const publisher = new RabbitMQPublisher(bus, {
  // ...
  retryOptions: {
    maxAttempts: 5,
    initialDelayMs: 500
  }
});
```

## Troubleshooting

### `channel buffer full`
- **Cause**: Publishing faster than RabbitMQ can accept (backpressure).
- **Solution**: Check your RabbitMQ server load and memory. The publisher will retry, but persistent failure indicates an infrastructure bottleneck.

### Unrouteable Messages
- **Cause**: Misconfigured exchange or routing keys.
- **Solution**: Ensure the exchange exists and queues are bound with appropriate keys matching the event type.
