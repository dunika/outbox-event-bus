# Feature Specification: Saga Routing Slip Library

**Feature Branch**: `001-saga-routing-slip`  
**Created**: 2025-12-23  
**Status**: Draft  
**Input**: User description: "Implement @outbox-event-bus/saga library using Routing Slip Pattern"

## Clarifications

### Session 2025-12-23

- Q: Should the routing slip support conditional branching or remain strictly linear? → A: Strictly Linear: Activities execute in the exact order defined in the itinerary.
- Q: How should the engine resolve activity names (strings) to actual executable code? → A: Explicit Registry: The engine instance is initialized with a map of `name -> ActivityImplementation`.
- Q: How is the updated slip persisted and passed to the next activity? → A: Message-Only: The entire updated `RoutingSlip` (including log and variables) is sent as the payload of the next command.
- Q: What specific failure conditions should trigger the automatic compensation flow? → A: Any Uncaught Exception: Any error thrown by an activity's `execute` method (after retries) triggers compensation.
- Q: What should happen if a `compensate` method itself fails? → A: Terminal Fault (DLQ): Stop compensation, emit `RoutingSlipFaulted`, and require manual intervention.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Linear Workflow Execution (Priority: P1)

As a developer, I want to define a sequence of activities (a routing slip) and execute them in order, so that I can automate a multi-step business process without managing a central state database.

**Why this priority**: This is the core value proposition of the library. Without linear execution, the routing slip pattern doesn't exist.

**Independent Test**: Can be fully tested by creating a slip with two "no-op" activities and verifying they both execute in the correct order.

**Acceptance Scenarios**:

1. **Given** a routing slip with activities A and B, **When** the slip is executed, **Then** activity A's `execute` method is called first, followed by activity B's `execute` method.
2. **Given** a completed activity A, **When** it returns new variables, **Then** those variables are available in the context of activity B.

---

### User Story 2 - Automatic Compensation on Failure (Priority: P1)

As a developer, I want the system to automatically undo previously completed activities if a later activity fails, so that I can maintain data consistency across distributed services.

**Why this priority**: Distributed transactions require a way to roll back. Compensation is the "Saga" part of the Saga pattern.

**Independent Test**: Can be tested by creating a slip where the second activity fails and verifying the first activity's `compensate` method is called.

**Acceptance Scenarios**:

1. **Given** a slip where activity A succeeded and activity B failed, **When** the failure occurs, **Then** activity A's `compensate` method is called with the log data it produced during execution.
2. **Given** a failed activity with no compensation logic needed (read-only), **When** it fails, **Then** the system continues compensating previous steps correctly.

---

### User Story 3 - Workflow Timeouts (Priority: P2)

As a developer, I want to set an expiration time for a routing slip, so that long-running or stuck workflows are automatically cancelled and compensated.

**Why this priority**: Prevents "zombie" transactions from hanging indefinitely and consuming resources.

**Independent Test**: Can be tested by creating a slip with an `expiresAt` in the past and verifying it immediately triggers compensation.

**Acceptance Scenarios**:

1. **Given** a routing slip that has expired, **When** the engine attempts to process the next activity, **Then** it throws a timeout error and begins compensation.

---

### User Story 4 - Activity Retries (Priority: P2)

As a developer, I want to define retry policies for individual activities, so that transient failures (like network blips) don't trigger a full workflow compensation immediately.

**Why this priority**: Improves system resilience and reduces the frequency of expensive compensation flows.

**Independent Test**: Can be tested by mocking an activity to fail twice and then succeed, verifying it completes successfully on the third attempt.

**Acceptance Scenarios**:

1. **Given** an activity with a retry count of 3, **When** it fails twice but succeeds on the third try, **Then** the workflow continues to the next activity.

---

### Edge Cases

- **Duplicate Messages**: How does the system handle receiving the same routing slip message twice? (Idempotency check against the ActivityLog).
- **Compensation Failure**: What happens if a `compensate` action itself fails? (Stop compensation, emit `RoutingSlipFaulted`, and move to DLQ).
- **Activity Failure**: What happens if an `execute` action fails? (Emit `ActivityFaulted` and begin compensation).
- **Empty Itinerary**: What happens if a slip is created with no activities? (Should be a validation error at build time).
- **Missing Activity Implementation**: What happens if the engine encounters an activity name it doesn't have a handler for? (Should trigger compensation and log a critical error).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The library MUST provide a `RoutingSlipBuilder` to fluently define a strictly linear itinerary, variables, and expiration.
- **FR-002**: The `RoutingSlip` MUST be stateless and contain all necessary information (Itinerary, ActivityLog, Variables) to continue execution from any point.
- **FR-003**: Activities MUST implement an `execute` method for forward progress and a `compensate` method for rollback.
- **FR-008**: The engine MUST be initialized with an explicit registry mapping activity names to their implementations.
- **FR-009**: The engine MUST pass the entire updated `RoutingSlip` state as the payload for the next activity's command message.
- **FR-010**: Any uncaught exception thrown by an activity's `execute` method (after all retries are exhausted) MUST trigger the automatic compensation flow.
- **FR-011**: If a `compensate` method fails, the engine MUST stop the compensation flow, emit a `RoutingSlipFaulted` event, and mark the slip as `Terminated` (logical DLQ) to prevent further automated processing.
- **FR-004**: The `execute` method MUST be able to return "Variables" that are merged into the slip's global state using a shallow merge (Object.assign).
- **FR-005**: The engine MUST support a "Compensation Mode" that processes the `ActivityLog` in reverse order (LIFO).
- **FR-006**: The system MUST emit standard `OutboxEvent` types for observability: `RoutingSlipCreated`, `ActivityCompleted`, `ActivityFaulted`, `RoutingSlipCompleted`, and `RoutingSlipFaulted`. These events MUST be emitted via the `OutboxEventBus`.
- **FR-007**: The engine MUST perform a passive timeout check before executing any activity.
- **FR-012**: The engine MUST implement a "Claim Check" pattern to handle large payloads that exceed transport limits (e.g., > 256KB), offloading the state to an external store via a `SagaStoreAdapter` (e.g., S3, Redis) to maintain storage agnosticism.
- **FR-013**: The Saga Engine MUST be implemented as a `HandlerMiddleware` for the `OutboxEventBus` to intercept and process routing slip commands (identified by the presence of a `routingSlip` property in the message body) transparently.
- **FR-014**: The engine MUST ensure idempotency by checking the `ActivityLog` before executing an activity to prevent duplicate processing of the same step.

### Non-Functional Requirements (Constitution Alignment)

- **NFR-001 (Atomic Persistence)**: The engine MUST use the existing `outbox-event-bus` to emit the next step's command and tracking events within the same transaction as any local state changes (if any).
- **NFR-002 (Type Safety)**: The library MUST be written in TypeScript with full type support for activity arguments and log data.
- **NFR-003 (Observability)**: Every state transition (Next Step, Compensation Start, Completion, Fault) MUST be logged with the `RoutingSlipId`.

## Success Criteria

- **SC-001**: A developer can implement a 3-step distributed transaction with compensation in under 50 lines of code.
- **SC-002**: 100% of "Happy Path" workflows complete successfully in integration tests.
- **SC-003**: 100% of workflows that encounter a terminal failure are fully compensated (all `compensate` methods called for completed steps).
- **SC-004**: The system handles 1000 concurrent routing slips without any "Split Brain" state issues (verified by state being contained in the message).

## Key Entities

- **RoutingSlip**: The envelope containing the state.
- **Activity**: A unit of work with `execute` and `compensate`.
- **Itinerary**: The list of remaining steps.
- **ActivityLog**: The list of completed steps and their compensation data.
- **Variables**: Shared data bag for the entire workflow.

## Assumptions

- **A-001**: The underlying message transport (RabbitMQ, SQS, etc.) guarantees at-least-once delivery.
- **A-002**: Activities are idempotent or can handle duplicate executions safely.
- **A-003**: The `outbox-event-bus` core is already functional and can be used for message emission.

