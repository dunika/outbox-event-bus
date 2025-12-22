# PostgreSQL (Drizzle) Outbox

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/postgres-drizzle-outbox?style=flat-square&color=2563eb)
![npm downloads](https://img.shields.io/npm/dm/@outbox-event-bus/postgres-drizzle-outbox?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/postgres-drizzle-outbox?style=flat-square&color=2563eb)

> **Type-Safe PostgreSQL Outbox with Drizzle ORM**
> 
> Zero-config setup with automatic schema inference. Custom table support for existing databases.

PostgreSQL adapter for [outbox-event-bus](https://github.com/dunika/outbox-event-bus#readme) using [Drizzle ORM](https://orm.drizzle.team/). Provides robust event storage with `SELECT FOR UPDATE SKIP LOCKED` for safe distributed processing.

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { PostgresDrizzleOutbox } from '@outbox-event-bus/postgres-drizzle-outbox';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

const outbox = new PostgresDrizzleOutbox({
  db
});
```

## Contents

- [When to Use](#when-to-use)
- [Installation](#installation)
- [Database Schema](#database-schema)
- [Configuration](#configuration)
- [Usage](#usage)
- [Custom Table Schemas](#custom-table-schemas)
- [Advanced Patterns](#advanced-patterns)
- [Features](#features)
- [Troubleshooting](#troubleshooting)

## When to Use

**Choose Postgres Drizzle Outbox when:**
- You are using **PostgreSQL** as your primary database
- You prefer **SQL-first** development with type safety
- You need **custom table names** or schemas (multi-tenant apps)
- You want **zero magic** - explicit queries you can inspect

**Choose Postgres Prisma Outbox instead if:**
- You're already using Prisma Client
- You prefer schema-first development with migrations
- You need Prisma's advanced features (middleware, extensions)

### Performance Characteristics

- **Concurrency**: Uses `SELECT FOR UPDATE SKIP LOCKED` for lock-free event claiming
- **Throughput**: ~1000-5000 events/sec (single instance, depends on handler complexity)
- **Latency**: Sub-100ms from emit to handler execution (default polling: 1s)

## Installation

```bash
npm install @outbox-event-bus/postgres-drizzle-outbox drizzle-orm postgres
```

## Database Schema

Run the following SQL to create the required tables:

```sql
CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TIMESTAMP,
  created_on TIMESTAMP NOT NULL DEFAULT NOW(),
  started_on TIMESTAMP,
  keep_alive TIMESTAMP,
  expire_in_seconds INTEGER NOT NULL DEFAULT 30
);

CREATE TABLE outbox_events_archive (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL,
  last_error TEXT,
  created_on TIMESTAMP NOT NULL,
  started_on TIMESTAMP,
  completed_on TIMESTAMP NOT NULL
);

CREATE INDEX idx_outbox_events_status_retry ON outbox_events (status, next_retry_at);
CREATE INDEX idx_outbox_events_keepalive ON outbox_events (status, keep_alive);
```

## Concurrency & Locking

This adapter uses **Row-Level Locking** (`SELECT ... FOR UPDATE SKIP LOCKED`) to ensure safe concurrent processing.

-   **Multiple Workers**: You can run multiple instances of your application.
-   **No Duplicates**: The database ensures that only one worker picks up a specific event at a time.
-   **Performance**: `SKIP LOCKED` allows workers to skip locked rows and process the next available event immediately, preventing contention.

## Configuration

### PostgresDrizzleOutboxConfig

| Parameter | Type | Default | Description |
|:---|:---|:---:|:---|
| `db` | `PostgresJsDatabase` | **Required** | Drizzle database instance (from `drizzle-orm/postgres-js`) |
| `getTransaction` | `() => PostgresJsDatabase \| undefined` | `undefined` | Function to retrieve active transaction from AsyncLocalStorage or context |
| `tables` | `{ outboxEvents, outboxEventsArchive }` | Default schema | Custom Drizzle table definitions (see [Custom Schemas](#custom-table-schemas)) |
| `maxRetries` | `number` | `5` | Maximum retry attempts before marking event as failed |
| `baseBackoffMs` | `number` | `1000` | Base delay for exponential backoff (1s, 2s, 4s, 8s, 16s) |
| `processingTimeoutMs` | `number` | `30000` | Time before reclaiming stuck events (30s) |
| `pollIntervalMs` | `number` | `1000` | Polling frequency for new events (1s) |
| `batchSize` | `number` | `50` | Events claimed per poll cycle |
| `maxErrorBackoffMs` | `number` | `30000` | Maximum backoff delay for polling errors |

> [!TIP]
> Start with defaults and tune based on metrics. Increase `batchSize` and decrease `pollIntervalMs` for higher throughput.

> [!WARNING]
> Setting `pollIntervalMs` too low (<100ms) can cause excessive database load. Monitor CPU and connection pool usage.

## Usage

### 1. Basic Setup (No Transactions)

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { PostgresDrizzleOutbox } from '@outbox-event-bus/postgres-drizzle-outbox';
import { OutboxEventBus } from 'outbox-event-bus';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

const outbox = new PostgresDrizzleOutbox({ db });
const bus = new OutboxEventBus(outbox, (error) => console.error(error));

bus.on('user.created', async (event) => {
  await emailService.sendWelcome(event.payload.email);
});

bus.start();

// Emit without transaction (event saved separately)
await bus.emit({ 
  type: 'user.created', 
  payload: { email: 'user@example.com' } 
});
```

> [!WARNING]
> Without transactions, events are **not atomic** with your data changes. Use transactions for critical workflows.

### 2. Explicit Transactions

```typescript
await db.transaction(async (tx) => {
  await tx.insert(users).values(newUser);
  
  // Pass transaction explicitly
  await bus.emit({ 
    type: 'user.created', 
    payload: newUser 
  }, tx);
});
```

### 3. AsyncLocalStorage (Recommended)

Avoid passing transactions manually by using AsyncLocalStorage:

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

const als = new AsyncLocalStorage<PostgresJsDatabase<Record<string, unknown>>>();

const outbox = new PostgresDrizzleOutbox({
  db,
  getTransaction: () => als.getStore()
});

const bus = new OutboxEventBus(outbox, (error) => console.error(error));

// In your service
async function createUser(user: any) {
  return await db.transaction(async (tx) => {
    return await als.run(tx, async () => {
      await tx.insert(users).values(user);
      
      // Bus automatically uses transaction from ALS
      await bus.emit({ 
        type: 'user.created', 
        payload: user 
      });
      
      return user;
    });
  });
}
```

> [!TIP]
> AsyncLocalStorage eliminates the need to pass transactions through your call stack, improving code clarity.

## Custom Table Schemas

The adapter supports custom table definitions, enabling:
- **Multi-tenancy**: Separate outbox tables per tenant
- **Legacy databases**: Integrate with existing table structures
- **Custom columns**: Add application-specific metadata

### Example: Custom Table Names

```typescript
import { pgTable, text, jsonb, timestamp, integer, uuid } from 'drizzle-orm/pg-core';

// Define custom tables
const myCustomOutbox = pgTable('tenant_a_outbox', {
  id: uuid('id').primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  occurredAt: timestamp('occurred_at').notNull(),
  status: text('status').notNull().default('created'),
  retryCount: integer('retry_count').notNull().default(0),
  lastError: text('last_error'),
  nextRetryAt: timestamp('next_retry_at'),
  createdOn: timestamp('created_on').notNull().defaultNow(),
  startedOn: timestamp('started_on'),
  keepAlive: timestamp('keep_alive'),
  expireInSeconds: integer('expire_in_seconds').notNull().default(30),
});

const myCustomArchive = pgTable('tenant_a_archive', {
  id: uuid('id').primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  occurredAt: timestamp('occurred_at').notNull(),
  status: text('status').notNull(),
  retryCount: integer('retry_count').notNull(),
  lastError: text('last_error'),
  createdOn: timestamp('created_on').notNull(),
  startedOn: timestamp('started_on'),
  completedOn: timestamp('completed_on').notNull(),
});

// Use custom tables
const outbox = new PostgresDrizzleOutbox({
  db,
  tables: {
    outboxEvents: myCustomOutbox,
    outboxEventsArchive: myCustomArchive
  }
});
```

> [!IMPORTANT]
> Custom tables **must** include all required columns with compatible types. Missing columns will cause runtime errors.

### Required Schema Fields

| Column | Type | Constraints | Purpose |
|:---|:---|:---|:---|
| `id` | `uuid` or `text` | Primary Key | Unique event identifier |
| `type` | `text` | Not Null | Event type for routing |
| `payload` | `jsonb` | Not Null | Event data |
| `occurredAt` | `timestamp` | Not Null | Event timestamp |
| `status` | `text` | Not Null, Default: 'created' | Lifecycle state |
| `retryCount` | `integer` | Not Null, Default: 0 | Retry attempts |
| `lastError` | `text` | Nullable | Error message from last failure |
| `nextRetryAt` | `timestamp` | Nullable | Scheduled retry time |
| `createdOn` | `timestamp` | Not Null | Record creation time |
| `startedOn` | `timestamp` | Nullable | Processing start time |
| `keepAlive` | `timestamp` | Nullable | Last heartbeat (stuck detection) |
| `expireInSeconds` | `integer` | Not Null, Default: 30 | Timeout threshold |

## Advanced Patterns

### Monitoring Event Processing

```typescript
import { OutboxEventBus, MaxRetriesExceededError } from 'outbox-event-bus';

const bus = new OutboxEventBus(outbox, (error, event) => {
  // Log to monitoring service
  logger.error('Event processing failed', {
    eventId: event?.id,
    eventType: event?.type,
    retryCount: event?.retryCount,
    error: error.message
  });
  
  // Send to Sentry/Datadog
  if (error instanceof MaxRetriesExceededError) {
    Sentry.captureException(error, {
      tags: { eventType: event?.type },
      extra: { event }
    });
  }
});
```

### Querying Failed Events

```typescript
import { eq } from 'drizzle-orm';
import { outboxEvents } from '@outbox-event-bus/postgres-drizzle-outbox';

// Get all failed events
const failedEvents = await db
  .select()
  .from(outboxEvents)
  .where(eq(outboxEvents.status, 'failed'))
  .orderBy(outboxEvents.occurredAt);

// Retry specific events
const idsToRetry = failedEvents.map(e => e.id);
await bus.retryEvents(idsToRetry);
```

### Archive Cleanup (Production)

The adapter automatically archives completed events. For long-running systems, periodically clean old archives:

```sql
-- Delete archives older than 30 days
DELETE FROM outbox_events_archive 
WHERE completed_on < NOW() - INTERVAL '30 days';
```

Or use a cron job:

```typescript
import { lt } from 'drizzle-orm';
import { outboxEventsArchive } from '@outbox-event-bus/postgres-drizzle-outbox';

async function cleanupArchives() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  await db
    .delete(outboxEventsArchive)
    .where(lt(outboxEventsArchive.completedOn, thirtyDaysAgo));
}

// Run daily
setInterval(cleanupArchives, 24 * 60 * 60 * 1000);
```

> [!CAUTION]
> Deleting archives removes audit history. Consider exporting to cold storage (S3, data warehouse) before deletion.

## Features

- **SKIP LOCKED**: Uses `SELECT ... FOR UPDATE SKIP LOCKED` to efficiently claim events without blocking other workers.
- **Transactional Integrity**: Supports emitting events within the same transaction as your data changes (Atomic Phase 1).
- **Archiving**: Automatically moves processed events to an archive table to keep the active table small and fast.
- **Stuck Event Recovery**: Reclaims events that have timed out (stalled workers) based on `keep_alive` + `expire_in_seconds`.

## Troubleshooting

### Events not appearing

**Symptom**: Events emitted but handlers never execute

**Causes**:
1. **Transaction rollback**: Event was emitted inside a transaction that rolled back
2. **Bus not started**: Forgot to call `bus.start()`
3. **No handler registered**: No `bus.on()` for the event type

**Solution**:
```typescript
// Ensure bus is started
bus.start();

// Verify handler is registered
bus.on('user.created', async (event) => {
  console.log('Handler called:', event);
});

// Check transaction commits
await db.transaction(async (tx) => {
  await tx.insert(users).values(user);
  await bus.emit({ type: 'user.created', payload: user }, tx);
  // Transaction must commit (no throw)
});
```

### SerializationFailure / Deadlocks

**Symptom**: `SerializationFailure` errors in logs

**Cause**: High contention on outbox table (multiple workers claiming same events)

**Solution**:
- The `SKIP LOCKED` clause minimizes this
- Reduce `pollIntervalMs` to spread out polling
- Increase `batchSize` to reduce lock frequency
- Add jitter to polling intervals in multi-worker setups

### High Database Load

**Symptom**: CPU spikes, slow queries

**Cause**: Aggressive polling settings

**Solution**:
```typescript
const outbox = new PostgresDrizzleOutbox({
  db,
  pollIntervalMs: 2000,  // Increase from 1000ms
  batchSize: 100         // Process more per poll
});
```

### Custom Table Errors

**Symptom**: `column "xyz" does not exist` errors

**Cause**: Custom table schema missing required columns

**Solution**: Ensure your custom table includes all fields from [Required Schema Fields](#required-schema-fields)

### TypeScript Errors with Custom Tables

**Symptom**: Type errors when using custom tables

**Cause**: Table types don't match expected schema

**Solution**:
```typescript
// Ensure your table matches the expected structure
import type { outboxEvents } from '@outbox-event-bus/postgres-drizzle-outbox';

const myTable: typeof outboxEvents = pgTable('custom', {
  // ... must match outboxEvents structure
});
```
