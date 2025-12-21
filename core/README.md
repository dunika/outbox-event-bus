# @outbox-event-bus/core

Core logic for the `outbox-event-bus` library. This package contains the `OutboxEventBus` class and the interfaces for implementing storage adapters.

For full documentation, please visit the [root repository](https://github.com/dunika/outbox-event-bus).

## Installation

```bash
npm install @outbox-event-bus/core
```

## Architecture

The library consists of three main components:

1.  **[OutboxEventBus](../docs/API_REFERENCE.md#outboxeventbus)**: The main entry point. It manages event listeners and delegates storage to the `IOutbox` adapter.
2.  **[IOutbox](../docs/API_REFERENCE.md#ioutbox-interface) (Adapter)**: Responsible for persisting events to the database and polling for new events.
3.  **[IPublisher](../docs/API_REFERENCE.md#publishers)**: Optional component that subscribes to the bus and forwards events to external systems (SQS, Kafka, etc.).

## Project Structure

The core package is organized into the following directories:

```
core/src/
├── bus/              # OutboxEventBus implementation
├── errors/           # Error classes and utilities
├── outboxes/         # Built-in outbox implementations (InMemoryOutbox)
├── services/         # PollingService and EventPublisher
├── types/            # TypeScript interfaces and types
└── utils/            # Utility functions (time, etc.)
```

**Key Files:**
- `bus/outbox-event-bus.ts` - Main event bus implementation
- `types/interfaces.ts` - Core interfaces (`IOutbox`, `IOutboxEventBus`, `IPublisher`)
- `types/types.ts` - Type definitions (`BusEvent`, `BusEventInput`, `FailedBusEvent`)
- `errors/errors.ts` - Error class hierarchy
- `services/polling-service.ts` - Background polling service
- `services/event-publisher.ts` - Base publisher implementation

## Usage

```typescript
import { OutboxEventBus, InMemoryOutbox } from "@outbox-event-bus/core";

// 1. Initialize Storage
const outbox = new InMemoryOutbox();

// 2. Create Bus
const bus = new OutboxEventBus(outbox, (err) => console.error(err));

// 3. Start
bus.start();
```

## Extending the Library

### Implementing a Custom Storage Adapter

To support a new database, implement the `IOutbox` interface.

```typescript
import { 
  IOutbox,           // See: ../docs/API_REFERENCE.md#ioutbox-interface
  BusEvent,          // See: ../docs/API_REFERENCE.md#busevent
  FailedBusEvent,    // See: ../docs/API_REFERENCE.md#failedbusevent
  ErrorHandler 
} from "@outbox-event-bus/core";

export class MyCustomOutbox implements IOutbox<MyTransactionType> {
  
  // 1. Persist events (Transactional)
  async publish(events: BusEvent[], transaction?: MyTransactionType): Promise<void> {
    // Insert events into your 'outbox_events' table
    // Ensure this happens within the provided transaction
  }

  // 2. Start Polling
  start(handler: (event: BusEvent) => Promise<void>, onError: ErrorHandler): void {
    // Start a loop that:
    // a. Polls for 'created' events
    // b. Locks them (status='active')
    // c. Calls handler(event)
    // d. Updates status to 'completed' or 'failed'
  }

  // 3. Stop Polling
  async stop(): Promise<void> {
    // Clean up timers/connections
  }

  // 4. Management
  async getFailedEvents(): Promise<FailedBusEvent[]> {
    // Return events with status='failed'
  }

  async retryEvents(eventIds: string[]): Promise<void> {
    // Reset status to 'created' for these IDs
  }
}
```

### Implementing a Custom Publisher

To forward events to a new external system, implement `IPublisher`.

```typescript
import { 
  IPublisher,        // See: ../docs/API_REFERENCE.md#publishers
  IOutboxEventBus    // See: ../docs/API_REFERENCE.md#ioutboxeventbus-interface
} from "@outbox-event-bus/core";

export class MyCustomPublisher implements IPublisher {
  constructor(private bus: IOutboxEventBus<any>) {}

  subscribe(eventTypes: string[]): void {
    // Subscribe to the bus for these events
    this.bus.subscribe(eventTypes, async (event) => {
      // Forward to external system
      await this.sendToExternalSystem(event);
    });
  }

  private async sendToExternalSystem(event: any) {
    // ... implementation
  }
}
```
