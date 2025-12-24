import { type OutboxEvent, OutboxStatus, type PrismaClient, type Prisma } from "@prisma/client"
import {
  type BusEvent,
  type ErrorHandler,
  type FailedBusEvent,
  formatErrorMessage,
  type IOutbox,
  type OutboxConfig,
  PollingService,
  reportEventError,
} from "outbox-event-bus"

type RawOutboxEvent = {
  id: string
  type: string
  payload: Prisma.JsonValue
  occurred_at: Date
  status: OutboxStatus
  retry_count: number
  last_error: string | null
  next_retry_at: Date | null
  created_on: Date
  started_on: Date | null
  completed_on: Date | null
  keep_alive: Date | null
  expire_in_seconds: number
}

type PrismaModelDelegate = {
  create: (args: { data: unknown }) => Promise<unknown>
  createMany: (args: { data: unknown[] }) => Promise<{ count: number }>
  findMany: (args: { where?: unknown; orderBy?: unknown; take?: number }) => Promise<unknown[]>
  update: (args: { where: unknown; data: unknown }) => Promise<unknown>
  updateMany: (args: { where: unknown; data: unknown }) => Promise<{ count: number }>
  delete: (args: { where: unknown }) => Promise<unknown>
}

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
    const model = this.config.models.outbox ?? "outboxEvent"

    const delegate = this.getDelegate(executor, model)
    await delegate.createMany({
      data: events.map((event) => ({
        id: event.id,
        type: event.type,
        payload: event.payload as Prisma.InputJsonValue,
        occurredAt: event.occurredAt,
        status: OutboxStatus.created,
      })),
    })
  }

  async getFailedEvents(): Promise<FailedBusEvent[]> {
    const model = this.config.models.outbox ?? "outboxEvent"
    const delegate = this.getDelegate(this.config.prisma, model)
    const events = await delegate.findMany({
      where: { status: OutboxStatus.failed },
      orderBy: { occurredAt: "desc" },
      take: 100,
    })

    return (events as OutboxEvent[]).map((event) => {
      const failedEvent: FailedBusEvent = {
        id: event.id,
        type: event.type,
        payload: event.payload,
        occurredAt: event.occurredAt,
        retryCount: event.retryCount,
      }
      if (event.lastError) failedEvent.error = event.lastError
      if (event.startedOn) failedEvent.lastAttemptAt = event.startedOn
      return failedEvent
    })
  }

  async retryEvents(eventIds: string[]): Promise<void> {
    const model = this.config.models.outbox ?? "outboxEvent"
    const delegate = this.getDelegate(this.config.prisma, model)
    await delegate.updateMany({
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

  private getDelegate(
    executor: PrismaClient | Prisma.TransactionClient,
    modelName: string
  ): PrismaModelDelegate {
    const delegate = (executor as unknown as Record<string, PrismaModelDelegate>)[modelName]
    if (!delegate) {
      throw new Error(`Prisma model "${modelName}" not found on client`)
    }
    return delegate
  }

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
    const lockedEvents = await this.config.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      const now = new Date()

      // Use raw query to support SKIP LOCKED which is not available in standard Prisma API.
      // SKIP LOCKED is critical for concurrent processing - it allows multiple workers to
      // process different events simultaneously without blocking each other.
      const rawEvents = await transaction.$queryRawUnsafe<RawOutboxEvent[]>(
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

      if (rawEvents.length === 0) return []

      const events: OutboxEvent[] = rawEvents.map((raw) => ({
        id: raw.id,
        type: raw.type,
        payload: raw.payload,
        occurredAt: raw.occurred_at,
        status: raw.status,
        retryCount: raw.retry_count ?? 0,
        lastError: raw.last_error,
        nextRetryAt: raw.next_retry_at,
        createdOn: raw.created_on,
        startedOn: raw.started_on,
        completedOn: raw.completed_on,
        keepAlive: raw.keep_alive,
        expireInSeconds: raw.expire_in_seconds ?? 300,
      }))

      const eventIds = events.map((event) => event.id)
      const outboxModel = this.config.models.outbox ?? "outboxEvent"

      const delegate = this.getDelegate(transaction, outboxModel)
      await delegate.updateMany({
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
    const busEvents: BusEvent[] = lockedEvents.map((event) => ({
      id: event.id,
      type: event.type,
      payload: event.payload,
      occurredAt: event.occurredAt,
    }))

    for (let index = 0; index < lockedEvents.length; index++) {
      const event = lockedEvents[index]
      if (!event) continue
      const busEvent = busEvents[index]
      if (!busEvent) continue

      try {
        await handler(busEvent)
        await this.config.prisma.$transaction(async (tx) => {
          const archiveModel = this.config.models.archive ?? "outboxEventArchive"
          const outboxModel = this.config.models.outbox ?? "outboxEvent"

          const archiveDelegate = this.getDelegate(tx, archiveModel)
          await archiveDelegate.create({
            data: {
              id: event.id,
              type: event.type,
              payload: event.payload as Prisma.InputJsonValue,
              occurredAt: event.occurredAt,
              status: OutboxStatus.completed,
              retryCount: event.retryCount,
              createdOn: event.createdOn,
              startedOn: event.startedOn ?? now,
              completedOn: new Date(),
            },
          })

          const outboxDelegate = this.getDelegate(tx, outboxModel)
          await outboxDelegate.delete({ where: { id: event.id } })
        })
      } catch (error: unknown) {
        const retryCount = event.retryCount + 1
        reportEventError(this.poller.onError, error, busEvent, retryCount, this.config.maxRetries)

        const delay = this.poller.calculateBackoff(retryCount)
        const outboxModel = this.config.models.outbox ?? "outboxEvent"
        const outboxDelegate = this.getDelegate(this.config.prisma, outboxModel)
        await outboxDelegate.update({
          where: { id: event.id },
          data: {
            status: OutboxStatus.failed,
            retryCount,
            lastError: formatErrorMessage(error),
            nextRetryAt: new Date(Date.now() + delay),
          },
        })
      }
    }
  }
}
