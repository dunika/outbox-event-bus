import type { Redis, ChainableCommander } from "ioredis"
import { type OutboxEvent, type IOutbox, type OutboxConfig, PollingService } from "outbox-event-bus"

export interface RedisOutboxConfig extends OutboxConfig {
  redis: Redis
  keyPrefix?: string
  processingTimeoutMs?: number
  getPipeline?: (() => ChainableCommander | undefined) | undefined
}

export class RedisOutbox implements IOutbox<ChainableCommander> {
  private readonly config: Required<RedisOutboxConfig>
  private readonly redis: Redis
  private readonly poller: PollingService
  private readonly KEYS: {
    PENDING: string
    PROCESSING: string
    EVENT_PREFIX: string
  }

  constructor(config: RedisOutboxConfig) {
    this.config = {
      batchSize: config.batchSize ?? 50,
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      maxRetries: config.maxRetries ?? 5,
      baseBackoffMs: config.baseBackoffMs ?? 1000,
      maxErrorBackoffMs: config.maxErrorBackoffMs ?? 30000,
      processingTimeoutMs: config.processingTimeoutMs ?? 30000,
      redis: config.redis,
      keyPrefix: config.keyPrefix ?? "outbox",
      getPipeline: config.getPipeline,
    }

    this.redis = config.redis

    this.KEYS = {
      PENDING: `${this.config.keyPrefix}:pending`,
      PROCESSING: `${this.config.keyPrefix}:processing`,
      EVENT_PREFIX: `${this.config.keyPrefix}:event:`
    }

    this.registerLuaScripts()

    this.poller = new PollingService({
      pollIntervalMs: this.config.pollIntervalMs,
      baseBackoffMs: this.config.baseBackoffMs,
      maxErrorBackoffMs: this.config.maxErrorBackoffMs,
      performMaintenance: () => this.recoverStuckEvents(),
      processBatch: (handler) => this.processBatch(handler),
    })
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

  async publish(events: OutboxEvent[], transaction?: unknown): Promise<void> {
    if (events.length === 0) return

    const externalExecutor = (transaction ?? this.config.getPipeline?.()) as ChainableCommander | undefined
    const pipeline = externalExecutor ?? this.redis.pipeline()
    
    for (const event of events) {
      const id = event.id!
      const key = `${this.KEYS.EVENT_PREFIX}${id}`
      const occurredAt = event.occurredAt!
      // Use hmset for ioredis-mock compatibility (multiple hset calls don't work in pipelines)
      pipeline.hmset(key, 
        "id", id,
        "type", event.type,
        "payload", JSON.stringify(event.payload),
        "occurredAt", occurredAt.toISOString(),
        "status", "created",
        "retryCount", "0"
      )
      pipeline.zadd(this.KEYS.PENDING, occurredAt.getTime(), id)
    }

    if (!externalExecutor) {
      await pipeline.exec()
    }
  }

  start(
    handler: (events: OutboxEvent[]) => Promise<void>,
    onError: (error: unknown) => void
  ): void {
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }

  private async recoverStuckEvents() {
    const now = Date.now()
    // @ts-expect-error - Custom method on redis client
    await this.redis.recoverOutboxEvents(
      this.KEYS.PROCESSING,
      this.KEYS.PENDING,
      this.config.processingTimeoutMs,
      now
    )
  }

  private async processBatch(handler: (events: OutboxEvent[]) => Promise<void>) {
    const now = Date.now()

    // @ts-expect-error - Custom method on redis client
    const eventIds: string[] = await this.redis.pollOutboxEvents(
      this.KEYS.PENDING,
      this.KEYS.PROCESSING,
      now,
      this.config.batchSize
    )

    if (!eventIds || eventIds.length === 0) return

    const pipelineFetch = this.redis.pipeline()
    for (const id of eventIds) {
      pipelineFetch.hgetall(`${this.KEYS.EVENT_PREFIX}${id}`)
    }
    const results = await pipelineFetch.exec()

    if (!results) return

    const eventsToProcess: OutboxEvent[] = []
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
      this.poller.onError?.(error)

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

        if (retryCount >= this.config.maxRetries) {
          pipelineRetry.zrem(this.KEYS.PROCESSING, id)
          pipelineRetry.hmset(`${this.KEYS.EVENT_PREFIX}${id}`,
            "retryCount", retryCount.toString(),
            "status", "FAILED",
            "lastError", error instanceof Error ? error.message : String(error)
          )
        } else {
          const delay = this.poller.calculateBackoff(retryCount)
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
