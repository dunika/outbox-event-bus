import type { IOutbox } from "../interfaces"
import { PollingService } from "../polling-service"
import type { BusEvent } from "../types"

const IN_MEMORY_POLL_INTERVAL_MS = 10
const IN_MEMORY_BASE_BACKOFF_MS = 10
const IN_MEMORY_MAX_ERROR_BACKOFF_MS = 50
const IN_MEMORY_DEFAULT_MAX_RETRIES = 3

export interface InMemoryOutboxConfig {
  maxRetries?: number
}

export class InMemoryOutbox implements IOutbox<unknown> {
  private events: BusEvent[] = []
  private readonly poller: PollingService
  private handler: ((event: BusEvent) => Promise<void>) | null = null
  public onError?: (error: unknown) => void
  private readonly maxRetries?: number
  private retryCounts = new Map<string, number>()

  constructor(config: InMemoryOutboxConfig = {}) {
    this.maxRetries = config.maxRetries ?? IN_MEMORY_DEFAULT_MAX_RETRIES
    this.poller = new PollingService({
      pollIntervalMs: IN_MEMORY_POLL_INTERVAL_MS,
      baseBackoffMs: IN_MEMORY_BASE_BACKOFF_MS,
      maxErrorBackoffMs: IN_MEMORY_MAX_ERROR_BACKOFF_MS,
      processBatch: (handler) => this.processBatch(handler),
    })
  }

  async publish(events: BusEvent[]): Promise<void> {
    this.events.push(...events)
  }

  start(
    handler: (event: BusEvent) => Promise<void>,
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

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
    if (this.events.length === 0) return

    const batch = [...this.events]
    this.events = []

    const failedEvents: BusEvent[] = []
    
    for (const event of batch) {
      try {
        await handler(event)
        if (event.id) {
          this.retryCounts.delete(event.id)
        }
      } catch (error) {
        this.onError?.(error)
        
        let shouldRetry = true
        if (this.maxRetries !== undefined && event.id) {
          const currentRetries = this.retryCounts.get(event.id) ?? 0
          if (currentRetries >= this.maxRetries) {
            shouldRetry = false
            this.retryCounts.delete(event.id)
            this.onError?.(new Error(`Max retries exceeded for event ${event.id}`))
          } else {
            this.retryCounts.set(event.id, currentRetries + 1)
          }
        }

        if (shouldRetry) {
          failedEvents.push(event)
        }
      }
    }
    
    // Put failed events back for retry
    if (failedEvents.length > 0) {
      this.events.unshift(...failedEvents)
    }
  }
}
