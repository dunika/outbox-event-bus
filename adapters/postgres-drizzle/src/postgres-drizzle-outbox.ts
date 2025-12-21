import { and, eq, inArray, lt, or, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { type BusEvent, type IOutbox, type OutboxConfig, type ResolvedOutboxConfig, PollingService } from "outbox-event-bus"
import { outboxEvents, outboxEventsArchive } from "./schema"

export interface PostgresDrizzleOutboxConfig extends OutboxConfig {
  db: PostgresJsDatabase<Record<string, unknown>>
  getExecutor?: (() => PostgresJsDatabase<Record<string, unknown>> | undefined) | undefined
}

export class PostgresDrizzleOutbox implements IOutbox {
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
      getExecutor: config.getExecutor,
    }

    this.poller = new PollingService(
      {
        pollIntervalMs: this.config.pollIntervalMs,
        baseBackoffMs: this.config.baseBackoffMs,
        maxErrorBackoffMs: this.config.maxErrorBackoffMs,
        processBatch: (handler) => this.processBatch(handler),
      }
    )
  }

  async publish(
    events: BusEvent[],
  ): Promise<void> {
    const executor = this.config.getExecutor?.() ?? this.config.db

    await executor.insert(outboxEvents).values(
      events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload,
        occurredAt: e.occurredAt ?? new Date(),
        status: "created" as const,
      }))
    )
  }

  start(
    handler: (events: BusEvent[]) => Promise<void>,
    onError: (error: unknown) => void
  ): void {
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }

  private async processBatch(handler: (events: BusEvent[]) => Promise<void>) {
    await this.config.db.transaction(async (tx) => {
      const now = new Date()

      const events = await tx
        .select()
        .from(outboxEvents)
        .where(
          or(
            eq(outboxEvents.status, "created"),
            and(
              eq(outboxEvents.status, "failed"),
              lt(outboxEvents.retryCount, this.config.maxRetries),
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
        .limit(this.config.batchSize)
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
        const msNow = Date.now()
        await Promise.all(
          events.map((event) => {
            const retryCount = event.retryCount + 1
            const delay = this.poller.calculateBackoff(retryCount)

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
