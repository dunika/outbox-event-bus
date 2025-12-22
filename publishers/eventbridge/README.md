# EventBridge Publisher

![npm version](https://img.shields.io/npm/v/@outbox-event-bus/eventbridge-publisher?style=flat-square&color=2563eb)
![license](https://img.shields.io/npm/l/@outbox-event-bus/eventbridge-publisher?style=flat-square&color=2563eb)

> **Reliable Event Delivery to AWS EventBridge**

AWS EventBridge publisher for [outbox-event-bus](https://github.com/dunika/outbox-event-bus#readme). Forwards events from the outbox to AWS EventBridge event buses with automatic retries (via SDK) and detailed event mapping.

```typescript
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { EventBridgePublisher } from '@outbox-event-bus/eventbridge-publisher';

const publisher = new EventBridgePublisher(bus, {
  eventBridgeClient: new EventBridgeClient({}),
  source: 'my-app',
  eventBusName: 'my-event-bus' // Optional
});

publisher.subscribe(['user.created', 'order.placed']);
```

## When to Use

**Choose EventBridge Publisher when:**
- You are building **serverless applications** on AWS.
- You need **cross-account** or cross-region event delivery.
- You want to leverage **EventBridge Rules** for complex filtering and routing.
- You are integrating with **third-party SaaS** providers.

**Consider alternatives when:**
- You need **strict ordering** (use SQS FIFO or Kafka).
- You require **extreme throughput** (use Kinesis or Kafka).
- You want **simple queue-based processing** (use SQS).

## Installation

```bash
npm install @outbox-event-bus/eventbridge-publisher
```

## Configuration

### EventBridgePublisherConfig

```typescript
interface EventBridgePublisherConfig {
  eventBridgeClient: EventBridgeClient; // AWS SDK v3 EventBridge client
  source: string;                       // Your application identifier
  eventBusName?: string;                // Target event bus (default: 'default')
  processingConfig?: {
    bufferSize?: number;                // Default: 50
    bufferTimeoutMs?: number;           // Default: 100
    concurrency?: number;               // Default: 5
  };
  retryConfig?: {
    maxAttempts?: number;               // Default: 3
    initialDelayMs?: number;            // Default: 1000
    maxDelayMs?: number;                // Default: 10000
  };
}
```

### Configuration Options

- `eventBridgeClient`: An instance of the AWS SDK `EventBridgeClient`.
- `source`: The source identifier for your events.
- `eventBusName`: (Optional) The name of the event bus. Default: `'default'`.
- `processingConfig`: (Optional) Settings for accumulation and batching.
    - `bufferSize`: Number of events to accumulation in memory before publishing. Default: `50`.
    - `bufferTimeoutMs`: Maximum time to wait for a buffer to fill before flushing. Default: `100ms`.
    - `concurrency`: Maximum number of concurrent batch requests to EventBridge. Default: `5`.
- `retryConfig`: (Optional) Custom retry settings for publishing failures.
    - `maxAttempts`: Maximum number of publication attempts. Default: `3`.
    - `initialDelayMs`: Initial backoff delay in milliseconds. Default: `1000ms`.
    - `maxDelayMs`: Maximum backoff delay in milliseconds. Default: `10000ms`.

> [!NOTE]
> The `maxBatchSize` for EventBridge is fixed at 10, as per AWS limits. If your `bufferSize` exceeds 10, the publisher will automatically split the buffer into multiple EventBridge `PutEvents` requests.

## Batching & Buffering

This publisher has **buffering enabled by default** (50 items or 100ms).

- **Efficient Accumulation**: Events are collected in memory until `bufferSize` is reached or `bufferTimeoutMs` expires.
- **Automatic EventBridge Batching**: The publisher automatically chunks the buffered events into batches of 10 to respect EventBridge `PutEvents` limits.

To disable buffering (process events one by one), set `bufferSize` to `1`:
```typescript
const publisher = new EventBridgePublisher(bus, {
  // ...
  processingConfig: { bufferSize: 1 }
});
```

## Usage

### Basic Setup

```typescript
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { EventBridgePublisher } from '@outbox-event-bus/eventbridge-publisher';

const publisher = new EventBridgePublisher(bus, {
  eventBridgeClient: new EventBridgeClient({ region: 'us-east-1' }),
  source: 'com.mycompany.order-service'
});

publisher.subscribe(['order.*']);
```

## Message Format

Events are mapped to EventBridge `PutEvents` entries as follows:

| EventBridge Field | Source Event Field | Description |
|-------------------|-------------------|-------------|
| **Source** | `config.source` | The configured source string. |
| **DetailType** | `event.type` | The event type (e.g., `user.created`). |
| **Detail** | `JSON.stringify(event)` | The full event object. |
| **Time** | `event.occurredAt` | The timestamp when the event happened. |
| **EventBusName** | `config.eventBusName` | The target bus. |

## Error Handling

### SDK Retries
The AWS SDK handles transient networking and throttling issues. Configure the client for custom behavior:
```typescript
const client = new EventBridgeClient({ maxAttempts: 5 });
```

### Application-Level Retries
In addition to SDK retries, you can configure application-level retries for extra resiliency against permanent or non-retryable errors before they bubble up to the outbox:
```typescript
const publisher = new EventBridgePublisher(bus, {
  // ...
  retryConfig: {
    maxAttempts: 3,
    initialDelayMs: 1000
  }
});



### Error Propagation
Permanent failures (permissions, invalid parameters) will bubble up to the `OutboxEventBus` error handler.

## Troubleshooting

### Events not visible in Target
- **Cause**: IAM permissions. Ensure your role has `events:PutEvents`.
- **Cause**: Rule patterns. Check if your rules filter matches the `Source` and `DetailType` exactly.
- **Cause**: Event Bus mismatch. If using a custom bus, ensure `eventBusName` is specified.

### Throttling
- **Cause**: AWS Quotas. EventBridge has default limits for `PutEvents`.
- **Solution**: Request a quota increase or implement local batching if necessary.

## License

MIT © [Dunika](https://github.com/dunika)
