# Implementation Plan: Saga Routing Slip Library

**Branch**: `001-saga-routing-slip` | **Date**: 2025-12-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/001-saga-routing-slip/spec.md`

## Summary

Implement `@outbox-event-bus/saga`, a library for managing distributed transactions using the Routing Slip pattern. It provides a `RoutingSlipBuilder` for defining strictly linear itineraries, an engine for executing activities, and automatic compensation on failure. The state (itinerary, log, variables) is carried entirely within the message payload, ensuring statelessness and compatibility with the existing `outbox-event-bus`.

## Technical Context

**Language/Version**: TypeScript (latest stable)
**Primary Dependencies**: `@outbox-event-bus/core` (internal)
**Storage**: Stateless (carried in message), relies on `outbox-event-bus` adapters for persistence.
**Testing**: Vitest (unit, integration), Testcontainers (E2E)
**Target Platform**: Node.js (LTS)
**Project Type**: Monorepo package (`packages/saga`)
**Performance Goals**: Minimal overhead over standard event emission.
**Constraints**: Must adhere to the 1:1 Command Bus pattern of the core.
**Scale/Scope**: Distributed transactions across multiple services.

**NEEDS CLARIFICATION**:

1. Integration Pattern: Should the Saga Engine be implemented as a middleware for `OutboxEventBus` or a separate service that registers handlers for routing slip commands?
2. Compensation Flow: How does the engine signal the transition from "Forward" to "Compensation" mode in the message payload?
3. Payload Size: What are the best practices for serializing the `RoutingSlip` to avoid exceeding transport limits (e.g., SQS 256KB)?

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Atomic Persistence**: Does this feature ensure events are persisted within the same transaction? (Uses core `emit`)
- [x] **II. Storage Agnosticism**: Does this feature maintain core storage-agnosticism? (Inherited from core)
- [x] **III. Type Safety**: Are all new types strictly defined? No `any`? (TypeScript first)
- [x] **IV. Comprehensive Testing**: Are unit, integration, and E2E tests planned? (Yes)
- [x] **V. Developer Experience**: Is the API simple and errors typed? (Fluent builder, typed errors)
- [x] **VI. 1:1 Command Bus Pattern**: Does it follow the 1:1 handler rule? (Each step is a command)
- [x] **VII. Observability & Error Handling**: Are failures logged and DLQs considered? (Standard events, DLQ on compensation failure)
- [x] **VIII. Performance & Scalability**: Are batch sizes and concurrency optimized? (Stateless design)

## Project Structure

### Documentation (this feature)

```text
specs/001-saga-routing-slip/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
packages/saga/
├── src/
│   ├── builder/         # RoutingSlipBuilder implementation
│   ├── engine/          # SagaEngine and ActivityRegistry
│   ├── types/           # RoutingSlip, Activity, and Event types
│   └── index.ts         # Public API
├── tests/
│   ├── unit/            # Builder and Engine logic tests
│   └── integration/     # Full flow with InMemoryOutbox
├── package.json
├── tsconfig.json
└── README.md
```

**Structure Decision**: New package `@outbox-event-bus/saga` in the `packages/` directory to maintain modularity and allow independent versioning.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
| :--- | :--- | :--- |
| N/A | | |
