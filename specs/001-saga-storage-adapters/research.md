# Research: Saga Storage Adapters

## DynamoDB (AWS SDK)

- **Decision**: Use native **TTL** with a `Number` attribute (Unix timestamp in seconds). For payloads exceeding 400KB, the adapter will throw an error or require an S3-based implementation (out of scope for this MVP).
- **Rationale**: DynamoDB's native TTL is cost-effective and automatic. 400KB is extremely large for a routing slip (which is usually < 10KB), so S3 is a future optimization.
- **Alternatives considered**: Item splitting (too complex for atomicity).

## MongoDB

- **Decision**: Use **TTL Indexes** on an `expiresAt` field and **BSON BinData** for binary storage.
- **Rationale**: TTL indexes are efficient and built-in. `BinData` supports up to 16MB, which is more than enough for saga states and more performant than GridFS for this size.
- **Alternatives considered**: GridFS (overkill for < 16MB).

## Prisma & Drizzle (Postgres)

- **Decision**: Use **Transaction Injection** via `AsyncLocalStorage` or direct client passing.
- **Rationale**: Ensures the saga state is saved atomically with business logic by sharing the same transaction client.
- **Alternatives considered**: Two-Phase Commit (too complex).

## SQLite (better-sqlite3)

- **Decision**: **Manual Cleanup** via a `cleanup()` method and shared database handles for transactions.
- **Rationale**: SQLite lacks native TTL. Providing a `cleanup()` method allows users to leverage the existing `PollingService` maintenance cycle.
- **Alternatives considered**: Separate cleanup thread (unnecessary overhead).
