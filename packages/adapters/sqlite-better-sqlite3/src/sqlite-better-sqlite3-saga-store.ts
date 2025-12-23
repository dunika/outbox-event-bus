import type { SagaStoreAdapter } from "@outbox-event-bus/saga"
import type Database from "better-sqlite3"
import { resolveExecutor, withSagaAdapterLogAndError } from "outbox-event-bus"

export interface SqliteBetterSqlite3SagaStoreConfig {
  db: Database.Database
  getTransaction?: (() => Database.Database | undefined) | undefined
  tableName?: string
}

export class SqliteBetterSqlite3SagaStore implements SagaStoreAdapter {
  private readonly db: Database.Database
  private readonly getTransaction: (() => Database.Database | undefined) | undefined
  private readonly tableName: string

  constructor(config: SqliteBetterSqlite3SagaStoreConfig) {
    this.db = config.db
    this.getTransaction = config.getTransaction
    this.tableName = config.tableName ?? "saga_store"
  }

  async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        data BLOB NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires_at ON ${this.tableName} (expires_at);
    `)
  }

  private get executor() {
    return resolveExecutor(undefined, this.getTransaction, this.db)
  }

  async put(id: string, data: Buffer, expiresAt: Date): Promise<void> {
    await withSagaAdapterLogAndError(
      "SqliteBetterSqlite3SagaStore",
      "Stored payload",
      id,
      async () => {
        const stmt = this.executor.prepare(`
        INSERT INTO ${this.tableName} (id, data, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data = excluded.data,
          expires_at = excluded.expires_at
      `)
        stmt.run(id, data, expiresAt.toISOString())
      }
    )
  }

  async get(id: string): Promise<Buffer> {
    return withSagaAdapterLogAndError(
      "SqliteBetterSqlite3SagaStore",
      "Retrieved payload",
      id,
      async () => {
        const stmt = this.executor.prepare(`
        SELECT data FROM ${this.tableName} WHERE id = ?
      `)
        const row = stmt.get(id) as { data: Buffer } | undefined

        if (!row) {
          throw new Error(`Saga data not found for ID: ${id}`)
        }

        return row.data
      }
    )
  }

  async cleanup(): Promise<void> {
    const stmt = this.db.prepare(`
      DELETE FROM ${this.tableName} WHERE expires_at < ?
    `)
    stmt.run(new Date().toISOString())
  }
}
