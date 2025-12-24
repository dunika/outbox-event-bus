import { reportEventError } from "../../errors/error-reporting"
import { MaxRetriesExceededError } from "../../errors/errors"
import { PollingService } from "../../services/polling-service"
import type { IOutbox } from "../../types/interfaces"
import type { BusEvent, ErrorHandler, FailedBusEvent } from "../../types/types"

const IN_MEMORY_POLL_INTERVAL_MS = 10
const IN_MEMORY_BASE_BACKOFF_MS = 10
const IN_MEMORY_MAX_ERROR_BACKOFF_MS = 50
const IN_MEMORY_DEFAULT_MAX_RETRIES = 3

export type InMemoryOutboxConfig = {
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
      processBatch: (handler) => this.processBatch(handler),
    })
  }

  async publish(events: BusEvent[]): Promise<void> {
    this.events.push(...events)
  }

  start(handler: (event: BusEvent) => Promise<void>, onError: ErrorHandler): void {
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

  async getFailedEvents(): Promise<FailedBusEvent[]> {
    return this.deadLetterQueue.map((event) => ({
      ...event,
      retryCount: this.retryCounts.get(event.id) ?? this.maxRetries ?? 0,
      error: "Max retries exceeded", // capture actual error if possible
    }))
  }

  async retryEvents(eventIds: string[]): Promise<void> {
    const eventsToRetry = this.deadLetterQueue.filter((event) => eventIds.includes(event.id))
    this.deadLetterQueue = this.deadLetterQueue.filter((event) => !eventIds.includes(event.id))

    for (const event of eventsToRetry) {
      this.retryCounts.set(event.id, 0)
      this.events.push(event)
    }
  }

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
    if (this.events.length === 0) return

    const batch = this.events
    this.events = []

    const failedEvents: BusEvent[] = []

    for (const event of batch) {
      try {
        await handler(event)
        if (event.id) {
          this.retryCounts.delete(event.id)
        }
      } catch (error) {
        const currentRetries = event.id ? (this.retryCounts.get(event.id) ?? 0) : 0
        const nextRetryCount = currentRetries + 1

        if (this.shouldRetry(event)) {
          failedEvents.push(event)
          if (this.maxRetries !== undefined) {
            reportEventError(this.onError, error, event, nextRetryCount, this.maxRetries)
          }
        } else {
          this.moveToDLQ(event, error)
        }
      }
    }

    if (failedEvents.length > 0) {
      this.events.unshift(...failedEvents)
    }
  }

  private shouldRetry(event: BusEvent): boolean {
    if (this.maxRetries === undefined || !event.id) return true

    const currentRetries = this.retryCounts.get(event.id) ?? 0
    if (currentRetries < this.maxRetries) {
      this.retryCounts.set(event.id, currentRetries + 1)
      return true
    }

    return false
  }

  private moveToDLQ(event: BusEvent, error: unknown): void {
    const retryCount = (event.id ? this.retryCounts.get(event.id) : 0) ?? 0
    if (event.id) {
      this.retryCounts.delete(event.id)
    }

    const failedEvent: FailedBusEvent = { ...event, retryCount: retryCount + 1 }
    this.onError?.(new MaxRetriesExceededError(error, failedEvent))
    this.deadLetterQueue.push(event)
  }
}
