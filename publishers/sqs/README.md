# SQS Publisher

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/sqs-publisher?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/sqs-publisher?style=flat-square&color=2563eb)

> **Reliable Point-to-Point Event Delivery**

AWS SQS publisher for [outbox-event-bus](https://github.com/dunika/outbox-event-bus#readme). Forwards events to SQS queues for reliable, asynchronous processing by backend workers.

```typescript
import { SQSClient } from '@aws-sdk/client-sqs';
import { SQSPublisher } from '@outbox-event-bus/sqs-publisher';

const publisher = new SQSPublisher(bus, {
  sqsClient: new SQSClient({}),
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/12345/my-queue'
});

publisher.subscribe(['user.created']);
```

## When to Use

**Choose SQS Publisher when:**
- You need a **reliable buffer** between your event bus and worker services.
- You want **managed scalability** with no infrastructure to maintain.
- You require **delayed processing** (via SQS visibility timeouts).
- You need **Dead Letter Queues (DLQ)** for failed message handling.

**Consider alternatives when:**
- You need **pub/sub fan-out** to multiple subscribers (use SNS instead).
- You require **complex event routing** (use EventBridge).
- You need **global ordered logs** (use Kafka).

## Installation

```bash
npm install @outbox-event-bus/sqs-publisher
```

## Configuration

### SQSPublisherConfig

```typescript
interface SQSPublisherConfig {
  sqsClient: SQSClient;           // AWS SDK v3 SQS client
  queueUrl: string;               // Target SQS Queue URL
  processingConfig?: {
    bufferSize?: number;          // Default: 50
    bufferTimeoutMs?: number;     // Default: 100
    concurrency?: number;         // Default: 5
  };
  retryConfig?: {
    maxAttempts?: number;         // Default: 3
    initialDelayMs?: number;      // Default: 1000
    maxDelayMs?: number;          // Default: 10000
  };
}
```

### Configuration Options

- `sqsClient`: An instance of the AWS SDK `SQSClient`.
- `queueUrl`: The URL of the SQS queue.
- `processingConfig`: (Optional) Settings for accumulation and batching.
    - `bufferSize`: Number of events to accumulate in memory before publishing. Default: `50`.
    - `bufferTimeoutMs`: Maximum time to wait for a buffer to fill before flushing. Default: `100ms`.
    - `concurrency`: Maximum number of concurrent batch requests to SQS. Default: `5`.
- `retryConfig`: (Optional) Custom retry settings for publishing failures.
    - `maxAttempts`: Maximum number of publication attempts. Default: `3`.
    - `initialDelayMs`: Initial backoff delay in milliseconds. Default: `1000ms`.
    - `maxDelayMs`: Maximum backoff delay in milliseconds. Default: `10000ms`.

> [!NOTE]
> The `maxBatchSize` for SQS is fixed at 10, as per AWS limits. If your `bufferSize` exceeds 10, the publisher will automatically split the buffer into multiple SQS batch requests. FIFO support is automatically enabled if the `queueUrl` ends in `.fifo`.

## Batching & Buffering

This publisher has **buffering enabled by default** (50 items or 100ms).

- **Efficient Accumulation**: Events are collected in memory until `bufferSize` is reached or `bufferTimeoutMs` expires.
- **Automatic SQS Batching**: The publisher automatically chunks the buffered events into batches of 10 to respect SQS `SendMessageBatch` limits.

To disable buffering (process events one by one), set `bufferSize` to `1`:
```typescript
const publisher = new SQSPublisher(bus, {
  // ...
  processingConfig: { bufferSize: 1 }
});
```

## Usage

### Basic Setup

```typescript
import { SQSClient } from '@aws-sdk/client-sqs';
import { SQSPublisher } from '@outbox-event-bus/sqs-publisher';

const publisher = new SQSPublisher(bus, {
  sqsClient: new SQSClient({ region: 'us-east-1' }),
  queueUrl: process.env.QUEUE_URL!
});

publisher.subscribe(['*']);
```

### FIFO Queues
The publisher supports FIFO queues. It uses the `event.id` as the **Deduplication ID** and the `event.type` as the **Message Group ID** to ensure ordered processing within event types.

## Message Format

Messages are published to SQS with:

| SQS Field | Value | Description |
|-----------|-------|-------------|
| **Body** | `JSON.stringify(event)` | The full event object. |
| **MessageAttributes** | `EventType` | Set to the event type string. |
| **MessageGroupId** | `event.type` | (FIFO only) Ensures ordering within type. |
| **DeduplicationId** | `event.id` | (FIFO only) Prevents duplicates. |

## Error Handling

### SDK Retries
The AWS SDK handles transient errors automatically.

### Application-Level Retries
Configure application-level retries for extra resiliency:
```typescript
const publisher = new SQSPublisher(bus, {
  // ...
  retryConfig: {
    maxAttempts: 3,
    initialDelayMs: 1000
  }
});
```

## Troubleshooting

### Messages stuck in DLQ
- **Cause**: Consumer failing. Check your worker logs.
- **Cause**: Payload too large (> 256KB). Reduce payload size or store in S3.

### Permissions
- **Cause**: Ensure the IAM role has `sqs:SendMessage` on the specific queue resource.

## License

MIT © [Dunika](https://github.com/dunika)
