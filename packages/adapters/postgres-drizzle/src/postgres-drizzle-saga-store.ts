import type { SagaStoreAdapter } from "@outbox-event-bus/saga"
import { eq, lt } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { resolveExecutor, withSagaAdapterLogAndError } from "outbox-event-bus"
import { sagaStore } from "./schema"

export interface PostgresDrizzleSagaStoreConfig {
  db: PostgresJsDatabase<Record<string, unknown>>
  getTransaction?: (() => PostgresJsDatabase<Record<string, unknown>> | undefined) | undefined
  table?: typeof sagaStore
}

export class PostgresDrizzleSagaStore implements SagaStoreAdapter {
  private readonly db: PostgresJsDatabase<Record<string, unknown>>
  private readonly getTransaction:
    | (() => PostgresJsDatabase<Record<string, unknown>> | undefined)
    | undefined
  private readonly table: typeof sagaStore

  constructor(config: PostgresDrizzleSagaStoreConfig) {
    this.db = config.db
    this.getTransaction = config.getTransaction
    this.table = config.table ?? sagaStore
  }

  private get executor() {
    return resolveExecutor(undefined, this.getTransaction, this.db)
  }

  async put(id: string, data: Buffer, expiresAt: Date): Promise<void> {
    await withSagaAdapterLogAndError("PostgresDrizzleSagaStore", "Stored payload", id, async () => {
      await this.executor.insert(this.table).values({ id, data, expiresAt }).onConflictDoUpdate({
        target: this.table.id,
        set: { data, expiresAt },
      })
    })
  }

  async get(id: string): Promise<Buffer> {
    return withSagaAdapterLogAndError(
      "PostgresDrizzleSagaStore",
      "Retrieved payload",
      id,
      async () => {
        const [record] = await this.executor
          .select()
          .from(this.table)
          .where(eq(this.table.id, id))
          .limit(1)

        if (!record) {
          throw new Error(`Saga data not found for ID: ${id}`)
        }

        return Buffer.from(record.data)
      }
    )
  }

  async initialize(): Promise<void> {
    // Drizzle usually handles schema via migrations, but we can log the table name
    console.debug(`[PostgresDrizzleSagaStore] Initialized with table`)
  }

  async cleanup(): Promise<void> {
    await this.db.delete(this.table).where(lt(this.table.expiresAt, new Date()))
  }
}
