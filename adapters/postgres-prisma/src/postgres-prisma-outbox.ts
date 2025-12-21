import { PrismaClient, OutboxStatus, type OutboxEvent } from "@prisma/client"
import { type OutboxEvent as BusOutboxEvent, type IOutbox, type OutboxConfig, type ResolvedOutboxConfig, PollingService } from "outbox-event-bus"

export interface PostgresPrismaOutboxConfig extends OutboxConfig {
  prisma: PrismaClient
  getTransaction?: (() => PrismaClient | undefined) | undefined
}

export class PostgresPrismaOutbox implements IOutbox<PrismaClient> {
  private readonly config: Required<PostgresPrismaOutboxConfig>
  private readonly poller: PollingService

  constructor(config: PostgresPrismaOutboxConfig) {
    this.config = {
      prisma: config.prisma,
      batchSize: config.batchSize ?? 50,
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      maxRetries: config.maxRetries ?? 5,
      baseBackoffMs: config.baseBackoffMs ?? 1000,
      processingTimeoutMs: config.processingTimeoutMs ?? 30000,
      maxErrorBackoffMs: config.maxErrorBackoffMs ?? 30000,
      getTransaction: config.getTransaction,
    }

    this.poller = new PollingService({
      pollIntervalMs: this.config.pollIntervalMs,
      baseBackoffMs: this.config.baseBackoffMs,
      maxErrorBackoffMs: this.config.maxErrorBackoffMs,
      processBatch: (handler) => this.processBatch(handler),
    })
  }

  async publish(
    events: BusOutboxEvent[],
    transaction?: PrismaClient,
  ): Promise<void> {
    const executor = transaction ?? this.config.getTransaction?.() ?? this.config.prisma

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

  start(
    handler: (events: BusOutboxEvent[]) => Promise<void>,
    onError: (error: unknown) => void
  ): void {
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }

  private async processBatch(handler: (events: BusOutboxEvent[]) => Promise<void>) {
    await this.config.prisma.$transaction(async (transaction) => {
      const now = new Date()

      // Use raw query to support SKIP LOCKED which is not available in standard Prisma API
      const events = await transaction.$queryRaw<OutboxEvent[]>`
        SELECT * FROM "outbox_events"
        WHERE "status" = 'created'::outbox_status
           OR ("status" = 'failed'::outbox_status AND "retry_count" < ${this.config.maxRetries} AND "next_retry_at" < ${now})
           OR ("status" = 'active'::outbox_status AND "keep_alive" < ${now}::timestamp - make_interval(secs => "expire_in_seconds"))
        LIMIT ${this.config.batchSize}
        FOR UPDATE SKIP LOCKED
      `
      if (events.length === 0) return

      const eventIds = events.map((e) => e.id)

      // Mark as active
      await transaction.outboxEvent.updateMany({
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
        await this.handleJobSuccess(transaction, events, eventIds, now)
      } catch (e: unknown) {
        this.poller.onError?.(e)
        await this.handleJobFailure(transaction, events, e)
      }
    })
  }

  private async handleJobSuccess(transaction: unknown, events: OutboxEvent[], eventIds: string[], now: Date) {
    // Archive successfully processed events
    await (transaction as any).outboxEventArchive.createMany({
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
    await (transaction as any).outboxEvent.deleteMany({
      where: { id: { in: eventIds } },
    })
  }

  private async handleJobFailure(transaction: unknown, events: OutboxEvent[], error: unknown) {
    const msNow = Date.now()
    
    // Handle failure for each event
    await Promise.all(
      events.map((event: any) => {
        const retryCount = event.retry_count + 1
        const delay = this.poller.calculateBackoff(retryCount)

        return (transaction as any).outboxEvent.update({
          where: { id: event.id },
          data: {
            status: OutboxStatus.failed,
            retryCount,
            lastError: error instanceof Error ? error.message : String(error),
            nextRetryAt: new Date(msNow + delay),
          },
        })
      })
    )
  }

}
