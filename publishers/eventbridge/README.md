# EventBridge Publisher

AWS EventBridge publisher for [outbox-event-bus](../../README.md). Forwards events from the outbox to AWS EventBridge event buses.

```typescript
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { EventBridgePublisher } from '@outbox-event-bus/eventbridge-publisher';

const publisher = new EventBridgePublisher(bus, {
  eventBridgeClient: new EventBridgeClient({}),
  source: 'my-app',
  eventBusName: 'my-event-bus' // optional, uses default if omitted
});

publisher.subscribe(['user.created', 'order.placed']);
```

- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Back to Main Documentation](../../README.md)

## Installation

```bash
npm install @outbox-event-bus/eventbridge-publisher
```

## Configuration

### EventBridgePublisherConfig

```typescript
interface EventBridgePublisherConfig {
  eventBridgeClient: EventBridgeClient; // AWS SDK v3 EventBridge client
  eventBusName?: string;                // Event bus name (optional, uses default)
  source: string;                       // Event source identifier
  onError?: ErrorHandler;               // Error handler (optional)
}
```

## Usage

### Basic Setup

```typescript
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { EventBridgePublisher } from '@outbox-event-bus/eventbridge-publisher';
import { OutboxEventBus } from 'outbox-event-bus';

const publisher = new EventBridgePublisher(bus, {
  eventBridgeClient: new EventBridgeClient({ region: 'us-east-1' }),
  source: 'my-application',
  onError: (error) => console.error('EventBridge error:', error)
});

// Subscribe to specific event types
publisher.subscribe(['user.created', 'user.updated', 'user.deleted']);
```

### Custom Event Bus

```typescript
const publisher = new EventBridgePublisher(bus, {
  eventBridgeClient: new EventBridgeClient({ region: 'us-east-1' }),
  eventBusName: 'custom-event-bus',
  source: 'my-application'
});

publisher.subscribe(['order.placed']);
```

### Event Format

Events are published to EventBridge with:
- **Source**: Configured source string
- **DetailType**: Event type from the bus event
- **Detail**: Full event object as JSON
- **Time**: Event occurred timestamp

## Back to Main Documentation

[← Back to outbox-event-bus](../../README.md)
