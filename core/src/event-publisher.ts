import type { BusEvent, RetryOptions } from "./types"
import type { IOutboxEventBus } from "./interfaces"
import { withRetry } from "./retry"

export class EventPublisher {
  private readonly retryOptions: Required<RetryOptions>

  constructor(
    private readonly bus: IOutboxEventBus,
    retryOptions?: RetryOptions
  ) {
    this.retryOptions = {
      maxAttempts: retryOptions?.maxAttempts ?? 3,
      initialDelayMs: retryOptions?.initialDelayMs ?? 1000,
      maxDelayMs: retryOptions?.maxDelayMs ?? 10000,
    }
  }

  subscribe(
    eventTypes: string[],
    handler: (event: BusEvent) => Promise<void>
  ): void {
    this.bus.subscribe(eventTypes, async (event: BusEvent) => {
      await withRetry(async () => {
        await handler(event)
      }, this.retryOptions)
    })
  }
}
