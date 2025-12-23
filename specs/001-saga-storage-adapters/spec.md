# Feature Specification: Saga Storage Adapters

**Feature Branch**: `001-saga-storage-adapters`  
**Created**: 2025-12-23  
**Status**: Draft  
**Input**: User description: "Implement SagaStoreAdapter for all existing outbox adapters with maximum infrastructure reuse"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Redis Saga Storage (Priority: P1)

As a developer using Redis for my outbox, I want to use the same Redis instance to store large saga payloads so that I don't have to manage multiple infrastructure components.

**Why this priority**: Redis is the most common transport and storage for this library. It provides native TTL support which is ideal for temporary saga data.

**Independent Test**: Can be fully tested by configuring a `SagaEngine` with a `RedisIoredisSagaStore` adapter and verifying that large payloads are stored in Redis with a TTL and retrieved correctly.

**Acceptance Scenarios**:

1. **Given** a Redis connection, **When** a large routing slip is processed, **Then** it is stored in Redis with the configured key prefix and TTL.
2. **Given** a stored payload in Redis, **When** the engine retrieves it via the middleware, **Then** the payload is correctly reconstructed.

---

### User Story 2 - SQL Saga Storage (Postgres/SQLite) (Priority: P1)

As a developer using a relational database, I want to store large saga payloads in a dedicated table within the same database transaction as my outbox events to ensure strict atomicity.

**Why this priority**: Ensures that the "Claim Check" is only persisted if the business transaction succeeds.

**Independent Test**: Can be tested by wrapping an `emit` call in a database transaction and verifying that the saga payload is rolled back if the transaction fails.

**Acceptance Scenarios**:

1. **Given** a Postgres/SQLite transaction, **When** a large payload is stored, **Then** it is written to the `saga_store` table within that transaction.
2. **Given** a failed transaction, **When** the transaction is rolled back, **Then** no entry exists in the `saga_store` table.

---

### User Story 3 - NoSQL Saga Storage (DynamoDB/Mongo) (Priority: P2)

As a developer using DynamoDB or MongoDB, I want to store large saga payloads in a dedicated collection/table to keep my outbox events lean.

**Why this priority**: Provides consistency for users already committed to these NoSQL providers.

**Independent Test**: Verify that payloads are stored and retrieved correctly using the provider-specific SDKs.

**Acceptance Scenarios**:

1. **Given** a DynamoDB table, **When** a payload is stored, **Then** it is saved as a new item with a TTL attribute.
2. **Given** a MongoDB collection, **When** a payload is stored, **Then** it is saved with a TTL index.

---

### Edge Cases

- **Storage Failure**: If the `put` operation fails, the `SagaEngine` MUST throw an error, preventing the outbox event from being persisted. This ensures we never have an event without its corresponding payload (Atomic Persistence).
- **Cleanup**: How do we handle orphaned payloads in SQL databases that don't support native TTL? SQL-based adapters will provide a `cleanup()` method that removes expired records, which users can call from a background task or cron job.
- **Payload Size**: Adapters SHOULD validate payload size against provider limits (e.g., 400KB for DynamoDB) and throw a descriptive error if exceeded.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `SagaStoreAdapter` implementation for: `redis-ioredis`, `postgres-prisma`, `postgres-drizzle`, `sqlite-better-sqlite3`, `dynamodb-aws-sdk`, and `mongodb`.
- **FR-002**: Adapters MUST reuse the existing connection/client provided to the Outbox adapter.
- **FR-003**: SQL-based adapters MUST support storing payloads within the same transaction as the outbox event.
- **FR-004**: Redis and DynamoDB adapters MUST support TTL (Time-To-Live) to automatically expire old payloads.
- **FR-005**: Adapters MUST provide a way to initialize the necessary storage structures (e.g., creating the `saga_store` table or indexes).

### Non-Functional Requirements (Constitution Alignment)

- **NFR-001 (Observability)**: Adapters MUST log storage operations (put/get) and any failures with the `routingSlipId` context.
- **NFR-002 (Performance)**: Adapters MUST use binary storage (Buffer/Uint8Array) for the payload to avoid Base64 serialization overhead.
- **NFR-003 (Reliability)**: SQL adapters MUST participate in the active transaction if one is present in the `AsyncLocalStorage`.

## Success Criteria

1. **100% Interface Compliance**: All adapters correctly implement the `SagaStoreAdapter` interface.
2. **Zero Connection Leak**: No new connections are opened; all adapters share the existing client.
3. **Transactional Integrity**: In SQL adapters, the `put` operation is atomic with the outbox event emission when using the provided transaction utilities.
4. **Automated Cleanup**: Redis, MongoDB, and DynamoDB payloads are automatically removed after the saga's `expiresAt` time.

## Key Entities

- **SagaStoreEntry**: The record stored in the database/store.
  - `id`: Unique identifier (Claim ID).
  - `data`: The serialized/compressed payload (Buffer/Blob).
  - `expiresAt`: When the record should be considered stale.

## Assumptions

- Users will use the same storage provider for both the Outbox and the Saga Claim Check.
- For SQL databases, users are willing to run a migration to create the `saga_store` table.
