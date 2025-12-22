# Saga Orchestration Pattern (Reference Implementation)

> **Note**: This document illustrates the "Mega-Mart" use case and a **Manual** implementation using standard event handlers.
> Use this as a reference for complexity. For the **Simplified** implementation using the proposed Saga Library (Routing Slips), please see `docs/proposals/saga-library-design.md`.

# Saga Orchestration Pattern

This guide demonstrates how to implement a **Complex Saga Pattern** using `outbox-event-bus`.

We will build a "Mega-Mart" order fulfillment system that handles distributed transactions across 5 distinct domains: **Order**, **Inventory**, **Fraud**, **Payment**, and **Shipping**.

We will also implement **Timeouts** using the "Reaper Pattern" to ensure orders don't hang indefinitely.

## The Scenario

We need to process an order through multiple steps. If any step fails **or takes too long**, we must "undo" (compensate) previous successful steps.

**The Workflow:**
1.  **Order Placed** → Reserve Inventory
2.  **Inventory Reserved** → Check Fraud
3.  **Fraud Passed** → Charge Payment
4.  **Payment Captured** → Create Shipment
5.  **Shipment Created** → **Order Completed**

**Compensations (The "Undo" Stack):**
-   If **Fraud Fails**: Release Inventory -> Cancel Order
-   If **Payment Fails**: Release Inventory -> Cancel Order
-   If **Shipping Fails**: Refund Payment -> Release Inventory -> Cancel Order
-   **If ANY step Times Out**: Trigger the exact same compensation logic.

---

## 1. The Strategy: Decentralized Orchestration

Instead of a monolithic "Saga Manager" that knows everything, we rely on a **chain of event handlers**.

-   Each handler listens for a specific "Fact" (e.g., `InventoryReserved`).
-   It performs a local DB transaction to update the **Saga State**.
-   It emits a "Command" for the next step (e.g., `CheckFraud`).
-   If it sees a "Failure Fact" or "Timeout," it triggers the compensation logic.

---

## 2. The Events

We distinguish between **Commands** (intent), **Facts** (outcome), and **Timeouts**.

```typescript
import { OutboxEvent } from 'outbox-event-bus';

// --- Base Types ---
type OrderId = { orderId: string };
type FailureReason = { reason: string };

// --- 1. Order Domain ---
export interface OrderPlaced extends OutboxEvent {
  type: 'order.placed';
  payload: OrderId & { customerId: string; total: number; items: any[] };
}
export interface OrderCompleted extends OutboxEvent {
  type: 'order.completed';
  payload: OrderId;
}
export interface OrderCancelled extends OutboxEvent {
  type: 'order.cancelled';
  payload: OrderId & FailureReason & { lastStep: string };
}
export interface OrderTimedOut extends OutboxEvent { // Timeout Event
  type: 'order.timed_out';
  payload: OrderId & { atStep: string };
}

// --- 2. Inventory Domain ---
export interface ReserveInventory extends OutboxEvent { // Command
  type: 'inventory.reserve';
  payload: OrderId & { items: any[] };
}
export interface InventoryReserved extends OutboxEvent { // Fact
  type: 'inventory.reserved';
  payload: OrderId;
}
export interface InventoryReservationFailed extends OutboxEvent { // Fact (Failure)
  type: 'inventory.reservation_failed';
  payload: OrderId & FailureReason;
}
export interface ReleaseInventory extends OutboxEvent { // Compensation Command
  type: 'inventory.release';
  payload: OrderId;
}

// --- 3. Fraud Domain ---
export interface CheckFraud extends OutboxEvent { // Command
  type: 'fraud.check';
  payload: OrderId & { customerId: string; total: number };
}
export interface FraudCheckPassed extends OutboxEvent { // Fact
  type: 'fraud.passed';
  payload: OrderId;
}
export interface FraudCheckFailed extends OutboxEvent { // Fact (Failure)
  type: 'fraud.failed';
  payload: OrderId & FailureReason;
}

// --- 4. Payment Domain ---
export interface ProcessPayment extends OutboxEvent { // Command
  type: 'payment.process';
  payload: OrderId & { amount: number };
}
export interface PaymentCaptured extends OutboxEvent { // Fact
  type: 'payment.captured';
  payload: OrderId & { transactionId: string };
}
export interface PaymentFailed extends OutboxEvent { // Fact (Failure)
  type: 'payment.failed';
  payload: OrderId & FailureReason;
}
export interface RefundPayment extends OutboxEvent { // Compensation Command
  type: 'payment.refund';
  payload: OrderId & { amount: number };
}

// --- 5. Shipping Domain ---
export interface CreateShipment extends OutboxEvent { // Command
  type: 'shipping.create';
  payload: OrderId & { address: string };
}
export interface ShipmentCreated extends OutboxEvent { // Fact
  type: 'shipping.created';
  payload: OrderId & { trackingNumber: string };
}
export interface ShipmentFailed extends OutboxEvent { // Fact (Failure)
  type: 'shipping.failed';
  payload: OrderId & FailureReason;
}
```

---

## 3. The Saga State

We track the `timeoutAt` timestamp. If the current time exceeds this, the step has taken too long.

```typescript
// Conceptual Database Schema
interface OrderSaga {
  orderId: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'COMPENSATING' | 'TIMED_OUT';
  currentStep: string;
  compensationStack: string[]; 
  error?: string;
  updatedAt: Date;
  timeoutAt?: Date; // New field for deadlines
}
```

---

## 4. The Orchestrator (Handlers)

```typescript
import { OutboxEventBus } from 'outbox-event-bus';
import { db } from './db'; 
import { addMinutes } from 'date-fns'; // Utils

// Default timeout per step
const TIMEOUT_MINS = 5;

export function registerMegaMartSaga(bus: OutboxEventBus) {

  // =================================================================
  // HAPPY PATH
  // =================================================================

  // 1. Order Placed -> Reserve Inventory
  bus.on('order.placed', async (event) => {
    const { orderId, items } = event.payload;
    
    await db.transaction(async (tx) => {
      // Create Saga State with Deadline
      await tx.saga.create({
        orderId,
        status: 'PENDING',
        currentStep: 'INIT',
        compensationStack: [],
        timeoutAt: addMinutes(new Date(), TIMEOUT_MINS) // Valid for 5 mins
      });

      await bus.emit({ 
        type: 'inventory.reserve', 
        payload: { orderId, items } 
      }, tx);
    });
  });

  // 2. Inventory Reserved -> Check Fraud
  bus.on('inventory.reserved', async (event) => {
    const { orderId } = event.payload;
    
    await db.transaction(async (tx) => {
      await tx.saga.update({
        where: { orderId },
        data: {
          currentStep: 'INVENTORY_RESERVED',
          compensationStack: { push: 'RELEASE_INVENTORY' },
          timeoutAt: addMinutes(new Date(), TIMEOUT_MINS) // Reset timer
        }
      });

      const order = await tx.orders.find(orderId);
      await bus.emit({
        type: 'fraud.check',
        payload: { orderId, customerId: order.customerId, total: order.total }
      }, tx);
    });
  });

  // 3. Fraud Passed -> Process Payment
  bus.on('fraud.passed', async (event) => {
    const { orderId } = event.payload;

    await db.transaction(async (tx) => {
      await tx.saga.update({
        where: { orderId },
        data: { 
          currentStep: 'FRAUD_PASSED',
          timeoutAt: addMinutes(new Date(), TIMEOUT_MINS) 
        }
      });

      const order = await tx.orders.find(orderId);
      await bus.emit({
        type: 'payment.process',
        payload: { orderId, amount: order.total }
      }, tx);
    });
  });

  // 4. Payment Captured -> Create Shipment
  bus.on('payment.captured', async (event) => {
    const { orderId } = event.payload;

    await db.transaction(async (tx) => {
      await tx.saga.update({
        where: { orderId },
        data: {
          currentStep: 'PAYMENT_CAPTURED',
          compensationStack: { push: 'REFUND_PAYMENT' },
          timeoutAt: addMinutes(new Date(), TIMEOUT_MINS) 
        }
      });

      const order = await tx.orders.find(orderId);
      await bus.emit({
        type: 'shipping.create',
        payload: { orderId, address: order.shippingAddress }
      }, tx);
    });
  });

  // 5. Shipment Created -> Complete Order
  bus.on('shipping.created', async (event) => {
    const { orderId, trackingNumber } = event.payload;

    await db.transaction(async (tx) => {
      // Clear timeout, mark complete
      await tx.saga.update({
        where: { orderId },
        data: { 
          status: 'COMPLETED', 
          currentStep: 'COMPLETED',
          timeoutAt: null 
        }
      });
      
      await tx.orders.update({
        where: { id: orderId },
        data: { status: 'SHIPPED', trackingNumber }
      });

      await bus.emit({
        type: 'order.completed',
        payload: { orderId }
      }, tx);
    });
  });


  // =================================================================
  // FAILURE & COMPENSATION PATHS
  // =================================================================

  // Generic Compensation Trigger
  async function triggerCompensation(tx: any, orderId: string, reason: string, sagaState: any) {
    if (sagaState.status === 'COMPENSATING' || sagaState.status === 'CANCELLED') {
        return; // Already handling
    }

    await tx.saga.update({
      where: { orderId },
      data: { status: 'COMPENSATING', error: reason, timeoutAt: null }
    });

    const stack = sagaState.compensationStack.reverse(); 
    const eventsToEmit = [];

    for (const step of stack) {
      if (step === 'REFUND_PAYMENT') {
        const order = await tx.orders.find(orderId);
        eventsToEmit.push({ type: 'payment.refund', payload: { orderId, amount: order.total } });
      }
      if (step === 'RELEASE_INVENTORY') {
        eventsToEmit.push({ type: 'inventory.release', payload: { orderId } });
      }
    }

    eventsToEmit.push({
      type: 'order.cancelled',
      payload: { orderId, reason, lastStep: sagaState.currentStep }
    });

    await bus.emitMany(eventsToEmit, tx);
  }

  // --- Failure Listeners ---
  // (Mapped same as happy path, passing error reason)
  
  const failureHandlers = {
    'inventory.reservation_failed': 'Inventory Failed',
    'fraud.failed': 'Fraud Check Failed',
    'payment.failed': 'Payment Failed',
    'shipping.failed': 'Shipping Failed',
    'order.timed_out': 'Saga Timed Out' // Handle Timeouts exactly like failures!
  };

  Object.entries(failureHandlers).forEach(([eventType, defaultReason]) => {
    bus.on(eventType as any, async (event) => {
       await db.transaction(async tx => {
         const saga = await tx.saga.find(event.payload.orderId);
         const reason = (event.payload as any).reason || defaultReason;
         await triggerCompensation(tx, saga.orderId, reason, saga);
       });
    });
  });
}
```

---

## 5. The Reaper (Timeout Monitor)

This is a background process that runs periodically (e.g., every 1 min).

```typescript
// reaper.ts
import { OutboxEventBus } from 'outbox-event-bus';
import { db } from './db';

export class SagaReaper {
  constructor(private bus: OutboxEventBus) {}

  async start() {
    setInterval(() => this.scanForTimeouts(), 60000); // Verify every minute
  }

  async scanForTimeouts() {
    await db.transaction(async tx => {
      // Find stuck sagas
      const expiredSagas = await tx.saga.findMany({
        where: {
          status: { in: ['PENDING', 'COMPENSATING'] }, // Also catch stuck compensations!
          timeoutAt: { lt: new Date() }
        }
      });

      for (const saga of expiredSagas) {
        console.warn(`Saga ${saga.orderId} timed out at step ${saga.currentStep}`);

        // Emit Timeout Event
        // The 'order.timed_out' handler (defined above) will pick this up 
        // and trigger the compensation stack.
        await this.bus.emit({
          type: 'order.timed_out',
          payload: { orderId: saga.orderId, atStep: saga.currentStep, reason: 'Timeout' }
        }, tx);
        
        // Push timeout forward to avoid immediate re-triggering loop 
        // (handling takes time)
        await tx.saga.update({
          where: { orderId: saga.orderId },
          data: { timeoutAt: addMinutes(new Date(), 1) } 
        });
      }
    });
  }
}
```

## 6. How It Works Together

1.  **Start**: Saga starts, `timeoutAt` is set to `Now + 5m`.
2.  **Hang**: Service hangs. 5 minutes pass.
3.  **Detect**: `SagaReaper` wakes up, sees `timeoutAt < Now`.
4.  **Signal**: `SagaReaper` emits `order.timed_out` transactionally.
5.  **Compensate**: The `registerMegaMartSaga` listener receives `order.timed_out`.
6.  **Undo**: It reads the `compensationStack` from the DB and reverses all actions.
7.  **Settle**: Order Status becomes `CANCELLED`. `timeoutAt` is cleared.

This provides a self-healing system that never leaves orders in a "pending" state indefinitely.
