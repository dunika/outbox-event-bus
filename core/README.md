# @outbox-event-bus/core

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/core?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/core?style=flat-square&color=2563eb)

> **The Core Logic for Outbox Event Bus**

This package contains the core interfaces, types, and the main `OutboxEventBus` class. It is the foundation upon which all adapters and publishers are built.

Most users will install `outbox-event-bus` (which re-exports everything from here), but you can use this package directly if you are building custom adapters or publishers.

- [Installation](#installation)
- [Core Components](#core-components)
  - [OutboxEventBus](#outboxeventbus)
  - [PollingOutbox](#pollingoutbox)
- [Interfaces](#interfaces)
  - [IOutbox](#ioutbox)
  - [IPublisher](#ipublisher)
  - [BusEvent](#busevent)
- [Creating Custom Adapters](#creating-custom-adapters)
- [Creating Custom Publishers](#creating-custom-publishers)
- [Best Practices](#best-practices)

## Installation

```bash
npm install @outbox-event-bus/core
```

## Core Components

### OutboxEventBus

The `OutboxEventBus` is the main orchestrator. It combines an `IOutbox` (storage) with a robust event emitter interface.

**Key Features:**
- **At-Least-Once Delivery**: Ensures events are processed even if the application crashes.
- **Batch Processing**: Emits events in batches for efficiency.
- **Max Listeners Management**: Warns if too many listeners are attached to a single event type to prevent memory leaks.
- **Error Propagation**: Centralized `onError` handler for all event processing errors.

```typescript
import { OutboxEventBus, InMemoryOutbox } from '@outbox-event-bus/core';

// 1. Initialize Storage (using in-memory for testing)
const outbox = new InMemoryOutbox();

// 2. Create Bus
const bus = new OutboxEventBus(
  outbox,
  (bus, type, count) => console.warn(`Max listeners for ${type}: ${count}`),
  (err) => console.error('Bus error:', err)
);

// 3. Subscribe
bus.on('user.created', async (event) => {
  console.log('User created:', event.payload);
});

// 4. Emit (persists to outbox)
await bus.emit({
  type: 'user.created',
  payload: { id: 1, name: 'Alice' }
});

// 5. Start Processing
bus.start();
```

### PollingOutbox

`PollingOutbox` is an abstract base class that simplifies creating database adapters. It handles the polling loop, error backoff, and state management, so you only need to implement the storage logic.

**Features:**
- **Automatic Polling**: Manages the `setInterval` loop for you.
- **Exponential Backoff**: Automatically slows down polling if errors occur (e.g., DB down).
- **Concurrency Control**: Prevents overlapping poll cycles.

## Interfaces

### IOutbox

The contract for storage adapters.

```typescript
interface IOutbox {
  // Persist events to storage
  publish(events: BusEvent[]): Promise<void>;

  // Start polling for pending events
  start(handler: (events: BusEvent[]) => Promise<void>): void;

  // Stop polling
  stop(): Promise<void>;
}
```

### IPublisher

The contract for external message brokers.

```typescript
interface IPublisher {
  // Subscribe to bus events and forward them
  subscribe(eventTypes: string[]): void;
}
```

### BusEvent

The standard event structure.

```typescript
interface BusEvent<T extends string = string, P = unknown> {
  id: string;           // Unique UUID
  type: T;              // Event type (e.g. 'order.created')
  payload: P;           // Your custom data
  occurredAt?: Date;    // Timestamp (auto-generated if missing)
  metadata?: Record<string, unknown>; // Optional metadata
}
```

## Creating Custom Adapters

To create a custom adapter (e.g., for Firestore, MySQL, or a proprietary store), extends `PollingOutbox`.

```typescript
import { PollingOutbox, BusEvent } from '@outbox-event-bus/core';

export class MyCustomOutbox extends PollingOutbox {
  constructor(options: MyOptions) {
    super(options);
  }

  // 1. Persist events
  async publish(events: BusEvent[]): Promise<void> {
    await myDb.insert('outbox_table', events.map(e => ({
      ...e,
      status: 'pending'
    })));
  }

  // 2. Fetch and lock a batch of events
  protected async processBatch(handler: (events: BusEvent[]) => Promise<void>): Promise<void> {
    // A. Lock events (UPDATE ... RETURNING or equivalent)
    const events = await myDb.lockStart('outbox_table', { limit: 50 });
    
    if (events.length === 0) return;

    try {
      // B. Process events
      await handler(events);

      // C. Delete or mark completed
      await myDb.delete('outbox_table', events.map(e => e.id));
    } catch (error) {
       // D. Handle failure (unlock or retry count increment)
       this.onError(error);
    }
  }

  // 3. (Optional) Recover stuck events
  protected async performMaintenance(): Promise<void> {
    await myDb.update('outbox_table')
      .set({ status: 'pending' })
      .where('status', 'processing')
      .andWhere('locked_at', '<', Date.now() - 30000); // 30s timeout
  }
}
```

## Creating Custom Publishers

To create a custom publisher (e.g., for Discord, Slack, or a legacy system):

```typescript
import { IPublisher, OutboxEventBus, BusEvent } from '@outbox-event-bus/core';

export class DiscordPublisher implements IPublisher {
  constructor(
    private bus: OutboxEventBus, 
    private webhookUrl: string
  ) {}

  subscribe(eventTypes: string[]): void {
    // Listen to specific events on the bus
    eventTypes.forEach(type => {
      this.bus.on(type, this.handleEvent.bind(this));
    });
  }

  private async handleEvent(event: BusEvent): Promise<void> {
    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `Event: ${event.type}\nID: ${event.id}` })
      });
    } catch (error) {
      console.error('Failed to send to Discord', error);
      // Decide if you want to re-throw (to retry the event) or swallow the error
    }
  }
}
```

## Best Practices

1.  **Keep Payloads Small**: Large payloads increase DB load and latency. Store large data in object storage (S3) and pass the reference in the payload.
2.  **Idempotence is Key**: Consumers MUST be idempotent. Events *will* be delivered at least once, which means they might be delivered twice.
3.  **Transactions**: Always insert the outbox event in the same database transaction as your business data change. This is the core guarantee of the pattern.
4.  **Monitoring**: Monitor the size of your outbox table. A growing table effectively means a growing lag in event processing.

## License

MIT
