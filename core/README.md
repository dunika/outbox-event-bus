# @outbox-event-bus/core

Core logic for the `outbox-event-bus` library. This package contains the `OutboxEventBus` class and the interfaces for implementing storage adapters.

For full documentation, please visit the [root repository](https://github.com/dunika/outbox-event-bus).

## Installation

```bash
npm install @outbox-event-bus/core
```

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
