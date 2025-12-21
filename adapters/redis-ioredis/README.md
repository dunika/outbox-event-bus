# Redis IoRedis Outbox

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/redis-ioredis-outbox?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/redis-ioredis-outbox?style=flat-square&color=2563eb)

> **Lightning-Fast Event Storage with Redis**

Redis adapter for [outbox-event-bus](../../README.md). Provides reliable event storage using Redis Sorted Sets for efficient time-based scheduling and Lua scripts for atomic operations.

```typescript
import Redis from 'ioredis';
import { RedisIoRedisOutbox } from '@outbox-event-bus/redis-ioredis-outbox';

const outbox = new RedisIoRedisOutbox({
  redis: new Redis()
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
npm install @outbox-event-bus/redis-ioredis-outbox ioredis
```

## Redis Keys

The adapter uses the following Redis keys:

- **`{prefix}:pending`**: Sorted Set of event IDs waiting to be processed (score = scheduled time).
- **`{prefix}:processing`**: Sorted Set of event IDs currently being processed (score = timeout time).
- **`{prefix}:event:{id}`**: Hash containing the full event data.

## Configuration

### RedisIoRedisOutboxConfig

```typescript
interface RedisIoRedisOutboxConfig {
  redis: Redis;                     // ioredis client instance
  keyPrefix?: string;               // Key prefix (default: 'outbox')
  batchSize?: number;               // Events per poll (default: 50)
  pollIntervalMs?: number;          // Polling interval (default: 1000ms)
  processingTimeoutMs?: number;     // Processing timeout (default: 30000ms)
  maxErrorBackoffMs?: number;       // Max polling error backoff (default: 30000ms)
  maxRetries?: number;              // Max retry attempts (default: 5)
  baseBackoffMs?: number;           // Base retry backoff (default: 1000ms)
  getIoRedisPipeline?: () => ChainableCommander | undefined; // Optional transaction pipeline getter
}
```

## Usage

### Basic Setup

```typescript
import Redis from 'ioredis';
import { RedisIoRedisOutbox } from '@outbox-event-bus/redis-ioredis-outbox';
import { OutboxEventBus } from 'outbox-event-bus';

const redis = new Redis();

const outbox = new RedisIoRedisOutbox({
  redis: new Redis()
});

const bus = new OutboxEventBus(outbox, (error) => console.error(error));
bus.start();
```

### With Transactions (AsyncLocalStorage)

Use `AsyncLocalStorage` to manage Redis pipelines or multi-exec blocks, ensuring outbox events are atomic with your business logic.

> **Note**: `ChainableCommander` is the return type of both `redis.multi()` and `redis.pipeline()`, so you can use either for transactions.

```typescript
import Redis, { ChainableCommander } from 'ioredis';
import { AsyncLocalStorage } from 'node:async_hooks';

const redis = new Redis();
const als = new AsyncLocalStorage<ChainableCommander>();

const outbox = new RedisIoRedisOutbox({
  redis,
  getIoRedisPipeline: () => als.getStore()
});

const bus = new OutboxEventBus(outbox, (error) => console.error(error));

async function processData(data: any) {
  const multi = redis.multi();  // or redis.pipeline()
  
  await als.run(multi, async () => {
    // 1. Add business logic to the transaction
    multi.set(`data:${data.id}`, JSON.stringify(data));

    // 2. Emit event (automatically adds its commands to the 'multi' block)
    await bus.emit({
      id: crypto.randomUUID(),
      type: 'data.processed',
      payload: data
    });

    // 3. Execute all commands atomically
    await multi.exec();
  });
}
```

### With Transactions (Explicit)

You can also pass the Redis pipeline/multi explicitly to `emit`.

```typescript
const multi = redis.multi();

// 1. Add business logic
multi.set(`data:${data.id}`, JSON.stringify(data));

// 2. Emit event (passing the multi explicitly)
await bus.emit({
  id: crypto.randomUUID(),
  type: 'data.processed',
  payload: data
}, multi);

// 3. Execute the transaction
await multi.exec();
```

### With Redis Cluster

```typescript
import { Cluster } from 'ioredis';

const redis = new Cluster([{ host: 'localhost', port: 6379 }]);
const outbox = new RedisIoRedisOutbox({ redis });
```

## Features

- **Lua Scripts**: Atomic "poll and claim" logic ensures no two workers pick up the same event.
- **Stuck Event Recovery**: Automatically moves events from `processing` back to `pending` if they exceed `processingTimeoutMs`.
- **High Performance**: Leverages Redis Sorted Sets for $O(\log N)$ scheduling efficiency.
- **Pipelining**: Uses Redis pipelines for batch operations to reduce network round-trips.
- **ioredis-mock Compatible**: Uses `hmset` for setting event data to ensure compatibility with ioredis-mock in tests.

## Troubleshooting

### High Memory Usage
- **Cause**: Completed events aren't being archived or deleted.
- **Solution**: The adapter deletes event data after successful processing. If memory grows, check if events are failing and accumulating in the `FAILED` state.
- **Solution**: Set a TTL on event keys if you want them to expire eventually.

### `NOSCRIPT` Errors
- **Cause**: Redis crashed or script cache was cleared.
- **Solution**: The adapter automatically re-registers Lua scripts on startup. Ensure your `ioridis` client is configured to handle reconnections.
