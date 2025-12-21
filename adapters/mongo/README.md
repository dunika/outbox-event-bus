# MongoDB Outbox

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/mongo-outbox?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/mongo-outbox?style=flat-square&color=2563eb)

> **Document-Oriented Event Persistence**

MongoDB adapter for [outbox-event-bus](../../README.md). Provides reliable event storage using MongoDB with optimistic locking via `findOneAndUpdate`.

```typescript
import { MongoClient } from 'mongodb';
import { MongoOutbox } from '@outbox-event-bus/mongo-outbox';

const outbox = new MongoOutbox({
  client: new MongoClient('mongodb://localhost:27017'),
  dbName: 'myapp',
  collectionName: 'outbox_events'
});
```

## When to Use

**Choose MongoDB Outbox when:**
- You are already using **MongoDB** in your stack.
- You need to store **complex, nested event payloads**.
- You want **flexible schema** evolution for events.
- You need deep **query capabilities** on event history.

## Installation

```bash
npm install @outbox-event-bus/mongo-outbox
```

## Document Schema

The adapter stores events in a dedicated collection (default: `outbox_events`).

### Fields
| Field | Type | Description |
|-------|------|-------------|
| `eventId` | String | Unique event identifier |
| `type` | String | Event type |
| `payload` | Object | Event payload |
| `status` | String | `created`, `active`, `failed`, or `completed` |
| `occurredAt` | Date | Timestamp of occurrence |
| `nextRetryAt` | Date | Scheduled time for retry |
| `retryCount` | Number | Number of retries so far |
| `lastError` | String | Error message from last failure |
| `startedOn` | Date | When processing started |
| `completedOn` | Date | When processing completed |
| `expireInSeconds` | Number | Lock duration |
| `keepAlive` | Date | Timestamp for lock renewal |

### Indexes
For optimal performance, we recommend creating the following indexes:

```javascript
// For polling pending events
db.outbox_events.createIndex({ status: 1, nextRetryAt: 1 });

// For recovering stuck events
db.outbox_events.createIndex({ status: 1, keepAlive: 1 });
```

## Configuration

### MongoOutboxConfig

```typescript
interface MongoOutboxConfig {
  client: MongoClient;              // MongoDB client instance
  dbName: string;                   // Database name
  collectionName?: string;          // Collection name (default: 'outbox_events')
  maxRetries?: number;              // Max retry attempts (default: 5)
  baseBackoffMs?: number;           // Base retry backoff (default: 1000ms)
  pollIntervalMs?: number;          // Polling interval (default: 1000ms)
  maxErrorBackoffMs?: number;       // Max polling error backoff (default: 30000ms)
  processingTimeoutMs?: number;     // Processing timeout (default: 30000ms)
  batchSize?: number;               // Events per poll (default: 50)
  getSession?: () => ClientSession | undefined; // Optional session getter
}
```

## Usage

### Basic Setup

```typescript
import { MongoClient } from 'mongodb';
import { MongoOutbox } from '@outbox-event-bus/mongo-outbox';
import { OutboxEventBus } from 'outbox-event-bus';

const client = new MongoClient('mongodb://localhost:27017');
await client.connect();

const outbox = new MongoOutbox({
  client,
  dbName: 'myapp'
});

const bus = new OutboxEventBus(outbox, console.warn, console.error);
bus.start();
```

### With Transactions (AsyncLocalStorage)

Use `AsyncLocalStorage` to manage MongoDB `ClientSession` across your application, ensuring events are only persisted if the session transaction commits.

```typescript
import { MongoClient, ClientSession } from 'mongodb';
import { AsyncLocalStorage } from 'node:async_hooks';

const client = new MongoClient('mongodb://localhost:27017');
const als = new AsyncLocalStorage<ClientSession>();

const outbox = new MongoOutbox({
  client,
  dbName: 'myapp',
  getSession: () => als.getStore()
});

const bus = new OutboxEventBus(outbox, console.warn, console.error);

async function createOrder(orderData: any) {
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await als.run(session, async () => {
        // 1. Save business data
        await client.db('myapp').collection('orders').insertOne(orderData, { session });

        // 2. Emit event (automatically uses session from ALS via getSession)
        await bus.emit({
          id: crypto.randomUUID(),
          type: 'order.created',
          payload: orderData
        });
      });
    });
  } finally {
    await session.endSession();
  }
}
```

### With Transactions (Explicit)

You can also pass the MongoDB `ClientSession` explicitly to `emit`.

```typescript
const session = client.startSession();
await session.withTransaction(async () => {
  await client.db('myapp').collection('orders').insertOne(orderData, { session });

  await bus.emit({
    id: crypto.randomUUID(),
    type: 'order.created',
    payload: orderData
  }, session); // Pass the session explicitly
});
session.endSession();
```

### With Replica Set

```typescript
const client = new MongoClient(
  'mongodb://mongo1,mongo2,mongo3/myapp?replicaSet=rs0&w=majority'
);
```

## Features

- **Atomic Locking**: Uses `findOneAndUpdate` to atomically claim events, preventing double-processing.
- **Stuck Event Recovery**: Automatically recovers events that have been in `active` state for too long (based on `keepAlive` timestamp).
- **Nested Payloads**: Fully supports arbitrary JSON payloads without serialization overhead.

## Troubleshooting

### `MongoTimeoutError`
- **Cause**: Network issues or connection pool exhaustion.
- **Solution**: Check firewall rules and ensure `minPoolSize`/`maxPoolSize` are tuned for your concurrency.

### Processing Lag
- **Cause**: Missing indexes.
- **Solution**: Ensure the compound indexes on `status` and `nextRetryAt` exist.
