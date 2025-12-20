# MongoDB Outbox

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

This adapter uses MongoDB's atomic `findOneAndUpdate` operation to ensure only one worker processes each event in distributed environments.

- [Installation](#installation)
- [Collection Schema](#collection-schema)
- [Configuration](#configuration)
- [Usage](#usage)
- [Features](#features)
- [Back to Main Documentation](../../README.md)

## Installation

```bash
npm install @outbox-event-bus/mongo-outbox
```

## Collection Schema

The adapter automatically creates documents with the following structure:

### Document Structure

```typescript
{
  _id: ObjectId,                    // MongoDB document ID
  eventId: string,                  // Unique event ID
  type: string,                     // Event type (e.g., 'user.created')
  payload: any,                     // Event payload
  occurredAt: Date,                 // When the event occurred
  status: string,                   // 'created', 'active', 'failed', or 'completed'
  retryCount: number,               // Number of retry attempts
  nextRetryAt: Date | null,         // When to retry (for failed events)
  lastError?: string,               // Last error message
  startedOn?: Date,                 // Processing start time
  completedOn?: Date,               // Completion time
  expireInSeconds: number,          // TTL for cleanup
  keepAlive: Date                   // Last keepalive update
}
```

### Recommended Indexes

Create these indexes for optimal performance:

```javascript
// Status and retry scheduling
db.outbox_events.createIndex({ 
  status: 1, 
  nextRetryAt: 1 
});

// Stuck event recovery
db.outbox_events.createIndex({ 
  status: 1, 
  keepAlive: 1 
});

// TTL index for automatic cleanup (optional)
db.outbox_events.createIndex(
  { completedOn: 1 },
  { expireAfterSeconds: 86400 } // 24 hours
);
```

### MongoDB Shell Example

```javascript
use myapp;

// Create indexes
db.outbox_events.createIndex({ status: 1, nextRetryAt: 1 });
db.outbox_events.createIndex({ status: 1, keepAlive: 1 });
db.outbox_events.createIndex(
  { completedOn: 1 },
  { expireAfterSeconds: 86400 }
);
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
  batchSize?: number;               // Events per poll (default: 50)
  onError: (error: unknown) => void; // Error handler
}
```

### Configuration Options

**client** (required)
- MongoDB client instance
- Must be connected before creating the outbox

**dbName** (required)
- Name of the database to use
- Database will be created if it doesn't exist

**collectionName** (optional, default: 'outbox_events')
- Name of the collection for outbox events
- Collection will be created if it doesn't exist

**maxRetries** (optional, default: 5)
- Maximum retry attempts before giving up
- Failed events remain in the collection with status 'failed'

**baseBackoffMs** (optional, default: 1000)
- Base delay for exponential backoff on retries
- Actual delay: `baseBackoffMs * 2^(retryCount - 1)`

**pollIntervalMs** (optional, default: 1000)
- Milliseconds between polling cycles
- Lower values reduce latency but increase database load

**batchSize** (optional, default: 50)
- Maximum events to process per polling cycle
- Higher values improve throughput

**onError** (required)
- Callback for handling errors during polling
- Does not include event handler errors (those trigger retries)

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

### Custom Configuration

```typescript
const outbox = new MongoOutbox({
  client,
  dbName: 'production',
  collectionName: 'events',
  batchSize: 100,                 // Process more events per cycle
  pollIntervalMs: 500,            // Poll more frequently
  maxRetries: 10,                 // More retry attempts
  baseBackoffMs: 2000,            // Longer base backoff
  onError: (error) => {
    console.error('MongoDB outbox error:', error);
    // Send to monitoring service
  }
});
```

### With Replica Set

```typescript
const client = new MongoClient(
  'mongodb://mongo1:27017,mongo2:27017,mongo3:27017/myapp?replicaSet=rs0',
  {
    retryWrites: true,
    w: 'majority'
  }
);

await client.connect();

const outbox = new MongoOutbox({
  client,
  dbName: 'myapp',
  onError: console.error
});
```

### With MongoDB Atlas

```typescript
const client = new MongoClient(
  `mongodb+srv://${username}:${password}@cluster.mongodb.net/?retryWrites=true&w=majority`
);

await client.connect();

const outbox = new MongoOutbox({
  client,
  dbName: 'production',
  onError: console.error
});
```

## Features

### Optimistic Locking

Uses MongoDB's atomic `findOneAndUpdate` to ensure only one worker claims each event:

```typescript
await collection.findOneAndUpdate(
  { status: "created" },
  { $set: { status: "active", startedOn: now } },
  { returnDocument: "after" }
);
```

If another worker already claimed the event, `findOneAndUpdate` returns `null`.

### Stuck Event Recovery

Automatically recovers events stuck in `active` state:

```typescript
{
  status: "active",
  keepAlive: { $lt: new Date(now - 60000) } // 60 seconds ago
}
```

Events with stale `keepAlive` timestamps are reclaimed and retried.

### Exponential Backoff Retry

Failed events are retried with exponential backoff:

- Retry 1: `baseBackoffMs * 2^0` = 1000ms
- Retry 2: `baseBackoffMs * 2^1` = 2000ms
- Retry 3: `baseBackoffMs * 2^2` = 4000ms
- Retry 4: `baseBackoffMs * 2^3` = 8000ms
- Retry 5: `baseBackoffMs * 2^4` = 16000ms

After `maxRetries`, events remain with status `failed`.

### Batch Processing

Processes up to `batchSize` events per polling cycle:

```typescript
for (let i = 0; i < batchSize; i++) {
  const event = await collection.findOneAndUpdate(...);
  if (!event) break;
  lockedEvents.push(event);
}
```

### Error Handling

Polling errors trigger exponential backoff:

```typescript
const backoff = Math.min(
  pollIntervalMs * 2^errorCount,
  30000 // Max 30 seconds
);
```

### Horizontal Scaling

Multiple workers can safely poll the same collection:
- Atomic `findOneAndUpdate` prevents duplicate processing
- Each worker claims events independently
- No coordination required

### TTL Support

Use MongoDB TTL indexes to automatically clean up old events:

```javascript
db.outbox_events.createIndex(
  { completedOn: 1 },
  { expireAfterSeconds: 86400 } // Delete after 24 hours
);
```

## Back to Main Documentation

[← Back to outbox-event-bus](../../README.md)
