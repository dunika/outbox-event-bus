import type { IOutboxEventBus } from "../types/interfaces"
import type { BusEvent, PublisherConfig, RetryOptions } from "../types/types"
import { Batcher } from "../utils/batcher"
import { withRetry } from "../utils/retry"

export class EventPublisher<TTransaction> {
  private readonly retryOptions: Required<RetryOptions>

  constructor(
    private readonly bus: IOutboxEventBus<TTransaction>,
    private readonly config?: PublisherConfig
  ) {
    this.retryOptions = {
      maxAttempts: config?.retryConfig?.maxAttempts ?? 3,
      initialDelayMs: config?.retryConfig?.initialDelayMs ?? 1000,
      maxDelayMs: config?.retryConfig?.maxDelayMs ?? 10000,
    }
  }

  subscribe(eventTypes: string[], handler: (events: BusEvent[]) => Promise<void>): void {
    const batcher = new Batcher<BusEvent>({
      batchSize: this.config?.batchConfig?.batchSize ?? 100,
      batchTimeoutMs: this.config?.batchConfig?.batchTimeoutMs ?? 100,
      processBatch: async (events) => {
        await withRetry(async () => {
          await handler(events)
        }, this.retryOptions)
      },
    })

    this.bus.subscribe(eventTypes, async (event: BusEvent) => {
      await batcher.add(event)
    })
  }
}
