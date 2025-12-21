import type { PollingServiceConfig } from "./interfaces"
import type { BusEvent } from "./types"

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
    handler: (event: BusEvent) => Promise<void>,
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

  private async poll(handler: (event: BusEvent) => Promise<void>) {
    if (!this.isPolling) return

    const pollExecution = this.executePoll(handler)

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

  private async executePoll(handler: (event: BusEvent) => Promise<void>): Promise<void> {
    if (this.config.performMaintenance) {
      try {
        await this.config.performMaintenance()
      } catch (maintenanceError) {
        // Wrap maintenance errors with context for better debugging
        const wrappedError = new Error(
          `Maintenance operation failed: ${maintenanceError instanceof Error ? maintenanceError.message : String(maintenanceError)}`
        )
        if (maintenanceError instanceof Error && maintenanceError.stack) {
          wrappedError.stack = maintenanceError.stack
        }
        throw wrappedError
      }
    }
    await this.config.processBatch(handler)
  }
}
