import { and, eq, inArray, lt, or, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import type { BusEvent, IOutbox } from "outbox-event-bus"
import { outboxEvents, outboxEventsArchive } from "./schema"

export interface PostgresDrizzleOutboxConfig {
  db: PostgresJsDatabase<Record<string, unknown>>
  getExecutor?: () => PostgresJsDatabase<Record<string, unknown>> | undefined
  maxRetries?: number
  baseBackoffMs?: number
  pollIntervalMs?: number
  batchSize?: number
  onError: (error: unknown) => void
}

export class PostgresDrizzleOutbox implements IOutbox {
  private readonly db: PostgresJsDatabase<Record<string, unknown>>
  private readonly getExecutor?: (() => PostgresJsDatabase<Record<string, unknown>> | undefined) | undefined
  private readonly maxRetries: number
  private readonly baseBackoffMs: number
  private readonly batchSize: number
  private readonly pollIntervalMs: number
  private readonly onError: (error: unknown) => void

  private isPolling = false
  private pollTimer: NodeJS.Timeout | null = null
  private errorCount = 0
  private readonly maxErrorBackoffMs = 30000

  constructor(config: PostgresDrizzleOutboxConfig) {
    this.db = config.db
    this.getExecutor = config.getExecutor
    this.maxRetries = config.maxRetries ?? 5
    this.baseBackoffMs = config.baseBackoffMs ?? 1000
    this.pollIntervalMs = config.pollIntervalMs ?? 1000
    this.batchSize = config.batchSize ?? 50
    this.onError = config.onError
  }

  async publish(
    events: BusEvent[],
  ): Promise<void> {
    const db = this.getExecutor?.() ?? this.db

    await db.insert(outboxEvents).values(
      events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload,
        occurredAt: e.occurredAt,
        status: "created" as const,
      }))
    )
  }

  start(handler: (events: BusEvent[]) => Promise<void>): void {
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
    await this.db.transaction(async (tx) => {
      const now = new Date()

      const events = await tx
        .select()
        .from(outboxEvents)
        .where(
          or(
            eq(outboxEvents.status, "created"),
            and(
              eq(outboxEvents.status, "failed"),
              lt(outboxEvents.retryCount, this.maxRetries),
              lt(outboxEvents.nextRetryAt, now)
            ),
            and(
              eq(outboxEvents.status, "active"),
              lt(
                outboxEvents.keepAlive,
                sql`${now.toISOString()}::timestamp - make_interval(secs => ${outboxEvents.expireInSeconds})`
              )
            )
          )
        )
        .limit(this.batchSize)
        .for("update", { skipLocked: true })

      if (events.length === 0) return

      const eventIds = events.map((e) => e.id)

      await tx
        .update(outboxEvents)
        .set({
          status: "active",
          startedOn: now,
          keepAlive: now,
        })
        .where(inArray(outboxEvents.id, eventIds))

      const busEvents = events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload,
        occurredAt: e.occurredAt,
      }))

      try {
        await handler(busEvents)

        await tx.insert(outboxEventsArchive).values(
          events.map((e) => ({
            id: e.id,
            type: e.type,
            payload: e.payload,
            occurredAt: e.occurredAt,
            status: "completed" as const,
            retryCount: e.retryCount,
            createdOn: e.createdOn,
            startedOn: now,
            completedOn: new Date(),
          }))
        )

        await tx.delete(outboxEvents).where(inArray(outboxEvents.id, eventIds))
      } catch (e: unknown) {
        this.onError(e)
        const msNow = Date.now()
        await Promise.all(
          events.map((event) => {
            const retryCount = event.retryCount + 1
            const delay = this.baseBackoffMs * 2 ** (retryCount - 1)

            return tx
              .update(outboxEvents)
              .set({
                status: "failed",
                retryCount,
                lastError: e instanceof Error ? e.message : String(e),
                nextRetryAt: new Date(msNow + delay),
              })
              .where(eq(outboxEvents.id, event.id))
          })
        )
      }
    })
  }
}
