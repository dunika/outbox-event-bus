import type { IOutboxEventBus } from "../types/interfaces"
import type { BusEvent, ProcessingOptions, PublisherConfig, RetryOptions } from "../types/types"
import { Batcher } from "../utils/batcher"
import { promiseMap } from "../utils/promise-utils"
import { withRetry } from "../utils/retry"

export class EventPublisher<TTransaction> {
  static readonly DEFAULT_BUFFER_SIZE = 50
  static readonly DEFAULT_BUFFER_TIMEOUT_MS = 100
  static readonly DEFAULT_CONCURRENCY = 5
  static readonly DEFAULT_RETRY_ATTEMPTS = 3
  static readonly DEFAULT_RETRY_DELAY_MS = 1000
  static readonly DEFAULT_RETRY_MAX_DELAY_MS = 10000

  private readonly retryOptions: Required<RetryOptions>

  constructor(
    private readonly bus: IOutboxEventBus<TTransaction>,
    private readonly config?: PublisherConfig
  ) {
    const { retryConfig } = config ?? {}
    this.retryOptions = {
      maxAttempts: retryConfig?.maxAttempts ?? EventPublisher.DEFAULT_RETRY_ATTEMPTS,
      initialDelayMs: retryConfig?.initialDelayMs ?? EventPublisher.DEFAULT_RETRY_DELAY_MS,
      maxDelayMs: retryConfig?.maxDelayMs ?? EventPublisher.DEFAULT_RETRY_MAX_DELAY_MS,
    }
  }

  static withOverrides(
    config: PublisherConfig,
    processingOverrides: Partial<ProcessingOptions>
  ): PublisherConfig {
    return {
      ...config,
      processingConfig: {
        ...config.processingConfig,
        ...processingOverrides,
      },
    }
  }

  subscribe(eventTypes: string[], handler: (events: BusEvent[]) => Promise<void>): void {
    const processingConfig = this.config?.processingConfig
    const batcher = new Batcher<BusEvent>({
      batchSize: processingConfig?.bufferSize ?? EventPublisher.DEFAULT_BUFFER_SIZE,
      batchTimeoutMs: processingConfig?.bufferTimeoutMs ?? EventPublisher.DEFAULT_BUFFER_TIMEOUT_MS,
      processBatch: (events) => this.handleBatch(events, handler),
    })

    this.bus.subscribe(eventTypes, (event) => batcher.add(event))
  }

  private async handleBatch(
    events: BusEvent[],
    handler: (events: BusEvent[]) => Promise<void>
  ): Promise<void> {
    const { maxBatchSize, concurrency = EventPublisher.DEFAULT_CONCURRENCY } =
      this.config?.processingConfig ?? {}

    if (!maxBatchSize || events.length <= maxBatchSize) {
      return withRetry(() => handler(events), this.retryOptions)
    }

    const chunks: BusEvent[][] = []
    for (let offset = 0; offset < events.length; offset += maxBatchSize) {
      chunks.push(events.slice(offset, offset + maxBatchSize))
    }

    await promiseMap(
      chunks,
      (chunk) => withRetry(() => handler(chunk), this.retryOptions),
      concurrency
    )
  }
}
