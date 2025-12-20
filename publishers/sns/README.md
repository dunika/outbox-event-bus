# SNS Publisher

AWS SNS publisher for [outbox-event-bus](../../README.md). Forwards events from the outbox to AWS SNS topics.

```typescript
import { SNSClient } from '@aws-sdk/client-sns';
import { SNSPublisher } from '@outbox-event-bus/sns-publisher';

const publisher = new SNSPublisher(bus, {
  snsClient: new SNSClient({}),
  topicArn: 'arn:aws:sns:us-east-1:123456789:my-topic'
});

publisher.subscribe(['user.created', 'order.placed']);
```

- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Back to Main Documentation](../../README.md)

## Installation

```bash
npm install @outbox-event-bus/sns-publisher
```

## Configuration

### SNSPublisherConfig

```typescript
interface SNSPublisherConfig {
  snsClient: SNSClient;      // AWS SDK v3 SNS client
  topicArn: string;          // SNS topic ARN
  onError?: ErrorHandler;    // Error handler (optional)
}
```

## Usage

### Basic Setup

```typescript
import { SNSClient } from '@aws-sdk/client-sns';
import { SNSPublisher } from '@outbox-event-bus/sns-publisher';

const publisher = new SNSPublisher(bus, {
  snsClient: new SNSClient({ region: 'us-east-1' }),
  topicArn: process.env.SNS_TOPIC_ARN!,
  onError: (error) => console.error('SNS error:', error)
});

publisher.subscribe(['user.created', 'order.placed']);
```

### Message Format

Messages are published with:
- **Message**: Full event object as JSON
- **MessageAttributes**: `EventType` attribute with the event type

## Back to Main Documentation

[← Back to outbox-event-bus](../../README.md)
