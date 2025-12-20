# DynamoDB Outbox

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

This adapter uses DynamoDB's conditional writes for optimistic locking, ensuring only one worker processes each event in distributed environments.

- [Installation](#installation)
- [Table Schema](#table-schema)
- [Configuration](#configuration)
- [Usage](#usage)
- [Features](#features)
- [Back to Main Documentation](../../README.md)

## Installation

```bash
npm install @outbox-event-bus/dynamodb-outbox
```

## Table Schema

Create a DynamoDB table with the following schema:

### Primary Key

- **Partition Key**: `id` (String) - Unique event ID

### Global Secondary Index

- **Index Name**: `status-gsiSortKey-index` (or your chosen name)
- **Partition Key**: `status` (String) - Event status (PENDING, PROCESSING, COMPLETED, FAILED)
- **Sort Key**: `gsiSortKey` (Number) - Timestamp for ordering and scheduling

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
| `startedOn` | Number | Processing start timestamp (optional) |
| `completedOn` | Number | Completion timestamp (optional) |
| `lastError` | String | Last error message (optional) |

### CloudFormation Example

```yaml
EventsOutboxTable:
  Type: AWS::DynamoDB::Table
  Properties:
    TableName: events-outbox
    BillingMode: PAY_PER_REQUEST
    AttributeDefinitions:
      - AttributeName: id
        AttributeType: S
      - AttributeName: status
        AttributeType: S
      - AttributeName: gsiSortKey
        AttributeType: N
    KeySchema:
      - AttributeName: id
        KeyType: HASH
    GlobalSecondaryIndexes:
      - IndexName: status-gsiSortKey-index
        KeySchema:
          - AttributeName: status
            KeyType: HASH
          - AttributeName: gsiSortKey
            KeyType: RANGE
        Projection:
          ProjectionType: ALL
```

### Terraform Example

```hcl
resource "aws_dynamodb_table" "events_outbox" {
  name           = "events-outbox"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "gsiSortKey"
    type = "N"
  }

  global_secondary_index {
    name            = "status-gsiSortKey-index"
    hash_key        = "status"
    range_key       = "gsiSortKey"
    projection_type = "ALL"
  }
}
```

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
  maxRetries?: number;              // Max retry attempts (default: 5)
  baseBackoffMs?: number;           // Base retry backoff (default: 1000ms)
  onError: (error: unknown) => void; // Error handler
}
```

### Configuration Options

**client** (required)
- AWS SDK v3 DynamoDB client instance
- Configure region, credentials, and other AWS settings here

**tableName** (required)
- Name of your DynamoDB table
- Must match the table created with the schema above

**statusIndexName** (required)
- Name of the Global Secondary Index
- Used for querying events by status

**batchSize** (optional, default: 10)
- Number of events to process per polling cycle
- Higher values improve throughput but increase processing time
- DynamoDB query limit applies

**pollIntervalMs** (optional, default: 1000)
- Milliseconds between polling cycles
- Lower values reduce latency but increase DynamoDB read costs
- Exponential backoff applied on errors

**processingTimeoutMs** (optional, default: 30000)
- Milliseconds before a PROCESSING event is considered stuck
- Stuck events are automatically recovered and retried
- Should be longer than your longest event handler

**maxRetries** (optional, default: 5)
- Maximum retry attempts before marking event as FAILED
- Retries use exponential backoff based on `baseBackoffMs`

**baseBackoffMs** (optional, default: 1000)
- Base delay for exponential backoff on retries
- Actual delay: `baseBackoffMs * 2^(retryCount - 1)`
- Example: 1000ms, 2000ms, 4000ms, 8000ms, 16000ms

**onError** (required)
- Callback for handling errors during polling and processing
- Does not include event handler errors (those trigger retries)

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

bus.on('user.created', async (event) => {
  console.log('User created:', event.payload);
});

bus.start();
```

### Custom Configuration

```typescript
const outbox = new DynamoDBOutbox({
  client: new DynamoDBClient({
    region: 'us-west-2',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
    }
  }),
  tableName: 'my-events',
  statusIndexName: 'status-timestamp-index',
  batchSize: 25,                  // Process more events per cycle
  pollIntervalMs: 500,            // Poll more frequently
  processingTimeoutMs: 60000,     // 1 minute timeout
  maxRetries: 10,                 // More retry attempts
  baseBackoffMs: 2000,            // Longer base backoff
  onError: (error) => {
    console.error('DynamoDB outbox error:', error);
    // Send to monitoring service
  }
});
```

### With LocalStack (Development)

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const outbox = new DynamoDBOutbox({
  client: new DynamoDBClient({
    endpoint: 'http://localhost:4566',
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test'
    }
  }),
  tableName: 'events-outbox',
  statusIndexName: 'status-gsiSortKey-index',
  onError: console.error
});
```

## Features

### Optimistic Locking

Uses DynamoDB conditional writes to ensure only one worker claims each event:

```typescript
// Claim event for processing
UpdateExpression: "SET #status = :processing",
ConditionExpression: "#status = :pending"
```

If the condition fails, another worker already claimed the event.

### Stuck Event Recovery

Automatically recovers events stuck in PROCESSING state:

1. Query GSI for PROCESSING events with `gsiSortKey <= now`
2. Reset status to PENDING for retry
3. Runs on every polling cycle

### Exponential Backoff Retry

Failed events are retried with exponential backoff:

- Retry 1: `baseBackoffMs * 2^0` = 1000ms
- Retry 2: `baseBackoffMs * 2^1` = 2000ms
- Retry 3: `baseBackoffMs * 2^2` = 4000ms
- Retry 4: `baseBackoffMs * 2^3` = 8000ms
- Retry 5: `baseBackoffMs * 2^4` = 16000ms

After `maxRetries`, events are marked as FAILED.

### Batch Publishing

Automatically chunks events into batches of 25 (DynamoDB limit):

```typescript
await bus.emitMany([...100Events]); // Sent in 4 batches
```

### Error Handling

Polling errors trigger exponential backoff to prevent overwhelming DynamoDB:

```typescript
const backoff = Math.min(
  pollIntervalMs * 2^errorCount,
  30000 // Max 30 seconds
);
```

### Horizontal Scaling

Multiple workers can safely poll the same table:
- Conditional writes prevent duplicate processing
- Each worker claims events independently
- No coordination required

## Back to Main Documentation

[← Back to outbox-event-bus](../../README.md)
