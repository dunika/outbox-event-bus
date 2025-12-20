# PostgreSQL Prisma Outbox

PostgreSQL adapter for [outbox-event-bus](../../README.md) using [Prisma ORM](https://www.prisma.io/). Provides reliable event storage with row-level locking for safe distributed processing.

```typescript
import { PrismaClient } from '@prisma/client';
import { PostgresPrismaOutbox } from '@outbox-event-bus/postgres-prisma-outbox';

const prisma = new PrismaClient();

const outbox = new PostgresPrismaOutbox({
  prisma,
  onError: (error) => console.error(error)
});
```

This adapter uses PostgreSQL's row-level locking to ensure only one worker processes each event.

- [Installation](#installation)
- [Prisma Schema](#prisma-schema)
- [Configuration](#configuration)
- [Usage](#usage)
- [Features](#features)
- [Back to Main Documentation](../../README.md)

## Installation

```bash
npm install @outbox-event-bus/postgres-prisma-outbox @prisma/client
npm install -D prisma
```

## Prisma Schema

Add these models to your `schema.prisma`:

```prisma
model OutboxEvent {
  id               String    @id
  type             String
  payload          Json
  occurredAt       DateTime  @map("occurred_at")
  status           String    @default("created")
  retryCount       Int       @default(0) @map("retry_count")
  lastError        String?   @map("last_error")
  nextRetryAt      DateTime? @map("next_retry_at")
  createdOn        DateTime  @default(now()) @map("created_on")
  startedOn        DateTime? @map("started_on")
  keepAlive        DateTime? @map("keep_alive")
  expireInSeconds  Int       @default(60) @map("expire_in_seconds")

  @@index([status, nextRetryAt])
  @@index([status, keepAlive])
  @@map("outbox_events")
}

model OutboxEventArchive {
  id          String   @id
  type        String
  payload     Json
  occurredAt  DateTime @map("occurred_at")
  status      String
  retryCount  Int      @map("retry_count")
  lastError   String?  @map("last_error")
  createdOn   DateTime @map("created_on")
  startedOn   DateTime? @map("started_on")
  completedOn DateTime @map("completed_on")

  @@map("outbox_events_archive")
}
```

Then run:

```bash
npx prisma migrate dev --name add_outbox
```

## Configuration

### PostgresPrismaOutboxConfig

```typescript
interface PostgresPrismaOutboxConfig {
  prisma: PrismaClient;
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
import { PrismaClient } from '@prisma/client';
import { PostgresPrismaOutbox } from '@outbox-event-bus/postgres-prisma-outbox';
import { OutboxEventBus } from 'outbox-event-bus';

const prisma = new PrismaClient();

const outbox = new PostgresPrismaOutbox({
  prisma,
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

### With Prisma Interactive Transactions

```typescript
// Create user and emit event in same transaction
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({
    data: { email: 'user@example.com', name: 'John Doe' }
  });

  await tx.outboxEvent.create({
    data: {
      id: crypto.randomUUID(),
      type: 'user.created',
      payload: user,
      occurredAt: new Date(),
      status: 'created',
      retryCount: 0,
      expireInSeconds: 60
    }
  });
});
```

## Features

### Row-Level Locking

Uses Prisma's raw SQL for `SELECT FOR UPDATE SKIP LOCKED` to safely claim events in distributed environments.

### Automatic Archiving

Completed events are moved to `OutboxEventArchive` model for audit trail.

### Stuck Event Recovery

Events with stale `keepAlive` timestamps are automatically reclaimed.

### Exponential Backoff Retry

Failed events retry with exponential backoff (max 5 retries by default).

## Back to Main Documentation

[← Back to outbox-event-bus](../../README.md)
