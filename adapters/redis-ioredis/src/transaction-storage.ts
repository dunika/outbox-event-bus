import { AsyncLocalStorage } from "node:async_hooks"
import type { ChainableCommander, Redis } from "ioredis"

export const redisIoRedisTransactionStorage = new AsyncLocalStorage<ChainableCommander>()

export async function withIoRedisTransaction<T>(
  redis: Redis,
  fn: (multi: ChainableCommander) => Promise<T>
): Promise<T> {
  const multi = redis.multi()
  return await redisIoRedisTransactionStorage.run(multi, async () => {
    const result = await fn(multi)
    await multi.exec()
    return result
  })
}

export function getIoRedisPipeline(): () => ChainableCommander | undefined {
  return () => redisIoRedisTransactionStorage.getStore()
}
