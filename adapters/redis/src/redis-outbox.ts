import type { Redis } from "ioredis"
import type { BusEvent, IOutbox } from "outbox-event-bus"

export interface RedisOutboxConfig {
  redis: Redis
  keyPrefix?: string
  batchSize?: number
  pollIntervalMs?: number
  processingTimeoutMs?: number
  onError: (error: unknown) => void
}

export class RedisOutbox implements IOutbox {
  private readonly redis: Redis
  private readonly batchSize: number
  private readonly pollIntervalMs: number
  private readonly processingTimeoutMs: number
  private readonly onError: (error: unknown) => void
  private readonly KEYS: {
    PENDING: string
    PROCESSING: string
    EVENT_PREFIX: string
  }

  private isPolling = false
  private pollTimeout: NodeJS.Timeout | null = null
  private errorCount = 0
  private readonly maxErrorBackoffMs = 30000

  constructor(config: RedisOutboxConfig) {
    this.redis = config.redis
    this.batchSize = config.batchSize ?? 10
    this.pollIntervalMs = config.pollIntervalMs ?? 1000
    this.processingTimeoutMs = config.processingTimeoutMs ?? 30000
    this.onError = config.onError

    const prefix = config.keyPrefix ?? "outbox"
    this.KEYS = {
      PENDING: `${prefix}:pending`,
      PROCESSING: `${prefix}:processing`,
      EVENT_PREFIX: `${prefix}:event:`
    }

    this.registerLuaScripts()
  }

  private registerLuaScripts() {
    this.redis.defineCommand("pollOutboxEvents", {
      numberOfKeys: 2,
      lua: `
        local pendingKey = KEYS[1]
        local processingKey = KEYS[2]
        local now = ARGV[1]
        local batchSize = ARGV[2]

        local ids = redis.call('ZRANGEBYSCORE', pendingKey, '-inf', now, 'LIMIT', 0, batchSize)
        if #ids > 0 then
          for _, id in ipairs(ids) do
            redis.call('ZREM', pendingKey, id)
            redis.call('ZADD', processingKey, now, id)
          end
        end
        return ids
      `
    })

    this.redis.defineCommand("recoverOutboxEvents", {
      numberOfKeys: 2,
      lua: `
        local processingKey = KEYS[1]
        local pendingKey = KEYS[2]
        local timeout = ARGV[1]
        local now = ARGV[2]
        local threshold = now - timeout

        local stuckIds = redis.call('ZRANGEBYSCORE', processingKey, '-inf', threshold)
        if #stuckIds > 0 then
          for _, id in ipairs(stuckIds) do
            redis.call('ZREM', processingKey, id)
            redis.call('ZADD', pendingKey, now, id)
          end
        end
        return #stuckIds
      `
    })
  }

  async publish(events: BusEvent[]): Promise<void> {
    if (events.length === 0) return

    const pipeline = this.redis.pipeline()
    for (const event of events) {
      const id = event.id
      const key = `${this.KEYS.EVENT_PREFIX}${id}`
      // Use hmset for ioredis-mock compatibility (multiple hset calls don't work in pipelines)
      pipeline.hmset(key, 
        "id", event.id,
        "type", event.type,
        "payload", JSON.stringify(event.payload),
        "occurredAt", event.occurredAt.toISOString(),
        "status", "created",
        "retryCount", "0"
      )
      pipeline.zadd(this.KEYS.PENDING, event.occurredAt.getTime(), id)
    }
    await pipeline.exec()
  }

  start(handler: (events: BusEvent[]) => Promise<void>): void {
    if (this.isPolling) return
    this.isPolling = true
    void this.poll(handler)
  }

  async stop(): Promise<void> {
    this.isPolling = false
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout)
      this.pollTimeout = null
    }
  }

  private async poll(handler: (events: BusEvent[]) => Promise<void>) {
    if (!this.isPolling) return

    try {
      await this.recoverStuckEvents()
      await this.processBatch(handler)
      this.errorCount = 0
    } catch (err) {
      this.onError(err)
      this.errorCount++
    }

    if (this.isPolling) {
      const backoff = Math.min(
        this.pollIntervalMs * Math.pow(2, this.errorCount),
        this.maxErrorBackoffMs
      )
      this.pollTimeout = setTimeout(() => {
        void this.poll(handler)
      }, backoff)
    }
  }

  private async recoverStuckEvents() {
    const now = Date.now()
    // @ts-expect-error - Custom method on redis client
    await this.redis.recoverOutboxEvents(
      this.KEYS.PROCESSING,
      this.KEYS.PENDING,
      this.processingTimeoutMs,
      now
    )
  }

  private async processBatch(handler: (events: BusEvent[]) => Promise<void>) {
    const now = Date.now()

    // @ts-expect-error - Custom method on redis client
    const eventIds: string[] = await this.redis.pollOutboxEvents(
      this.KEYS.PENDING,
      this.KEYS.PROCESSING,
      now,
      this.batchSize
    )

    if (!eventIds || eventIds.length === 0) return

    const pipelineFetch = this.redis.pipeline()
    for (const id of eventIds) {
      pipelineFetch.hgetall(`${this.KEYS.EVENT_PREFIX}${id}`)
    }
    const results = await pipelineFetch.exec()

    if (!results) return

    const eventsToProcess: BusEvent[] = []
    const successfulIds: string[] = []

    results.forEach((res, index) => {
      const [err, messageRaw] = res
      if (!err && messageRaw && Object.keys(messageRaw).length > 0) {
        const message = messageRaw as Record<string, unknown>
        const id = eventIds[index]
        if (id) {
          eventsToProcess.push({
            id: message.id as string,
            type: message.type as string,
            payload: JSON.parse(message.payload as string),
            occurredAt: new Date(message.occurredAt as string)
          })
          successfulIds.push(id)
        }
      }
    })

    if (eventsToProcess.length === 0) return

    try {
      await handler(eventsToProcess)

      const pipelineCleanup = this.redis.pipeline()
      for (const id of successfulIds) {
        pipelineCleanup.zrem(this.KEYS.PROCESSING, id)
        pipelineCleanup.del(`${this.KEYS.EVENT_PREFIX}${id}`)
      }
      await pipelineCleanup.exec()
    } catch (error) {
      this.onError(error)

      const pipelineFetch = this.redis.pipeline()
      for (const id of successfulIds) {
        pipelineFetch.hgetall(`${this.KEYS.EVENT_PREFIX}${id}`)
      }
      const fetchResults = await pipelineFetch.exec()

      const pipelineRetry = this.redis.pipeline()
      successfulIds.forEach((id, index) => {
        const [err, eventData] = fetchResults?.[index] ?? [null, {}]
        if (err || !eventData) return

        const data = eventData as Record<string, string>
        const retryCount = Number.parseInt(data.retryCount || '0', 10) + 1
        const maxRetries = 5

        if (retryCount >= maxRetries) {
          pipelineRetry.zrem(this.KEYS.PROCESSING, id)
          pipelineRetry.hmset(`${this.KEYS.EVENT_PREFIX}${id}`,
            "retryCount", retryCount.toString(),
            "status", "FAILED",
            "lastError", error instanceof Error ? error.message : String(error)
          )
        } else {
          const baseBackoffMs = 1000
          const delay = baseBackoffMs * 2 ** (retryCount - 1)
          const nextAttemptTime = Date.now() + delay

          pipelineRetry.zrem(this.KEYS.PROCESSING, id)
          pipelineRetry.zadd(this.KEYS.PENDING, nextAttemptTime, id)
          pipelineRetry.hmset(`${this.KEYS.EVENT_PREFIX}${id}`,
            "retryCount", retryCount.toString(),
            "lastError", error instanceof Error ? error.message : String(error)
          )
        }
      })
      await pipelineRetry.exec()
    }
  }
}
