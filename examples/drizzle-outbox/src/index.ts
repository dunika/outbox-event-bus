import { and, eq, inArray, lt, or, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import type { BusEvent, IOutbox } from "outbox-event-bus"
import { outboxEvents, outboxEventsArchive } from "./schema"

export interface DrizzleOutboxConfig {
  db: PostgresJsDatabase<Record<string, unknown>>
  maxRetries?: number
  baseBackoffMs?: number
  pollIntervalMs?: number
  batchSize?: number
  onError: (error: unknown) => void
}

export class DrizzleOutbox implements IOutbox {
  private readonly db: PostgresJsDatabase<Record<string, unknown>>
  private readonly maxRetries: number
  private readonly baseBackoffMs: number
  private readonly batchSize: number
  private readonly pollIntervalMs: number
  private readonly onError: (error: unknown) => void

  private isPolling = false
  private pollTimer: NodeJS.Timeout | null = null
  private errorCount = 0
  private readonly maxErrorBackoffMs = 30000

  constructor(config: DrizzleOutboxConfig) {
    this.db = config.db
    this.maxRetries = config.maxRetries ?? 5
    this.baseBackoffMs = config.baseBackoffMs ?? 1000
    this.pollIntervalMs = config.pollIntervalMs ?? 1000
    this.batchSize = config.batchSize ?? 50
    this.onError = config.onError
  }

  async publish(
    events: BusEvent[],
    context?: unknown,
  ): Promise<void> {
    const executor = context as PostgresJsDatabase<Record<string, unknown>> | undefined
    const db = executor ?? this.db

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
      // 1. Fetch pending waiting for retry, or stuck active events
      const now = new Date()

      const events = await tx
        .select()
        .from(outboxEvents)
        .where(
          or(
            // New events
            eq(outboxEvents.status, "created"),

            // Retryable failed events
            and(
              eq(outboxEvents.status, "failed"),
              lt(outboxEvents.retryCount, this.maxRetries),
              lt(outboxEvents.nextRetryAt, now)
            ),

            // Stuck active events (expired keep_alive)
            // We cast expire_in_seconds to interval to add to started_on/keep_alive if we wanted proper db-side calc,
            // but simpler: if keep_alive < now - expireInSeconds.
            // Using sql injection for interval arithmetic if needed, or just JS date math if we rely on keep_alive updates.
            // Here we assume keep_alive is updated on start. If we want robustness we check against keep_alive.
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

      // 2. Mark as active (processing)
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
        // 3. Process events
        await handler(busEvents)

        // 4. Mark as completed -> Move to Archive -> Delete from Outbox
        // Insert into archive
        await tx.insert(outboxEventsArchive).values(
          events.map((e) => ({
            id: e.id,
            type: e.type,
            payload: e.payload,
            occurredAt: e.occurredAt,
            status: "completed" as const,
            retryCount: e.retryCount,
            createdOn: e.createdOn,
            startedOn: now, // effectively when this successful attempt started
            completedOn: new Date(),
          }))
        )

        // Delete from outbox
        await tx.delete(outboxEvents).where(inArray(outboxEvents.id, eventIds))
      } catch (e: unknown) {
        this.onError(e)
        // 5. Build retry updates on failure
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
                // Reset monitoring fields? Maybe keep startedOn for history
              })
              .where(eq(outboxEvents.id, event.id))
          })
        )
      }
    })
  }
}
