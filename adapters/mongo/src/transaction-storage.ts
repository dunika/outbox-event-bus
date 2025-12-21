import { AsyncLocalStorage } from "node:async_hooks";
import type { ClientSession, MongoClient } from "mongodb";

export const mongoTransactionStorage = new AsyncLocalStorage<ClientSession>();

export async function withMongoTransaction<T>(
  client: MongoClient,
  fn: (session: ClientSession) => Promise<T>
): Promise<T> {
  const session = client.startSession();
  try {
    return await mongoTransactionStorage.run(session, async () => {
      let result: T;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result!;
    });
  } finally {
    await session.endSession();
  }
}

export function getMongoSession(): () => ClientSession | undefined {
  return () => mongoTransactionStorage.getStore();
}
