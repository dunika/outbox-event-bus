import { AsyncLocalStorage } from "node:async_hooks";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";


export const drizzleTransactionStorage = new AsyncLocalStorage<PostgresJsDatabase<Record<string, unknown>>>();

export async function withDrizzleTransaction<T>(
  db: PostgresJsDatabase<Record<string, unknown>>,
  fn: (tx: PostgresJsDatabase<Record<string, unknown>>) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    return drizzleTransactionStorage.run(tx, () => fn(tx));
  });
}

export function getDrizzleTransaction(): () => PostgresJsDatabase<Record<string, unknown>> | undefined {
  return () => drizzleTransactionStorage.getStore();
}
