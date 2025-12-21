import { type OutboxEvent, type IOutbox, type OutboxConfig, PollingService } from "outbox-event-bus"
import Database from "better-sqlite3"

export interface SqliteOutboxConfig extends OutboxConfig {
  dbPath: string
  getTransaction?: (() => Database.Database | undefined) | undefined
}

interface OutboxRow {
  id: string
  type: string
  payload: string
  occurred_at: string
  status: "created" | "active" | "failed" | "completed"
  retry_count: number
  next_retry_at: string | null
  last_error: string | null
  created_on: string
  started_on: string | null
  completed_on: string | null
  keep_alive: string | null
  expire_in_seconds: number
}

export class SqliteOutbox implements IOutbox<Database.Database> {
  private readonly config: Required<SqliteOutboxConfig>
  private readonly db: Database.Database
  private readonly poller: PollingService

  constructor(config: SqliteOutboxConfig) {
    this.config = {
      batchSize: config.batchSize ?? 50,
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      maxRetries: config.maxRetries ?? 5,
      baseBackoffMs: config.baseBackoffMs ?? 1000,
      processingTimeoutMs: config.processingTimeoutMs ?? 30000,
      maxErrorBackoffMs: config.maxErrorBackoffMs ?? 30000,
      dbPath: config.dbPath,
      getTransaction: config.getTransaction,
    }

    this.db = new Database(config.dbPath)
    this.db.pragma("journal_mode = WAL")
    
    this.init()

    this.poller = new PollingService({
      pollIntervalMs: this.config.pollIntervalMs,
      baseBackoffMs: this.config.baseBackoffMs,
      maxErrorBackoffMs: this.config.maxErrorBackoffMs,
      processBatch: (handler) => this.processBatch(handler),
    })
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outbox_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_retry_at TEXT,
        created_on TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
        started_on TEXT,
        completed_on TEXT,
        keep_alive TEXT,
        expire_in_seconds INTEGER NOT NULL DEFAULT 300
      );

      CREATE TABLE IF NOT EXISTS outbox_events_archive (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        status TEXT NOT NULL,
        retry_count INTEGER NOT NULL,
        last_error TEXT,
        created_on TEXT NOT NULL,
        started_on TEXT,
        completed_on TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_events_status_retry ON outbox_events (status, next_retry_at);
    `)
  }

  async publish(
    events: OutboxEvent[],
    transaction?: Database.Database,
  ): Promise<void> {
    if (events.length === 0) return

    const executor = transaction ?? this.config.getTransaction?.() ?? this.db

    const insert = executor.prepare(`
      INSERT INTO outbox_events (id, type, payload, occurred_at, status)
      VALUES (?, ?, ?, ?, 'created')
    `)

    executor.transaction(() => {
      for (const event of events) {
        insert.run(
          event.id,
          event.type,
          JSON.stringify(event.payload),
          event.occurredAt.toISOString()
        )
      }
    })()
  }

  start(
    handler: (events: OutboxEvent[]) => Promise<void>,
    onError: (error: unknown) => void
  ): void {
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
    // Wait a bit to ensure any in-flight transactions complete
    await new Promise(resolve => setTimeout(resolve, 100))
    this.db.close()
  }

  private async processBatch(handler: (events: OutboxEvent[]) => Promise<void>) {
    const now = new Date().toISOString()

    const lockedEvents = this.db.transaction(() => {
      const rows = this.db.prepare(`
        SELECT * FROM outbox_events
        WHERE status = 'created'
        OR (status = 'failed' AND retry_count < ? AND next_retry_at <= ?)
        OR (status = 'active' AND datetime(keep_alive, '+' || expire_in_seconds || ' seconds') < datetime(?))
        LIMIT ?
      `).all(this.config.maxRetries, now, now, this.config.batchSize) as OutboxRow[]

      if (rows.length === 0) return []

      const ids = rows.map(r => r.id)
      
      const update = this.db.prepare(`
        UPDATE outbox_events
        SET status = 'active',
            started_on = ?,
            keep_alive = ?
        WHERE id = ?
      `)

      for (const id of ids) {
        update.run(now, now, id)
      }

      return rows
    })()

    if (lockedEvents.length === 0) return

    const busEvents: OutboxEvent[] = lockedEvents.map((e) => ({
      id: e.id,
      type: e.type,
      payload: JSON.parse(e.payload),
      occurredAt: new Date(e.occurred_at),
    }))

    try {
      await handler(busEvents)

      this.db.transaction(() => {
        const insertArchive = this.db.prepare(`
          INSERT INTO outbox_events_archive (
            id, type, payload, occurred_at, status, retry_count, last_error, created_on, started_on, completed_on
          ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)
        `)
        
        const deleteEvent = this.db.prepare(`DELETE FROM outbox_events WHERE id = ?`)
        
        const completedAt = new Date().toISOString()
        
        for (const e of lockedEvents) {
          insertArchive.run(
            e.id, e.type, e.payload, e.occurred_at, e.retry_count, e.last_error, e.created_on, now, completedAt
          )
          deleteEvent.run(e.id)
        }
      })()

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      this.db.transaction(() => {
        const updateFailure = this.db.prepare(`
          UPDATE outbox_events
          SET status = 'failed',
          retry_count = retry_count + 1,
              last_error = ?,
              next_retry_at = ?
          WHERE id = ?
        `)

        const msNow = Date.now()
        for (const e of lockedEvents) {
          const nextRetryCount = e.retry_count + 1
          const delay = this.poller.calculateBackoff(nextRetryCount)
          const nextRetryAt = new Date(msNow + delay).toISOString()
          
          updateFailure.run(errorMessage, nextRetryAt, e.id)
        }
      })()
    }
  }
}
