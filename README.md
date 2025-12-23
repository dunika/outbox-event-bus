# outbox-event-bus

![version](https://img.shields.io/npm/v/outbox-event-bus?style=flat-square&color=2563eb)
![size](https://img.shields.io/bundlephobia/minzip/outbox-event-bus?style=flat-square&color=2563eb)
![deps](https://img.shields.io/badge/dependencies-0-2563eb?style=flat-square)
![license](https://img.shields.io/npm/l/outbox-event-bus?style=flat-square&color=2563eb)

> **Never Lose an Event Again**
>
> Transactional outbox pattern made simple. Persist events atomically with your data. Guaranteed delivery with your database.

<br>

**The Problem**: You save data to your database and attempt to emit a relevant event. If your process crashes or the network fails before the event is sent, your system becomes inconsistent.

<div align="center">
<img src="https://raw.githubusercontent.com/dunika/outbox-event-bus/main/docs/images/problem.png" alt="The Dual Write Problem" width="600">
</div>

<br>

**The Solution**: `outbox-event-bus` stores events in your database *within the same transaction* as your data. A background worker then reliably delivers them.

<div align="center">
<img src="https://raw.githubusercontent.com/dunika/outbox-event-bus/main/docs/images/solution.png" alt="The Outbox Solution" width="600">
</div>

<br>

## Quick Start (Postgres + Drizzle ORM + SQS Example)

```bash
npm install outbox-event-bus @outbox-event-bus/postgres-drizzle-outbox drizzle-orm @outbox-event-bus/sqs-publisher
```

```typescript
import { OutboxEventBus } from 'outbox-event-bus';
import { PostgresDrizzleOutbox } from '@outbox-event-bus/postgres-drizzle-outbox';
import { SQSPublisher } from '@outbox-event-bus/sqs-publisher';

// Setup
const outbox = new PostgresDrizzleOutbox({ db });
const bus = new OutboxEventBus(outbox, (error: OutboxError) => console.error(error));


// Register handlers
bus.on('user.created', async (event) => {
  // Fan Out as needed
  await bus.emitMany([
    { type: 'send.welcome', payload: event.payload },
    { type: 'sync-to-sqs', payload: event.payload }
  ]);
});

bus.on('send.welcome', async (event) => {
  await emailService.sendWelcome(event.payload.email);
});

// Middleware 
bus.addHandlerMiddleware(async (ctx, next) => {
  console.log('Processing:', ctx.event.type);
  await next();
});

// Forward messages to SQS
const sqsClient = new SQSClient({ region: 'us-east-1' });
const publisher = new SQSPublisher(bus, { queueUrl: '...', sqsClient });
publisher.subscribe(['sync-to-sqs']);

// Start the bus
bus.start();

// Emit transactionally
await db.transaction(async (transaction) => {
  const [user] = await transaction.insert(users).values(newUser).returning();
  
  // Both operations commit together or rollback together
  await bus.emit({ type: 'user.created', payload: user }, transaction);
});
```

<br>

## Why outbox-event-bus?

- **Zero Event Loss**: Events persist atomically with your data using database transactions.
- **Storage Agnostic**: Works with any database. **Use our built-in adapters** for Postgres, MongoDB, DynamoDB, Redis, and SQLite, or create your own.
- **Guaranteed Delivery**: At-least-once semantics with exponential backoff and dead letter handling.
- **Safe Retries**: Strict 1:1 command bus pattern prevents duplicate side-effects.
- **Built-in Publishers**: Comes with optional publishers for SQS, SNS, Kafka, RabbitMQ, Redis Streams, and EventBridge
- **Middleware Support**: Intercept and process events with custom middleware for cross-cutting concerns like logging, observability, and enrichment.
- **Typed Error Handling**: Comprehensive typed errors for precise control over failure scenarios and recovery strategies.
- **TypeScript First**: Full type safety with generics for events, payloads, and transactions.

## Contents

- [Concepts](#concepts)
- [Middleware](#middleware)
- [Adapters & Publishers](#adapters--publishers)
- [How-To Guides](#how-to-guides)
- [API Reference](./docs/API_REFERENCE.md)
- [Production Guide](#production-guide)
- [Contributing](./docs/CONTRIBUTING.md)
- [License](#license)

<br>

## Concepts

### Strict 1:1 Command Bus Pattern

> This library enforces a **Command Bus pattern**: Each event type can have exactly **one** handler.

**Why?**
- If you have 2 handlers and one fails, retrying the event would re-run the successful handler too (double side-effects)
- Example: `user.created` triggers "Send Welcome Email", "Send Analytics" and "Sync to SQS". If "Send Analytics" fails and retries, "Send Welcome Email" runs again → duplicate emails

**Solution:** Strict 1:1 binding ensures that if a handler fails, only that specific logic is retried.

**Fan-Out Pattern:** If you need multiple actions, publish new "intent events" from your handler:

```typescript
// Main handler
bus.on('user.created', async (event) => {
  // Fan-out: Publish intent events back to the outbox
  await bus.emitMany([
    { type: 'send.welcome', payload: event.payload },
    { type: 'send.analytics', payload: event.payload },
    { type: 'sync-to-sqs', payload: event.payload }
  ]);
});

// Specialized handlers (1:1)
bus.on('send.welcome', async (event) => {
  await emailService.sendWelcome(event.payload.email);
});

bus.on('send.analytics', async (event) => {
  await analyticsService.track(event.payload);
});
```

### Event Lifecycle

Events flow through several states from creation to completion

<div align="center">
<img src="https://raw.githubusercontent.com/dunika/outbox-event-bus/main/docs/images/event_life_cycle.png" alt="Event Lifecycle" width="600">
</div>

<br>

**State Descriptions**

| State | Description | Next States |
|:---|:---|:---|
| `created` | Event saved to outbox, waiting to be processed | `active` (claimed by worker) |
| `active` | Event claimed by worker, handler executing | `completed` (success), `failed` (error), `active` (timeout) |
| `completed` | Handler succeeded, event ready for archival | `archived` (maintenance) |
| `failed` | Error occurred (retry pending or max retries exceeded) | `active` (retry), Manual intervention (max retries) |

<br>

**Stuck Event Recovery**

If a worker crashes while processing an event (status: `active`), the event becomes "stuck". The outbox adapter automatically reclaims stuck events after `processingTimeoutMs` (default: 30s).

**SQL Example (Postgres/SQLite):**
```sql
-- Events stuck for more than 30 seconds are reclaimed
SELECT * FROM outbox_events 
WHERE status = 'active' 
  AND keep_alive < NOW() - INTERVAL '30 seconds';
```

> **Note:** Non-SQL adapters (DynamoDB, Redis, Mongo) implement equivalent recovery mechanisms using their native features (TTL, Sorted Sets, etc).

<br>

## Middleware

`outbox-event-bus` supports middleware to intercept and process events during the **Emit** and **Handler** phases. This is useful for logging, observability, modifying events, or enforcing policies.

### Usage

Register middleware based on your needs: use `bus.addEmitMiddleware()` to intercept events before persistence, `bus.addHandlerMiddleware()` to process them before they reach handlers, or `bus.addMiddleware()` to apply logic across both phases.

Each `add*` method accepts one or more middleware functions.

```typescript
bus.addMiddleware(async (ctx, next) => {
  const prefix = ctx.phase === 'emit' ? '[emit]' : '[handler]';
  console.log(`${prefix} Processing event: ${ctx.event.type}`);
  
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  
  console.log(`${prefix} Completed in ${duration}ms`);
});
```

### Middleware Phases

- **Emit Phase** (`phase: 'emit'`): Runs when `bus.emit()` or `bus.emitMany()` is called, *before* events are persisted to the database.
  - Useful for: Validation, adding metadata (correlation IDs), encryption.
  - **Note**: Modifying `ctx.event` affects what IS stored in the database.
  - You can filter events by not calling `next()` (or throwing an error).

- **Handler Phase** (`phase: 'handler'`): Runs when a worker picks up an event, *before* the handler is invoked.
  - Useful for: Logging, setting up AsyncLocalStorage, error reporting contexts (Sentry, etc.), decryption.

### Modifying Events

You can modify events in transit.

```typescript
bus.addEmitMiddleware(async (ctx, next) => {
  // Add correlation ID if missing
  ctx.event.metadata = { 
    ...ctx.event.metadata, 
    correlationId: ctx.event.metadata?.correlationId || crypto.randomUUID() 
  };
  await next();
});
```

### Filtering Events

You can explicitly drop an event by passing `{ dropEvent: true }` to `next()`. This stops the middleware chain and prevents the event from being persisted (emit phase) or processed (handler phase).

```typescript
bus.addEmitMiddleware(async (ctx, next) => {
  if (ctx.event.type === 'sensitive.data') {
    await next({ dropEvent: true });
    return;
  }
  await next();
});
```

<br>

## Adapters & Publishers

Mix and match any storage adapter with any publisher.

### Storage Adapters (The "Outbox")

These store your events. Choose one that matches your primary database.

| Database | Adapters | Transaction Support | Concurrency |
|:---|:---|:---:|:---|
| **Postgres** | [Prisma](./adapters/postgres-prisma/README.md), [Drizzle](./adapters/postgres-drizzle/README.md) | Full (ACID) | `SKIP LOCKED` |
| **MongoDB** | [Native Driver](./adapters/mongo-mongodb/README.md) | Full (Replica Set) | Optimistic Locking |
| **DynamoDB** | [AWS SDK](./adapters/dynamodb-aws-sdk/README.md) | Full (TransactWrite) | Optimistic Locking |
| **Redis** | [ioredis](./adapters/redis-ioredis/README.md) | Atomic (Multi/Exec) | Distributed Lock |
| **SQLite** | [better-sqlite3](./adapters/sqlite-better-sqlite3/README.md) | Full (ACID) | Serialized |

<br>

### Publishers

These send your events to the world.

| Publisher | Target | Batching | Package |
|:---|:---|:---:|:---|
| **[AWS SQS](./publishers/sqs/README.md)** | Amazon SQS Queues | Yes (10) | `@outbox-event-bus/sqs-publisher` |
| **[AWS SNS](./publishers/sns/README.md)** | Amazon SNS Topics | Yes (10) | `@outbox-event-bus/sns-publisher` |
| **[EventBridge](./publishers/eventbridge/README.md)** | AWS Event Bus | Yes (10) | `@outbox-event-bus/eventbridge-publisher` |
| **[RabbitMQ](./publishers/rabbitmq/README.md)** | AMQP Brokers | Yes (Configurable) | `@outbox-event-bus/rabbitmq-publisher` |
| **[Kafka](./publishers/kafka/README.md)** | Streaming | Yes (Configurable) | `@outbox-event-bus/kafka-publisher` |
| **[Redis Streams](./publishers/redis-streams/README.md)** | Lightweight Stream | Yes (Configurable) | `@outbox-event-bus/redis-streams-publisher` |

<br>

### Choosing the Right Publisher

<div align="center">
<img src="https://raw.githubusercontent.com/dunika/outbox-event-bus/main/docs/images/choose_publisher.png" alt="Choose Publisher" width="600">
</div>

<br>

## How-To Guides

### Working with Transactions (Prisma + Postgres Example)
<br>

```typescript
import { PrismaClient } from '@prisma/client';
import { PostgresPrismaOutbox } from '@outbox-event-bus/postgres-prisma-outbox';
import { OutboxEventBus } from 'outbox-event-bus';

const prisma = new PrismaClient();
const outbox = new PostgresPrismaOutbox({ prisma });
const bus = new OutboxEventBus(outbox, (error) => console.error(error));

bus.start();

// Register handler
bus.on('user.created', async (event) => {
  await emailService.sendWelcome(event.payload.email);
});

// Emit within a transaction
async function createUser(userData: any) {
  await prisma.$transaction(async (transaction) => {
    // 1. Create user
    const user = await transaction.user.create({ data: userData });
    
    // 2. Emit event (will commit with the user creation)
    await bus.emit({ type: 'user.created', payload: user }, transaction);
  });
}
```

### Async Transactions (SQLite + better-sqlite3 Example)

SQLite transactions are synchronous by default. To use `await` with the event bus, use the `withBetterSqlite3Transaction` helper which manages the transaction scope for you.

```typescript
import Database from 'better-sqlite3';
import { SqliteBetterSqlite3Outbox, withBetterSqlite3Transaction, getBetterSqlite3Transaction } from '@outbox-event-bus/sqlite-better-sqlite3-outbox';
import { OutboxEventBus } from 'outbox-event-bus';

const db = new Database('app.db');
const outbox = new SqliteBetterSqlite3Outbox({ 
  dbPath: 'app.db',
  getTransaction: getBetterSqlite3Transaction() 
});
const bus = new OutboxEventBus(outbox, (error) => console.error(error));

bus.start();

async function createUser(userData: any) {
  return withBetterSqlite3Transaction(db, async (transaction) => {
    const stmt = transaction.prepare('INSERT INTO users (name) VALUES (?)');
    const info = stmt.run(userData.name);
    
    await bus.emit({ 
      type: 'user.created', 
      payload: { id: info.lastInsertRowid, ...userData } 
    });
    
    return info;
  });
}
```

> **Note:** Similar helpers (`withPrismaTransaction`, `withDrizzleTransaction`, `withMongodbTransaction`, etc.) are available in other adapters to simplify transaction management and avoid passing transaction objects manually.

<br>

### Environment-Specific Adapters

```typescript
import { InMemoryOutbox } from 'outbox-event-bus';
import { PostgresPrismaOutbox } from '@outbox-event-bus/postgres-prisma-outbox';

const outbox = process.env.NODE_ENV === 'production'
  ? new PostgresPrismaOutbox({ prisma })
  : new InMemoryOutbox();

const bus = new OutboxEventBus(outbox, (error) => console.error(error));
```

### Testing Event Handlers

**Problem:** How do I test event-driven code without a real database?

**Solution:** Use `InMemoryOutbox` and `waitFor`:

```typescript
import { describe, it, expect } from 'vitest';
import { OutboxEventBus, InMemoryOutbox } from 'outbox-event-bus';

describe('User Creation', () => {
  it('sends welcome email when user is created', async () => {
    const outbox = new InMemoryOutbox();
    const bus = new OutboxEventBus(outbox, (error) => console.error(error));
    
    let emailSent = false;
    bus.on('user.created', async (event) => {
      emailSent = true;
    });
    
    bus.start();
    
    await bus.emit({ type: 'user.created', payload: { email: 'test@example.com' } });
    await bus.waitFor('user.created');
    
    expect(emailSent).toBe(true);
    
    await bus.stop();
  });
});
```

### Error Handling

The library provides typed errors to help you handle specific failure scenarios programmatically. All errors extend the base `OutboxError` class.

- **Configuration Errors**: `DuplicateListenerError`, `UnsupportedOperationError`
- **Validation Errors**: `BatchSizeLimitError`
- **Operational Errors**: `TimeoutError`, `BackpressureError`, `MaxRetriesExceededError`, `HandlerError`

<br>

```typescript
import { OutboxEventBus, MaxRetriesExceededError } from 'outbox-event-bus';

// Simple initialization with error handler
const bus = new OutboxEventBus(outbox, (error: OutboxError) => {
  console.error('Bus error:', error);
});

// Advanced initialization with config object
const bus = new OutboxEventBus(outbox, {
  onError: (error: OutboxError) => console.error(error),
  middlewareConcurrency: 20 // Custom concurrency for middleware
});
```

For a complete list and usage examples, see the [API Reference](./docs/API_REFERENCE.md).

### Handling Failures

**Problem:** An event failed after max retries. How do I retry it?

**Solution:** Use `retryEvents` or reset via SQL.

**Using API:**
```typescript
const failedEvents = await bus.getFailedEvents();
const idsToRetry = failedEvents.map(e => e.id);
await bus.retryEvents(idsToRetry);
```

**Using SQL:**
```sql
-- Reset a specific event
UPDATE outbox_events 
SET status = 'created', retry_count = 0, last_error = NULL 
WHERE id = 'event-id-here';

-- Reset all failed events of a type
UPDATE outbox_events 
SET status = 'created', retry_count = 0, last_error = NULL 
WHERE status = 'failed' AND type = 'user.created';
```

### Schema Evolution

**Problem:** I need to change my event payload structure. How do I handle old events?

**Solution:** Use versioned event types and handlers:

```typescript
// Old handler (still processes legacy events)
bus.on('user.created.v1', async (event) => {
  const { firstName, lastName } = event.payload;
  await emailService.send({ name: `${firstName} ${lastName}` });
});

// New handler (processes new events)
bus.on('user.created.v2', async (event) => {
  const { fullName } = event.payload;
  await emailService.send({ name: fullName });
});

// Emit new version
await bus.emit({ type: 'user.created.v2', payload: { fullName: 'John Doe' } });
```



## Production Guide

> [!TIP]
> Start with conservative settings and tune based on your metrics. It's easier to increase throughput than to debug overload issues.

### Deployment Checklist

- [ ] **Database Schema**: Ensure outbox tables are created and migrated
- [ ] **Connection Pooling**: Size your connection pool for concurrent workers
- [ ] **Error Monitoring**: Set up error tracking (Sentry, Datadog, etc.)
- [ ] **Metrics**: Track event processing rates, retry counts, failure rates
- [ ] **Archiving**: Configure automatic archiving of completed events
- [ ] **Scaling**: Plan for horizontal scaling (multiple workers)

### Observability & Monitoring

**Key Metrics to Track:**

1. **Event Processing Rate**: Events/second processed
2. **Retry Rate**: Percentage of events requiring retries
3. **Failure Rate**: Percentage of events failing after max retries
4. **Processing Latency**: Time from event creation to successful delivery
5. **Queue Depth**: Number of pending events in the outbox

#### 1. Error Monitoring (Sentry/Loggers)

The `onError` callback captures unexpected errors and permanent failures.

```typescript
const bus = new OutboxEventBus(outbox, (error: OutboxError) => {
  const event = error.context?.event;
  
  // Send to error tracking (e.g. Sentry)
  if (error instanceof MaxRetriesExceededError) {
    Sentry.captureException(error, {
      tags: { eventType: event?.type, retryCount: error.retryCount },
      extra: error.context
    });
  }
});
```

#### 2. Metrics (Prometheus Example)

Use middleware to track event counts and processing duration.

```typescript
import { Counter, Histogram } from 'prom-client';

const eventCounter = new Counter({
  name: 'outbox_events_total',
  help: 'Total events processed',
  labelNames: ['type', 'phase', 'status']
});

const processingDuration = new Histogram({
  name: 'outbox_event_duration_seconds',
  help: 'Event processing duration',
  labelNames: ['type']
});

bus.addMiddleware(async (ctx, next) => {
  const start = Date.now();
  try {
    await next();
    eventCounter.inc({ type: ctx.event.type, phase: ctx.phase, status: 'success' });
  } catch (err) {
    eventCounter.inc({ type: ctx.event.type, phase: ctx.phase, status: 'error' });
    throw err;
  } finally {
    processingDuration.observe({ type: ctx.event.type }, (Date.now() - start) / 1000);
  }
});
```

#### 3. Tracing (OpenTelemetry Example)

Use middleware to start spans for distributed tracing.

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('outbox-event-bus');

bus.addMiddleware(async (ctx, next) => {
  return tracer.startActiveSpan(`${ctx.phase} ${ctx.event.type}`, async (span) => {
    span.setAttributes({
      'messaging.system': 'outbox',
      'messaging.destination': ctx.event.type,
      'messaging.message_id': ctx.event.id,
      'messaging.phase': ctx.phase
    });

    try {
      await next();
      span.setStatus({ code: 1 }); // OK
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: 2 }); // ERROR
      throw err;
    } finally {
      span.end();
    }
  });
});
```

#### 4. Dead Letter Queue (DLQ)

Query the database for events that failed after all retries.

```typescript
// Get failed events
const failedEvents = await bus.getFailedEvents();
```

Or via SQL:
```sql
SELECT * FROM outbox_events WHERE status = 'failed';
```

### Scaling

**Horizontal Scaling:**

Run multiple instances of your application. Each instance runs its own poller. The outbox adapter handles coordination using:

- **Row-level locking** (Postgres, SQLite): `FOR UPDATE SKIP LOCKED`
- **Optimistic locking** (MongoDB, DynamoDB): Version fields
- **Distributed locks** (Redis): Redlock algorithm

**Vertical Scaling:**

Increase `batchSize` and reduce `pollIntervalMs` for higher throughput:

```typescript
const outbox = new PostgresPrismaOutbox({
  prisma,
  batchSize: 100,        // Process 100 events per poll
  pollIntervalMs: 500    // Poll every 500ms
});
```

### Security

**Best Practices:**

1. **Encrypt Sensitive Payloads**: Use application-level encryption for PII
2. **IAM Permissions**: Grant minimal permissions to publishers (e.g., `sqs:SendMessage` only)
3. **Network Security**: Use VPC endpoints for AWS services
4. **Audit Logging**: Log all event emissions and processing

**Example: Encrypting Payloads**

Essential when forwarding events to external systems (SQS, Kafka) or to protect PII stored in the `outbox_events` table.

```typescript
import { encrypt, decrypt } from './crypto';

// Encryption Middleware (applies to both phases, encryption logic inside handles direction)
bus.addMiddleware(async (ctx, next) => {
  if (ctx.phase === 'emit') {
    ctx.event.payload = encrypt(ctx.event.payload);
  } else {
    ctx.event.payload = decrypt(ctx.event.payload);
  }
  await next();
});

// Usage (Transparent encryption/decryption)
await bus.emit({ type: 'user.created', payload: user });

bus.on('user.created', async (event) => {
  // event.payload is automatically decrypted
  await emailService.send(event.payload.email);
});
```

## License

MIT © [Dunika](https://github.com/dunika)
