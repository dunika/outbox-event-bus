import { and, eq, inArray, lt, or, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
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
} from "outbox-event-bus"
import { outboxEvents, outboxEventsArchive } from "./schema"

export interface PostgresDrizzleOutboxConfig extends OutboxConfig {
  db: PostgresJsDatabase<Record<string, unknown>>
  getTransaction?: (() => PostgresJsDatabase<Record<string, unknown>> | undefined) | undefined
  tables?: {
    outboxEvents: typeof outboxEvents
    outboxEventsArchive: typeof outboxEventsArchive
  }
}

export class PostgresDrizzleOutbox implements IOutbox<PostgresJsDatabase<Record<string, unknown>>> {
  private readonly config: Required<PostgresDrizzleOutboxConfig>
  private readonly poller: PollingService

  constructor(config: PostgresDrizzleOutboxConfig) {
    this.config = {
      batchSize: config.batchSize ?? 50,
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      maxRetries: config.maxRetries ?? 5,
      baseBackoffMs: config.baseBackoffMs ?? 1000,
      processingTimeoutMs: config.processingTimeoutMs ?? 30000,
      maxErrorBackoffMs: config.maxErrorBackoffMs ?? 30000,
      db: config.db,
      getTransaction: config.getTransaction,
      tables: config.tables ?? {
        outboxEvents,
        outboxEventsArchive,
      },
    }

    this.poller = new PollingService({
      pollIntervalMs: this.config.pollIntervalMs,
      baseBackoffMs: this.config.baseBackoffMs,
      maxErrorBackoffMs: this.config.maxErrorBackoffMs,
      processBatch: (handler) => this.processBatch(handler),
    })
  }

  async publish(
    events: BusEvent[],
    transaction?: PostgresJsDatabase<Record<string, unknown>>
  ): Promise<void> {
    const executor = transaction ?? this.config.getTransaction?.() ?? this.config.db

    await executor.insert(this.config.tables.outboxEvents).values(
      events.map((event) => ({
        id: event.id,
        type: event.type,
        payload: event.payload,
        occurredAt: event.occurredAt,
        status: EventStatus.CREATED,
      }))
    )
  }

  async getFailedEvents(): Promise<FailedBusEvent[]> {
    const events = await this.config.db
      .select()
      .from(this.config.tables.outboxEvents)
      .where(eq(this.config.tables.outboxEvents.status, EventStatus.FAILED))
      .orderBy(sql`${this.config.tables.outboxEvents.occurredAt} DESC`)
      .limit(100)

    return events.map((event) => {
      const failedEvent: FailedBusEvent = {
        id: event.id,
        type: event.type,
        payload: event.payload as any,
        occurredAt: event.occurredAt,
        retryCount: event.retryCount,
      }
      if (event.lastError) failedEvent.error = event.lastError
      if (event.startedOn) failedEvent.lastAttemptAt = event.startedOn
      return failedEvent
    })
  }

  async retryEvents(eventIds: string[]): Promise<void> {
    await this.config.db
      .update(this.config.tables.outboxEvents)
      .set({
        status: EventStatus.CREATED,
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
      })
      .where(inArray(this.config.tables.outboxEvents.id, eventIds))
  }

  start(handler: (event: BusEvent) => Promise<void>, onError: ErrorHandler): void {
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
    await this.config.db.transaction(async (transaction) => {
      const now = new Date()

      // Select events that are:
      // 1. New (status = created)
      // 2. Failed but can be retried (retry count < max AND retry time has passed)
      // 3. Active but stuck/timed out (keepAlive is older than now - expireInSeconds)
      const events = await transaction
        .select()
        .from(this.config.tables.outboxEvents)
        .where(
          or(
            eq(this.config.tables.outboxEvents.status, EventStatus.CREATED),
            and(
              eq(this.config.tables.outboxEvents.status, EventStatus.FAILED),
              lt(this.config.tables.outboxEvents.retryCount, this.config.maxRetries),
              lt(this.config.tables.outboxEvents.nextRetryAt, now)
            ),
            and(
              eq(this.config.tables.outboxEvents.status, EventStatus.ACTIVE),
              // Check if event is stuck: keepAlive is older than (now - expireInSeconds)
              // This uses PostgreSQL's make_interval to subtract expireInSeconds from current timestamp
              lt(
                this.config.tables.outboxEvents.keepAlive,
                sql`${now.toISOString()}::timestamp - make_interval(secs => ${this.config.tables.outboxEvents.expireInSeconds})`
              )
            )
          )
        )
        .limit(this.config.batchSize)
        .for("update", { skipLocked: true })

      if (events.length === 0) return

      const eventIds = events.map((event) => event.id)

      await transaction
        .update(this.config.tables.outboxEvents)
        .set({
          status: EventStatus.ACTIVE,
          startedOn: now,
          keepAlive: now,
        })
        .where(inArray(this.config.tables.outboxEvents.id, eventIds))

      for (const event of events) {
        try {
          await handler(event)
          // Archive successful event immediately
          await transaction.insert(this.config.tables.outboxEventsArchive).values({
            id: event.id,
            type: event.type,
            payload: event.payload,
            occurredAt: event.occurredAt,
            status: EventStatus.COMPLETED,
            retryCount: event.retryCount,
            createdOn: event.createdOn,
            startedOn: now,
            completedOn: new Date(),
          })
          await transaction
            .delete(this.config.tables.outboxEvents)
            .where(eq(this.config.tables.outboxEvents.id, event.id))
        } catch (error: unknown) {
          const retryCount = event.retryCount + 1
          reportEventError(this.poller.onError, error, event, retryCount, this.config.maxRetries)

          // Mark this specific event as failed
          const delay = this.poller.calculateBackoff(retryCount)
          await transaction
            .update(this.config.tables.outboxEvents)
            .set({
              status: EventStatus.FAILED,
              retryCount,
              lastError: formatErrorMessage(error),
              nextRetryAt: new Date(Date.now() + delay),
            })
            .where(eq(this.config.tables.outboxEvents.id, event.id))
        }
      }
    })
  }
}
