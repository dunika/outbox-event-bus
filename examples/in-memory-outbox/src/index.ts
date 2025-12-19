import type { BusEvent, IOutbox } from "outbox-event-bus"

export interface InMemoryOutboxConfig {
  onError: (error: unknown) => void
}

export class InMemoryOutbox implements IOutbox {
  private events: BusEvent[] = []
  private handler: ((events: BusEvent[]) => Promise<void>) | null = null
  private processingPromise: Promise<void> | null = null

  constructor(config: InMemoryOutboxConfig)
  constructor(configOrCallback: InMemoryOutboxConfig | ((error: unknown) => void)) {
    this.onError = typeof configOrCallback === 'function' ? configOrCallback : configOrCallback.onError
  }

  async publish(events: BusEvent[]): Promise<void> {
    this.events.push(...events)
    this.process()
  }

  async start(handler: (events: BusEvent[]) => Promise<void>): Promise<void> {
    this.handler = handler
    this.process()
  }

  async stop(): Promise<void> {
    this.handler = null
    if (this.processingPromise) {
      await this.processingPromise
    }
  }

  private process() {
    if (this.processingPromise || !this.handler || this.events.length === 0) {
      return
    }

    this.processingPromise = (async () => {
      try {
        while (this.handler && this.events.length > 0) {
          const batch = this.events
          this.events = []

          try {
            await this.handler(batch)
          } catch (error) {
            this.onError(error)
          }
        }
      } finally {
        this.processingPromise = null
      }
    })()
  }
}
