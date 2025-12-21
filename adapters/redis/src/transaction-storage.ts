import { AsyncLocalStorage } from "node:async_hooks";
import type { ChainableCommander, Redis } from "ioredis";


export const redisTransactionStorage = new AsyncLocalStorage<ChainableCommander>();

export async function withRedisTransaction<T>(
  redis: Redis,
  fn: (multi: ChainableCommander) => Promise<T>
): Promise<T> {
  const multi = redis.multi();
  return await redisTransactionStorage.run(multi, async () => {
    const result = await fn(multi);
    await multi.exec();
    return result;
  });
}


export function getRedisPipeline(): () => ChainableCommander | undefined {
  return () => redisTransactionStorage.getStore();
}
