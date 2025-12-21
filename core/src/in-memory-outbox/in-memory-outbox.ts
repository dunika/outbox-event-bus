import type { IOutbox } from "../interfaces"
import { PollingService } from "../polling-service"
import type { OutboxEvent } from "../types"


export class InMemoryOutbox implements IOutbox<unknown> {
  private events: OutboxEvent[] = []
  private readonly poller: PollingService
  private handler: ((events: OutboxEvent[]) => Promise<void>) | null = null
  public onError?: (error: unknown) => void

  constructor() {
    this.poller = new PollingService({
      pollIntervalMs: 10,
      baseBackoffMs: 10,
      maxErrorBackoffMs: 50,
      processBatch: (handler) => this.processBatch(handler),
    })
  }

  async publish(events: OutboxEvent[]): Promise<void> {
    this.events.push(...events)
  }

  start(
    handler: (events: OutboxEvent[]) => Promise<void>,
    onError: (error: unknown) => void
  ): void {
    this.handler = handler
    this.onError = onError
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
    // Drain remaining events
    while (this.events.length > 0 && this.handler) {
      await this.processBatch(this.handler)
    }
    this.handler = null
  }

  private async processBatch(handler: (events: OutboxEvent[]) => Promise<void>) {
    if (this.events.length === 0) return

    const batch = [...this.events]
    this.events = []

    try {
      await handler(batch)
    } catch (error) {
      // Do not call onError here, PollingService will handle it
      // this.onError?.(error)
      // For in-memory, we just put them back to try again
      // In a real DB adapter, we would update status/retry count
      this.events.unshift(...batch)
      throw error // Re-throw to let PollingService handle backoff
    }
  }
}
