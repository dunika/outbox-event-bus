import type { PollingServiceConfig } from "./interfaces"
import type { BusEvent } from "./types"

export class PollingService {
  private isPolling = false
  private pollTimer: NodeJS.Timeout | null = null
  private errorCount = 0
  private readonly maxErrorBackoffMs: number

  public onError?: (error: unknown) => void

  constructor(
    private readonly config: PollingServiceConfig,
  ) {
    this.maxErrorBackoffMs = config.maxErrorBackoffMs ?? 30000
  }

  start(handler: (events: BusEvent[]) => Promise<void>): void {
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
  }

  calculateBackoff(retryCount: number): number {
    return this.config.baseBackoffMs * Math.pow(2, retryCount - 1)
  }

  private async poll(handler: (events: BusEvent[]) => Promise<void>) {
    if (!this.isPolling) return

    try {
      if (this.config.performMaintenance) {
        await this.config.performMaintenance()
      }
      await this.config.processBatch(handler)
      this.errorCount = 0
    } catch (error) {
      this.onError?.(error)
      this.errorCount++
    } finally {
      if (this.isPolling) {
        const backoff = Math.min(
          this.config.pollIntervalMs * Math.pow(2, this.errorCount),
          this.maxErrorBackoffMs
        )
        this.pollTimer = setTimeout(() => {
          void this.poll(handler)
        }, backoff)
      }
    }
  }
}
