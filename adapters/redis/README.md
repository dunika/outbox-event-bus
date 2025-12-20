# Redis Outbox

Redis adapter for [outbox-event-bus](../../README.md). Provides reliable event storage using Redis Sorted Sets for efficient time-based scheduling and Lua scripts for atomic operations.

```typescript
import Redis from 'ioredis';
import { RedisOutbox } from '@outbox-event-bus/redis-outbox';

const outbox = new RedisOutbox({
  redis: new Redis(),
  keyPrefix: 'outbox',
  onError: (error) => console.error(error)
});
```

This adapter uses Lua scripts to ensure atomic claim operations, making it safe for distributed environments.

- [Installation](#installation)
- [Redis Keys](#redis-keys)
- [Configuration](#configuration)
- [Usage](#usage)
- [Features](#features)
- [Back to Main Documentation](../../README.md)

## Installation

```bash
npm install @outbox-event-bus/redis-outbox ioredis
```

## Redis Keys

The adapter uses the following Redis keys:

### Sorted Sets

- **`{prefix}:pending`** - Events waiting to be processed (score = scheduled time)
- **`{prefix}:processing`** - Events currently being processed (score = timeout time)

### Hashes

- **`{prefix}:event:{id}`** - Event data stored as hash
  - `id` - Event ID
  - `type` - Event type
  - `payload` - JSON-encoded payload
  - `occurredAt` - ISO 8601 timestamp
  - `status` - Event status
  - `retryCount` - Number of retries

## Configuration

### RedisOutboxConfig

```typescript
interface RedisOutboxConfig {
  redis: Redis;                     // ioredis client instance
  keyPrefix?: string;               // Key prefix (default: 'outbox')
  batchSize?: number;               // Events per poll (default: 10)
  pollIntervalMs?: number;          // Polling interval (default: 1000ms)
  processingTimeoutMs?: number;     // Processing timeout (default: 30000ms)
  onError: (error: unknown) => void; // Error handler
}
```

## Usage

### Basic Setup

```typescript
import Redis from 'ioredis';
import { RedisOutbox } from '@outbox-event-bus/redis-outbox';
import { OutboxEventBus } from 'outbox-event-bus';

const redis = new Redis();

const outbox = new RedisOutbox({
  redis,
  onError: (error) => console.error('Outbox error:', error)
});

const bus = new OutboxEventBus(
  outbox,
  (bus, eventType, count) => console.warn(`Max listeners: ${eventType}`),
  (error) => console.error('Bus error:', error)
);

bus.on('user.created', async (event) => {
  console.log('User created:', event.payload);
});

bus.start();
```

### With Redis Cluster

```typescript
import { Cluster } from 'ioredis';

const redis = new Cluster([
  { host: 'redis-1', port: 6379 },
  { host: 'redis-2', port: 6379 },
  { host: 'redis-3', port: 6379 }
]);

const outbox = new RedisOutbox({
  redis,
  keyPrefix: 'myapp:outbox',
  onError: console.error
});
```

## Features

### Lua Scripts for Atomicity

Uses custom Lua scripts registered on the Redis client:

**pollOutboxEvents** - Atomically moves events from pending to processing
**recoverOutboxEvents** - Recovers stuck events back to pending

### Stuck Event Recovery

Events stuck in processing beyond `processingTimeoutMs` are automatically recovered.

### Exponential Backoff Retry

Failed events retry with exponential backoff (max 5 retries by default).

### Horizontal Scaling

Multiple workers can safely poll the same Redis instance using atomic Lua scripts.

## Back to Main Documentation

[← Back to outbox-event-bus](../../README.md)
