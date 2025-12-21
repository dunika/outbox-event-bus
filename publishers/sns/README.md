# SNS Publisher

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/sns-publisher?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/sns-publisher?style=flat-square&color=2563eb)

> **Serverless Pub/Sub to Thousands of Subscribers**

AWS SNS publisher for [outbox-event-bus](../../README.md). Provides high-fanout event delivery to SQS, Email, HTTP endpoints, and more.

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
  snsClient: SNSClient;   // AWS SDK v3 SNS client
  topicArn: string;       // AWS Topic ARN
  retryOptions?: RetryOptions; // Application-level retry logic
}
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
- **Message**: `JSON.stringify(event)`
- **MessageAttributes**:
    - `EventType`: Set to the event type (string) for convenient server-side filtering.

## Error Handling

### SDK Retries
The AWS SDK handles transient errors automatically.

### Application-Level Retries
Configure application-level retries for extra resiliency:
```typescript
const publisher = new SNSPublisher(bus, {
  // ...
  retryOptions: {
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
