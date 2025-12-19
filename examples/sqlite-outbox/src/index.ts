import type { BusEvent, IOutbox } from "outbox-event-bus"
import Database from "better-sqlite3"

export interface SqliteOutboxConfig {
  dbPath: string
  maxRetries?: number
  baseBackoffMs?: number
  pollIntervalMs?: number
  batchSize?: number
  onError: (error: unknown) => void
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

export class SqliteOutbox implements IOutbox {
  private readonly db: Database.Database
  private readonly maxRetries: number
  private readonly baseBackoffMs: number
  private readonly pollIntervalMs: number
  private readonly batchSize: number
  private readonly onError: (error: unknown) => void

  private isPolling = false
  private pollTimer: NodeJS.Timeout | null = null
  private errorCount = 0
  private readonly maxErrorBackoffMs = 30000

  constructor(config: SqliteOutboxConfig) {
    this.db = new Database(config.dbPath)
    this.db.pragma("journal_mode = WAL")
    
    this.maxRetries = config.maxRetries ?? 5
    this.baseBackoffMs = config.baseBackoffMs ?? 1000
    this.pollIntervalMs = config.pollIntervalMs ?? 1000
    this.batchSize = config.batchSize ?? 50
    this.onError = config.onError

    this.init()
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

  async publish(events: BusEvent[]): Promise<void> {
    if (events.length === 0) return

    const insert = this.db.prepare(`
      INSERT INTO outbox_events (id, type, payload, occurred_at, status)
      VALUES (?, ?, ?, ?, 'created')
    `)

    this.db.transaction(() => {
      for (const e of events) {
        insert.run(e.id, e.type, JSON.stringify(e.payload), e.occurredAt.toISOString())
      }
    })()
  }

  async start(handler: (events: BusEvent[]) => Promise<void>): Promise<void> {
    if (this.isPolling) return
    this.isPolling = true
    void this.poll(handler)
  }

  async stop(): Promise<void> {
    this.isPolling = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    // Wait a bit to ensure any in-flight transactions complete
    await new Promise(resolve => setTimeout(resolve, 100))
    this.db.close()
  }

  private async poll(handler: (events: BusEvent[]) => Promise<void>) {
    if (!this.isPolling) return

    try {
      await this.processBatch(handler)
      this.errorCount = 0 // Reset on success
    } catch (error) {
      this.onError(error)
      this.errorCount++
    } finally {
      if (this.isPolling) {
        const backoff = Math.min(
          this.pollIntervalMs * Math.pow(2, this.errorCount),
          this.maxErrorBackoffMs
        )
        this.pollTimer = setTimeout(() => {
          void this.poll(handler)
        }, backoff)
      }
    }
  }

  private async processBatch(handler: (events: BusEvent[]) => Promise<void>) {
    const now = new Date().toISOString()

    const lockedEvents = this.db.transaction(() => {
      // 1. Find candidates
      // SQLite doesn't have interval math like Postgres, so we do it in JS or use strftime
      // For keep_alive check: keep_alive < now - expire_in_seconds
      
      const rows = this.db.prepare(`
        SELECT * FROM outbox_events
        WHERE status = 'created'
        OR (status = 'failed' AND retry_count < ? AND next_retry_at <= ?)
        OR (status = 'active' AND datetime(keep_alive, '+' || expire_in_seconds || ' seconds') < datetime(?))
        LIMIT ?
      `).all(this.maxRetries, now, now, this.batchSize) as OutboxRow[]

      if (rows.length === 0) return []

      const ids = rows.map(r => r.id)
      
      // 2. Mark as active
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

    const busEvents: BusEvent[] = lockedEvents.map((e) => ({
      id: e.id,
      type: e.type,
      payload: JSON.parse(e.payload),
      occurredAt: new Date(e.occurred_at),
    }))

    try {
      // 3. Process events
      await handler(busEvents)

      // 4. Mark as completed and archive
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
      // 5. Build retry updates on failure
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
          const delay = this.baseBackoffMs * 2 ** (nextRetryCount - 1)
          const nextRetryAt = new Date(msNow + delay).toISOString()
          
          updateFailure.run(errorMessage, nextRetryAt, e.id)
        }
      })()
    }
  }
}
