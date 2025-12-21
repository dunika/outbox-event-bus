
import type { Redis, ChainableCommander } from "ioredis"
import { type BusEvent, type IOutbox, type OutboxConfig, PollingService, formatErrorMessage } from "outbox-event-bus"
import { pollEventsScript, recoverEventsScript } from "./scripts"

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
      lua: pollEventsScript
    })

    this.redis.defineCommand("recoverOutboxEvents", {
      numberOfKeys: 2,
      lua: recoverEventsScript
    })
  }

  async publish(events: BusEvent[], transaction?: unknown): Promise<void> {
    if (events.length === 0) return

    const externalExecutor = (transaction ?? this.config.getPipeline?.()) as ChainableCommander | undefined
    const pipeline = externalExecutor ?? this.redis.pipeline()
    
    for (const event of events) {
      const key = `${this.KEYS.EVENT_PREFIX}${event.id}`
      // Use hmset for ioredis-mock compatibility (multiple hset calls don't work in pipelines)
      pipeline.hmset(key, 
        "id", event.id,
        "type", event.type,
        "payload", JSON.stringify(event.payload),
        "occurredAt", event.occurredAt.toISOString(),
        "status", "created",
        "retryCount", "0"
      )
      pipeline.zadd(this.KEYS.PENDING, event.occurredAt.getTime(), event.id)
    }

    if (!externalExecutor) {
      await pipeline.exec()
    }
  }

  start(
    handler: (event: BusEvent) => Promise<void>,
    onError: (error: unknown) => void
  ): void {
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }

  private async recoverStuckEvents() {
    const now = Date.now()
    // Redis Lua script handles recovery logic
    await this.redis.recoverOutboxEvents(
      this.KEYS.PROCESSING,
      this.KEYS.PENDING,
      this.config.processingTimeoutMs,
      now
    )
  }

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
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

    for (let i = 0; i < results.length; i++) {
        const res = results[i]
        const id = eventIds[i]
        if (!res || !id) continue

        const [err, messageRaw] = res
        if (err || !messageRaw || Object.keys(messageRaw).length === 0) continue

        const message = messageRaw as Record<string, unknown>
        
        const event: BusEvent = {
            id: message.id as string,
            type: message.type as string,
            payload: JSON.parse(message.payload as string),
            occurredAt: new Date(message.occurredAt as string)
        }

        try {
            await handler(event)

            // Cleanup successful event
            const pipelineCleanup = this.redis.pipeline()
            pipelineCleanup.zrem(this.KEYS.PROCESSING, id)
            pipelineCleanup.del(`${this.KEYS.EVENT_PREFIX}${id}`)
            await pipelineCleanup.exec()
        } catch (error) {
            this.poller.onError?.(error)

            // Handle failure
            const data = message as Record<string, string>
            const retryCount = Number.parseInt(data.retryCount || '0', 10) + 1

            const pipelineRetry = this.redis.pipeline()
            if (retryCount >= this.config.maxRetries) {
                pipelineRetry.zrem(this.KEYS.PROCESSING, id)
                pipelineRetry.hmset(`${this.KEYS.EVENT_PREFIX}${id}`,
                  "retryCount", retryCount.toString(),
                  "status", "FAILED",
                  "lastError", formatErrorMessage(error)
                )
            } else {
                const delay = this.poller.calculateBackoff(retryCount)
                const nextAttemptTime = Date.now() + delay

                pipelineRetry.zrem(this.KEYS.PROCESSING, id)
                pipelineRetry.zadd(this.KEYS.PENDING, nextAttemptTime, id)
                pipelineRetry.hmset(`${this.KEYS.EVENT_PREFIX}${id}`,
                  "retryCount", retryCount.toString(),
                  "lastError", formatErrorMessage(error)
                )
            }
            await pipelineRetry.exec()
        }
    }
  }
}
