import type { IOutbox } from "../types/interfaces"
import { PollingService } from "../services/polling-service"
import type { BusEvent, FailedBusEvent, ErrorHandler } from "../types/types"
import { reportEventError } from "../utils/error-reporting"

const IN_MEMORY_POLL_INTERVAL_MS = 10
const IN_MEMORY_BASE_BACKOFF_MS = 10
const IN_MEMORY_MAX_ERROR_BACKOFF_MS = 50
const IN_MEMORY_DEFAULT_MAX_RETRIES = 3

export interface InMemoryOutboxConfig {
  maxRetries?: number
}

export class InMemoryOutbox implements IOutbox<unknown> {
  private events: BusEvent[] = []
  private deadLetterQueue: BusEvent[] = []
  private readonly poller: PollingService
  private handler: ((event: BusEvent) => Promise<void>) | null = null
  public onError?: ErrorHandler
  private readonly maxRetries?: number
  private retryCounts = new Map<string, number>()

  constructor(config: InMemoryOutboxConfig = {}) {
    this.maxRetries = config.maxRetries ?? IN_MEMORY_DEFAULT_MAX_RETRIES
    this.poller = new PollingService({
      pollIntervalMs: IN_MEMORY_POLL_INTERVAL_MS,
      baseBackoffMs: IN_MEMORY_BASE_BACKOFF_MS,
      maxErrorBackoffMs: IN_MEMORY_MAX_ERROR_BACKOFF_MS,
      processBatch: (handler: (event: BusEvent) => Promise<void>) => this.processBatch(handler),
    })
  }

  async publish(events: BusEvent[]): Promise<void> {
    this.events.push(...events)
  }

  start(
    handler: (event: BusEvent) => Promise<void>,
    onError: ErrorHandler
  ): void {
    this.handler = handler
    this.onError = onError
    void this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
    // Drain remaining events
    while (this.events.length > 0 && this.handler) {
      await this.processBatch(this.handler)
    }
    this.handler = null
  }

  async getFailedEvents(): Promise<FailedBusEvent[]> {
    return this.deadLetterQueue.map((event): FailedBusEvent => ({
      ...event,
      retryCount: this.retryCounts.get(event.id ?? '') ?? this.maxRetries ?? 0,
      error: 'Max retries exceeded'
    }))
  }

  async retryEvents(eventIds: string[]): Promise<void> {
    const eventsToRetry = this.deadLetterQueue.filter(event => eventIds.includes(event.id ?? ''))
    this.deadLetterQueue = this.deadLetterQueue.filter(event => !eventIds.includes(event.id ?? ''))
    
    for (const event of eventsToRetry) {
      if (event.id) {
        this.retryCounts.set(event.id, 0)
      }
      this.events.push(event)
    }
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
      } catch (error: unknown) {
        let shouldRetry = true
        if (this.maxRetries !== undefined && event.id) {
          const currentRetries = this.retryCounts.get(event.id) ?? 0
          const nextRetryCount = currentRetries + 1

          reportEventError(this.onError, error, event, nextRetryCount, this.maxRetries)

          if (nextRetryCount > this.maxRetries) {
            shouldRetry = false

            this.retryCounts.delete(event.id)
            this.deadLetterQueue.push(event)
          } else {
            this.retryCounts.set(event.id, nextRetryCount)
          }
        } else {
          if (this.onError) {
            this.onError(error, event)
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
