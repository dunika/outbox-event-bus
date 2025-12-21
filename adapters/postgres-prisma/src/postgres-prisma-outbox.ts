import { PrismaClient, OutboxStatus, type OutboxEvent } from "@prisma/client"
import { type BusEvent, type IOutbox, type OutboxConfig, PollingService, formatErrorMessage } from "outbox-event-bus"

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
    events: BusEvent[],
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
    handler: (event: BusEvent) => Promise<void>,
    onError: (error: unknown) => void
  ): void {
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
    await this.config.prisma.$transaction(async (transaction) => {
      const now = new Date()

      // Use raw query to support SKIP LOCKED which is not available in standard Prisma API
      // Select events that are:
      // 1. New (status = created)
      // 2. Failed but can be retried
      // 3. Active but stuck/timed out
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

      const busEvents: BusEvent[] = events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload,
        occurredAt: e.occurredAt,
      }))

      // Process events one at a time
      for (let i = 0; i < events.length; i++) {
        const event = events[i]!
        const busEvent = busEvents[i]!
        
        try {
          await handler(busEvent)
          // Archive successful event immediately
          await transaction.outboxEventArchive.create({
            data: {
              id: event.id,
              type: event.type,
              payload: event.payload as any,
              occurredAt: event.occurredAt,
              status: OutboxStatus.completed,
              retryCount: event.retryCount,
              createdOn: event.createdOn,
              startedOn: now,
              completedOn: new Date(),
            },
          })
          await transaction.outboxEvent.delete({ where: { id: event.id } })
        } catch (e: unknown) {
          this.poller.onError?.(e)
          // Mark this specific event as failed
          const retryCount = event.retryCount + 1
          const delay = this.poller.calculateBackoff(retryCount)
          await transaction.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: OutboxStatus.failed,
              retryCount,
              lastError: formatErrorMessage(e),
              nextRetryAt: new Date(Date.now() + delay),
            },
          })
        }
      }
    })
  }

}
