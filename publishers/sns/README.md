# SNS Publisher

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/sns-publisher?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/sns-publisher?style=flat-square&color=2563eb)

> **Serverless Pub/Sub to Thousands of Subscribers**

AWS SNS publisher for [outbox-event-bus](https://github.com/dunika/outbox-event-bus#readme). Provides high-fanout event delivery to SQS, Email, HTTP endpoints, and more.

```typescript
import { SNSClient } from '@aws-sdk/client-sns';
import { SNSPublisher } from '@outbox-event-bus/sns-publisher';

const publisher = new SNSPublisher(bus, {
  snsClient: new SNSClient({}),
  topicArn: 'arn:aws:sns:us-east-1:123456789:my-topic'
});

publisher.subscribe(['user.created']);
```

## When to Use

**Choose SNS Publisher when:**
- You need to **fan-out** a single event to multiple subscribers.
- You want to trigger **Push Notifications** or **Emails** directly.
- You are using **AWS Lambda** and want to trigger functions via SNS.
- You need a **managed service** with minimal configuration.

**Consider alternatives when:**
- You need **ordered processing** (use SQS FIFO or Kafka).
- You want **complex event pattern matching** (use EventBridge).
- You require **pull-based** consumption (use SQS).

## Installation

```bash
npm install @outbox-event-bus/sns-publisher
```

## Configuration

### SNSPublisherConfig

```typescript
interface SNSPublisherConfig {
  snsClient: SNSClient;           // AWS SDK v3 SNS client
  topicArn: string;               // Target SNS Topic ARN
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

- `snsClient`: An instance of the AWS SDK `SNSClient`.
- `topicArn`: The ARN of the SNS topic.
- `processingConfig`: (Optional) Settings for accumulation and batching.
    - `bufferSize`: Number of events to accumulation in memory before publishing. Default: `50`.
    - `bufferTimeoutMs`: Maximum time to wait for a buffer to fill before flushing. Default: `100ms`.
    - `concurrency`: Maximum number of concurrent batch requests to SNS. Default: `5`.
- `retryConfig`: (Optional) Custom retry settings for publishing failures.
    - `maxAttempts`: Maximum number of publication attempts. Default: `3`.
    - `initialDelayMs`: Initial backoff delay in milliseconds. Default: `1000ms`.
    - `maxDelayMs`: Maximum backoff delay in milliseconds. Default: `10000ms`.

> [!NOTE]
> The `maxBatchSize` for SNS is fixed at 10, as per AWS limits. If your `bufferSize` exceeds 10, the publisher will automatically split the buffer into multiple SNS batch requests.

## Batching & Buffering

This publisher has **buffering enabled by default** (50 items or 100ms).

- **Efficient Accumulation**: Events are collected in memory until `bufferSize` is reached or `bufferTimeoutMs` expires.
- **Automatic SNS Batching**: The publisher automatically chunks the buffered events into batches of 10 to respect SNS `PublishBatch` limits.

To disable buffering (process events one by one), set `bufferSize` to `1`:
```typescript
const publisher = new SNSPublisher(bus, {
  // ...
  processingConfig: { bufferSize: 1 }
});
```

## Usage

### Basic Setup

```typescript
import { SNSClient } from '@aws-sdk/client-sns';
import { SNSPublisher } from '@outbox-event-bus/sns-publisher';

const publisher = new SNSPublisher(bus, {
  snsClient: new SNSClient({ region: 'us-east-1' }),
  topicArn: process.env.SNS_TOPIC_ARN!
});

publisher.subscribe(['order.*']);
```

## Message Format

Messages are published to SNS with:

| SNS Field | Value | Description |
|-----------|-------|-------------|
| **Message** | `JSON.stringify(event)` | The full event object. |
| **MessageAttributes** | `EventType` | Set to the event type (string) for filtering. |

## Error Handling

### SDK Retries
The AWS SDK handles transient errors automatically.

### Application-Level Retries
Configure application-level retries for extra resiliency:
```typescript
const publisher = new SNSPublisher(bus, {
  // ...
  retryConfig: {
    maxAttempts: 3,
    initialDelayMs: 1000
  }
});
```

## Troubleshooting

### Subscribers not receiving events
- **Cause**: SNS Filter Polices. If you set a filter policy on the subscription, ensure it matches the `EventType` attribute sent by this publisher.
- **Cause**: Permissions. Ensure the publisher's IAM role has `sns:Publish` on the topic ARN.

### Throttling
- **Cause**: Exceeding account limits.
- **Solution**: Check your SNS `Publish` quotas in the AWS Service Quotas console.

## License

MIT © [Dunika](https://github.com/dunika)
