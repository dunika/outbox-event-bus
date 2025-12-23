<!--
SYNC IMPACT REPORT
Version change: 1.2.0 -> 1.3.0
Modified principles:
- Added Principle VIII: Performance & Scalability.
- Refined Principle VII: Observability & Error Handling (added explicit mention of retry strategies).
Added sections:
- Future Directions (Transports rename).
Removed sections:
- None
Templates requiring updates:
- .specify/templates/spec-template.md (✅ updated)
- .specify/templates/plan-template.md (✅ updated)
- .specify/templates/tasks-template.md (✅ updated)
-->

# outbox-event-bus Constitution

## Core Principles

### I. Atomic Persistence

Events MUST be persisted within the same transaction as the business data. This is the non-negotiable core of the "Outbox" pattern. No event shall be emitted if the transaction fails, and no transaction shall commit if the event persistence fails. The system must guarantee at-least-once delivery.

### II. Storage Agnosticism

The core logic MUST remain storage-agnostic. All database-specific logic MUST be encapsulated in adapters. Adapters MUST adhere to the strict interface defined by the core and pass the standard compliance test suite. Users must be able to swap adapters without changing application logic.

### III. Type Safety (TypeScript First)

The codebase MUST be written in TypeScript. `any` is strictly forbidden. Generics MUST be used to propagate types from the application to the event bus and back. Typed errors MUST be used for control flow to ensure precise failure handling. The `core` package SHOULD have zero external runtime dependencies to ensure maximum portability and security.

### IV. Comprehensive Testing

Testing is mandatory. Unit tests are required for core logic. Integration tests are required for every adapter against real databases (using Docker/Testcontainers). End-to-end tests must verify the full flow. Reliability under failure scenarios (network partitions, crashes) MUST be verified.

### V. Developer Experience

The API MUST be simple to setup and use. Defaults should be sensible ("Convention over Configuration"). Error messages MUST be clear, actionable, and typed. Middleware should be used for cross-cutting concerns like logging and observability.

### VI. 1:1 Command Bus Pattern

The `OutboxEventBus` MUST follow a 1:1 Command Bus pattern where each event type has exactly one handler. This ensures predictable side-effects and simplifies retry logic. Fan-out MUST be handled explicitly by the user (e.g., by emitting new events or using publishers).

### VII. Observability & Error Handling

The system MUST provide clear visibility into the event lifecycle. All failures MUST be logged with sufficient context (event ID, type, error stack). Dead Letter Queues (DLQ) or equivalent mechanisms MUST be supported for events that exceed retry limits. Retry strategies (exponential backoff) MUST be configurable and predictable.

### VIII. Performance & Scalability

The system MUST be designed for high throughput. Polling intervals, batch sizes, and concurrency limits MUST be configurable. Adapters SHOULD use efficient database queries (e.g., indexed lookups, batch updates). The core SHOULD minimize overhead during event emission and processing.

## Architecture & Standards

- **Monorepo Structure**: The project follows a monorepo structure with `core` (business logic), `adapters` (storage implementations), and `publishers` (message broker integrations).
- **Dependency Management**: Dependencies must be minimized. `core` MUST have zero runtime dependencies.
- **Tooling**: [Biome](https://biomejs.dev/) is used for linting and formatting. All code MUST pass Biome checks.
- **Semantic Versioning**: All packages must follow semantic versioning. Breaking changes must be strictly managed and documented.

## Contribution & Workflow

- **Conventional Commits**: All commits must follow the Conventional Commits specification to enable automated versioning and changelog generation.
- **Changesets**: Use `changeset` for versioning and changelog generation. Every PR that affects release artifacts must include a changeset.
- **Documentation**: All features must include documentation updates in `README.md` and `docs/`. Code must be self-documenting where possible, with comments explaining "why" not "what".

## Future Directions

- **Transports Rename**: The `publishers` directory and related interfaces are planned to be renamed to `transports` to better reflect their role as event carriers.

## Governance

This Constitution supersedes all other practices. Amendments require documentation, approval by maintainers, and a migration plan.

- **Compliance**: All PRs must be reviewed against these principles.
- **New Adapters**: New adapters must pass the full compliance test suite before acceptance.
- **RFC Process**: Significant changes to the `core` package require a Request for Comments (RFC) or Design Document.

**Version**: 1.3.0 | **Ratified**: 2025-12-23 | **Last Amended**: 2025-12-23
