# API Reference

## Core Components

### OutboxEventBus

The main orchestrator for event emission and handling. The API is inspired by [the Node.js EventEmitter](https://nodejs.org/api/events.html#class-eventemitter).

#### Constructor

```typescript
// Option 1: Direct error handler
new OutboxEventBus<TTransaction = unknown>(
  outbox: IOutbox<TTransaction>,
  onError: ErrorHandler
)

// Option 2: Config object
new OutboxEventBus<TTransaction = unknown>(
  outbox: IOutbox<TTransaction>,
  config: OutboxBusConfig
)
```

**Parameters:**
- `outbox`: Storage adapter implementing `IOutbox` interface
- `onError`: Error handler function (Option 1)
- `config`: Configuration object (Option 2)

**OutboxBusConfig:**
```typescript
import type { OutboxBusConfig } from 'outbox-event-bus';
```
- `onError`: Required error handler for processing failures.
- `middlewareConcurrency`: Optional. Max concurrent middleware executions during `emitMany` (default: 10).

#### Methods

##### `use()`
Registers middleware to be executed during event emission and consumption.

```typescript
bus.use(...middlewares: Middleware<TTransaction>[]): this
```

##### `start()`
Starts the background worker that polls and processes events.

```typescript
bus.start(): void
```

##### `stop()`
Stops the background worker and cleans up resources.

```typescript
bus.stop(): Promise<void>
```

##### `emit()`
Emits a single event to the outbox.

```typescript
bus.emit(
  event: BusEventInput,
  transaction?: TTransaction
): Promise<void>
```

**Parameters:**
- `event`: Event object with `type` and `payload`
- `transaction`: Optional transaction context

**Example:**
```typescript
await bus.emit({ type: 'user.created', payload: user }, transaction);
```

##### `emitMany()`
Emits multiple events in a single operation.

```typescript
bus.emitMany(
  events: BusEventInput[],
  transaction?: TTransaction
): Promise<void>
```

##### `on()`
Registers a handler for a specific event type.

```typescript
bus.on(
  eventType: string,
  handler: (event: BusEvent) => Promise<void>
): this
```

**Note:** Only one handler per event type (1:1 Command Bus pattern).

##### `off()`
Removes the handler for a specific event type.

```typescript
bus.off(
  eventType: string, 
  handler: (event: BusEvent) => Promise<void>
): this
```

> [!TIP]
> `off()` and `removeListener()` are equivalent methods. Similarly, `on()` and `addListener()` are equivalent. Use whichever naming convention you prefer.

##### `once()`
Registers a one-time handler for a specific event type. The handler will be removed after it is invoked once.

```typescript
bus.once(
  eventType: string,
  handler: (event: BusEvent) => Promise<void>
): this
```

##### `removeAllListeners()`
Removes all registered handlers.

```typescript
bus.removeAllListeners(eventType?: string): this
```

##### `subscribe()`

Subscribes a single handler to multiple event types.

```typescript
bus.subscribe(
  eventTypes: string[],
  handler: (event: BusEvent) => Promise<void>
): this
```

**Parameters:**

- `eventTypes`: Array of event type strings
- `handler`: Function to handle the events

**Example:**

```typescript
bus.subscribe(['user.created', 'user.updated'], async (event) => {
  console.log('User changed:', event.type);
});
```

##### `waitFor()`
Waits for a specific event type to be processed (useful for testing).

```typescript
bus.waitFor(
  eventType: string,
  timeoutMs?: number
): Promise<BusEvent>
```

##### `getFailedEvents()`
Retrieves a list of events that have failed processing.

```typescript
bus.getFailedEvents(): Promise<FailedBusEvent[]>
```

##### `retryEvents()`
Resets the status of failed events to 'created' so they can be retried.

```typescript
bus.retryEvents(eventIds: string[]): Promise<void>
```

### InMemoryOutbox

A lightweight in-memory outbox, primarily useful for testing or non-persistent workflows.

#### Constructor

```typescript
new InMemoryOutbox(config?: InMemoryOutboxConfig)
```

#### Configuration

```typescript
interface InMemoryOutboxConfig {
  maxRetries?: number; // Default: 3
}
```

### IOutbox Interface

Storage adapters must implement this interface.

```typescript
interface IOutbox<TTransaction = unknown> {
  publish(events: BusEvent[], transaction?: TTransaction): Promise<void>;
  start(handler: (event: BusEvent) => Promise<void>, onError: ErrorHandler): void;
  stop(): Promise<void>;
  getFailedEvents(): Promise<FailedBusEvent[]>;
  retryEvents(eventIds: string[]): Promise<void>;
}
```

### IOutboxEventBus Interface

Public interface for the event bus, useful for dependency injection.

```typescript
interface IOutboxEventBus<TTransaction> {
  use(...middlewares: Middleware<TTransaction>[]): this;
  emit<T extends string, P>(
    event: BusEventInput<T, P>,
    transaction?: TTransaction
  ): Promise<void>;
  emitMany<T extends string, P>(
    events: BusEventInput<T, P>[],
    transaction?: TTransaction
  ): Promise<void>;
  on<T extends string, P = unknown>(
    eventType: T,
    handler: (event: BusEvent<T, P>) => Promise<void>
  ): this;
  addListener<T extends string, P = unknown>(
    eventType: T,
    handler: (event: BusEvent<T, P>) => Promise<void>
  ): this;
  off<T extends string, P = unknown>(
    eventType: T,
    handler: (event: BusEvent<T, P>) => Promise<void>
  ): this;
  removeListener<T extends string, P = unknown>(
    eventType: T,
    handler: (event: BusEvent<T, P>) => Promise<void>
  ): this;
  once<T extends string, P = unknown>(
    eventType: T,
    handler: (event: BusEvent<T, P>) => Promise<void>
  ): this;
  removeAllListeners<T extends string>(eventType?: T): this;
  getSubscriptionCount(): number;
  listenerCount(eventType: string): number;
  getListener(eventType: string): AnyListener | undefined;
  eventNames(): string[];
  start(): void;
  stop(): Promise<void>;
  subscribe<T extends string, P = unknown>(
    eventTypes: T[],
    handler: (event: BusEvent<T, P>) => Promise<void>
  ): this;
  waitFor<T extends string, P = unknown>(
    eventType: T,
    timeoutMs?: number
  ): Promise<BusEvent<T, P>>;
  getFailedEvents(): Promise<FailedBusEvent[]>;
  retryEvents(eventIds: string[]): Promise<void>;
}
```

### IPublisher Interface

Interface for external event publishers (e.g., SQS, Kafka).

```typescript
interface IPublisher {
  subscribe(eventTypes: string[]): void;
}
```

## Event Types

### `BusEventInput`
Event structure when emitting (before persistence). Optional `id` and `occurredAt` are auto-generated if not provided.

```typescript
interface BusEventInput<T extends string = string, P = unknown> {
  id?: string;           // Optional, auto-generated if not provided
  type: T;               // Event type (e.g., 'user.created')
  payload: P;            // Event data
  occurredAt?: Date;     // Optional, auto-set to now if not provided
  metadata?: Record<string, unknown>; // Optional metadata
}
```

### `BusEvent`
Event structure after persistence (includes required metadata).

```typescript
interface BusEvent<T extends string = string, P = unknown> {
  id: string;            // Unique event ID (required)
  type: T;               // Event type
  payload: P;            // Event data
  occurredAt: Date;      // When the event occurred (required)
  metadata?: Record<string, unknown>; // Optional metadata
}
```

### `FailedBusEvent`
Represents an event that has failed processing.

```typescript
type FailedBusEvent<T extends string = string, P = unknown> = BusEvent<T, P> & {
  error?: string;
  retryCount: number;
  lastAttemptAt?: Date;
}
```

### `EventStatus`
Possible states for an event in the outbox.

```typescript
const EventStatus = {
  CREATED: 'created',
  ACTIVE: 'active',
  FAILED: 'failed',
  COMPLETED: 'completed',
} as const;
```

## Middleware Types

### `Middleware`
A function that intercepts event processing.

```typescript
type Middleware<TTransaction = unknown> = (
  ctx: MiddlewareContext<TTransaction>,
  next: Next
) => Promise<void>;
```

### `MiddlewareContext`
Context passed to middleware.

```typescript
type MiddlewareContext<TTransaction = unknown> =
  | EmitMiddlewareContext<TTransaction>
  | ConsumeMiddlewareContext<TTransaction>;

type EmitMiddlewareContext<TTransaction = unknown> = {
  phase: 'emit';
  event: BusEvent;
  transaction?: TTransaction | undefined;
}

type ConsumeMiddlewareContext<TTransaction = unknown> = {
  phase: 'consume';
  event: BusEvent;
  transaction?: TTransaction | undefined;
}
```

### `Next`
Function to call the next middleware or the actual handler.

```typescript
type Next = () => Promise<void>;
```

## Adapters

### PostgresPrismaOutbox

Adapter for PostgreSQL using Prisma.

#### Constructor

```typescript
new PostgresPrismaOutbox(config: PostgresPrismaOutboxConfig)
```

#### Configuration

```typescript
interface PostgresPrismaOutboxConfig extends OutboxConfig {
  prisma: PrismaClient;
  getTransaction?: () => PrismaClient | undefined; // Optional context getter
  models?: {
    outbox?: string;   // Default: "outboxEvent"
    archive?: string;  // Default: "outboxEventArchive"
  };
  tableName?: string;  // Default: "outbox_events"
}
```

### DynamoDBAwsSdkOutbox

Adapter for AWS DynamoDB.

#### Constructor

```typescript
new DynamoDBAwsSdkOutbox(config: DynamoDBAwsSdkOutboxConfig)
```

#### Configuration

```typescript
interface DynamoDBAwsSdkOutboxConfig extends OutboxConfig {
  client: DynamoDBClient;
  tableName: string;
  statusIndexName?: string; // Default: "status-gsiSortKey-index"
  processingTimeoutMs?: number; // Time before stuck events are retried (default: 30000ms)
  getCollector?: () => DynamoDBAwsSdkTransactionCollector | undefined;
}
```

### MongoMongodbOutbox

Adapter for MongoDB.

#### Constructor

```typescript
new MongoMongodbOutbox(config: MongoMongodbOutboxConfig)
```

#### Configuration

```typescript
interface MongoMongodbOutboxConfig extends OutboxConfig {
  client: MongoClient;
  dbName: string;
  collectionName?: string; // Default: "outbox_events"
  getSession?: () => ClientSession | undefined;
}
```

### PostgresDrizzleOutbox

Adapter for PostgreSQL using Drizzle ORM.

#### Constructor

```typescript
new PostgresDrizzleOutbox(config: PostgresDrizzleOutboxConfig)
```

#### Configuration

```typescript
interface PostgresDrizzleOutboxConfig extends OutboxConfig {
  db: PostgresJsDatabase<Record<string, unknown>>;
  getTransaction?: () => PostgresJsDatabase<Record<string, unknown>> | undefined;
  tables?: {
    outboxEvents: Table;
    outboxEventsArchive?: Table;
  };
}
```

### RedisIoRedisOutbox

Adapter for Redis (using IOredis).

#### Constructor

```typescript
new RedisIoRedisOutbox(config: RedisIoRedisOutboxConfig)
```

#### Configuration

```typescript
interface RedisIoRedisOutboxConfig extends OutboxConfig {
  redis: Redis;
  keyPrefix?: string; // Default: "outbox"
  processingTimeoutMs?: number; // Default: 30000ms
  getPipeline?: () => ChainableCommander | undefined;
}
```

### SqliteBetterSqlite3Outbox

Adapter for SQLite (using better-sqlite3).

#### Constructor

```typescript
new SqliteBetterSqlite3Outbox(config: SqliteBetterSqlite3OutboxConfig)
```

#### Configuration

```typescript
interface SqliteBetterSqlite3OutboxConfig extends OutboxConfig {
  dbPath?: string;
  db?: Database.Database;
  getTransaction?: () => Database.Database | undefined;
  tableName?: string;        // Default: "outbox_events"
  archiveTableName?: string; // Default: "outbox_events_archive"
}
```

### InMemoryOutbox

Simple in-memory adapter for testing and development. Does not provide persistence across restarts.

#### Constructor

```typescript
new InMemoryOutbox(config?: InMemoryOutboxConfig)
```

#### Configuration

```typescript
interface InMemoryOutboxConfig extends OutboxConfig {
  maxEvents?: number; // Optional limit for memory safety
}
```

## Publishers

### SQSPublisher

Publisher for AWS SQS.

#### Constructor

```typescript
new SQSPublisher(
  bus: IOutboxEventBus<TTransaction>,
  config: SQSPublisherConfig
)
```

#### Configuration

```typescript
interface SQSPublisherConfig extends PublisherConfig {
  sqsClient: SQSClient;
  queueUrl: string;
}
```

### SNSPublisher

Publisher for AWS SNS.

#### Constructor

```typescript
new SNSPublisher(
  bus: IOutboxEventBus<TTransaction>,
  config: SNSPublisherConfig
)
```

#### Configuration

```typescript
interface SNSPublisherConfig extends PublisherConfig {
  snsClient: SNSClient;
  topicArn: string;
}
```

### EventBridgePublisher

Publisher for AWS EventBridge.

#### Constructor

```typescript
new EventBridgePublisher(
  bus: IOutboxEventBus<TTransaction>,
  config: EventBridgePublisherConfig
)
```

#### Configuration

```typescript
interface EventBridgePublisherConfig extends PublisherConfig {
  eventBridgeClient: EventBridgeClient;
  eventBusName?: string;
  source: string;
}
```

### KafkaPublisher

Publisher for Apache Kafka (using kafkajs).

#### Constructor

```typescript
new KafkaPublisher(
  bus: IOutboxEventBus<TTransaction>,
  config: KafkaPublisherConfig
)
```

#### Configuration

```typescript
interface KafkaPublisherConfig extends PublisherConfig {
  producer: Producer;
  topic: string;
}
```

### RabbitMQPublisher

Publisher for RabbitMQ (using amqplib).

#### Constructor

```typescript
new RabbitMQPublisher(
  bus: IOutboxEventBus<TTransaction>,
  config: RabbitMQPublisherConfig
)
```

#### Configuration

```typescript
interface RabbitMQPublisherConfig extends PublisherConfig {
  channel: Channel;
  exchange: string;
  routingKey?: string;
}
```

### RedisStreamsPublisher

Publisher for Redis Streams.

#### Constructor

```typescript
new RedisStreamsPublisher(
  bus: IOutboxEventBus<TTransaction>,
  config: RedisStreamsPublisherConfig
)
```

#### Configuration

```typescript
interface RedisStreamsPublisherConfig extends PublisherConfig {
  redisClient: Redis;
  streamKey: string;
}
```

## Global Configuration

### Base Outbox Configuration

All adapters inherit from `OutboxConfig`.

```typescript
interface OutboxConfig {
  maxRetries?: number;        // Max retry attempts (default: 5)
  baseBackoffMs?: number;     // Initial delay before retry (default: 1000ms)
  pollIntervalMs?: number;    // How often to poll for events (default: 1000ms)
  batchSize?: number;         // Max events per batch (default: 50)
  processingTimeoutMs?: number; // Timeout for processing/locking (default: 30000ms)
  maxErrorBackoffMs?: number; // Max backoff delay (default: 30000ms)
}
```

> [!NOTE]
> All outbox adapters implement an exponential backoff with a **+/- 10% jitter** to prevent thundering herd problems when multiple workers are recovering from failures.

### Publisher Configuration

All publishers inherit from `PublisherConfig`.

```typescript
type PublisherConfig = {
  retryConfig?: RetryOptions;
  processingConfig?: ProcessingOptions;
}

type RetryOptions = {
  maxAttempts?: number;    // Default: 3
  initialDelayMs?: number; // Default: 1000ms
  maxDelayMs?: number;     // Default: 10000ms
}

type ProcessingOptions = {
  bufferSize?: number;        // Max events to buffer before processing (default: 50)
  bufferTimeoutMs?: number;   // Max wait time for buffer to fill (default: 100ms)
  concurrency?: number;      // Max concurrent batch requests (default: 5)
  maxBatchSize?: number;     // Max items per downstream batch (e.g. SQS limit)
}
```

## Error Handling

The library provides a structured error hierarchy to help you distinguish between configuration issues, validation errors, and operational failures. All custom errors inherit from `OutboxError`.

### Error Hierarchy

| Error Class | Category | Description |
| :--- | :--- | :--- |
| `OutboxError` | - | **Base class** for all errors in the library. Includes a `.context` property. |
| `ConfigurationError`| Category | Base class for setup-related issues. |
| `DuplicateListenerError` | Configuration | Thrown by `.on()` if a listener is already registered for an event type. |
| `UnsupportedOperationError` | Configuration | Thrown if an outbox doesn't support management APIs like `getFailedEvents`. |
| `ValidationError` | Category | Base class for validation-related issues. |
| `BatchSizeLimitError` | Validation | Thrown by `.emit()` if the number of events exceeds adapter limits. |
| `OperationalError` | Category | Base class for runtime/processing failures. |
| `TimeoutError` | Operational | Thrown by `.waitFor()` if the event does not occur within the timeout period. |
| `BackpressureError` | Operational | Thrown by publishers if the underlying storage/channel is full. |
| `MaintenanceError` | Operational | Reported to `onError` if a background maintenance task fails. |
| `MaxRetriesExceededError` | Operational | Reported to `onError` when an event exhausts its configured retry attempts. |
| `HandlerError` | Operational | Reported to `onError` when an event handler throws an error (before max retries). |

### The `onError` Callback

The `onError` callback is the primary place to handle background processing failures. It receives the error instance with event information bundled in `error.context.event` for event-related errors.

#### Example: Specific Error Handling

```typescript
import { OutboxEventBus, MaxRetriesExceededError, MaintenanceError } from 'outbox-event-bus';

const bus = new OutboxEventBus(outbox, (error: OutboxError) => {
  // error is always an OutboxError instance  
  if (error instanceof MaxRetriesExceededError) {
    // Access strongly typed event and cause
    console.error(`Event ${error.event.id} permanently failed after ${error.retryCount} attempts`);
    console.error('Original cause:', error.cause);
  } else if (error instanceof MaintenanceError) {
    // Background tasks like stuck event recovery failed.
    console.error(`Maintenance failed: ${error.message}`);
  } else {
    // Generic operational or handler error.
    console.error('Background processing error:', error);
  }
});
```

### Contextual Data

Every `OutboxError` contains a `context` property with additional debugging information:

```typescript
try {
  bus.on('my-event', handler);
  bus.on('my-event', handler); // Throws DuplicateListenerError
} catch (error) {
  if (error instanceof DuplicateListenerError) {
    console.log(error.context.eventType); // "my-event"
  }
}
```

## Advanced API

> [!TIP]
> These APIs are for advanced use cases. Most users won't need them.

#### `PollingService`
Low-level polling service used internally by outbox adapters. Useful if you're implementing a custom adapter.

```typescript
class PollingService {
  constructor(config: PollingServiceConfig);
  start(): void;
  stop(): Promise<void>;
}

interface PollingServiceConfig {
  pollIntervalMs: number;              // How often to poll
  baseBackoffMs: number;               // Base backoff on error
  maxErrorBackoffMs?: number;          // Max backoff on error
  processBatch: (handler) => Promise<void>; // Batch processor
  performMaintenance?: () => Promise<void>; // Optional maintenance
}
```

#### `EventPublisher`
Generic event publisher with batching and retry logic. Used internally by all publisher implementations.

```typescript
class EventPublisher<TTransaction = unknown> {
  constructor(
    bus: IOutboxEventBus<TTransaction>,
    config?: PublisherConfig
  );
  
  subscribe(
    eventTypes: string[], 
    handler: (events: BusEvent[]) => Promise<void>
  ): void;
}
```
