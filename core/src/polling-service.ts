import type { PollingServiceConfig } from "./interfaces"
import type { OutboxEvent } from "./types"

export class PollingService {
  private isPolling = false
  private pollTimer: NodeJS.Timeout | null = null
  private errorCount = 0
  private readonly maxErrorBackoffMs: number
  private activePollPromise: Promise<void> | null = null

  public onError?: (error: unknown) => void

  constructor(
    private readonly config: PollingServiceConfig,
  ) {
    this.maxErrorBackoffMs = config.maxErrorBackoffMs ?? 30000
  }

  start(
    handler: (events: OutboxEvent[]) => Promise<void>,
    onError: (error: unknown) => void
  ): void {
    this.onError = onError
    if (this.isPolling) return
    this.isPolling = true
    void this.poll(handler)
  }

  async stop(): Promise<void> {
    this.isPolling = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    if (this.activePollPromise) {
      await this.activePollPromise
    }
  }

  calculateBackoff(retryCount: number): number {
    return this.config.baseBackoffMs * Math.pow(2, retryCount - 1)
  }

  private async poll(handler: (events: OutboxEvent[]) => Promise<void>) {
    if (!this.isPolling) return

    const pollExecution = (async () => {
      if (this.config.performMaintenance) {
        await this.config.performMaintenance()
      }
      await this.config.processBatch(handler)
    })()

    this.activePollPromise = pollExecution

    try {
      await pollExecution
      this.errorCount = 0
    } catch (error) {
      this.onError?.(error)
      this.errorCount++
    } finally {
      this.activePollPromise = null
      if (this.isPolling) {
        const delay =
          this.errorCount > 0
            ? Math.min(
                this.calculateBackoff(this.errorCount + 1),
                this.maxErrorBackoffMs
              )
            : this.config.pollIntervalMs

        this.pollTimer = setTimeout(() => {
          void this.poll(handler)
        }, delay)
      }
    }
  }
}
