import type { PollingServiceConfig } from "../types/interfaces"
import { MaintenanceError, OutboxError, OperationalError } from "../errors/errors"
import type { BusEvent, ErrorHandler } from "../types/types"

export class PollingService {
  private isPolling = false
  private pollTimer: NodeJS.Timeout | null = null
  private errorCount = 0
  private readonly maxErrorBackoffMs: number
  private activePollPromise: Promise<void> | null = null

  public onError?: ErrorHandler

  constructor(
    private readonly config: PollingServiceConfig,
  ) {
    this.maxErrorBackoffMs = config.maxErrorBackoffMs ?? 30000
  }

  start(
    handler: (event: BusEvent) => Promise<void>,
    onError: ErrorHandler
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
    const backoff = this.config.baseBackoffMs * Math.pow(2, retryCount - 1)
    const jitter = (Math.random() * 0.2 - 0.1) * backoff // ±10% jitter
    return Math.floor(backoff + jitter)
  }

  private async poll(handler: (event: BusEvent) => Promise<void>) {
    if (!this.isPolling) return

    const pollExecution = this.executePoll(handler)

    this.activePollPromise = pollExecution

    try {
      await pollExecution
      this.errorCount = 0
    } catch (error) {
      const errorToReport = error instanceof OutboxError 
        ? error 
        : new OperationalError("Polling cycle failed", { originalError: error })
      
      this.onError?.(errorToReport)
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
        throw new MaintenanceError(maintenanceError)
      }
    }
    await this.config.processBatch(handler)
  }
}
