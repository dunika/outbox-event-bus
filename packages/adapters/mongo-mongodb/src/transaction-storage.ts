import { AsyncLocalStorage } from "node:async_hooks"
import type { ClientSession, MongoClient } from "mongodb"

export const mongoMongodbTransactionStorage = new AsyncLocalStorage<ClientSession>()

export async function withMongodbTransaction<T>(
  client: MongoClient,
  fn: (session: ClientSession) => Promise<T>
): Promise<T> {
  const session = client.startSession()
  try {
    return await mongoMongodbTransactionStorage.run(session, async () => {
      let result: T
      await session.withTransaction(async () => {
        result = await fn(session)
      })
      return result!
    })
  } finally {
    await session.endSession()
  }
}

export function getMongodbSession(): () => ClientSession | undefined {
  return () => mongoMongodbTransactionStorage.getStore()
}
