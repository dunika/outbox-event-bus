# PostgreSQL (Prisma) Outbox

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/postgres-prisma-outbox?style=flat-square&color=2563eb)
![npm downloads](https://img.shields.io/npm/dm/@outbox-event-bus/postgres-prisma-outbox?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/postgres-prisma-outbox?style=flat-square&color=2563eb)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?style=flat-square&logo=typescript)

> **Transactional Outbox for Prisma — Zero Event Loss with Your Existing Schema**

PostgreSQL adapter for [outbox-event-bus](https://github.com/dunika/outbox-event-bus#readme) using [Prisma ORM](https://www.prisma.io/). Provides reliable event storage with ACID transactions and row-level locking for safe distributed processing.

## Quick Start

```bash
npm install @outbox-event-bus/postgres-prisma-outbox @prisma/client
```

```typescript
import { PrismaClient } from '@prisma/client';
import { PostgresPrismaOutbox } from '@outbox-event-bus/postgres-prisma-outbox';
import { OutboxEventBus } from 'outbox-event-bus';

const prisma = new PrismaClient();
const outbox = new PostgresPrismaOutbox({ prisma });
const bus = new OutboxEventBus(outbox, (error) => console.error(error));

bus.start();

// Emit events transactionally
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({ data: userData });
  await bus.emit({ type: 'user.created', payload: user }, tx);
});
```

[→ Full Tutorial](#tutorial)

## Contents

- [Quick Start](#quick-start)
- [When to Use](#when-to-use)
- [Installation](#installation)
- [Tutorial](#tutorial)
- [Prisma Schema](#prisma-schema)
- [Configuration](#configuration)
- [Usage](#usage)
- [How-To Guides](#how-to-guides)
- [Features](#features)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)

## When to Use

**Choose Postgres Prisma Outbox when:**
- You are using **Prisma** as your ORM
- You want seamless integration with your existing Prisma schema
- You need **transactional consistency** using Prisma's interactive transactions

**Comparison with other adapters:**

| Feature | Prisma | Drizzle | Raw SQL |
|:---|:---:|:---:|:---:|
| **Type Safety** | ✅ Full | ✅ Full | ❌ Manual |
| **Transaction Support** | ✅ Interactive | ✅ Native | ✅ Manual |
| **Schema Migrations** | ✅ Built-in | ✅ Built-in | ❌ Manual |
| **Learning Curve** | Medium | Low | Low |
| **Performance** | Good | Excellent | Excellent |
| **Best For** | Prisma users | SQL purists | Maximum control |

## Installation

```bash
npm install @outbox-event-bus/postgres-prisma-outbox @prisma/client
npm install -D prisma
```

## Tutorial

### Step 1: Install Dependencies

```bash
npm install @outbox-event-bus/postgres-prisma-outbox @prisma/client
npm install -D prisma
```

### Step 2: Add Prisma Schema

Add the outbox tables to your `schema.prisma`:

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
  expireInSeconds Int          @default(300) @map("expire_in_seconds")

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

### Step 3: Run Migration

```bash
npx prisma migrate dev --name add_outbox
```

### Step 4: Create Outbox Instance

```typescript
import { PrismaClient } from '@prisma/client';
import { PostgresPrismaOutbox } from '@outbox-event-bus/postgres-prisma-outbox';
import { OutboxEventBus } from 'outbox-event-bus';

const prisma = new PrismaClient();
const outbox = new PostgresPrismaOutbox({ prisma });
const bus = new OutboxEventBus(outbox, (err) => console.error(err));
```

### Step 5: Register Handlers

```typescript
bus.on('user.created', async (event) => {
  await emailService.sendWelcome(event.payload.email);
});

bus.start();
```

### Step 6: Emit Your First Event

```typescript
async function createUser(userData: any) {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: userData });
    
    // Event will commit with the user creation
    await bus.emit({ 
      type: 'user.created', 
      payload: user 
    }, tx);
  });
}
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
  expireInSeconds Int          @default(300) @map("expire_in_seconds")

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

### Required Schema Fields

Your Prisma model **must** include the following fields with these specific types (or compatible ones):

| Field | Type | Required | Description |
|:---|:---|:---:|:---|
| `id` | `String` | ✅ | Primary Key |
| `type` | `String` | ✅ | Event type |
| `payload` | `Json` | ✅ | Event data |
| `occurredAt` | `DateTime` | ✅ | When event occurred |
| `status` | `OutboxStatus` | ✅ | Lifecycle state |
| `retryCount` | `Int` | ✅ | Default: 0 |
| `lastError` | `String?` | ❌ | Error message |
| `nextRetryAt` | `DateTime?` | ❌ | Scheduled retry |
| `createdOn` | `DateTime` | ✅ | Default: now() |
| `startedOn` | `DateTime?` | ❌ | Processing start |
| `keepAlive` | `DateTime?` | ❌ | Heartbeat |
| `expireInSeconds` | `Int` | ✅ | Default: 30 |

> [!TIP]
> Use `@map` to align Prisma field names with your database column names if they differ.

## Concurrency & Locking

This adapter uses **Row-Level Locking** (`SELECT ... FOR UPDATE SKIP LOCKED`) to ensure safe concurrent processing.

-   **Multiple Workers**: You can run multiple instances of your application.
-   **No Duplicates**: The database ensures that only one worker picks up a specific event at a time.
-   **Performance**: `SKIP LOCKED` allows workers to skip locked rows and process the next available event immediately, preventing contention.

## Configuration

### PostgresPrismaOutboxConfig

```typescript
interface PostgresPrismaOutboxConfig extends OutboxConfig {
  // Prisma-specific options
  prisma: PrismaClient;
  getTransaction?: () => PrismaClient | undefined; // Optional transaction executor getter
  models?: {                        // Optional model name overrides
    outbox?: string;                // Default: "outboxEvent"
    archive?: string;               // Default: "outboxEventArchive"
  };
  tableName?: string;               // Optional table name for raw queries (default: "outbox_events")
  // Inherited from OutboxConfig
  maxRetries?: number;              // Max retry attempts (default: 5)
  baseBackoffMs?: number;           // Base retry backoff (default: 1000ms)
  pollIntervalMs?: number;          // Polling interval (default: 1000ms)
  maxErrorBackoffMs?: number;       // Max polling error backoff (default: 30000ms)
  processingTimeoutMs?: number;     // Processing timeout (default: 30000ms)
  batchSize?: number;               // Events per poll (default: 50)
}
```

> [!NOTE]
> All adapters inherit base configuration options from `OutboxConfig`. See the [API Reference](https://github.com/dunika/outbox-event-bus/blob/main/docs/API_REFERENCE.md#base-outbox-configuration) for details on inherited options.

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

const bus = new OutboxEventBus(outbox, (error) => console.error(error));
bus.start();
```

### With Interactive Transactions (AsyncLocalStorage)

> [!TIP]
> Use `AsyncLocalStorage` to manage transactions without passing them through your call stack. This keeps your code clean and avoids "transaction drilling."

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

const bus = new OutboxEventBus(outbox, (error) => console.error(error));

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

**Alternative: Use the built-in helper:**

```typescript
import { 
  PostgresPrismaOutbox, 
  withPrismaTransaction, 
  getPrismaTransaction 
} from '@outbox-event-bus/postgres-prisma-outbox';

const outbox = new PostgresPrismaOutbox({
  prisma,
  getTransaction: getPrismaTransaction()
});

async function createUser(userData: any) {
  return withPrismaTransaction(prisma, async (tx) => {
    const user = await tx.user.create({ data: userData });
    await bus.emit({ type: 'user.created', payload: user });
    return user;
  });
}
```

### With Interactive Transactions (Explicit)

> [!IMPORTANT]
> Always pass the transaction object to `emit()` to ensure atomicity. If you forget, the event will be saved outside the transaction and could be lost on rollback.

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

## How-To Guides

### Use Custom Table Names

If you need to use different table names than the defaults:

```typescript
const outbox = new PostgresPrismaOutbox({
  prisma,
  tableName: 'my_custom_outbox_events'
});
```

> [!WARNING]
> When using custom table names, ensure your Prisma schema's `@@map` directive matches the `tableName` config.

### Use Custom Model Names

If your Prisma models have different names:

```typescript
const outbox = new PostgresPrismaOutbox({
  prisma,
  models: {
    outbox: 'myOutboxEvent',
    archive: 'myOutboxEventArchive'
  }
});
```

This is useful when integrating with existing schemas or following specific naming conventions.

### Migrate from Drizzle to Prisma

**Step 1:** Install Prisma and introspect your existing database:

```bash
npm install @prisma/client prisma
npx prisma init
npx prisma db pull
```

**Step 2:** Update your outbox initialization:

```typescript
// Before (Drizzle)
import { PostgresDrizzleOutbox } from '@outbox-event-bus/postgres-drizzle-outbox';
const outbox = new PostgresDrizzleOutbox({ db });

// After (Prisma)
import { PostgresPrismaOutbox } from '@outbox-event-bus/postgres-prisma-outbox';
const outbox = new PostgresPrismaOutbox({ prisma });
```

**Step 3:** Update transaction handling:

```typescript
// Before (Drizzle)
await db.transaction(async (tx) => {
  await bus.emit({ type: 'event' }, tx);
});

// After (Prisma)
await prisma.$transaction(async (tx) => {
  await bus.emit({ type: 'event' }, tx);
});
```

### Debug Transaction Issues

**Problem:** Events are not being saved or are lost on rollback.

**Solution:** Verify the transaction is being passed correctly:

```typescript
// ❌ Wrong - event saved outside transaction
await prisma.$transaction(async (tx) => {
  await tx.user.create({ data });
  await bus.emit({ type: 'event' }); // Missing tx argument!
});

// ✅ Correct - event saved within transaction
await prisma.$transaction(async (tx) => {
  await tx.user.create({ data });
  await bus.emit({ type: 'event' }, tx); // tx passed explicitly
});
```

**Enable debug logging:**

```typescript
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error']
});
```

### Optimize for High Throughput

**Increase batch size and reduce poll interval:**

```typescript
const outbox = new PostgresPrismaOutbox({
  prisma,
  batchSize: 100,        // Process 100 events per poll (default: 50)
  pollIntervalMs: 500    // Poll every 500ms (default: 1000ms)
});
```

**Size your connection pool appropriately:**

```typescript
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL + '?connection_limit=20'
    }
  }
});
```

> [!TIP]
> Connection pool size should be: `(number of workers × 2) + 1` to handle concurrent polling and processing.

### Monitor Event Processing

**Track processing metrics:**

You can wrap your handlers to track successful executions, while the error handler captures failures.

```typescript
const metrics = {
  processed: 0,
  failed: 0
};

const bus = new OutboxEventBus(outbox, (error: OutboxError) => {
  metrics.failed++;
  logger.error('Event processing failed', {
    error: error.message,
    event: error.context?.event
  });
});

// Helper to wrap handlers with monitoring
const monitor = (handler: (event: any) => Promise<void>) => {
  return async (event: any) => {
    await handler(event);
    metrics.processed++;
  };
};

bus.on('user.created', monitor(async (event) => {
  // ... handler logic
}));

// Expose metrics endpoint
app.get('/metrics', (req, res) => {
  res.json({
    ...metrics,
    successRate: metrics.processed / (metrics.processed + metrics.failed) || 1
  });
});
```

**Query failed events:**

```typescript
const failedEvents = await outbox.getFailedEvents();
console.log(`${failedEvents.length} events need attention`);
```

## Features

### 🔒 Safe Concurrent Processing

Uses PostgreSQL's `FOR UPDATE SKIP LOCKED` to allow multiple workers to process events simultaneously without blocking each other.

```sql
-- Multiple workers can claim different events in parallel
SELECT * FROM outbox_events 
WHERE status = 'created'
LIMIT 50 
FOR UPDATE SKIP LOCKED;
```

This ensures:
- **No blocking**: Workers don't wait for each other
- **No duplicates**: Each event is processed exactly once
- **Horizontal scaling**: Add more workers for higher throughput

### ⚛️ ACID Transactions

Emit events within Prisma transactions for guaranteed atomicity.

```typescript
await prisma.$transaction(async (tx) => {
  await tx.user.create({ data: userData });
  await bus.emit({ type: 'user.created', payload: user }, tx);
  // Both commit together or rollback together
});
```

**Benefits:**
- Events are never lost due to crashes
- No orphaned events if business logic fails
- Database guarantees consistency

### 🔄 Automatic Retries

Failed events are retried with exponential backoff (configurable).

```typescript
const outbox = new PostgresPrismaOutbox({
  prisma,
  maxRetries: 5,           // Retry up to 5 times
  baseBackoffMs: 1000      // Start with 1s delay, then 2s, 4s, 8s, 16s
});
```

### 📦 Archiving

Completed events are moved to `outbox_events_archive` to keep the main table fast.

```typescript
// Successful events are automatically archived
await tx.outboxEventArchive.create({ data: completedEvent });
await tx.outboxEvent.delete({ where: { id: eventId } });
```

### 🛡️ Stuck Event Recovery

Automatically reclaims events from crashed workers using `keep_alive` timestamps.

```sql
-- Events stuck for more than 30 seconds are reclaimed
SELECT * FROM outbox_events 
WHERE status = 'active' 
  AND keep_alive < NOW() - INTERVAL '30 seconds';
```

### 🎯 Flexible Schema

Use custom table and model names to fit your existing Prisma schema.

```typescript
const outbox = new PostgresPrismaOutbox({
  prisma,
  models: { 
    outbox: 'myOutboxEvent', 
    archive: 'myArchive' 
  },
  tableName: 'my_outbox_events'
});
```

### 🧪 TypeScript First

Full type safety with generics for events, payloads, and transactions.

```typescript
interface UserCreatedPayload {
  id: string;
  email: string;
}

await bus.emit<UserCreatedPayload>({
  type: 'user.created',
  payload: { id: '123', email: 'user@example.com' }
});
```

## API Reference

### PostgresPrismaOutbox

```typescript
class PostgresPrismaOutbox implements IOutbox<PrismaClient>
```

#### Constructor

```typescript
constructor(config: PostgresPrismaOutboxConfig)
```

Creates a new PostgreSQL outbox adapter using Prisma.

**Parameters:**
- `config`: Configuration object (see [Configuration](#configuration))

**Example:**
```typescript
const outbox = new PostgresPrismaOutbox({
  prisma,
  batchSize: 50,
  pollIntervalMs: 1000
});
```

#### Methods

##### publish()

```typescript
async publish(
  events: BusEvent[],
  transaction?: PrismaClient
): Promise<void>
```

Publishes events to the outbox. If `transaction` is provided, events are saved within that transaction. Otherwise, uses `getTransaction()` or the default Prisma client.

**Parameters:**
- `events`: Array of events to publish
- `transaction`: Optional Prisma transaction client

**Example:**
```typescript
await outbox.publish([
  { id: '1', type: 'user.created', payload: user, occurredAt: new Date() }
], tx);
```

##### getFailedEvents()

```typescript
async getFailedEvents(): Promise<FailedBusEvent[]>
```

Returns up to 100 failed events, ordered by most recent first.

**Returns:** Array of failed events with error details

**Example:**
```typescript
const failed = await outbox.getFailedEvents();
console.log(`${failed.length} events failed`);
```

##### retryEvents()

```typescript
async retryEvents(eventIds: string[]): Promise<void>
```

Resets the specified events to `created` status with retry count 0.

**Parameters:**
- `eventIds`: Array of event IDs to retry

**Example:**
```typescript
await outbox.retryEvents(['event-1', 'event-2']);
```

##### start()

```typescript
start(
  handler: (event: BusEvent) => Promise<void>,
  onError: ErrorHandler
): void
```

Starts the polling service.

**Parameters:**
- `handler`: Function to process each event
- `onError`: Error handler callback

**Example:**
```typescript
outbox.start(
  async (event) => console.log(event),
  (err) => console.error(err)
);
```

##### stop()

```typescript
async stop(): Promise<void>
```

Stops the polling service gracefully.

**Example:**
```typescript
await outbox.stop();
```

### Transaction Utilities

#### withPrismaTransaction()

```typescript
async function withPrismaTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T>
```

Wraps a function in a Prisma transaction with AsyncLocalStorage context.

**Parameters:**
- `prisma`: Prisma client instance
- `fn`: Function to execute within transaction

**Returns:** Result of the function

**Example:**
```typescript
const user = await withPrismaTransaction(prisma, async (tx) => {
  const user = await tx.user.create({ data: userData });
  await bus.emit({ type: 'user.created', payload: user });
  return user;
});
```

#### getPrismaTransaction()

```typescript
function getPrismaTransaction(): () => PrismaClient | undefined
```

Returns a getter function for the current transaction from AsyncLocalStorage.

**Returns:** Function that returns the current transaction or undefined

**Example:**
```typescript
const outbox = new PostgresPrismaOutbox({
  prisma,
  getTransaction: getPrismaTransaction()
});
```

#### prismaTransactionStorage

```typescript
const prismaTransactionStorage: AsyncLocalStorage<PrismaClient>
```

The AsyncLocalStorage instance used to store Prisma transactions.

**Example:**
```typescript
await prisma.$transaction(async (tx) => {
  await prismaTransactionStorage.run(tx, async () => {
    // Transaction is available via getStore()
    const currentTx = prismaTransactionStorage.getStore();
  });
});
```

### Types

#### PostgresPrismaOutboxConfig

See [Configuration](#configuration) section.

#### OutboxStatus

```typescript
enum OutboxStatus {
  created = 'created',
  active = 'active',
  completed = 'completed',
  failed = 'failed'
}
```

Enum representing the lifecycle states of an outbox event.

## Troubleshooting

### `Raw query failed. Code: 42883` (Undefined function)

**Cause:** Casting to `::outbox_status` failed because the enum doesn't exist in the database.

**Solution:** Ensure you used the `enum OutboxStatus` in your Prisma schema and ran the migration:

```bash
npx prisma migrate dev --name add_outbox
```

Verify the enum exists:
```sql
SELECT typname FROM pg_type WHERE typname = 'OutboxStatus';
```

### `PrismaClientKnownRequestError`

**Cause:** Database connection issues or connection pool exhaustion.

**Solution:** 

1. **Check connection string:**
```typescript
console.log(process.env.DATABASE_URL);
```

2. **Size connection pool correctly:**
```typescript
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL + '?connection_limit=20'
    }
  }
});
```

3. **Monitor active connections:**
```sql
SELECT count(*) FROM pg_stat_activity WHERE datname = 'your_database';
```

### Transaction Timeout Errors

**Cause:** Long-running transactions or deadlocks.

**Solution:**

1. **Reduce transaction scope:**
```typescript
// ❌ Bad - too much work in transaction
await prisma.$transaction(async (tx) => {
  await tx.user.create({ data });
  await externalApiCall(); // Don't do this!
  await bus.emit({ type: 'event' }, tx);
});

// ✅ Good - minimal transaction scope
await prisma.$transaction(async (tx) => {
  await tx.user.create({ data });
  await bus.emit({ type: 'event' }, tx);
});
await externalApiCall(); // Do this outside
```

2. **Increase timeout:**
```typescript
await prisma.$transaction(async (tx) => {
  // ... transaction logic
}, {
  timeout: 10000 // 10 seconds
});
```

### Prisma 7 Adapter Configuration

> [!WARNING]
> Prisma 7 requires `@prisma/adapter-pg` for connection pooling. Without it, you'll see `P1001` connection errors.

**Cause:** Missing Prisma 7 adapter configuration.

**Solution:**

```bash
npm install @prisma/adapter-pg pg
```

```typescript
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
```

### AsyncLocalStorage Context Loss

**Cause:** Transaction context is lost when using `AsyncLocalStorage` with certain async operations.

**Solution:** Ensure all async operations preserve the ALS context:

```typescript
// ❌ Bad - context may be lost
await prisma.$transaction(async (tx) => {
  await als.run(tx, async () => {
    await Promise.all([
      operation1(),
      operation2() // Context might be lost here
    ]);
  });
});

// ✅ Good - use withPrismaTransaction helper
await withPrismaTransaction(prisma, async (tx) => {
  await Promise.all([
    operation1(),
    operation2() // Context preserved
  ]);
});
```
