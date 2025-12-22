import { AsyncLocalStorage } from "node:async_hooks"
import type { Database } from "better-sqlite3"

export type { Database }

export const betterSqlite3TransactionStorage: AsyncLocalStorage<Database> =
  new AsyncLocalStorage<Database>()

export async function withBetterSqlite3Transaction<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>
): Promise<T> {
  return betterSqlite3TransactionStorage.run(db, async () => {
    if (db.inTransaction) {
      const savepointName = `sp_${Date.now()}_${Math.random().toString(36).slice(2)}`
      db.prepare(`SAVEPOINT ${savepointName}`).run()
      try {
        const result = await fn(db)
        db.prepare(`RELEASE ${savepointName}`).run()
        return result
      } catch (error) {
        db.prepare(`ROLLBACK TO ${savepointName}`).run()
        db.prepare(`RELEASE ${savepointName}`).run()
        throw error
      }
    } else {
      db.prepare("BEGIN").run()
      try {
        const result = await fn(db)
        db.prepare("COMMIT").run()
        return result
      } catch (error) {
        db.prepare("ROLLBACK").run()
        throw error
      }
    }
  })
}

export function getBetterSqlite3Transaction(): () => Database | undefined {
  return () => betterSqlite3TransactionStorage.getStore()
}
