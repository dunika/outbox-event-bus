# SQS Publisher

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/sqs-publisher?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/sqs-publisher?style=flat-square&color=2563eb)

> **Reliable Point-to-Point Event Delivery**

AWS SQS publisher for [outbox-event-bus](../../README.md). Forwards events to SQS queues for reliable, asynchronous processing by backend workers.

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
  sqsClient: SQSClient;   // AWS SDK v3 SQS client
  queueUrl: string;       // Target SQS Queue URL
  onError?: ErrorHandler; // Error callback
}
```

## Usage

### Basic Setup

```typescript
import { SQSClient } from '@aws-sdk/client-sqs';
import { SQSPublisher } from '@outbox-event-bus/sqs-publisher';

const publisher = new SQSPublisher(bus, {
  sqsClient: new SQSClient({ region: 'us-east-1' }),
  queueUrl: process.env.QUEUE_URL!,
  onError: (err) => console.error('SQS Publish Error:', err)
});

publisher.subscribe(['*']);
```

### FIFO Queues
The publisher supports FIFO queues. It uses the `event.id` as the **Deduplication ID** and the `event.type` as the **Message Group ID** to ensure ordered processing within event types.

## Message Format

Messages are published to SQS with:
- **Body**: `JSON.stringify(event)`
- **MessageAttributes**:
    - `EventType`: Set to the event type string.

## Error Handling

### SDK Retries
The AWS SDK handles transient errors automatically.

### `onError`
Permanent errors are passed to this handler.

## Troubleshooting

### Messages stuck in DLQ
- **Cause**: Consumer failing. Check your worker logs.
- **Cause**: Payload too large (> 256KB). Reduce payload size or store in S3.

### Permissions
- **Cause**: Ensure the IAM role has `sqs:SendMessage` on the specific queue resource.
