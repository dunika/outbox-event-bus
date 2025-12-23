# Implementation Plan: Saga Storage Adapters

**Branch**: `001-saga-storage-adapters` | **Date**: 2025-12-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/001-saga-storage-adapters/spec.md`

## Summary

Implement `SagaStoreAdapter` for all existing outbox adapters (`redis-ioredis`, `postgres-prisma`, `postgres-drizzle`, `sqlite-better-sqlite3`, `dynamodb-aws-sdk`, `mongodb`). The approach focuses on maximum infrastructure reuse by sharing the existing database connections and clients. SQL-based adapters will support transactional atomicity for "Claim Check" payloads, while Redis and DynamoDB will leverage native TTL for automatic cleanup.

## Technical Context

**Language/Version**: TypeScript (latest stable)
**Primary Dependencies**: `@outbox-event-bus/core`, `@outbox-event-bus/saga`
**Storage**: Redis, PostgreSQL, SQLite, DynamoDB, MongoDB
**Testing**: Vitest (unit, integration), Testcontainers (E2E)
**Target Platform**: Node.js (LTS)
**Project Type**: Monorepo (multiple packages in `packages/adapters/`)
**Performance Goals**: Minimal overhead; binary storage where possible.
**Constraints**: Must reuse existing connections; SQL must support transactions.
**Scale/Scope**: All 6 existing adapters.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Atomic Persistence**: Does this feature ensure events are persisted within the same transaction? (SQL adapters will use shared transactions)
- [x] **II. Storage Agnosticism**: Does this feature maintain core storage-agnosticism? (Interface-driven design)
- [x] **III. Type Safety**: Are all new types strictly defined? No `any`? (TypeScript first)
- [x] **IV. Comprehensive Testing**: Are unit, integration, and E2E tests planned? (Integration tests for each adapter)
- [x] **V. Developer Experience**: Is the API simple and errors typed? (Simple put/get API)
- [x] **VI. 1:1 Command Bus Pattern**: Does it follow the 1:1 handler rule? (N/A for storage)
- [x] **VII. Observability & Error Handling**: Are failures logged and DLQs considered? (Logging with context)
- [x] **VIII. Performance & Scalability**: Are batch sizes and concurrency optimized? (Binary storage and native TTL)

## Project Structure

### Documentation (this feature)

```text
specs/001-saga-storage-adapters/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
packages/adapters/
├── dynamodb-aws-sdk/
│   └── src/dynamodb-aws-sdk-saga-store.ts
├── mongodb/
│   └── src/mongodb-saga-store.ts
├── postgres-drizzle/
│   └── src/postgres-drizzle-saga-store.ts
├── postgres-prisma/
│   └── src/postgres-prisma-saga-store.ts
├── redis-ioredis/
│   └── src/redis-ioredis-saga-store.ts
└── sqlite-better-sqlite3/
    └── src/sqlite-better-sqlite3-saga-store.ts
```

**Structure Decision**: The implementations will be added directly to the existing adapter packages in `packages/adapters/`. This ensures that users who already have an adapter installed get the saga storage capability without needing to install additional packages, and it facilitates maximum code reuse for connection management.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
| :--- | :--- | :--- |
| N/A | | |
