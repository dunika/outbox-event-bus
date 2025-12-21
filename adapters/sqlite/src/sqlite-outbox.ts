import { type BusEvent, type IOutbox, type OutboxConfig, PollingService, formatErrorMessage } from "outbox-event-bus"
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
    const OUTBOX_SCHEMA = `
      CREATE TABLE IF NOT EXISTS outbox_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_retry_at TEXT,
        created_on TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
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
    `;

    this.db.exec(OUTBOX_SCHEMA)
  }

  async publish(
    events: BusEvent[],
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
    handler: (event: BusEvent) => Promise<void>,
    onError: (error: unknown) => void
  ): void {
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
    const now = new Date().toISOString()
    const msNow = Date.now()

    const lockedEvents = this.db.transaction(() => {
      // Select events that are ready to process
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

    const busEvents: BusEvent[] = lockedEvents.map((e) => ({
      id: e.id,
      type: e.type,
      payload: JSON.parse(e.payload),
      occurredAt: new Date(e.occurred_at),
    }))

    for (let i = 0; i < busEvents.length; i++) {
        const event = busEvents[i]!
        const lockedEvent = lockedEvents[i]!

        try {
            await handler(event)

            // Success - archive
            this.db.transaction(() => {
                const insertArchive = this.db.prepare(`
                  INSERT INTO outbox_events_archive (
                    id, type, payload, occurred_at, status, retry_count, last_error, created_on, started_on, completed_on
                  ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)
                `)
                const deleteEvent = this.db.prepare(`DELETE FROM outbox_events WHERE id = ?`)
                
                insertArchive.run(
                    lockedEvent.id, lockedEvent.type, lockedEvent.payload, lockedEvent.occurred_at, 
                    lockedEvent.retry_count, lockedEvent.last_error, lockedEvent.created_on, now, new Date().toISOString()
                )
                deleteEvent.run(lockedEvent.id)
            })()
        } catch (error) {
            this.poller.onError?.(error)

            // Failure - update status
            const retryCount = lockedEvent.retry_count + 1
            const delay = this.poller.calculateBackoff(retryCount)

            this.db.prepare(`
                UPDATE outbox_events
                SET status = 'failed',
                    retry_count = ?,
                    last_error = ?,
                    next_retry_at = ?
                WHERE id = ?
            `).run(
                retryCount,
                formatErrorMessage(error),
                new Date(msNow + delay).toISOString(),
                lockedEvent.id
            )
        }
    }
  }
}
