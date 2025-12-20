import { PrismaClient, OutboxStatus, type OutboxEvent } from "@prisma/client"
import type { BusEvent, IOutbox } from "outbox-event-bus"

export interface PostgresPrismaOutboxConfig {
  prisma: PrismaClient
  getExecutor?: () => PrismaClient | undefined
  maxRetries?: number
  baseBackoffMs?: number
  pollIntervalMs?: number
  batchSize?: number
  onError: (error: unknown) => void
}

export class PostgresPrismaOutbox implements IOutbox {
  private readonly prisma: PrismaClient
  private readonly getExecutor?: (() => PrismaClient | undefined) | undefined
  private readonly maxRetries: number
  private readonly baseBackoffMs: number
  private readonly batchSize: number
  private readonly pollIntervalMs: number
  private readonly onError: (error: unknown) => void

  private isPolling = false
  private pollTimer: NodeJS.Timeout | null = null
  private errorCount = 0
  private readonly maxErrorBackoffMs = 30000

  constructor(config: PostgresPrismaOutboxConfig) {
    this.prisma = config.prisma
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
    const executor = this.getExecutor?.() ?? this.prisma

    await executor.outboxEvent.createMany({
      data: events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload as any,
        occurredAt: e.occurredAt,
        status: OutboxStatus.created,
      }))
    })
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
    // We use a transaction to lock rows and process them
    await this.prisma.$transaction(async (tx) => {
      const now = new Date()

      // Use raw query to support SKIP LOCKED which is not available in standard Prisma API
      const events = await tx.$queryRaw<OutboxEvent[]>`
        SELECT * FROM "outbox_events"
        WHERE "status" = 'created'::outbox_status
           OR ("status" = 'failed'::outbox_status AND "retry_count" < ${this.maxRetries} AND "next_retry_at" < ${now})
           OR ("status" = 'active'::outbox_status AND "keep_alive" < ${now}::timestamp - make_interval(secs => "expire_in_seconds"))
        LIMIT ${this.batchSize}
        FOR UPDATE SKIP LOCKED
      `
      if (events.length === 0) return

      const eventIds = events.map((e) => e.id)

      // Mark as active
      await tx.outboxEvent.updateMany({
        where: { id: { in: eventIds } },
        data: {
          status: OutboxStatus.active,
          startedOn: now,
          keepAlive: now,
        },
      })

      const busEvents = events.map((e: any) => ({
        id: e.id,
        type: e.type,
        payload: e.payload,
        occurredAt: e.occurred_at,
      }))

      try {
        await handler(busEvents)

        // Archive successfully processed events
        await tx.outboxEventArchive.createMany({
          data: events.map((e: any) => ({
            id: e.id,
            type: e.type,
            payload: e.payload,
            occurredAt: e.occurred_at,
            status: OutboxStatus.completed,
            retryCount: e.retry_count,
            createdOn: e.created_on,
            startedOn: now,
            completedOn: new Date(),
          })),
        })

        // Delete from main table
        await tx.outboxEvent.deleteMany({
          where: { id: { in: eventIds } },
        })
      } catch (e: unknown) {
        this.onError(e)
        const msNow = Date.now()
        
        // Handle failure for each event
        await Promise.all(
          events.map((event: any) => {
            const retryCount = event.retry_count + 1
            const delay = this.baseBackoffMs * 2 ** (retryCount - 1)

            return tx.outboxEvent.update({
              where: { id: event.id },
              data: {
                status: OutboxStatus.failed,
                retryCount,
                lastError: e instanceof Error ? e.message : String(e),
                nextRetryAt: new Date(msNow + delay),
              },
            })
          })
        )
      }
    })
  }
}
