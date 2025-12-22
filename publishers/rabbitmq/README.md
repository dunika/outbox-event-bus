# RabbitMQ Publisher

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/rabbitmq-publisher?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/rabbitmq-publisher?style=flat-square&color=2563eb)

> **Enterprise-Grade Message Routing**

RabbitMQ (AMQP) publisher for [outbox-event-bus](https://github.com/dunika/outbox-event-bus#readme). Forwards events to RabbitMQ exchanges with intelligent routing and configurable retries.

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
  channel: Channel;               // amqplib Channel instance
  exchange: string;               // Target exchange name
  routingKey?: string;            // Optional static routing key
  processingConfig?: {
    bufferSize?: number;          // Default: 50
    bufferTimeoutMs?: number;     // Default: 100
    concurrency?: number;         // Default: 5
    maxBatchSize?: number;        // Optional downstream batch limit
  };
  retryConfig?: {
    maxAttempts?: number;         // Default: 3
    initialDelayMs?: number;      // Default: 1000
    maxDelayMs?: number;          // Default: 10000
  };
}
```

## Batching & Buffering

This publisher has **buffering enabled by default** (50 items or 100ms). This safe default ensures efficient use of the AMQP channel while maintaining low latency.

To tune buffering, adjust the `processingConfig`:
```typescript
const publisher = new RabbitMQPublisher(bus, {
  // ...
  processingConfig: {
    bufferSize: 100,
    bufferTimeoutMs: 50
  }
});
```

## Usage

### Basic Setup

```typescript
import { RabbitMQPublisher } from '@outbox-event-bus/rabbitmq-publisher';

const publisher = new RabbitMQPublisher(bus, {
  channel: myChannel,
  exchange: 'app-events'
});

publisher.subscribe(['*']);
```

### Dynamic Routing
If `routingKey` is not provided, the **event type** is used as the routing key automatically.

### Configuration Options

- `channel`: An instance of the `amqplib` `Channel`.
- `exchange`: The exchange to publish to.
- `routingKey`: (Optional) The routing key. Default: uses `event.type`.
- `processingConfig`: (Optional) Settings for accumulation and batching.
    - `bufferSize`: Number of events to accumulation in memory before publishing. Default: `50`.
    - `bufferTimeoutMs`: Maximum time to wait for a buffer to fill before flushing. Default: `100ms`.
    - `concurrency`: Maximum number of concurrent processing tasks. Default: `5`.
    - `maxBatchSize`: (Optional) If set, the accumulated buffer will be split into smaller downstream batches.
- `retryConfig`: (Optional) Custom retry settings for publishing failures.
    - `maxAttempts`: Maximum number of publication attempts. Default: `3`.
    - `initialDelayMs`: Initial backoff delay in milliseconds. Default: `1000ms`.
    - `maxDelayMs`: Maximum backoff delay in milliseconds. Default: `10000ms`.

> [!NOTE]
> RabbitMQ publishers are often used with smaller buffers for lower latency, but larger buffers can significantly improve throughput for high-volume event streams.

## Message Format

Messages are published as JSON buffers:

| AMQP Field | Value | Description |
|------------|-------|-------------|
| **Body** | `JSON.stringify(event)` | The full event object. |
| **Routing Key** | `config.routingKey` or `event.type` | Used for routing to queues. |
| **Headers** | `eventType`, `eventId` | Metadata headers. |

## Error Handling

### Application-Level Retries
The RabbitMQ publisher implements **exponential backoff retries** to handle channel buffer saturation or temporary connection drops.

```typescript
const publisher = new RabbitMQPublisher(bus, {
  // ...
  retryConfig: {
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

## License

MIT © [Dunika](https://github.com/dunika)
