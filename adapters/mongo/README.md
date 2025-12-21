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
  collectionName: 'outbox_events',
  onError: (error) => console.error(error)
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

### Indexes
For formatting performance, we recommend creating the following indexes:

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
  batchSize?: number;               // Events per poll (default: 50)
  onError: (error: unknown) => void; // Error handler
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
  dbName: 'myapp',
  onError: console.error
});

const bus = new OutboxEventBus(outbox, console.warn, console.error);
bus.start();
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
