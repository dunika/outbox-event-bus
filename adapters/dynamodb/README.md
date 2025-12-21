# DynamoDB Outbox

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/dynamodb-outbox?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/dynamodb-outbox?style=flat-square&color=2563eb)

> **Serverless-Ready Event Storage**

AWS DynamoDB adapter for [outbox-event-bus](../../README.md). Provides reliable event storage using DynamoDB with a Global Secondary Index for efficient status-based queries.

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBOutbox } from '@outbox-event-bus/dynamodb-outbox';

const outbox = new DynamoDBOutbox({
  client: new DynamoDBClient({}),
  tableName: 'events-outbox',
  statusIndexName: 'status-gsiSortKey-index',
  onError: (error) => console.error(error)
});
```

## When to Use

**Choose DynamoDB Outbox when:**
- You are running on **AWS Lambda** or serverless infrastructure.
- You need **auto-scaling** throughput without managing instances.
- You want **managed high availability** across availability zones.
- You have **unpredictable traffic patterns**.
- You want to **avoid database connection limits**.

**Consider alternatives when:**
- You need **complex ad-hoc queries** on event payloads (use MongoDB/PostgreSQL instead).
- You want **lower latency** at lower cost for constant high loads (use Redis instead).
- You are not using AWS (use PostgreSQL/MongoDB instead).

## Installation

```bash
npm install @outbox-event-bus/dynamodb-outbox
```

## Table Schema

Create a DynamoDB table with the following schema:

### Primary Key
- **Partition Key**: `id` (String)

### Global Secondary Index (GSI)
- **Index Name**: `status-gsiSortKey-index` (configurable)
- **Partition Key**: `status` (String)
- **Sort Key**: `gsiSortKey` (Number)

### Attributes
| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | String | Unique event identifier |
| `type` | String | Event type (e.g., 'user.created') |
| `payload` | Map | Event payload data |
| `occurredAt` | String | ISO 8601 timestamp |
| `status` | String | PENDING, PROCESSING, COMPLETED, or FAILED |
| `retryCount` | Number | Number of retry attempts |
| `gsiSortKey` | Number | Unix timestamp for GSI sorting |

## Configuration

### DynamoDBOutboxConfig

```typescript
interface DynamoDBOutboxConfig {
  client: DynamoDBClient;           // AWS SDK v3 DynamoDB client
  tableName: string;                // DynamoDB table name
  statusIndexName: string;          // GSI name for status queries
  batchSize?: number;               // Events per poll (default: 10)
  pollIntervalMs?: number;          // Polling interval (default: 1000ms)
  processingTimeoutMs?: number;     // Processing timeout (default: 30000ms)
  maxErrorBackoffMs?: number;       // Max polling error backoff (default: 30000ms)
  maxRetries?: number;              // Max retry attempts (default: 5)
  baseBackoffMs?: number;           // Base retry backoff (default: 1000ms)
  onError: (error: unknown) => void; // Error handler
}
```

## Usage

### Basic Setup

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBOutbox } from '@outbox-event-bus/dynamodb-outbox';
import { OutboxEventBus } from 'outbox-event-bus';

const outbox = new DynamoDBOutbox({
  client: new DynamoDBClient({ region: 'us-east-1' }),
  tableName: 'events-outbox',
  statusIndexName: 'status-gsiSortKey-index',
  onError: (error) => console.error('Outbox error:', error)
});

const bus = new OutboxEventBus(
  outbox,
  (bus, eventType, count) => console.warn(`Max listeners: ${eventType}`),
  (error) => console.error('Bus error:', error)
);

bus.start();
```

### With LocalStack

```typescript
const outbox = new DynamoDBOutbox({
  client: new DynamoDBClient({
    endpoint: 'http://localhost:4566',
    region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
  }),
  tableName: 'events-outbox',
  statusIndexName: 'status-gsiSortKey-index',
  onError: console.error
});
```

## Features

- **Optimistic Locking**: Uses DynamoDB conditional writes to ensure only one worker claims each event (`ConditionExpression: "#status = :pending"`).
- **Stuck Event Recovery**: Automatically detects events in `PROCESSING` state that have exceeded `processingTimeoutMs` and resets them to `PENDING`.
- **Exponential Backoff**: Retries failed events with increasing delays (1s, 2s, 4s, etc.).
- **Batch Processing**: Groups updates into `BatchWriteItem` requests for efficiency.

## Troubleshooting

### `ProvisionedThroughputExceededException`
- **Cause**: Polling or writing too fast for your WCU/RCU settings.
- **Solution**: Switch to `PAY_PER_REQUEST` billing or increase capacity.

### `ConditionalCheckFailedException`
- **Cause**: Another worker picked up the event.
- **Solution**: Safe to ignore. The library handles this automatically.

### Events not processing
- **Cause**: GSI misconfiguration.
- **Solution**: Ensure `statusIndexName` matches your actual GSI name and that the GSI is `ACTIVE`.
- **Cause**: Permissions.
- **Solution**: Ensure your IAM role has `Query` permissions on the *index* ARN, not just the table ARN.
