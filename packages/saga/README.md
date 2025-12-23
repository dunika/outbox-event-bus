# @outbox-event-bus/saga

A lightweight, stateless distributed transaction library for Node.js using the **Routing Slip** pattern.

## Features

- **Stateless**: Saga state (itinerary, log, variables) is carried entirely in the message payload.
- **Atomic Transitions**: Integrates with `@outbox-event-bus/core` to ensure local DB changes and next-step emissions are atomic.
- **Automatic Compensation**: LIFO (Last-In, First-Out) compensation on failure.
- **Passive Timeouts**: Automatic expiration and compensation for stuck workflows.
- **Activity Retries**: Configurable retry policies for individual activities.
- **Transparent Compression**: Automatic `zlib` compression for large routing slips.
- **Claim Check Pattern**: Fallback storage for extremely large payloads.
- **Structured Logging**: JSON-based observability for all state transitions.

## Installation

```bash
npm install @outbox-event-bus/saga
```

## Quick Start

### 1. Define Activities

```typescript
import { Activity } from "@outbox-event-bus/saga";

const reserveInventory: Activity = {
  name: "reserve-inventory",
  execute: async (args, variables) => {
    // Perform business logic
    return { reservationId: "123" }; // Data for compensation
  },
  compensate: async (logEntry, variables) => {
    const { reservationId } = logEntry.compensationData;
    // Undo business logic
  }
};
```

### 2. Setup Saga Engine

```typescript
import { SagaEngine, ActivityRegistry } from "@outbox-event-bus/saga";
import { OutboxEventBus } from "@outbox-event-bus/core";

const registry = new ActivityRegistry();
registry.register(reserveInventory);

const engine = new SagaEngine({
  bus: outboxBus,
  registry
});

// Add as middleware to your bus
outboxBus.addHandlerMiddleware(engine.middleware());
```

### 3. Create and Execute a Routing Slip

```typescript
import { RoutingSlipBuilder } from "@outbox-event-bus/saga";

const slip = new RoutingSlipBuilder()
  .addActivity("reserve-inventory", { sku: "ABC", qty: 1 })
  .addActivity("process-payment", { amount: 100 })
  .withTimeout(60000) // 1 minute
  .build();

await engine.execute(slip);
```

## Documentation

- [API Reference](./docs/API_REFERENCE.md)
- [Design Specification](../../specs/001-saga-routing-slip/spec.md)

## License

MIT
