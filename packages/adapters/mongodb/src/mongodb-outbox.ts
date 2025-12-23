import { type ClientSession, type Collection, type MongoClient, ObjectId } from "mongodb"
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

const DEFAULT_EXPIRE_IN_SECONDS = 60

export interface MongodbOutboxConfig extends OutboxConfig {
  client: MongoClient
  dbName: string
  collectionName?: string
  getSession?: (() => ClientSession | undefined) | undefined
}

interface OutboxDocument {
  _id: ObjectId
  eventId: string
  type: string
  payload: unknown
  occurredAt: Date
  status: EventStatus
  retryCount: number
  nextRetryAt: Date | null
  lastError?: string
  startedOn?: Date
  completedOn?: Date
  expireInSeconds: number
  keepAlive: Date
}

export class MongodbOutbox implements IOutbox<ClientSession> {
  private readonly config: Required<MongodbOutboxConfig>
  private readonly collection: Collection<OutboxDocument>
  private readonly poller: PollingService
  private onError?: ErrorHandler

  constructor(config: MongodbOutboxConfig) {
    this.config = {
      batchSize: config.batchSize ?? 50,
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      maxRetries: config.maxRetries ?? 5,
      baseBackoffMs: config.baseBackoffMs ?? 1000,
      processingTimeoutMs: config.processingTimeoutMs ?? 30000,
      maxErrorBackoffMs: config.maxErrorBackoffMs ?? 30000,
      collectionName: config.collectionName ?? "outbox_events",
      client: config.client,
      dbName: config.dbName,
      getSession: config.getSession,
    }

    this.collection = config.client
      .db(config.dbName)
      .collection<OutboxDocument>(this.config.collectionName)

    this.poller = new PollingService({
      pollIntervalMs: this.config.pollIntervalMs,
      baseBackoffMs: this.config.baseBackoffMs,
      maxErrorBackoffMs: this.config.maxErrorBackoffMs,
      processBatch: (handler) => this.processBatch(handler),
    })
  }

  async publish(events: BusEvent[], transaction?: ClientSession): Promise<void> {
    if (events.length === 0) return

    const documents: OutboxDocument[] = events.map((event) => ({
      _id: new ObjectId(),
      eventId: event.id,
      type: event.type,
      payload: event.payload,
      occurredAt: event.occurredAt,
      status: EventStatus.CREATED,
      retryCount: 0,
      nextRetryAt: event.occurredAt,
      expireInSeconds: DEFAULT_EXPIRE_IN_SECONDS,
      keepAlive: event.occurredAt,
    }))

    const session = transaction ?? this.config.getSession?.()

    await this.collection.insertMany(documents, {
      ...(session ? { session } : {}),
    })
  }

  async getFailedEvents(): Promise<FailedBusEvent[]> {
    const events = await this.collection
      .find({ status: EventStatus.FAILED })
      .sort({ occurredAt: -1 })
      .limit(100)
      .toArray()

    return events.map((doc) => {
      const event: FailedBusEvent = {
        id: doc.eventId,
        type: doc.type,
        payload: doc.payload,
        occurredAt: doc.occurredAt,
        retryCount: doc.retryCount,
      }
      if (doc.lastError) event.error = doc.lastError
      if (doc.startedOn) event.lastAttemptAt = doc.startedOn
      return event
    })
  }

  async retryEvents(eventIds: string[]): Promise<void> {
    await this.collection.updateMany(
      { eventId: { $in: eventIds } },
      {
        $set: {
          status: EventStatus.CREATED,
          retryCount: 0,
          nextRetryAt: null,
        },
        $unset: {
          lastError: "",
        },
      }
    )
  }

  start(handler: (event: BusEvent) => Promise<void>, onError: ErrorHandler): void {
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }

  private async markEventFailed(
    eventId: string,
    retryCount: number,
    error: unknown
  ): Promise<void> {
    const delay = this.poller.calculateBackoff(retryCount)

    await this.collection.updateOne(
      { eventId },
      {
        $set: {
          status: EventStatus.FAILED,
          retryCount,
          lastError: formatErrorMessage(error),
          nextRetryAt: new Date(Date.now() + delay),
        },
      }
    )
  }

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
    const now = new Date()

    const query = {
      $or: [
        { status: EventStatus.CREATED },
        {
          status: EventStatus.FAILED,
          retryCount: { $lt: this.config.maxRetries },
          nextRetryAt: { $lt: now },
        },
        {
          $expr: {
            $lt: [
              "$keepAlive",
              {
                $subtract: [now, { $multiply: ["$expireInSeconds", 1000] }],
              },
            ],
          },
        },
      ],
    }

    // Fetch candidate IDs first to enforce batchSize limit (updateMany does not support limit).
    const candidates = await this.collection
      .find(query)
      .project({ _id: 1 })
      .limit(this.config.batchSize)
      .toArray()

    if (candidates.length === 0) return

    const candidateIds = candidates.map((c) => c._id)

    const result = await this.collection.updateMany(
      { _id: { $in: candidateIds }, ...query }, // Re-include query to handle race conditions
      {
        $set: {
          status: EventStatus.ACTIVE,
          startedOn: now,
          keepAlive: now,
        },
      }
    )

    if (result.matchedCount === 0) return

    const lockedEvents = await this.collection
      .find({ _id: { $in: candidateIds }, status: EventStatus.ACTIVE })
      .toArray()

    if (lockedEvents.length === 0) return

    const completedEventIds: string[] = []

    for (const lockedEvent of lockedEvents) {
      const busEvent: BusEvent = {
        id: lockedEvent.eventId,
        type: lockedEvent.type,
        payload: lockedEvent.payload,
        occurredAt: lockedEvent.occurredAt,
      }

      try {
        await handler(busEvent)
        completedEventIds.push(busEvent.id)
      } catch (error: unknown) {
        const retryCount = lockedEvent.retryCount + 1
        reportEventError(this.poller.onError, error, busEvent, retryCount, this.config.maxRetries)
        await this.markEventFailed(busEvent.id, retryCount, error)
      }
    }


    if (completedEventIds.length > 0) {
      await this.collection.updateMany(
        { eventId: { $in: completedEventIds } },
        {
          $set: {
            status: EventStatus.COMPLETED,
            completedOn: new Date(),
          },
        }
      )
    }

  }
}
