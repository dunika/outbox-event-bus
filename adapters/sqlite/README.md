# SQLite Outbox

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/sqlite-outbox?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/sqlite-outbox?style=flat-square&color=2563eb)

> **Zero-Config Event Storage for Development**

SQLite adapter for [outbox-event-bus](../../README.md). Provides reliable event storage using SQLite with WAL mode for better concurrency.

```typescript
import { SqliteOutbox } from '@outbox-event-bus/sqlite-outbox';

const outbox = new SqliteOutbox({
  dbPath: './outbox.db',
  onError: (error) => console.error(error)
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
npm install @outbox-event-bus/sqlite-outbox
```

## Database Schema

Tables are automatically created on initialization.

### `outbox_events`
Stores active and pending events. Use `idx_outbox_events_status_retry` for fast polling.

### `outbox_events_archive`
Stores successfully processed events for audit purposes.

## Configuration

### SqliteOutboxConfig

```typescript
interface SqliteOutboxConfig {
  dbPath: string;                   // Path to SQLite database file (or ':memory:')
  getExecutor?: () => Database.Database | undefined;
  maxRetries?: number;              // Max retry attempts (default: 5)
  baseBackoffMs?: number;           // Base retry backoff (default: 1000ms)
  pollIntervalMs?: number;          // Polling interval (default: 1000ms)
  batchSize?: number;               // Events per poll (default: 50)
  maxErrorBackoffMs?: number;       // Max polling error backoff (default: 30000ms)
  onError: (error: unknown) => void; // Error handler
}
```

## Usage

### Basic Setup

```typescript
import { SqliteOutbox } from '@outbox-event-bus/sqlite-outbox';
import { OutboxEventBus } from 'outbox-event-bus';

const outbox = new SqliteOutbox({
  dbPath: './outbox.db',
  onError: console.error
});

const bus = new OutboxEventBus(outbox, console.warn, console.error);
bus.start();
```

### In-Memory (for tests)

```typescript
const outbox = new SqliteOutbox({
  dbPath: ':memory:',
  onError: console.error
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
