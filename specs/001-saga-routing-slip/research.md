# Research: Routing Slip Pattern for Distributed Sagas

## 1. Stateless Routing Slip Implementation

The Routing Slip pattern is a message-based orchestration pattern where the "state" of the workflow is carried within the message itself (the "envelope"). This eliminates the need for a central saga state database.

### Key Components of a Routing Slip:
- **ID**: A unique identifier for the saga instance.
- **Itinerary**: A stack or list of activities to be executed in order.
- **Activity Log**: A stack of successfully completed activities, including data required for compensation.
- **Variables**: A shared key-value store for data passed between activities (e.g., a `paymentId` generated in step 2 needed for step 4).
- **Metadata**: Information like `expiresAt` for timeout handling.

### Workflow:
1. **Initiation**: A `RoutingSlipBuilder` creates the initial slip and emits it as a command to the first activity's queue.
2. **Execution**: Each activity handler:
    - Receives the slip.
    - Performs its local business logic.
    - Updates the `Activity Log` and `Variables`.
    - Forwards the updated slip to the next activity in the `Itinerary`.
3. **Completion**: When the `Itinerary` is empty, the saga is complete.

## 2. Integration with Outbox Event Bus

To maintain the "Atomic Persistence" principle of the `outbox-event-bus`, the transition between saga steps must be atomic.

### Atomic Step Transitions:
- The activity handler MUST execute its local database changes and the `bus.emit()` call for the next step within the **same database transaction**.
- **Example**:
  ```typescript
  await db.transaction(async (tx) => {
    // 1. Local business logic
    const result = await reserveInventory(items, tx);
    
    // 2. Update slip
    const nextSlip = slip.next(result.compensationData, result.newVars);
    
    // 3. Emit next command via Outbox
    await bus.emit({
      type: 'inventory.reserved',
      payload: nextSlip
    }, tx);
  });
  ```
- This ensures that the saga state (in the slip) and the business state (in the DB) never diverge.

## 3. Compensation Logic Best Practices

Compensation is the process of undoing completed activities when a later activity fails.

- **LIFO Order**: Compensation MUST be performed in reverse order of execution (Last-In, First-Out) using the `Activity Log`.
- **Idempotency**: Compensation actions MUST be idempotent. They may be retried multiple times in case of transient failures.
- **Explicit Compensation Data**: The `execute` method of an activity should return a specific "Log" object containing only the data needed to undo that specific action (e.g., an ID, not the whole entity).
- **Faulted State**: If compensation fails after all retries, the saga should be marked as `Faulted` and moved to a Dead Letter Queue (DLQ) or emit a critical alert for manual intervention.

## 4. Passive Timeout Handling

Instead of an active "Reaper" process that polls a database for timed-out sagas, we use a passive approach.

- **Expiration Timestamp**: The slip includes an `expiresAt` field (ISO 8601).
- **Pre-Execution Check**: Every engine/handler MUST check the expiration before processing:
  ```typescript
  if (new Date() > new Date(slip.expiresAt)) {
    return engine.compensate(slip, 'Timeout');
  }
  ```
- **Triggering Compensation**: If a timeout is detected, the engine immediately switches the slip to "Compensation Mode" and begins unwinding the `Activity Log`.
- **Clock Synchronization**: While this relies on synchronized clocks, a small grace period (e.g., 5-10 seconds) can mitigate minor drifts.

## 5. References & Inspiration
- **MassTransit Courier**: The gold standard for Routing Slip implementations in .NET.
- **Enterprise Integration Patterns**: The original source for the Routing Slip pattern.
- **Outbox Pattern**: Ensures at-least-once delivery and atomic transitions.

## 6. Implementation Decisions (2025-12-23)

### 6.1 Integration Pattern

- **Decision**: Implement the Saga Engine as a **Handler Middleware**.
- **Rationale**:
  - **Seamless Interception**: The `OutboxEventBus` already supports `HandlerMiddleware`. A middleware can inspect every incoming event for a `RoutingSlip` payload.
  - **Automatic Dispatching**: If a `RoutingSlip` is detected, the middleware can resolve the current activity from its registry and execute it without requiring the user to register manual handlers for every activity type.
  - **Execution Control**: Using the `dropEvent` capability in `Next`, the engine can prevent standard event handlers from running when an event is being processed as part of a saga.
  - **DX**: It simplifies setup to a single line: `bus.addHandlerMiddleware(sagaEngine.middleware())`.

### 6.2 Compensation Flow

- **Decision**: Add an explicit `mode: 'forward' | 'compensate'` field to the `RoutingSlip` entity.
- **Rationale**:
  - **Logic Branching**: Decouples the *direction* of execution from the *lifecycle state* of the saga.
  - **Observability**: Makes the message payload self-describing. Developers can quickly see if a message is a "Forward Command" or a "Compensation Command" in logs.
  - **Standard Pattern**: Aligns with industry standards where the routing slip carries its current execution context.

### 6.3 Payload Size

- **Decision**: Maintain the **"Message-Only"** approach with **Transparent Compression** in the Saga library.
- **Rationale**:
  - **Maintain Portability**: Adheres to Principle II: Storage Agnosticism by avoiding a central state database.
  - **Built-in Compression**: Use Node.js native `zlib` to compress large slips before emission.
  - **Claim Check Fallback**: Support an optional "Claim Check" pattern where the slip is stored in the outbox's underlying storage if it exceeds transport limits.
