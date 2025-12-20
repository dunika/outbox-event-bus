# SQLite Outbox

SQLite adapter for [outbox-event-bus](../../README.md). Provides reliable event storage using SQLite with WAL mode for better concurrency.

```typescript
import { SqliteOutbox } from '@outbox-event-bus/sqlite-outbox';

const outbox = new SqliteOutbox({
  dbPath: './outbox.db',
  onError: (error) => console.error(error)
});
```

Perfect for local development, testing, or single-instance deployments.

- [Installation](#installation)
- [Database Schema](#database-schema)
- [Configuration](#configuration)
- [Usage](#usage)
- [Features](#features)
- [Back to Main Documentation](../../README.md)

## Installation

```bash
npm install @outbox-event-bus/sqlite-outbox
```

## Database Schema

Tables are automatically created on initialization:

```sql
CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TEXT,
  created_on TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  started_on TEXT,
  completed_on TEXT,
  keep_alive TEXT,
  expire_in_seconds INTEGER NOT NULL DEFAULT 300
);

CREATE TABLE outbox_events_archive (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL,
  last_error TEXT,
  created_on TEXT NOT NULL,
  started_on TEXT,
  completed_on TEXT NOT NULL
);

CREATE INDEX idx_outbox_events_status_retry ON outbox_events (status, next_retry_at);
```

## Configuration

### SqliteOutboxConfig

```typescript
interface SqliteOutboxConfig {
  dbPath: string;                   // Path to SQLite database file
  getExecutor?: () => Database.Database | undefined;
  maxRetries?: number;              // Max retry attempts (default: 5)
  baseBackoffMs?: number;           // Base retry backoff (default: 1000ms)
  pollIntervalMs?: number;          // Polling interval (default: 1000ms)
  batchSize?: number;               // Events per poll (default: 50)
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

// Clean shutdown
process.on('SIGTERM', async () => {
  await bus.stop(); // Closes database connection
});
```

### In-Memory Database

```typescript
const outbox = new SqliteOutbox({
  dbPath: ':memory:',
  onError: console.error
});
```

## Features

### WAL Mode

Automatically enables Write-Ahead Logging for better concurrency.

### Automatic Archiving

Completed events are moved to `outbox_events_archive` table.

### Transaction Support

All batch operations use SQLite transactions for atomicity.

### Stuck Event Recovery

Events with stale `keep_alive` timestamps are automatically reclaimed.

## Back to Main Documentation

[← Back to outbox-event-bus](../../README.md)
