# PostgreSQL Drizzle Outbox

PostgreSQL adapter for [outbox-event-bus](../../README.md) using [Drizzle ORM](https://orm.drizzle.team/). Provides reliable event storage with `SELECT FOR UPDATE SKIP LOCKED` for safe distributed processing.

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

This adapter uses PostgreSQL's row-level locking to ensure only one worker processes each event.

- [Installation](#installation)
- [Database Schema](#database-schema)
- [Configuration](#configuration)
- [Usage](#usage)
- [Features](#features)
- [Back to Main Documentation](../../README.md)

## Installation

```bash
npm install @outbox-event-bus/postgres-drizzle-outbox drizzle-orm postgres
```

## Database Schema

Run the migration to create required tables:

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
  pollIntervalMs?: number;          // Polling interval (default: 1000ms)
  batchSize?: number;               // Events per poll (default: 50)
  onError: (error: unknown) => void; // Error handler
}
```

### getExecutor Option

The `getExecutor` option allows you to provide a custom database executor, useful for:
- Transaction support with async local storage
- Custom connection pooling
- Multi-tenancy scenarios

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

### With Transaction Support

```typescript
import { AsyncLocalStorage } from 'async_hooks';

const txStorage = new AsyncLocalStorage<PostgresJsDatabase>();

const outbox = new PostgresDrizzleOutbox({
  db,
  getExecutor: () => txStorage.getStore(),
  onError: console.error
});

// In your application code
async function createUser(userData) {
  await db.transaction(async (tx) => {
    txStorage.run(tx, async () => {
      // Insert user
      await tx.insert(users).values(userData);
      
      // Emit event (uses transaction from async local storage)
      await bus.emit({
        id: crypto.randomUUID(),
        type: 'user.created',
        payload: userData,
        occurredAt: new Date()
      });
    });
  });
}
```

## Features

### SELECT FOR UPDATE SKIP LOCKED

Uses PostgreSQL's row-level locking for safe distributed processing:

```sql
SELECT * FROM outbox_events
WHERE status = 'created'
LIMIT 50
FOR UPDATE SKIP LOCKED
```

### Automatic Archiving

Completed events are moved to `outbox_events_archive` table for audit trail.

### Stuck Event Recovery

Events with stale `keep_alive` timestamps are automatically reclaimed.

### Exponential Backoff Retry

Failed events retry with exponential backoff (max 5 retries by default).

## Back to Main Documentation

[← Back to outbox-event-bus](../../README.md)
