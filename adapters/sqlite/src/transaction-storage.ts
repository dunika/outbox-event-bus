import { AsyncLocalStorage } from "async_hooks";
import type { Database } from "better-sqlite3";

export type { Database };

export const sqliteTransactionStorage: AsyncLocalStorage<Database> =
  new AsyncLocalStorage<Database>();


export async function withSqliteTransaction<T>(
  db: Database,
  fn: (tx: Database) => T
): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const result = db.transaction(() => {
        return sqliteTransactionStorage.run(db, () => fn(db));
      })();
      resolve(result);
    } catch (error) {
      reject(error);
    }
  });
}

export function getSqliteTransaction(): () => Database | undefined {
  return () => sqliteTransactionStorage.getStore();
}
