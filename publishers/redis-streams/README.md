# Redis Streams Publisher

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/redis-streams-publisher?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/redis-streams-publisher?style=flat-square&color=2563eb)

> **High-Throughput Log Streaming with Redis**

Redis Streams publisher for [outbox-event-bus](https://github.com/dunika/outbox-event-bus#readme). Appends events to Redis Streams for efficient consumption by multiple consumer groups.

```typescript
import { RedisStreamsPublisher } from '@outbox-event-bus/redis-streams-publisher';

const publisher = new RedisStreamsPublisher(bus, {
  redisClient: new Redis(),
  streamKey: 'app-events-stream'
});

publisher.subscribe(['user.*']);
```

## When to Use

**Choose Redis Streams Publisher when:**
- You need **extremely high throughput** (millions of events/sec).
- You want **persistent log-based** messaging with consumer groups.
- You are already using **Redis** for your outbox or caching.
- You need **fan-out** to multiple independent services.

**Consider alternatives when:**
- You need **complex routing** (use RabbitMQ).
- You want **managed AWS services** (use SNS/EventBridge).
- You require **exactly-once processing** (no system is perfect, but Kafka has better support for this).

## Installation

```bash
npm install @outbox-event-bus/redis-streams-publisher ioredis
```

## Configuration

### RedisStreamsPublisherConfig

```typescript
interface RedisStreamsPublisherConfig {
  redisClient: Redis;             // ioredis client instance
  streamKey: string;              // Key of the Redis Stream
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

- `redisClient`: An instance of `ioredis`.
- `streamKey`: The Redis key for the stream.
- `processingConfig`: (Optional) Settings for accumulation and batching.
    - `bufferSize`: Number of events to accumulate in memory before publishing. Default: `50`.
    - `bufferTimeoutMs`: Maximum time to wait for a buffer to fill before flushing. Default: `100ms`.
    - `concurrency`: Maximum number of concurrent processing tasks. Default: `5`.
    - `maxBatchSize`: (Optional) If set, the accumulated buffer will be split into smaller downstream batches.
- `retryConfig`: (Optional) Custom retry settings for publishing failures.
    - `maxAttempts`: Maximum number of publication attempts. Default: `3`.
    - `initialDelayMs`: Initial backoff delay in milliseconds. Default: `1000ms`.
    - `maxDelayMs`: Maximum backoff delay in milliseconds. Default: `10000ms`.

> [!NOTE]
> This publisher uses Redis **Pipelines** to efficiently publish multiple events in a single round-trip.

## Batching & Buffering

This publisher has **buffering enabled by default** (50 items or 100ms).

To tune buffering for high throughput, adjust `bufferSize` and `bufferTimeoutMs`:
```typescript
const publisher = new RedisStreamsPublisher(bus, {
  // ...
  processingConfig: {
    bufferSize: 50,
    bufferTimeoutMs: 10
  }
});
```

## Message Format

Events are added to the stream using `XADD` with the following field mapping:

> [!NOTE]
> Unlike other publishers that send the full event object as JSON, Redis Streams stores events as **flattened key-value fields** for efficient stream operations and consumer group processing.

| Redis Field | Value | Description |
|-------------|-------|-------------|
| **eventId** | `event.id` | The unique event UUID. |
| **eventType** | `event.type` | The event type string. |
| **payload** | `JSON.stringify(event.payload)` | The full event payload. |
| **occurredAt** | `event.occurredAt.toISOString()` | ISO timestamp of the event. |
| **metadata** | `JSON.stringify(event.metadata)` | Optional metadata. |

## Error Handling

### Connectivity
Ensure your Redis client is configured with a robust retry strategy.

### Application-Level Retries
You can also configure application-level retries for command failures:
```typescript
const publisher = new RedisStreamsPublisher(bus, {
  // ...
  retryConfig: {
    maxAttempts: 3,
    initialDelayMs: 1000
  }
});
```



The publisher will propagate any terminal Redis errors to the `OutboxEventBus` error handler.

## Troubleshooting

### Stream growing too large
- **Cause**: Redis Streams are not capped by default.
- **Solution**: Use `XTRIM` or the `MAXLEN` option in your consumption logic to truncate old events. The publisher presently uses `*` for ID generation and does not cap the stream.

### Data persistence
- **Cause**: Redis is in-memory.
- **Solution**: Enable AOF (Append Only File) persistence in Redis to ensure stream data survives a restart.

## License

MIT © [Dunika](https://github.com/dunika)
