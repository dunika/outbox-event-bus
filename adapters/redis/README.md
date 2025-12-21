# Redis Outbox

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/redis-outbox?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/redis-outbox?style=flat-square&color=2563eb)

> **Lightning-Fast Event Storage with Redis**

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

## When to Use

**Choose Redis Outbox when:**
- You need **sub-second latency** for event processing.
- You're already using Redis in your infrastructure.
- You want **horizontal scaling** with multiple workers.
- You need **scheduled event delivery** with precise timing.
- Your events are **ephemeral** (persistence is secondary to speed).

**Consider alternatives when:**
- You need **long-term event history** (use PostgreSQL/MongoDB instead).
- You require **transactional consistency** with your relational database (use PostgreSQL adapters instead).
- You want to store **very large payloads** (Redis memory is expensive).

## Installation

```bash
npm install @outbox-event-bus/redis-outbox ioredis
```

## Redis Keys

The adapter uses the following Redis keys:

- **`{prefix}:pending`**: Sorted Set of event IDs waiting to be processed (score = scheduled time).
- **`{prefix}:processing`**: Sorted Set of event IDs currently being processed (score = timeout time).
- **`{prefix}:event:{id}`**: Hash containing the full event data.

## Configuration

### RedisOutboxConfig

```typescript
interface RedisOutboxConfig {
  redis: Redis;                     // ioredis client instance
  keyPrefix?: string;               // Key prefix (default: 'outbox')
  batchSize?: number;               // Events per poll (default: 10)
  pollIntervalMs?: number;          // Polling interval (default: 1000ms)
  processingTimeoutMs?: number;     // Processing timeout (default: 30000ms)
  maxErrorBackoffMs?: number;       // Max polling error backoff (default: 30000ms)
  maxRetries?: number;              // Max retry attempts (default: 5)
  baseBackoffMs?: number;           // Base retry backoff (default: 1000ms)
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

const bus = new OutboxEventBus(outbox, console.warn, console.error);
bus.start();
```

### With Redis Cluster

```typescript
import { Cluster } from 'ioredis';

const redis = new Cluster([{ host: 'localhost', port: 6379 }]);
const outbox = new RedisOutbox({ redis, onError: console.error });
```

## Features

- **Lua Scripts**: Atomic "poll and claim" logic ensures no two workers pick up the same event.
- **Stuck Event Recovery**: Automatically moves events from `processing` back to `pending` if they exceed `processingTimeoutMs`.
- **High Performance**: Leverages Redis Sorted Sets for $O(\log N)$ scheduling efficiency.
- **Pipelining**: Uses Redis pipelines for batch operations to reduce network round-trips.

## Troubleshooting

### High Memory Usage
- **Cause**: Completed events aren't being archived or deleted.
- **Solution**: The adapter deletes event data after successful processing. If memory grows, check if events are failing and accumulating in the `FAILED` state.
- **Solution**: Set a TTL on event keys if you want them to expire eventually.

### `NOSCRIPT` Errors
- **Cause**: Redis crashed or script cache was cleared.
- **Solution**: The adapter automatically re-registers Lua scripts on startup. Ensure your `ioridis` client is configured to handle reconnections.
