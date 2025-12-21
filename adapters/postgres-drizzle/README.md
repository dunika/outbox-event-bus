# PostgreSQL (Drizzle) Outbox

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/postgres-drizzle-outbox?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/postgres-drizzle-outbox?style=flat-square&color=2563eb)

> **Relational Event Storage with Drizzle ORM**

PostgreSQL adapter for [outbox-event-bus](../../README.md) using [Drizzle ORM](https://orm.drizzle.team/). Provides robust event storage with `SELECT FOR UPDATE SKIP LOCKED` for safe distributed processing.

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { PostgresDrizzleOutbox } from '@outbox-event-bus/postgres-drizzle-outbox';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

const outbox = new PostgresDrizzleOutbox({
  db,
  onError: (error) => console.error(error)
});
```

## When to Use

**Choose Postgres Drizzle Outbox when:**
- You are using **PostgreSQL** as your primary database.
- You prefer **SQL-standard** relational data models.
- You need **transactional consistency** (emitting events within the same transaction as business logic).
- You want **type safety** provided by Drizzle ORM.

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
  expire_in_seconds INTEGER NOT NULL DEFAULT 60
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

## Configuration

### PostgresDrizzleOutboxConfig

```typescript
interface PostgresDrizzleOutboxConfig {
  db: PostgresJsDatabase<Record<string, unknown>>;
  getExecutor?: () => PostgresJsDatabase<Record<string, unknown>> | undefined;
  maxRetries?: number;              // Max retry attempts (default: 5)
  baseBackoffMs?: number;           // Base retry backoff (default: 1000ms)
  maxErrorBackoffMs?: number;       // Max polling error backoff (default: 30000ms)
  pollIntervalMs?: number;          // Polling interval (default: 1000ms)
  batchSize?: number;               // Events per poll (default: 50)
  onError: (error: unknown) => void; // Error handler
}
```

## Usage

### Basic Setup

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { PostgresDrizzleOutbox } from '@outbox-event-bus/postgres-drizzle-outbox';
import { OutboxEventBus } from 'outbox-event-bus';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

const outbox = new PostgresDrizzleOutbox({
  db,
  onError: console.error
});

const bus = new OutboxEventBus(outbox, console.warn, console.error);
bus.start();
```

### With Transactions

The `getExecutor` option allows you to integrate with transactions, ensuring events are only processed if the transaction commits.

```typescript
import { AsyncLocalStorage } from 'async_hooks';

const txStorage = new AsyncLocalStorage<PostgresJsDatabase>();

const outbox = new PostgresDrizzleOutbox({
  db,
  getExecutor: () => txStorage.getStore(),
  onError: console.error
});

// In your service
async function createUser(user) {
  await db.transaction(async (tx) => {
    txStorage.run(tx, async () => {
      await tx.insert(users).values(user);
      await bus.emit({ type: 'user.created', payload: user });
    });
  });
}
```

## Features

- **SKIP LOCKED**: Uses `SELECT ... FOR UPDATE SKIP LOCKED` to efficiently claim events without blocking other workers.
- **Transactional Integrity**: Supports emitting events within the same transaction as your data changes (Atomic Phase 1).
- **Archiving**: Automatically moves processed events to an archive table to keep the active table small and fast.
- **Stuck Event Recovery**: Reclaims events that have timed out (stalled workers) based on `keep_alive` + `expire_in_seconds`.

## Troubleshooting

### `SerializationFailure`
- **Cause**: Transaction conflicts.
- **Solution**: The `SKIP LOCKED` clause minimizes this, but ensure your `pollIntervalMs` isn't too aggressive if high contention exists.

### Events not appearing
- **Cause**: Transaction rollback.
- **Solution**: If using transactions, ensure `bus.emit` is awaited *inside* the transaction scope and the transaction actually commits.
