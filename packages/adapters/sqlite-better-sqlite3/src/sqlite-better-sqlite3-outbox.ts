import Database from "better-sqlite3"
import {
  type BusEvent,
  type ErrorHandler,
  EventStatus,
  type FailedBusEvent,
  formatErrorMessage,
  type IOutbox,
  type OutboxConfig,
  PollingService,
  reportEventError,
  resolveExecutor,
} from "outbox-event-bus"

const DEFAULT_EXPIRE_IN_SECONDS = 300

const getOutboxSchema = (tableName: string, archiveTableName: string) => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '${EventStatus.CREATED}',
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
  status: EventStatus
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

  private archiveStatement!: Database.Statement
  private deleteStatement!: Database.Statement
  private fetchStatement!: Database.Statement
  private failStatement!: Database.Statement

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

    this.archiveStatement = this.db.prepare(`
      INSERT INTO ${this.config.archiveTableName} (
        id, type, payload, occurred_at, status, retry_count, last_error, created_on, started_on, completed_on
      ) VALUES (?, ?, ?, ?, '${EventStatus.COMPLETED}', ?, ?, ?, ?, ?)
    `)

    this.deleteStatement = this.db.prepare(`DELETE FROM ${this.config.tableName} WHERE id = ?`)

    this.fetchStatement = this.db.prepare(`
      SELECT * FROM ${this.config.tableName}
      WHERE status = '${EventStatus.CREATED}'
      OR (status = '${EventStatus.FAILED}' AND retry_count < ? AND next_retry_at <= ?)
      OR (status = '${EventStatus.ACTIVE}' AND datetime(keep_alive, '+' || expire_in_seconds || ' seconds') < datetime(?))
      LIMIT ?
    `)

    this.failStatement = this.db.prepare(`
      UPDATE ${this.config.tableName}
      SET status = '${EventStatus.FAILED}',
          retry_count = ?,
          last_error = ?,
          next_retry_at = ?
      WHERE id = ?
    `)
  }

  async publish(events: BusEvent[], transaction?: Database.Database): Promise<void> {
    if (events.length === 0) return

    const executor = resolveExecutor(transaction, this.config.getTransaction, this.db)

    const insert = executor.prepare(`
      INSERT INTO ${this.config.tableName} (id, type, payload, occurred_at, status)
      VALUES (?, ?, ?, ?, '${EventStatus.CREATED}')
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
      WHERE status = '${EventStatus.FAILED}'
      ORDER BY occurred_at DESC
      LIMIT 100
    `)
      .all() as OutboxRow[]

    return rows.map((row) => {
      const event: FailedBusEvent = {
        id: row.id,
        type: row.type,
        payload: JSON.parse(row.payload),
        occurredAt: new Date(row.occurred_at),
        retryCount: row.retry_count,
      }
      if (row.last_error) event.error = row.last_error
      if (row.started_on) event.lastAttemptAt = new Date(row.started_on)
      return event
    })
  }

  async retryEvents(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return

    const placeholders = eventIds.map(() => "?").join(",")
    this.db
      .prepare(`
      UPDATE ${this.config.tableName}
      SET status = '${EventStatus.CREATED}',
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
    const lockedEvents = this.lockBatch()
    if (lockedEvents.length === 0) return

    const now = new Date().toISOString()
    const msNow = Date.now()
    const completedEvents: OutboxRow[] = []

    for (const lockedEvent of lockedEvents) {
      const event: BusEvent = {
        id: lockedEvent.id,
        type: lockedEvent.type,
        payload: JSON.parse(lockedEvent.payload),
        occurredAt: new Date(lockedEvent.occurred_at),
      }

      try {
        await handler(event)
        completedEvents.push(lockedEvent)
      } catch (error) {
        this.handleEventFailure(lockedEvent, event, error, msNow)
      }
    }

    if (completedEvents.length > 0) {
      this.archiveBatch(completedEvents, now)
    }
  }

  private lockBatch(): OutboxRow[] {
    const now = new Date().toISOString()

    return this.db.transaction(() => {
      const rows = this.fetchStatement.all(
        this.config.maxRetries,
        now,
        now,
        this.config.batchSize
      ) as OutboxRow[]

      if (rows.length === 0) return []

      const ids = rows.map((r) => r.id)
      const placeholders = ids.map(() => "?").join(",")

      this.db
        .prepare(`
        UPDATE ${this.config.tableName}
        SET status = '${EventStatus.ACTIVE}',
            started_on = ?,
            keep_alive = ?
        WHERE id IN (${placeholders})
      `)
        .run(now, now, ...ids)

      return rows
    })()
  }

  private handleEventFailure(
    lockedEvent: OutboxRow,
    event: BusEvent,
    error: unknown,
    msNow: number
  ) {
    const retryCount = lockedEvent.retry_count + 1
    reportEventError(this.poller.onError, error, event, retryCount, this.config.maxRetries)

    const delay = this.poller.calculateBackoff(retryCount)

    this.failStatement.run(
      retryCount,
      formatErrorMessage(error),
      new Date(msNow + delay).toISOString(),
      lockedEvent.id
    )
  }

  private archiveBatch(completedEvents: OutboxRow[], now: string) {
    const completionTime = new Date().toISOString()

    this.db.transaction(() => {
      for (const lockedEvent of completedEvents) {
        this.archiveStatement.run(
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
        this.deleteStatement.run(lockedEvent.id)
      }
    })()
  }
}
