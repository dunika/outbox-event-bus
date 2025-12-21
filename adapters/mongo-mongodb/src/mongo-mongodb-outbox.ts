import { type ClientSession, type Collection, type MongoClient, ObjectId } from "mongodb"
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

const DEFAULT_EXPIRE_IN_SECONDS = 60

export interface MongoMongodbOutboxConfig extends OutboxConfig {
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
  status: "created" | "active" | "failed" | "completed"
  retryCount: number
  nextRetryAt: Date | null
  lastError?: string
  startedOn?: Date
  completedOn?: Date
  expireInSeconds: number
  keepAlive: Date
}

export class MongoMongodbOutbox implements IOutbox<ClientSession> {
  private readonly config: Required<MongoMongodbOutboxConfig>
  private readonly collection: Collection<OutboxDocument>
  private readonly poller: PollingService
  private onError?: ErrorHandler

  constructor(config: MongoMongodbOutboxConfig) {
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

    const documents: OutboxDocument[] = events.map((e) => ({
      _id: new ObjectId(),
      eventId: e.id,
      type: e.type,
      payload: e.payload,
      occurredAt: e.occurredAt,
      status: "created",
      retryCount: 0,
      nextRetryAt: e.occurredAt,
      expireInSeconds: DEFAULT_EXPIRE_IN_SECONDS,
      keepAlive: e.occurredAt,
    }))

    const session = transaction ?? this.config.getSession?.()

    await this.collection.insertMany(documents, {
      ...(session ? { session } : {}),
    })
  }

  async getFailedEvents(): Promise<FailedBusEvent[]> {
    const events = await this.collection
      .find({ status: "failed" })
      .sort({ occurredAt: -1 })
      .limit(100)
      .toArray()

    return events.map((e) => {
      const event: FailedBusEvent = {
        id: e.eventId,
        type: e.type,
        payload: e.payload,
        occurredAt: e.occurredAt,
        retryCount: e.retryCount,
      }
      if (e.lastError) event.error = e.lastError
      if (e.startedOn) event.lastAttemptAt = e.startedOn
      return event
    })
  }

  async retryEvents(eventIds: string[]): Promise<void> {
    await this.collection.updateMany(
      { eventId: { $in: eventIds } },
      {
        $set: {
          status: "created",
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
          status: "failed",
          retryCount,
          lastError: formatErrorMessage(error),
          nextRetryAt: new Date(Date.now() + delay),
        },
      }
    )
  }

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
    const now = new Date()

    const lockedEvents: OutboxDocument[] = []

    // MongoDB's findOneAndUpdate doesn't support bulk locking with returnDocument,
    // so we must lock events sequentially to ensure atomic claim-and-update.
    for (let i = 0; i < this.config.batchSize; i++) {
      const result = await this.collection.findOneAndUpdate(
        {
          $or: [
            { status: "created" },
            {
              status: "failed",
              retryCount: { $lt: this.config.maxRetries },
              nextRetryAt: { $lt: now },
            },
            // Check if event is stuck (keepAlive is older than expireInSeconds)
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
        },
        {
          $set: {
            status: "active",
            startedOn: now,
            keepAlive: now,
          },
        },
        { returnDocument: "after" }
      )

      if (!result) break
      lockedEvents.push(result)
    }

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
      } catch (e: unknown) {
        const retryCount = lockedEvent.retryCount + 1
        if (retryCount >= this.config.maxRetries) {
          this.poller.onError?.(new MaxRetriesExceededError(e, retryCount), {
            ...busEvent,
            retryCount,
          })
        } else {
          this.poller.onError?.(e, { ...busEvent, retryCount })
        }
        await this.markEventFailed(busEvent.id, retryCount, e)
      }
    }

    // Batch completion
    if (completedEventIds.length > 0) {
      await this.collection.updateMany(
        { eventId: { $in: completedEventIds } },
        {
          $set: {
            status: "completed",
            completedOn: new Date(),
          },
        }
      )
    }
  }
}
