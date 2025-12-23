# Tasks: Saga Routing Slip Library

**Input**: Design documents from `specs/001-saga-routing-slip/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are MANDATORY for all core logic and engine components, as per Constitution Principle IV.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create `packages/saga` directory structure per implementation plan
- [ ] T002 Initialize `packages/saga/package.json` and `packages/saga/tsconfig.json`
- [ ] T003 [P] Configure Biome linting and formatting for `packages/saga`
- [ ] T004 Add `packages/saga` to `pnpm-workspace.yaml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T005 Define core types (RoutingSlip, Activity, ActivityLogEntry) in `packages/saga/src/types/interfaces.ts`
- [ ] T006 [P] Implement `RoutingSlipBuilder` in `packages/saga/src/builder/routing-slip-builder.ts`
- [ ] T007 [P] Implement `ActivityRegistry` in `packages/saga/src/engine/activity-registry.ts`
- [ ] T008 Implement base `SagaEngine` class structure in `packages/saga/src/engine/saga-engine.ts`
- [ ] T009 [P] Implement transparent compression utility in `packages/saga/src/utils/compression.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Linear Workflow Execution (Priority: P1) 🎯 MVP

**Goal**: Define a sequence of activities and execute them in order without central state.

**Independent Test**: Create a slip with two "no-op" activities and verify they both execute in the correct order.

### Tests for User Story 1 (MANDATORY) ⚠️

- [ ] T010 [P] [US1] Unit tests for `RoutingSlipBuilder` in `packages/saga/tests/unit/builder.test.ts`
- [ ] T011 [P] [US1] Integration test for linear execution in `packages/saga/tests/integration/linear-execution.test.ts`

### Implementation for User Story 1

- [ ] T012 [US1] Implement forward execution logic in `SagaEngine.execute()` in `packages/saga/src/engine/saga-engine.ts`
- [ ] T013 [US1] Implement `SagaEngine.middleware()` to intercept routing slips in `packages/saga/src/engine/saga-engine.ts`
- [ ] T014 [US1] Implement "Next Step" command emission using `OutboxEventBus` in `packages/saga/src/engine/saga-engine.ts`
- [ ] T015 [US1] Add `RoutingSlipCreated` and `RoutingSlipCompleted` events in `packages/saga/src/types/events.ts`
- [ ] T016 [US1] Implement idempotency check against `ActivityLog` in `packages/saga/src/engine/saga-engine.ts`

**Checkpoint**: User Story 1 functional and testable independently.

---

## Phase 4: User Story 2 - Automatic Compensation on Failure (Priority: P1)

**Goal**: Automatically undo previously completed activities if a later activity fails.

**Independent Test**: Create a slip where the second activity fails and verify the first activity's `compensate` method is called.

### Tests for User Story 2 (MANDATORY) ⚠️

- [ ] T017 [P] [US2] Integration test for compensation flow in `packages/saga/tests/integration/compensation.test.ts`

### Implementation for User Story 2

- [ ] T018 [US2] Implement failure detection and `mode` switching in `SagaEngine`
- [ ] T019 [US2] Implement compensation logic (LIFO) in `SagaEngine.compensate()`
- [ ] T020 [US2] Add `ActivityFaulted` and `RoutingSlipFaulted` events in `packages/saga/src/types/events.ts`
- [ ] T021 [US2] Implement terminal fault logic (DLQ) for compensation failures in `SagaEngine`

**Checkpoint**: User Stories 1 and 2 work independently.

---

## Phase 5: User Story 3 - Workflow Timeouts (Priority: P2)

**Goal**: Set an expiration time for a routing slip to automatically cancel and compensate stuck workflows.

**Independent Test**: Create a slip with an `expiresAt` in the past and verify it immediately triggers compensation.

### Tests for User Story 3 (MANDATORY) ⚠️

- [ ] T022 [P] [US3] Integration test for passive timeouts in `packages/saga/tests/integration/timeout.test.ts`

### Implementation for User Story 3

- [ ] T023 [US3] Implement passive timeout check in `SagaEngine` before activity execution
- [ ] T024 [US3] Integrate timeout check into forward execution flow to trigger compensation

**Checkpoint**: Timeouts functional and testable.

---

## Phase 6: User Story 4 - Activity Retries (Priority: P2)

**Goal**: Define retry policies for individual activities to handle transient failures.

**Independent Test**: Mock an activity to fail twice and then succeed, verifying it completes on the third attempt.

### Tests for User Story 4 (MANDATORY) ⚠️

- [ ] T025 [P] [US4] Integration test for activity retries in `packages/saga/tests/integration/retries.test.ts`

### Implementation for User Story 4

- [ ] T026 [US4] Add retry policy fields to `ActivityDefinition` in `packages/saga/src/types/interfaces.ts`
- [ ] T027 [US4] Implement retry logic in `SagaEngine` using the activity's retry policy

**Checkpoint**: All user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T028 [P] Implement "Claim Check" fallback for large payloads in `packages/saga/src/engine/saga-engine.ts`
- [ ] T029 [P] Finalize `packages/saga/README.md` and `packages/saga/docs/API_REFERENCE.md`
- [ ] T030 [P] Add comprehensive unit tests for all engine components in `packages/saga/tests/unit/`
- [ ] T031 Run `quickstart.md` validation to ensure developer experience
- [ ] T032 [P] Implement structured logging for all state transitions (Next Step, Compensation, Completion, Fault) using the `RoutingSlipId` in `SagaEngine`.

---

## Phase 8: End-to-End Testing (Constitution Principle IV)

**Purpose**: Verify full system integration under realistic failure conditions.

- [ ] T033 Setup Testcontainers for E2E testing in `packages/saga/tests/e2e/`
- [ ] T034 Implement E2E test for a multi-service linear workflow using a real transport (e.g., RabbitMQ)
- [ ] T035 Implement E2E test for a full compensation flow under simulated network failure

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup completion.
- **User Stories (Phase 3+)**: All depend on Foundational phase completion.
- **Polish (Final Phase)**: Depends on all user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: MVP - No dependencies on other stories.
- **User Story 2 (P1)**: Depends on US1 for forward execution context.
- **User Story 3 (P2)**: Depends on US2 for compensation logic.
- **User Story 4 (P2)**: Depends on US1 for execution flow.

### Parallel Opportunities

- T003 (Biome) can run in parallel with T001/T002.
- T006 (Builder), T007 (Registry), T009 (Compression) can run in parallel.
- Once Phase 2 is done, US1 and US2 can start in parallel (though US2 depends on US1's context).
- All tests marked [P] can run in parallel.

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Unit tests for RoutingSlipBuilder in packages/saga/tests/unit/builder.test.ts"
Task: "Integration test for linear execution in packages/saga/tests/integration/linear-execution.test.ts"

# Launch foundational components together:
Task: "Implement RoutingSlipBuilder in packages/saga/src/builder/routing-slip-builder.ts"
Task: "Implement ActivityRegistry in packages/saga/src/engine/activity-registry.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently.

### Incremental Delivery

1. Complete Setup + Foundational.
2. Add User Story 1 → Test independently → MVP!
3. Add User Story 2 → Test independently.
4. Add User Story 3 → Test independently.
5. Add User Story 4 → Test independently.
