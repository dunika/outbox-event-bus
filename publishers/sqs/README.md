# SQS Publisher

AWS SQS publisher for [outbox-event-bus](../../README.md). Forwards events from the outbox to AWS SQS queues.

```typescript
import { SQSClient } from '@aws-sdk/client-sqs';
import { SQSPublisher } from '@outbox-event-bus/sqs-publisher';

const publisher = new SQSPublisher(bus, {
  sqsClient: new SQSClient({}),
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue'
});

publisher.subscribe(['user.created', 'order.placed']);
```

- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Back to Main Documentation](../../README.md)

## Installation

```bash
npm install @outbox-event-bus/sqs-publisher
```

## Configuration

### SQSPublisherConfig

```typescript
interface SQSPublisherConfig {
  sqsClient: SQSClient;      // AWS SDK v3 SQS client
  queueUrl: string;          // SQS queue URL
  onError?: ErrorHandler;    // Error handler (optional)
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
  onError: (error) => console.error('SQS error:', error)
});

publisher.subscribe(['user.created', 'order.placed']);
```

### Message Format

Messages are sent with:
- **MessageBody**: Full event object as JSON
- **MessageAttributes**: `EventType` attribute with the event type

## Back to Main Documentation

[← Back to outbox-event-bus](../../README.md)
