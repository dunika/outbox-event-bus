# API Reference: @outbox-event-bus/saga

## `SagaEngine`

The core engine responsible for executing routing slips and managing transitions.

### `constructor(config: SagaEngineConfig)`

- `bus`: `OutboxEventBus<unknown>` - The event bus instance.
- `registry`: `ActivityRegistry` - Registry containing available activities.
- `compressionThreshold?`: `number` - Payload size (bytes) to trigger compression (default: 10KB).
- `claimCheckStore?`: `SagaStoreAdapter` - Optional store for large payloads.
- `claimCheckThreshold?`: `number` - Payload size (bytes) to trigger claim check (default: 200KB).

### `execute(slip: RoutingSlip): Promise<void>`

Starts or continues the execution of a routing slip.

### `middleware(): HandlerMiddleware`

Returns a middleware for `OutboxEventBus` that automatically intercepts and processes routing slips.

---

## `RoutingSlipBuilder`

Fluent API for creating routing slips.

### `addActivity(name: string, args: any, retryPolicy?: RetryPolicy)`

Adds an activity to the itinerary.

### `withVariables(vars: Record<string, any>)`

Sets initial variables for the saga.

### `withTimeout(ms: number)`

Sets an expiration time relative to now.

### `build(): RoutingSlip`

Generates the final `RoutingSlip` object.

---

## `ActivityRegistry`

Registry for mapping activity names to implementations.

### `register(activity: Activity)`

Registers an activity implementation.

---

## Interfaces

### `Activity`

```typescript
interface Activity {
  name: string;
  execute: (args: any, variables: any) => Promise<any>;
  compensate: (logEntry: ActivityLogEntry, variables: any) => Promise<void>;
}
```

### `RetryPolicy`

```typescript
interface RetryPolicy {
  maxRetries: number;
  backoff?: "fixed" | "exponential";
  intervalMs?: number;
}
```

### `SagaStoreAdapter`

```typescript
interface SagaStoreAdapter {
  initialize?(): Promise<void>;
  get(id: string): Promise<Buffer | undefined>;
  put(id: string, data: Buffer, expiresAt: Date): Promise<void>;
  delete(id: string): Promise<void>;
}
```
