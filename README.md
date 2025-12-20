# Outbox Event Bus

A TypeScript event bus implementation using the [Transactional Outbox Pattern](https://microservices.io/patterns/data/transactional-outbox.html) to ensure reliable, at-least-once event delivery across distributed systems.

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { OutboxEventBus } from 'outbox-event-bus';
import { PostgresDrizzleOutbox } from '@outbox-event-bus/postgres-drizzle-outbox';
import { SQSPublisher } from '@outbox-event-bus/sqs-publisher';
import { SQSClient } from '@aws-sdk/client-sqs';

// Setup outbox with PostgreSQL
const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);
const outbox = new PostgresDrizzleOutbox({
  db,
  onError: (error) => console.error('Outbox error:', error)
});

// Create event bus
const bus = new OutboxEventBus(
  outbox,
  (bus, eventType, count) => console.warn(`Max listeners: ${eventType}`),
  (error) => console.error('Bus error:', error)
);

// Setup SQS publisher
const publisher = new SQSPublisher(bus, {
  sqsClient: new SQSClient({}),
  queueUrl: process.env.QUEUE_URL!
});
publisher.subscribe(['user.created', 'order.placed']);

// Subscribe to events locally
bus.on('user.created', async (event) => {
  console.log('User created:', event.payload);
});

// Emit events
await bus.emit({ 
  id: crypto.randomUUID(), 
  type: 'user.created', 
  payload: { userId: '123' }, 
  occurredAt: new Date() 
});

// Start processing
bus.start();
```

This library provides a reliable event bus that persists events to an outbox table before processing them, ensuring events are never lost even if your application crashes. It's designed to work seamlessly with various storage backends and message brokers.

- [Why This Exists](#why-this-exists)
- [Core Concepts](#core-concepts)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Adapters](#adapters)
- [Publishers](#publishers)
- [API Reference](#api-reference)
- [Architecture](#architecture)
- [License](#license)

## Why This Exists

In distributed systems, ensuring reliable event delivery is challenging. Traditional event emitters can lose events if the application crashes before processing completes. The Transactional Outbox Pattern solves this by:

1. **Persisting events atomically** with your business logic
2. **Processing events asynchronously** from the outbox table
3. **Guaranteeing at-least-once delivery** through retries and recovery

This library provides a production-ready implementation with:

- **Node.js EventEmitter-compatible API** for familiar usage patterns
- **Multiple storage adapters** (DynamoDB, MongoDB, PostgreSQL, Redis, SQLite)
- **Multiple publisher integrations** (EventBridge, Kafka, RabbitMQ, SQS, SNS, Redis Streams)
- **Automatic retry logic** with exponential backoff
- **Stuck event recovery** to handle processing failures
- **Type-safe event handling** with full TypeScript support

## Core Concepts

### Outbox

An **outbox** is a storage adapter that persists events and manages their lifecycle. It implements three core operations:

- `publish(events)` - Persist events to storage
- `start(handler)` - Begin polling for pending events
- `stop()` - Stop polling

### Event Bus

The **event bus** provides an EventEmitter-like API for emitting and subscribing to events. It coordinates between the outbox and event handlers.

### Publisher

A **publisher** subscribes to specific event types and forwards them to external systems (message brokers, event buses, etc.).

## Installation

Install the core library:

```bash
npm install outbox-event-bus
```

Install your chosen adapter(s):

```bash
# DynamoDB
npm install @outbox-event-bus/dynamodb-outbox

# MongoDB
npm install @outbox-event-bus/mongo-outbox

# PostgreSQL with Drizzle
npm install @outbox-event-bus/postgres-drizzle-outbox

# PostgreSQL with Prisma
npm install @outbox-event-bus/postgres-prisma-outbox

# Redis
npm install @outbox-event-bus/redis-outbox

# SQLite
npm install @outbox-event-bus/sqlite-outbox
```

Install your chosen publisher(s):

```bash
# AWS EventBridge
npm install @outbox-event-bus/eventbridge-publisher

# Kafka
npm install @outbox-event-bus/kafka-publisher

# RabbitMQ
npm install @outbox-event-bus/rabbitmq-publisher

# AWS SQS
npm install @outbox-event-bus/sqs-publisher

# AWS SNS
npm install @outbox-event-bus/sns-publisher

# Redis Streams
npm install @outbox-event-bus/redis-streams-publisher
```

## Quick Start

### 1. Create an Outbox

Choose a storage adapter and configure it:

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBOutbox } from '@outbox-event-bus/dynamodb-outbox';

const outbox = new DynamoDBOutbox({
  client: new DynamoDBClient({}),
  tableName: 'events-outbox',
  statusIndexName: 'status-gsiSortKey-index',
  onError: (error) => console.error('Outbox error:', error)
});
```

### 2. Create the Event Bus

```typescript
import { OutboxEventBus } from 'outbox-event-bus';

const bus = new OutboxEventBus(
  outbox,
  (bus, eventType, count) => {
    console.warn(`Max listeners (${count}) exceeded for event: ${eventType}`);
  },
  (error) => console.error('Bus error:', error)
);
```

### 3. Subscribe to Events

```typescript
bus.on('user.created', async (event) => {
  console.log('User created:', event.payload);
});

bus.on('order.placed', async (event) => {
  console.log('Order placed:', event.payload);
});
```

### 4. Emit Events

```typescript
// occurredAt is automatically added if not provided
await bus.emit({
  id: crypto.randomUUID(),
  type: 'user.created',
  payload: { userId: '123', email: 'user@example.com' }
});

// You can also provide a custom occurredAt if needed
await bus.emit({
  id: crypto.randomUUID(),
  type: 'user.created',
  payload: { userId: '123', email: 'user@example.com' },
  occurredAt: new Date('2023-01-01')
});
```

### 5. Start Processing

```typescript
bus.start();

// When shutting down
await bus.stop();
```

### 6. (Optional) Add Publishers

Forward events to external systems:

```typescript
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { EventBridgePublisher } from '@outbox-event-bus/eventbridge-publisher';

const publisher = new EventBridgePublisher(bus, {
  eventBridgeClient: new EventBridgeClient({}),
  source: 'my-app',
  onError: (error) => console.error('Publisher error:', error)
});

publisher.subscribe(['user.created', 'order.placed']);
```

## Adapters

Adapters provide storage backends for the outbox pattern. Each adapter implements the `IOutbox` interface.

| Adapter | Package | Description |
|---------|---------|-------------|
| **DynamoDB** | [`@outbox-event-bus/dynamodb-outbox`](./adapters/dynamodb/README.md) | AWS DynamoDB with GSI for status queries |
| **MongoDB** | [`@outbox-event-bus/mongo-outbox`](./adapters/mongo/README.md) | MongoDB with change streams support |
| **PostgreSQL (Drizzle)** | [`@outbox-event-bus/postgres-drizzle-outbox`](./adapters/postgres-drizzle/README.md) | PostgreSQL using Drizzle ORM |
| **PostgreSQL (Prisma)** | [`@outbox-event-bus/postgres-prisma-outbox`](./adapters/postgres-prisma/README.md) | PostgreSQL using Prisma ORM |
| **Redis** | [`@outbox-event-bus/redis-outbox`](./adapters/redis/README.md) | Redis with sorted sets for scheduling |
| **SQLite** | [`@outbox-event-bus/sqlite-outbox`](./adapters/sqlite/README.md) | SQLite for local development |

Click on any adapter name to view detailed documentation.

## Publishers

Publishers forward events from the bus to external messaging systems. Each publisher implements the `IPublisher` interface.

| Publisher | Package | Description |
|-----------|---------|-------------|
| **EventBridge** | [`@outbox-event-bus/eventbridge-publisher`](./publishers/eventbridge/README.md) | AWS EventBridge event bus |
| **Kafka** | [`@outbox-event-bus/kafka-publisher`](./publishers/kafka/README.md) | Apache Kafka topics |
| **RabbitMQ** | [`@outbox-event-bus/rabbitmq-publisher`](./publishers/rabbitmq/README.md) | RabbitMQ exchanges |
| **SQS** | [`@outbox-event-bus/sqs-publisher`](./publishers/sqs/README.md) | AWS SQS queues |
| **SNS** | [`@outbox-event-bus/sns-publisher`](./publishers/sns/README.md) | AWS SNS topics |
| **Redis Streams** | [`@outbox-event-bus/redis-streams-publisher`](./publishers/redis-streams/README.md) | Redis Streams |

Click on any publisher name to view detailed documentation.

## API Reference

### OutboxEventBus

The main event bus class that coordinates event emission and subscription.

#### Constructor

```typescript
new OutboxEventBus(
  outbox: IOutbox,
  onMaxListeners: (bus: OutboxEventBus, eventType: string, count: number) => void,
  onError: (error: unknown) => void
)
```

#### Methods

##### Event Emission

```typescript
// Emit a single event
await bus.emit<T extends string, P>(event: BusEvent<T, P>): Promise<void>

// Emit multiple events
await bus.emitMany<T extends string, P>(events: BusEvent<T, P>[]): Promise<void>
```

##### Event Subscription

```typescript
// Subscribe to an event type
bus.on<T extends string, P>(eventType: T, handler: EventHandler<T, P>): this

// Subscribe to multiple event types
bus.subscribe<T extends string, P>(eventTypes: T[], handler: EventHandler<T, P>): this

// Subscribe once (auto-unsubscribe after first event)
bus.once<T extends string, P>(eventType: T, handler: EventHandler<T, P>): this

// Prepend listener (execute before existing listeners)
bus.prependListener<T extends string, P>(eventType: T, handler: EventHandler<T, P>): this
bus.prependOnceListener<T extends string, P>(eventType: T, handler: EventHandler<T, P>): this
```

##### Event Unsubscription

```typescript
// Remove a specific handler
bus.off<T extends string, P>(eventType: T | T[], handler: EventHandler<T, P>): this
bus.removeListener<T extends string, P>(eventType: T | T[], handler: EventHandler<T, P>): this

// Remove all handlers for an event type
bus.removeAllListeners<T extends string>(eventType?: T): this
```

##### Lifecycle

```typescript
// Start processing events from the outbox
bus.start(): void

// Stop processing events
await bus.stop(): Promise<void>
```

##### Utilities

```typescript
// Wait for a specific event (with timeout)
await bus.waitFor<T extends string, P>(eventType: T, timeoutMs?: number): Promise<BusEvent<T, P>>

// Get listener count for an event type
bus.listenerCount(eventType: string): number

// Get all event types with listeners
bus.eventNames(): string[]

// Get total subscription count
bus.getSubscriptionCount(): number

// Set max listeners per event type
bus.setMaxListeners(n: number): this

// Get raw listeners for an event type
bus.rawListeners(eventType: string): AnyListener[]
```

### BusEvent

Event structure:

```typescript
interface BusEvent<T extends string = string, P = unknown> {
  id: string;           // Unique event ID
  type: T;              // Event type (e.g., 'user.created')
  payload: P;           // Event payload
  occurredAt?: Date;    // When the event occurred (automatically added if not provided)
  metadata?: Record<string, unknown>; // Optional metadata
}
```

### EventHandler

Event handler function signature:

```typescript
type EventHandler<T extends string, P> = (event: BusEvent<T, P>) => Promise<void>
```

## Architecture

### Event Flow

```
┌─────────────────┐
│  Application    │
│  Logic          │
└────────┬────────┘
         │ emit()
         ▼
┌─────────────────┐
│  OutboxEventBus │
└────────┬────────┘
         │ publish()
         ▼
┌─────────────────┐
│  Outbox Adapter │◄──┐
│  (Storage)      │   │
└────────┬────────┘   │
         │            │ poll()
         │ start()    │
         ▼            │
┌─────────────────┐   │
│  Event Handler  │───┘
│  (Subscribers)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Publishers     │
│  (External)     │
└─────────────────┘
```

### Key Features

**Reliability**
- Events are persisted before processing
- Automatic retry with exponential backoff
- Stuck event recovery for long-running failures
- At-least-once delivery guarantee

**Scalability**
- Horizontal scaling through competing consumers
- Batch processing for efficiency
- Configurable polling intervals and batch sizes

**Flexibility**
- Pluggable storage adapters
- Pluggable publishers
- EventEmitter-compatible API
- Full TypeScript support

## License

MIT
