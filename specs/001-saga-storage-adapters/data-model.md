# Data Model: Saga Storage

## SQL Schema (Postgres/SQLite)

Table Name: `saga_store`

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `VARCHAR(255)` | Primary Key. The Claim ID (e.g., `slip-UUID-timestamp`). |
| `data` | `BYTEA` / `BLOB` | The serialized and potentially compressed routing slip. |
| `expires_at` | `TIMESTAMP` | When the record can be safely deleted. |

## MongoDB Schema

Collection Name: `saga_store`

```json
{
  "_id": "string",
  "data": "BinData",
  "expiresAt": "Date"
}
```

*Index: `{ "expiresAt": 1 }, { expireAfterSeconds: 0 }`*

## DynamoDB Schema

Table Name: `saga_store` (or shared with Outbox)

| Attribute | Type | Description |
| :--- | :--- | :--- |
| `id` | `S` | Partition Key. |
| `data` | `B` | Binary data. |
| `expiresAt` | `N` | TTL Attribute (Unix timestamp in seconds). |
