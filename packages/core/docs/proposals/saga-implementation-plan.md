# Implementation Plan - Saga Library (@outbox-event-bus/sagas)

This document outlines the plan to implement the **Routing Slip** pattern as a standalone library within the `outbox-event-bus` monorepo.

## Goal
Create a new package `@outbox-event-bus/sagas` that implements the stateless Routing Slip pattern described in `docs/proposals/saga-library-design.md`.

## User Review Required
> [!IMPORTANT]
> This new package will be a root-level package named `sagas`, similar to `core`. It requires updating `pnpm-workspace.yaml`.

## Proposed Changes

### 1. Package Setup
#### [NEW] [sagas/package.json](file:///Users/dunika/workspace/outbox-event-bus/sagas/package.json)
- Name: `@outbox-event-bus/sagas`
- Dependencies: `outbox-event-bus` (core)
- DevDependencies: `typescript`, `vitest`, `tsdown`

#### [MODIFY] [pnpm-workspace.yaml](file:///Users/dunika/workspace/outbox-event-bus/pnpm-workspace.yaml)
- Add `sagas` to the `packages` list.

### 2. Core Implementation (`sagas/src`)

#### [NEW] [types.ts](file:///Users/dunika/workspace/outbox-event-bus/sagas/src/types.ts)
- `RoutingSlip` interface (Itinerary, Log, Variables, etc.)
- `Activity` interface (`execute`, `compensate`)
- `ActivityContext`, `CompensateContext`

#### [NEW] [events.ts](file:///Users/dunika/workspace/outbox-event-bus/sagas/src/events.ts)
- `RoutingSlipCreated`
- `RoutingSlipActivityCompleted`
- `RoutingSlipActivityFaulted`
- `RoutingSlipFaulted`
- `RoutingSlipCompleted`

#### [NEW] [builder.ts](file:///Users/dunika/workspace/outbox-event-bus/sagas/src/builder.ts)
- `RoutingSlipBuilder` class
- Methods: `addActivity`, `addVariable`, `expiresIn`, `build()`

#### [NEW] [execution.ts](file:///Users/dunika/workspace/outbox-event-bus/sagas/src/execution.ts)
- `processSagaActivity<T>` helper function.
- This function wraps the user's `Activity` implementation.
- It handles:
    - Logic for `execute()` vs `compensate()` based on slip mode.
    - Capturing results/errors.
    - Determining the *next* step (Forward or Backward).
    - Emitting the next command + tracking events.

### 3. Verification Plan

#### Automated Tests
- **Unit Tests**:
    - `builder.test.ts`: Verify slip construction, argument validation.
    - `execution.test.ts`: Mock `bus.emit` and verify correct "next step" logic (Happy path, Failure path, Compensation path).
- **Integration Test**:
    - `sagas/test/e2e.test.ts`:
        - Simulate a small crypto-exchange saga (Buy -> Withdraw -> Notify).
        - Use `TestContainer` or in-memory bus to verify the full flow.

## Verification Steps
1. `pnpm install`
2. `pnpm build` (core & sagas)
3. `pnpm test` (in sagas package)
