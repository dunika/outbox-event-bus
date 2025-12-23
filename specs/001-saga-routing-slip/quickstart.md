# Quickstart: Saga Routing Slip

## 1. Define Activities

Implement the `Activity` interface for each step of your saga.

```typescript
import { Activity, ActivityContext, ExecutionResult } from '@outbox-event-bus/saga';

export class ReserveInventoryActivity implements Activity {
  async execute(context: ActivityContext<{ sku: string; quantity: number }>): Promise<ExecutionResult> {
    const { sku, quantity } = context.arguments;
    const reservationId = await inventoryService.reserve(sku, quantity);
    
    return {
      compensationData: { reservationId },
      variables: { lastReservationId: reservationId }
    };
  }

  async compensate(log: { reservationId: string }): Promise<void> {
    await inventoryService.cancel(log.reservationId);
  }
}
```

## 2. Build and Execute a Routing Slip

Use the `RoutingSlipBuilder` to define the workflow and start it.

```typescript
import { RoutingSlipBuilder } from '@outbox-event-bus/saga';

const builder = new RoutingSlipBuilder();

const slip = builder
  .addActivity('ReserveInventory', { sku: 'ABC-123', quantity: 1 })
  .addActivity('ProcessPayment', { amount: 100 })
  .addActivity('ShipOrder', { carrier: 'FedEx' })
  .withTimeout(Duration.fromMinutes(30))
  .build();

// Emit the slip via the outbox event bus
await bus.emit({
  type: 'saga.started',
  payload: slip
}, transaction);
```

## 3. Initialize the Saga Engine

Register your activities and add the engine as a middleware to your bus.

```typescript
import { SagaEngine } from '@outbox-event-bus/saga';

const engine = new SagaEngine();

engine.registerActivity('ReserveInventory', new ReserveInventoryActivity());
engine.registerActivity('ProcessPayment', new ProcessPaymentActivity());
engine.registerActivity('ShipOrder', new ShipOrderActivity());

// Register as handler middleware
bus.addHandlerMiddleware(engine.middleware());
```
