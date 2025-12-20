# Redis Streams Publisher

Redis Streams publisher for [outbox-event-bus](../../README.md). Forwards events from the outbox to Redis Streams.

```typescript
import Redis from 'ioredis';
import { RedisStreamsPublisher } from '@outbox-event-bus/redis-streams-publisher';

const redis = new Redis();

const publisher = new RedisStreamsPublisher(bus, {
  redisClient: redis,
  streamKey: 'events'
});

publisher.subscribe(['user.created', 'order.placed']);
```

- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Back to Main Documentation](../../README.md)

## Installation

```bash
npm install @outbox-event-bus/redis-streams-publisher ioredis
```

## Configuration

### RedisStreamsPublisherConfig

```typescript
interface RedisStreamsPublisherConfig {
  redisClient: Redis;        // ioredis client instance
  streamKey: string;         // Redis stream key
  onError?: ErrorHandler;    // Error handler (optional)
}
```

## Usage

### Basic Setup

```typescript
import Redis from 'ioredis';
import { RedisStreamsPublisher } from '@outbox-event-bus/redis-streams-publisher';

const redis = new Redis({
  host: 'localhost',
  port: 6379
});

const publisher = new RedisStreamsPublisher(bus, {
  redisClient: redis,
  streamKey: 'application:events',
  onError: (error) => console.error('Redis Streams error:', error)
});

publisher.subscribe(['user.created', 'order.placed']);
```

### Stream Entry Format

Entries are added to the stream with fields:
- **eventId**: Event ID
- **eventType**: Event type
- **payload**: JSON-encoded payload
- **occurredAt**: ISO 8601 timestamp
- **metadata**: JSON-encoded metadata (if present)

## Back to Main Documentation

[← Back to outbox-event-bus](../../README.md)
