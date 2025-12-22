# outbox-event-bus

Core logic for the `outbox-event-bus` library. This package contains the `OutboxEventBus` class and the interfaces for implementing storage adapters.

For full documentation, please visit the [root repository](https://github.com/dunika/outbox-event-bus).

## Installation

```bash
npm install outbox-event-bus
```

## Architecture

The library consists of three main components:

1.  **[OutboxEventBus](https://github.com/dunika/outbox-event-bus/blob/main/docs/API_REFERENCE.md#outboxeventbus)**: The main entry point. It manages event listeners and delegates storage to the `IOutbox` adapter.
2.  **[IOutbox](https://github.com/dunika/outbox-event-bus/blob/main/docs/API_REFERENCE.md#ioutbox-interface) (Adapter)**: Responsible for persisting events to the database and polling for new events.
3.  **[IPublisher](https://github.com/dunika/outbox-event-bus/blob/main/docs/API_REFERENCE.md#publishers)**: Optional component that subscribes to the bus and forwards events to external systems (SQS, Kafka, etc.).

## Project Structure

The core package is organized into the following directories:

```
core/src/
├── bus/              # OutboxEventBus implementation
├── errors/           # Error classes and utilities
├── outboxes/         # Built-in outbox implementations
├── services/         # PollingService and EventPublisher
├── types/            # TypeScript interfaces and types
└── utils/            # Utility functions
```

## Usage

```typescript
import { OutboxEventBus, InMemoryOutbox } from "outbox-event-bus";

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
  IOutbox,
  BusEvent,
  FailedBusEvent,
  ErrorHandler 
} from "outbox-event-bus";

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
  IPublisher,
  IOutboxEventBus
} from "outbox-event-bus";

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
