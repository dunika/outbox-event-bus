export interface BatcherConfig<T> {
  batchSize: number
  batchTimeoutMs: number
  processBatch: (items: T[]) => Promise<void>
}

interface QueuedItem<T> {
  item: T
  resolve: () => void
  reject: (err: unknown) => void
}

export class Batcher<T> {
  private queue: QueuedItem<T>[] = []
  private timer: NodeJS.Timeout | null = null
  private readonly config: BatcherConfig<T>

  constructor(config: BatcherConfig<T>) {
    this.config = config
  }

  async add(item: T): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ item, resolve, reject })
      this.scheduleFlushIfNeeded()
    })
  }

  private scheduleFlushIfNeeded(): void {
    if (this.queue.length >= this.config.batchSize) {
      void this.flush()
      return
    }

    this.timer ??= setTimeout(() => {
      void this.flush()
    }, this.config.batchTimeoutMs)
  }

  private async flush(): Promise<void> {
    this.clearTimer()

    if (this.queue.length === 0) return

    const currentBatch = this.queue
    this.queue = []

    const items = currentBatch.map((qi) => qi.item)

    try {
      await this.config.processBatch(items)
      for (const qi of currentBatch) qi.resolve()
    } catch (error) {
      for (const qi of currentBatch) qi.reject(error)
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
