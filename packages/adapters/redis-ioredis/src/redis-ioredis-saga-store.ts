import type { SagaStoreAdapter } from "@outbox-event-bus/saga"
import type { Redis } from "ioredis"
import { withSagaAdapterLogAndError } from "outbox-event-bus"

export interface RedisIoredisSagaStoreConfig {
  redis: Redis
  keyPrefix?: string
}

export class RedisIoredisSagaStore implements SagaStoreAdapter {
  private readonly redis: Redis
  private readonly keyPrefix: string

  constructor(config: RedisIoredisSagaStoreConfig) {
    this.redis = config.redis
    this.keyPrefix = config.keyPrefix ?? "saga:storage"
  }

  private getKey(id: string): string {
    return `${this.keyPrefix}:${id}`
  }

  async put(id: string, data: Buffer, expiresAt: Date): Promise<void> {
    const key = this.getKey(id)
    const now = Date.now()
    const ttlMs = expiresAt.getTime() - now

    if (ttlMs <= 0) {
      return
    }

    await withSagaAdapterLogAndError("RedisIoredisSagaStore", "Stored payload", id, async () => {
      await this.redis.set(key, data, "PX", ttlMs)
    })
  }

  async get(id: string): Promise<Buffer> {
    const key = this.getKey(id)
    return withSagaAdapterLogAndError(
      "RedisIoredisSagaStore",
      "Retrieved payload",
      id,
      async () => {
        const data = await this.redis.getBuffer(key)

        if (!data) {
          throw new Error(`Saga data not found for ID: ${id}`)
        }

        return data
      }
    )
  }

  async initialize(): Promise<void> {
    // Redis doesn't require explicit initialization for keys
    return Promise.resolve()
  }
}
