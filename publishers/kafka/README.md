# Kafka Publisher

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/kafka-publisher?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/kafka-publisher?style=flat-square&color=2563eb)

> **High-Throughput Distributed Event Streaming**

Apache Kafka publisher for [outbox-event-bus](https://github.com/dunika/outbox-event-bus#readme). Forwards events from the outbox to Kafka topics with guaranteed at-least-once delivery and configurable partitioning.

```typescript
import { Kafka } from 'kafkajs';
import { KafkaPublisher } from '@outbox-event-bus/kafka-publisher';

const kafka = new Kafka({ brokers: ['localhost:9092'] });
const producer = kafka.producer();
await producer.connect();

const publisher = new KafkaPublisher(bus, {
  producer,
  topic: 'application-events'
});

publisher.subscribe(['user.created', 'order.placed']);
```

## When to Use

**Choose Kafka Publisher when:**
- You need **extreme scalability** and high throughput.
- You require **parallel processing** via partitions.
- You want **long-term event persistence** and replayability.
- You are building a **unified event log** for your entire organization.

**Consider alternatives when:**
- You want a **fully managed serverless service** (use AWS SNS/EventBridge).
- You have **simple queuing needs** (use SQS or RabbitMQ).
- You want to avoid the **operational complexity** of managing a Kafka cluster.

## Installation

```bash
npm install @outbox-event-bus/kafka-publisher kafkajs
```

## Configuration

### KafkaPublisherConfig

```typescript
interface KafkaPublisherConfig {
  producer: Producer;             // KafkaJS producer instance
  topic: string;                  // Target Kafka topic
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

### Configuration Options

- `producer`: An instance of the KafkaJS `Producer`.
- `topic`: The Kafka topic to publish to.
- `processingConfig`: (Optional) Settings for accumulation and batching.
    - `bufferSize`: Number of events to accumulate in memory before publishing. Default: `50`.
    - `bufferTimeoutMs`: Maximum time to wait for a buffer to fill before flushing. Default: `100ms`.
    - `concurrency`: Maximum number of concurrent batch requests to Kafka. Default: `5`.
    - `maxBatchSize`: (Optional) If set, the accumulated buffer will be split into smaller downstream batches.
- `retryConfig`: (Optional) Custom retry settings for publishing failures.
    - `maxAttempts`: Maximum number of publication attempts. Default: `3`.
    - `initialDelayMs`: Initial backoff delay in milliseconds. Default: `1000ms`.
    - `maxDelayMs`: Maximum backoff delay in milliseconds. Default: `10000ms`.

> [!TIP]
> Kafka typically performs best with larger buffers. Consider setting `bufferSize` to 100 or more if you have high throughput.

## Batching & Buffering

This publisher has **buffering enabled by default** (50 items or 100ms). While Kafka can handle much larger batches, this safe default ensures compatibility across all outbox-event-bus publishers.

To tune buffering for high throughput, adjust `bufferSize` and `bufferTimeoutMs`:
```typescript
const publisher = new KafkaPublisher(bus, {
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
import { Kafka } from 'kafkajs';
import { KafkaPublisher } from '@outbox-event-bus/kafka-publisher';

const kafka = new Kafka({ brokers: ['kafka:9092'] });
const producer = kafka.producer();
await producer.connect();

const publisher = new KafkaPublisher(bus, {
  producer,
  topic: 'events'
});

publisher.subscribe(['*']);
```

## Message Format

Events are published to Kafka as follows:

| Kafka Field | Value | Description |
|-------------|-------|-------------|
| **Key** | `event.id` | Ensures events for the same entity stay in the same partition. |
| **Value** | `JSON.stringify(event)` | The full event object. |
| **Headers** | `eventType` | The event type string. |

## Error Handling

### Application-Level Retries
The publisher implements **internal retries with exponential backoff** to handle transient Kafka failures.

```typescript
const publisher = new KafkaPublisher(bus, {
  // ...
  retryConfig: {
    maxAttempts: 5,
    initialDelayMs: 1000
  }
});
```

## Troubleshooting

### `KafkaJSProtocolError: Message was too large`
- **Cause**: The event payload exceeds the broker's `message.max.bytes`.
- **Solution**: Enable producer-side compression: `kafkajs.producer({ compression: CompressionTypes.GZIP })`.
- **Solution**: Store large payloads in S3 and pass the reference ID in the event.

### Ordering Issues
- **Cause**: Events are being sent to different partitions.
- **Solution**: The publisher uses `event.id` as the message key by default. If you need global ordering across event types for a specific entity, ensure they share the same ID or customize the partitioner.

## License

MIT © [Dunika](https://github.com/dunika)
