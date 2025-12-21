# Redis Streams Publisher

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/redis-streams-publisher?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/redis-streams-publisher?style=flat-square&color=2563eb)

> **High-Throughput Log Streaming with Redis**

Redis Streams publisher for [outbox-event-bus](../../README.md). Appends events to Redis Streams for efficient consumption by multiple consumer groups.

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
- You require **exactly-once processing** (no system is perfect, but Kafka has better supports for this).

## Installation

```bash
npm install @outbox-event-bus/redis-streams-publisher ioredis
```

## Configuration

### RedisStreamsPublisherConfig

```typescript
interface RedisStreamsPublisherConfig {
  redisClient: Redis;    // ioredis client instance
  streamKey: string;     // Key of the Redis Stream
  onError?: ErrorHandler; // Error callback
  retryOptions?: RetryOptions; // Application-level retry logic
}
```

## Usage

### Basic Setup

```typescript
import Redis from 'ioredis';
import { RedisStreamsPublisher } from '@outbox-event-bus/redis-streams-publisher';

const publisher = new RedisStreamsPublisher(bus, {
  redisClient: new Redis(),
  streamKey: 'logs',
  onError: (err) => console.error('Redis Stream Error:', err)
});

publisher.subscribe(['*']);
```

## Message Format

Events are added to the stream using `XADD` with the following field mapping:

| Redis Field | Value |
|-------------|-------|
| **eventId** | `event.id` |
| **eventType** | `event.type` |
| **payload** | `JSON.stringify(event.payload)` |
| **occurredAt** | `event.occurredAt.toISOString()` |
| **metadata** | `JSON.stringify(event.metadata)` |

## Error Handling

### Connectivity
Ensure your Redis client is configured with a robust retry strategy.

### Application-Level Retries
You can also configure application-level retries for command failures:
```typescript
const publisher = new RedisStreamsPublisher(bus, {
  // ...
  retryOptions: {
    maxAttempts: 3,
    initialDelayMs: 1000
  }
});
```

The publisher will pass any terminal Redis errors to the `onError` handler.

## Troubleshooting

### Stream growing too large
- **Cause**: Redis Streams are not capped by default.
- **Solution**: Use `XTRIM` or the `MAXLEN` option in your consumption logic to truncate old events. The publisher presently uses `*` for ID generation and does not cap the stream.

### Data persistence
- **Cause**: Redis is in-memory.
- **Solution**: Enable AOF (Append Only File) persistence in Redis to ensure stream data survives a restart.
