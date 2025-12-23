# Tasks: Saga Storage Adapters

**Input**: Design documents from `/specs/001-saga-storage-adapters/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and interface updates

- [X] T001 Update `SagaStoreAdapter` interface in `packages/saga/src/types/interfaces.ts` to include `expiresAt` in `put` and optional `cleanup`
- [X] T002 Update `SagaEngine.emitWithCompression` in `packages/saga/src/engine/saga-engine.ts` to pass `slip.expiresAt` to `claimCheckStore.put`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [X] T003 Create shared integration test suite for `SagaStoreAdapter` in `packages/saga/src/tests/storage-test-suite.ts`

**Checkpoint**: Foundation ready - adapter implementation can now begin in parallel

---

## Phase 3: User Story 1 - Redis Saga Storage (Priority: P1) 🎯 MVP

**Goal**: Implement Redis-based saga storage with native TTL support

**Independent Test**: Verify `RedisIoredisSagaStore` stores data with TTL and retrieves it correctly using a real Redis instance.

### Implementation for User Story 1

- [X] T004 [P] [US1] Implement `RedisIoredisSagaStore` with TTL support and logging in `packages/adapters/redis-ioredis/src/redis-ioredis-saga-store.ts`
- [X] T005 [P] [US1] Add integration tests for `RedisIoredisSagaStore` in `packages/adapters/redis-ioredis/src/redis-ioredis-saga-store.test.ts`

**Checkpoint**: Redis Saga Storage is fully functional and testable independently

---

## Phase 4: User Story 2 - SQL Saga Storage (Postgres/SQLite) (Priority: P1)

**Goal**: Implement SQL-based saga storage with transaction support and manual cleanup

**Independent Test**: Verify that saga payloads are persisted within the same transaction as outbox events and rolled back on failure.

### Implementation for User Story 2

- [X] T006 [P] [US2] Update Prisma schema with `SagaStore` model in `packages/adapters/postgres-prisma/schema.prisma`
- [X] T007 [P] [US2] Update Drizzle schema with `saga_store` table in `packages/adapters/postgres-drizzle/src/schema.ts`
- [X] T008 [P] [US2] Implement `PostgresPrismaSagaStore` with transaction support, logging, and `cleanup()` in `packages/adapters/postgres-prisma/src/postgres-prisma-saga-store.ts`
- [X] T009 [P] [US2] Implement `PostgresDrizzleSagaStore` with transaction support, logging, and `cleanup()` in `packages/adapters/postgres-drizzle/src/postgres-drizzle-saga-store.ts`
- [X] T010 [P] [US2] Implement `SqliteBetterSqlite3SagaStore` with logging and `cleanup()` in `packages/adapters/sqlite-better-sqlite3/src/sqlite-better-sqlite3-saga-store.ts`
- [X] T011 [P] [US2] Add integration tests for Prisma saga storage in `packages/adapters/postgres-prisma/src/postgres-prisma-saga-store.test.ts`
- [X] T012 [P] [US2] Add integration tests for Drizzle saga storage in `packages/adapters/postgres-drizzle/src/postgres-drizzle-saga-store.test.ts`
- [X] T013 [P] [US2] Add integration tests for SQLite saga storage in `packages/adapters/sqlite-better-sqlite3/src/sqlite-better-sqlite3-saga-store.test.ts`

**Checkpoint**: SQL Saga Storage adapters are fully functional and support transactional atomicity

---

## Phase 5: User Story 3 - NoSQL Saga Storage (DynamoDB/Mongo) (Priority: P2)

**Goal**: Implement NoSQL-based saga storage with native TTL/Index support

**Independent Test**: Verify payloads are stored and automatically expired using provider-specific TTL mechanisms.

### Implementation for User Story 3

- [X] T014 [P] [US3] Implement `DynamoDBAwsSdkSagaStore` with TTL support and logging in `packages/adapters/dynamodb-aws-sdk/src/dynamodb-aws-sdk-saga-store.ts`
- [X] T015 [P] [US3] Implement `MongodbSagaStore` with TTL index support and logging in `packages/adapters/mongodb/src/mongodb-saga-store.ts`
- [X] T016 [P] [US3] Implement `initialize()` for `MongodbSagaStore` in `packages/adapters/mongodb/src/mongodb-saga-store.ts`
- [X] T017 [P] [US3] Add integration tests for DynamoDB saga storage in `packages/adapters/dynamodb-aws-sdk/src/dynamodb-aws-sdk-saga-store.test.ts`
- [X] T018 [P] [US3] Add integration tests for Mongo saga storage in `packages/adapters/mongodb/src/mongodb-saga-store.test.ts`

**Checkpoint**: All NoSQL Saga Storage adapters are fully functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and final validation

- [X] T019 [P] Update `README.md` files in all adapter packages with Saga Storage documentation
- [X] T020 [P] Update `docs/API_REFERENCE.md` with new storage adapters
- [X] T021 Validate all implementations against `quickstart.md` examples
- [X] T022 [P] Implement `initialize()` method across all 6 adapters (FR-005)
- [X] T023 [P] Add missing logging to all `put`/`get` operations (NFR-001)
- [X] T024 [P] Add payload size validation for DynamoDB (US3)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Must be completed first to enable correct interface usage.
- **Foundational (Phase 2)**: Depends on Phase 1. Provides the test suite used by all adapters.
- **User Stories (Phase 3-5)**: Can proceed in parallel once Phase 2 is complete.
- **Polish (Phase 6)**: Depends on all implementation tasks.

### Parallel Opportunities

- All adapter implementations (T004, T008, T009, T010, T014, T015) can run in parallel.
- All integration tests can run in parallel.
- Documentation updates can run in parallel.

---

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Phase 1 & 2.
2. Implement `RedisSagaStore` (US1).
3. Verify with integration tests.

### Incremental Delivery

1. Add SQL adapters (US2) to support transactional workloads.
2. Add NoSQL adapters (US3) for DynamoDB/Mongo users.
3. Finalize documentation and examples.

