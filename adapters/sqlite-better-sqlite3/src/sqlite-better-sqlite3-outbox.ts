import Database from "better-sqlite3"
import {
  type BusEvent,
  type ErrorHandler,
  type FailedBusEvent,
  formatErrorMessage,
  type IOutbox,
  MaxRetriesExceededError,
  type OutboxConfig,
  PollingService,
} from "outbox-event-bus"

const DEFAULT_EXPIRE_IN_SECONDS = 300

const getOutboxSchema = (tableName: string, archiveTableName: string) => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
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
    expire_in_seconds INTEGER NOT NULL DEFAULT ${DEFAULT_EXPIRE_IN_SECONDS}
  );

  CREATE TABLE IF NOT EXISTS ${archiveTableName} (
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

  CREATE INDEX IF NOT EXISTS idx_${tableName}_status_retry ON ${tableName} (status, next_retry_at);
`

export interface SqliteBetterSqlite3OutboxConfig extends OutboxConfig {
  dbPath?: string
  db?: Database.Database
  getTransaction?: (() => Database.Database | undefined) | undefined
  tableName?: string
  archiveTableName?: string
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

export class SqliteBetterSqlite3Outbox implements IOutbox<Database.Database> {
  private readonly config: Required<SqliteBetterSqlite3OutboxConfig>
  private readonly db: Database.Database
  private readonly poller: PollingService

  constructor(config: SqliteBetterSqlite3OutboxConfig) {
    if (config.db) {
      this.db = config.db
    } else {
      if (!config.dbPath) throw new Error("dbPath is required if db is not provided")
      this.db = new Database(config.dbPath)
      this.db.pragma("journal_mode = WAL")
    }

    this.config = {
      batchSize: config.batchSize ?? 50,
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      maxRetries: config.maxRetries ?? 5,
      baseBackoffMs: config.baseBackoffMs ?? 1000,
      processingTimeoutMs: config.processingTimeoutMs ?? 30000,
      maxErrorBackoffMs: config.maxErrorBackoffMs ?? 30000,
      dbPath: config.dbPath ?? "",
      db: this.db,
      getTransaction: config.getTransaction,
      tableName: config.tableName ?? "outbox_events",
      archiveTableName: config.archiveTableName ?? "outbox_events_archive",
    } as Required<SqliteBetterSqlite3OutboxConfig>

    this.init()

    this.poller = new PollingService({
      pollIntervalMs: this.config.pollIntervalMs,
      baseBackoffMs: this.config.baseBackoffMs,
      maxErrorBackoffMs: this.config.maxErrorBackoffMs,
      processBatch: (handler) => this.processBatch(handler),
    })
  }

  private init() {
    this.db.exec(getOutboxSchema(this.config.tableName, this.config.archiveTableName))
  }

  async publish(events: BusEvent[], transaction?: Database.Database): Promise<void> {
    if (events.length === 0) return

    const executor = transaction ?? this.config.getTransaction?.() ?? this.db

    const insert = executor.prepare(`
      INSERT INTO ${this.config.tableName} (id, type, payload, occurred_at, status)
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

  async getFailedEvents(): Promise<FailedBusEvent[]> {
    const rows = this.db
      .prepare(`
      SELECT * FROM ${this.config.tableName}
      WHERE status = 'failed'
      ORDER BY occurred_at DESC
      LIMIT 100
    `)
      .all() as OutboxRow[]

    return rows.map((e) => {
      const event: FailedBusEvent = {
        id: e.id,
        type: e.type,
        payload: JSON.parse(e.payload),
        occurredAt: new Date(e.occurred_at),
        retryCount: e.retry_count,
      }
      if (e.last_error) event.error = e.last_error
      if (e.started_on) event.lastAttemptAt = new Date(e.started_on)
      return event
    })
  }

  async retryEvents(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return

    const placeholders = eventIds.map(() => "?").join(",")
    this.db
      .prepare(`
      UPDATE ${this.config.tableName}
      SET status = 'created',
          retry_count = 0,
          next_retry_at = NULL,
          last_error = NULL
      WHERE id IN (${placeholders})
    `)
      .run(...eventIds)
  }

  start(handler: (event: BusEvent) => Promise<void>, onError: ErrorHandler): void {
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
    const now = new Date().toISOString()
    const msNow = Date.now()

    const lockedEvents = this.db.transaction(() => {
      // Select events that are ready to process:
      // 1. New events (status = 'created')
      // 2. Failed events that can be retried (retry_count < max AND next_retry_at has passed)
      // 3. Stuck events (status = 'active' but keepAlive + expire_in_seconds < now)
      const rows = this.db
        .prepare(`
        SELECT * FROM ${this.config.tableName}
        WHERE status = 'created'
        OR (status = 'failed' AND retry_count < ? AND next_retry_at <= ?)
        OR (status = 'active' AND datetime(keep_alive, '+' || expire_in_seconds || ' seconds') < datetime(?))
        LIMIT ?
      `)
        .all(this.config.maxRetries, now, now, this.config.batchSize) as OutboxRow[]

      if (rows.length === 0) return []

      const ids = rows.map((r) => r.id)

      const update = this.db.prepare(`
        UPDATE ${this.config.tableName}
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

    const completedEvents: { event: BusEvent; lockedEvent: OutboxRow }[] = []

    for (let i = 0; i < busEvents.length; i++) {
      const event = busEvents[i]!
      const lockedEvent = lockedEvents[i]!

      try {
        await handler(event)
        completedEvents.push({ event, lockedEvent })
      } catch (error) {
        if (lockedEvent.retry_count + 1 >= this.config.maxRetries) {
          this.poller.onError?.(new MaxRetriesExceededError(error, lockedEvent.retry_count + 1), {
            ...event,
            retryCount: lockedEvent.retry_count + 1,
          })
        } else {
          this.poller.onError?.(error, { ...event, retryCount: lockedEvent.retry_count + 1 })
        }

        const retryCount = lockedEvent.retry_count + 1
        const delay = this.poller.calculateBackoff(retryCount)

        this.db
          .prepare(`
          UPDATE ${this.config.tableName}
          SET status = 'failed',
              retry_count = ?,
              last_error = ?,
              next_retry_at = ?
          WHERE id = ?
        `)
          .run(
            retryCount,
            formatErrorMessage(error),
            new Date(msNow + delay).toISOString(),
            lockedEvent.id
          )
      }
    }

    if (completedEvents.length > 0) {
      this.db.transaction(() => {
        const insertArchive = this.db.prepare(`
          INSERT INTO ${this.config.archiveTableName} (
            id, type, payload, occurred_at, status, retry_count, last_error, created_on, started_on, completed_on
          ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)
        `)
        const deleteEvent = this.db.prepare(`DELETE FROM ${this.config.tableName} WHERE id = ?`)

        const completionTime = new Date().toISOString()
        for (const { lockedEvent } of completedEvents) {
          insertArchive.run(
            lockedEvent.id,
            lockedEvent.type,
            lockedEvent.payload,
            lockedEvent.occurred_at,
            lockedEvent.retry_count,
            lockedEvent.last_error,
            lockedEvent.created_on,
            now,
            completionTime
          )
          deleteEvent.run(lockedEvent.id)
        }
      })()
    }
  }
}
