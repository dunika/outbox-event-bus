import { type OutboxEvent, OutboxStatus, type PrismaClient } from "@prisma/client"
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

export interface PostgresPrismaOutboxConfig extends OutboxConfig {
  prisma: PrismaClient
  getTransaction?: (() => PrismaClient | undefined) | undefined
  models?: {
    outbox?: string
    archive?: string
  }
  tableName?: string
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
      models: {
        outbox: config.models?.outbox ?? "outboxEvent",
        archive: config.models?.archive ?? "outboxEventArchive",
      },
      tableName: config.tableName ?? "outbox_events",
    }

    this.poller = new PollingService({
      pollIntervalMs: this.config.pollIntervalMs,
      baseBackoffMs: this.config.baseBackoffMs,
      maxErrorBackoffMs: this.config.maxErrorBackoffMs,
      processBatch: (handler) => this.processBatch(handler),
    })
  }

  async publish(events: BusEvent[], transaction?: PrismaClient): Promise<void> {
    const executor = transaction ?? this.config.getTransaction?.() ?? this.config.prisma

    await (executor as any)[this.config.models!.outbox!].createMany({
      data: events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload as any,
        occurredAt: e.occurredAt,
        status: OutboxStatus.created,
      })),
    })
  }

  async getFailedEvents(): Promise<FailedBusEvent[]> {
    const events = await (this.config.prisma as any)[this.config.models!.outbox!].findMany({
      where: { status: OutboxStatus.failed },
      orderBy: { occurredAt: "desc" },
      take: 100,
    })

    return events.map((e: any) => {
      const event: FailedBusEvent = {
        id: e.id,
        type: e.type,
        payload: e.payload as any,
        occurredAt: e.occurredAt,
        retryCount: e.retryCount,
      }
      if (e.lastError) event.error = e.lastError
      if (e.startedOn) event.lastAttemptAt = e.startedOn
      return event
    })
  }

  async retryEvents(eventIds: string[]): Promise<void> {
    await (this.config.prisma as any)[this.config.models!.outbox!].updateMany({
      where: { id: { in: eventIds } },
      data: {
        status: OutboxStatus.created,
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
      },
    })
  }

  start(handler: (event: BusEvent) => Promise<void>, onError: ErrorHandler): void {
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
    const lockedEvents = await this.config.prisma.$transaction(async (transaction) => {
      const now = new Date()

      // Use raw query to support SKIP LOCKED which is not available in standard Prisma API.
      // SKIP LOCKED is critical for concurrent processing - it allows multiple workers to
      // process different events simultaneously without blocking each other.
      // Select events that are:
      // 1. New (status = created)
      // 2. Failed but can be retried
      // 3. Active but stuck/timed out
      const events = await transaction.$queryRawUnsafe<OutboxEvent[]>(
        `
        SELECT * FROM "${this.config.tableName}"
        WHERE "status" = 'created'::outbox_status
           OR ("status" = 'failed'::outbox_status AND "retry_count" < ${this.config.maxRetries} AND "next_retry_at" < $1)
           OR ("status" = 'active'::outbox_status AND "keep_alive" < $2::timestamp - make_interval(secs => "expire_in_seconds"))
        LIMIT ${this.config.batchSize}
        FOR UPDATE SKIP LOCKED
      `,
        now,
        now
      )

      if (events.length === 0) return []

      const eventIds = events.map((e) => e.id)

      await (transaction as any)[this.config.models!.outbox!].updateMany({
        where: { id: { in: eventIds } },
        data: {
          status: OutboxStatus.active,
          startedOn: now,
          keepAlive: now,
        },
      })

      return events
    })

    if (lockedEvents.length === 0) return

    const now = new Date()
    const busEvents: BusEvent[] = lockedEvents.map((e) => ({
      id: e.id,
      type: e.type,
      payload: e.payload,
      occurredAt: e.occurredAt,
    }))

    for (let i = 0; i < lockedEvents.length; i++) {
      const event = lockedEvents[i]!
      const busEvent = busEvents[i]!

      try {
        await handler(busEvent)
        await this.config.prisma.$transaction(async (tx) => {
          await (tx as any)[this.config.models!.archive!].create({
            data: {
              id: event.id,
              type: event.type,
              payload: event.payload as any,
              occurredAt: event.occurredAt,
              status: OutboxStatus.completed,
              retryCount: event.retryCount,
              createdOn: event.createdOn,
              startedOn: event.startedOn ?? now,
              completedOn: new Date(),
            },
          })
          await (tx as any)[this.config.models!.outbox!].delete({ where: { id: event.id } })
        })
      } catch (e: unknown) {
        const retryCount = event.retryCount + 1
        if (retryCount >= this.config.maxRetries) {
          this.poller.onError?.(new MaxRetriesExceededError(e, retryCount), {
            ...busEvent,
            retryCount,
          })
        } else {
          this.poller.onError?.(e, { ...busEvent, retryCount })
        }

        // Mark this specific event as failed
        const delay = this.poller.calculateBackoff(retryCount)
        await (this.config.prisma as any)[this.config.models!.outbox!].update({
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
  }
}
