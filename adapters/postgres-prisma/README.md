# PostgreSQL (Prisma) Outbox

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/postgres-prisma-outbox?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/postgres-prisma-outbox?style=flat-square&color=2563eb)

> **Relational Event Storage with Prisma ORM**

PostgreSQL adapter for [outbox-event-bus](../../README.md) using [Prisma ORM](https://www.prisma.io/). Provides reliable event storage with row-level locking for safe distributed processing.

```typescript
import { PrismaClient } from '@prisma/client';
import { PostgresPrismaOutbox } from '@outbox-event-bus/postgres-prisma-outbox';

const prisma = new PrismaClient();
const outbox = new PostgresPrismaOutbox({
  prisma
});
```

## When to Use

**Choose Postgres Prisma Outbox when:**
- You are using **Prisma** as your ORM.
- You want seamless integration with your existing Prisma schema.
- You need **transactional consistency** using Prisma's interactive transactions.

## Installation

```bash
npm install @outbox-event-bus/postgres-prisma-outbox @prisma/client
npm install -D prisma
```

## Prisma Schema

Add the following to your `schema.prisma`. Note the use of `enum` for status to ensure type safety.

```prisma
enum OutboxStatus {
  created
  active
  completed
  failed
}

model OutboxEvent {
  id              String       @id
  type            String
  payload         Json
  occurredAt      DateTime     @map("occurred_at")
  status          OutboxStatus @default(created)
  retryCount      Int          @default(0) @map("retry_count")
  lastError       String?      @map("last_error")
  nextRetryAt     DateTime?    @map("next_retry_at")
  createdOn       DateTime     @default(now()) @map("created_on")
  startedOn       DateTime?    @map("started_on")
  keepAlive       DateTime?    @map("keep_alive")
  expireInSeconds Int          @default(60) @map("expire_in_seconds")

  @@index([status, nextRetryAt])
  @@index([status, keepAlive])
  @@map("outbox_events")
}

model OutboxEventArchive {
  id          String       @id
  type        String
  payload     Json
  occurredAt  DateTime     @map("occurred_at")
  status      OutboxStatus
  retryCount  Int          @map("retry_count")
  lastError   String?      @map("last_error")
  createdOn   DateTime     @map("created_on")
  startedOn   DateTime?    @map("started_on")
  completedOn DateTime     @map("completed_on")

  @@map("outbox_events_archive")
}
```

Run migration:
```bash
npx prisma migrate dev --name add_outbox
```

## Configuration

### PostgresPrismaOutboxConfig

```typescript
interface PostgresPrismaOutboxConfig {
  prisma: PrismaClient;
  getTransaction?: () => PrismaClient | undefined; // Optional transaction executor getter
  maxRetries?: number;              // Max retry attempts (default: 5)
  baseBackoffMs?: number;           // Base retry backoff (default: 1000ms)
  pollIntervalMs?: number;          // Polling interval (default: 1000ms)
  maxErrorBackoffMs?: number;       // Max polling error backoff (default: 30000ms)
  processingTimeoutMs?: number;     // Processing timeout (default: 30000ms)
  batchSize?: number;               // Events per poll (default: 50)
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
  prisma
});

const bus = new OutboxEventBus(outbox, console.warn, console.error);
bus.start();
```

### With Interactive Transactions (AsyncLocalStorage)

For larger applications, use `AsyncLocalStorage` to manage transactions. This allows you to emit events from anywhere in your code without passing around the Prisma transaction object.

```typescript
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

const prisma = new PrismaClient();
const als = new AsyncLocalStorage<PrismaClient>();

const outbox = new PostgresPrismaOutbox({
  prisma,
  getTransaction: () => als.getStore()
});

const bus = new OutboxEventBus(outbox, console.warn, console.error);

async function createUser(userData: any) {
  return await prisma.$transaction(async (tx) => {
    // Run business logic within the ALS context
    return await als.run(tx as any, async () => {
      const user = await tx.user.create({ data: userData });
      
      // The bus will automatically use the transaction from ALS via getTransaction
      await bus.emit({
        id: crypto.randomUUID(),
        type: 'user.created',
        payload: user
      });
      
      return user;
    });
  });
}
```

### With Interactive Transactions (Explicit)

If you prefer passing the transaction client explicitly, you can pass it as a second argument to `emit`.

```typescript
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({ data: userData });

  await bus.emit({
    id: crypto.randomUUID(),
    type: 'user.created',
    payload: user
  }, tx); // Pass the transaction client explicitly
});
```

## Features

- **SKIP LOCKED**: Uses raw SQL with `FOR UPDATE SKIP LOCKED` to efficiently claim events without blocking.
- **Transactional Integrity**: Fully compatible with Prisma's interactive transactions ($transaction).
- **Archiving**: Moves processed events to `outbox_events_archive` to maintain performance.
- **Stuck Event Recovery**: Reclaims events locked by dead workers using `keep_alive` timestamps.

## Troubleshooting

### `Raw query failed. Code: 42883` (Undefined function)
- **Cause**: Casting to `::outbox_status` failed.
- **Solution**: Ensure you used the `enum OutboxStatus` in your Prisma schema and migrated the DB.

### `PrismaClientKnownRequestError`
- **Cause**: Database connection issues.
- **Solution**: Ensure your connection pool is sized correctly for the number of workers.
