# SQLite Better-Sqlite3 Outbox

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/sqlite-better-sqlite3-outbox?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/sqlite-better-sqlite3-outbox?style=flat-square&color=2563eb)

> **Zero-Config Event Storage for Development**

SQLite adapter for [outbox-event-bus](../../README.md). Provides reliable event storage using SQLite with WAL mode for better concurrency.

```typescript
import { SqliteBetterSqlite3Outbox } from '@outbox-event-bus/sqlite-better-sqlite3-outbox';

const outbox = new SqliteBetterSqlite3Outbox({
  dbPath: './data/events.db'
});
```

## When to Use

**Choose SQLite Outbox when:**
- You're in **local development** or testing.
- You have a **single-instance deployment** (no horizontal scaling).
- You want **zero external dependencies**.
- You're building a **desktop application** or CLI tool.

**Consider alternatives when:**
- You need **horizontal scaling** across multiple servers (use Redis/DynamoDB/PostgreSQL).
- You require **high write throughput** (SQLite serializes writes).
- You want **cloud-native deployment** (use managed database services).

## Installation

```bash
npm install @outbox-event-bus/sqlite-better-sqlite3-outbox
```

## Database Schema

Tables are automatically created on initialization.

### `outbox_events`
Stores active and pending events. Use `idx_outbox_events_status_retry` for fast polling.

### `outbox_events_archive`
Stores successfully processed events for audit purposes.

## Configuration

### SqliteBetterSqlite3OutboxConfig

```typescript
interface SqliteBetterSqlite3OutboxConfig {
  dbPath?: string;                  // Path to SQLite database file (required if db not provided)
  db?: Database.Database;           // Existing better-sqlite3 instance
  getTransaction?: () => Database.Database | undefined;
  maxRetries?: number;              // Max retry attempts (default: 5)
  baseBackoffMs?: number;           // Base retry backoff (default: 1000ms)
  maxErrorBackoffMs?: number;       // Max polling error backoff (default: 30000ms)
  processingTimeoutMs?: number;     // Processing timeout (default: 30000ms)
  pollIntervalMs?: number;          // Polling interval (default: 1000ms)
  batchSize?: number;               // Events per poll (default: 50)
  tableName?: string;               // Outbox table name (default: "outbox_events")
  archiveTableName?: string;        // Archive table name (default: "outbox_events_archive")
}
```

## Usage

### With Transactions (AsyncLocalStorage)

Use `AsyncLocalStorage` to manage SQLite transactions, ensuring outbox events are committed along with your business data.

> **Note**: better-sqlite3 transactions are synchronous, but `bus.emit()` is async. The recommended pattern is to call `emit()` synchronously within the transaction (it queues the write) and the actual I/O happens immediately since better-sqlite3 is synchronous.

```typescript
import Database from 'better-sqlite3';
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage<Database.Database>();

const outbox = new SqliteBetterSqlite3Outbox({
  dbPath: './data/events.db',
  getTransaction: () => als.getStore()
});

const bus = new OutboxEventBus(outbox, (error) => console.error(error));

async function createUser(user: any) {
  const db = new Database('./data/events.db');
  
  // Run the transaction synchronously
  const transaction = db.transaction(() => {
    // Set ALS context for the transaction
    return als.run(db, () => {
      // 1. Save business data
      db.prepare('INSERT INTO users (name) VALUES (?)').run(user.name);

      // 2. Emit event (synchronously writes to outbox table via ALS)
      // The emit() call is async but the underlying SQLite write is synchronous
      void bus.emit({
        id: crypto.randomUUID(),
        type: 'user.created',
        payload: user
      });
    });
  });

  // Execute the transaction
  transaction();
}
```

### With Transactions (Explicit)

You can also pass the SQLite database instance explicitly to `emit`.

```typescript
const db = new Database('./data/events.db');
const transaction = db.transaction(() => {
  // 1. Save business data
  db.prepare('INSERT INTO users (name) VALUES (?)').run(user.name);

  // 2. Emit event (passing the db explicitly)
  // The emit() is async but writes synchronously to SQLite
  void bus.emit({
    id: crypto.randomUUID(),
    type: 'user.created',
    payload: user
  }, db);
});
transaction();
```

### Basic Setup

```typescript
import { SqliteBetterSqlite3Outbox } from '@outbox-event-bus/sqlite-better-sqlite3-outbox';
import { OutboxEventBus } from 'outbox-event-bus';

const outbox = new SqliteBetterSqlite3Outbox({
  dbPath: './data/events.db'
});

const bus = new OutboxEventBus(outbox, (error) => console.error(error));
bus.start();
```

### In-Memory (for tests)

```typescript
const outbox = new SqliteBetterSqlite3Outbox({
  dbPath: ':memory:'
});
```

## Features

- **WAL Mode**: Enables Write-Ahead Logging for improved read/write concurrency.
- **Zero-Config**: No need to manage a separate database server.
- **Transactional**: All batch claims and completions happen within a single SQLite transaction.
- **Auto-Archiving**: Automatically moves completed events to an archive table.

## Troubleshooting

### `SQLITE_BUSY: database is locked`
- **Cause**: High write contention or multiple processes accessing the same file.
- **Solution**: Ensure you are using WAL mode (enabled by default).
- **Solution**: Reduce the `pollIntervalMs` or `batchSize` to minimize lock duration.

### Data Loss on Crash
- **Cause**: SQLite persistence settings or disk cache.
- **Solution**: SQLite is highly durable, but ensure your `dbPath` is on a stable filesystem. For critical data, consider a client-server database.
