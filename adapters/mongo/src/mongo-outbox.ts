import { ObjectId, type Collection, type MongoClient, type ClientSession } from "mongodb"
import { type OutboxEvent, type IOutbox, type OutboxConfig, type ResolvedOutboxConfig, PollingService } from "outbox-event-bus"

export interface MongoOutboxConfig extends OutboxConfig {
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

export class MongoOutbox implements IOutbox<ClientSession> {
  private readonly config: Required<MongoOutboxConfig>
  private readonly collection: Collection<OutboxDocument>
  private readonly poller: PollingService

  constructor(config: MongoOutboxConfig) {
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

    this.poller = new PollingService(
      {
        pollIntervalMs: this.config.pollIntervalMs,
        baseBackoffMs: this.config.baseBackoffMs,
        maxErrorBackoffMs: this.config.maxErrorBackoffMs,
        processBatch: (handler) => this.processBatch(handler),
      }
    )
  }

  async publish(events: OutboxEvent[], transaction?: ClientSession): Promise<void> {
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
      expireInSeconds: 60,
      keepAlive: e.occurredAt,
    }))

    const session = transaction ?? this.config.getSession?.()

    await this.collection.insertMany(documents, { 
      ...(session ? { session } : {})
    })
  }

  start(
    handler: (events: OutboxEvent[]) => Promise<void>,
    onError: (error: unknown) => void
  ): void {
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }

  private async processBatch(handler: (events: OutboxEvent[]) => Promise<void>) {
    const now = new Date()

    const lockedEvents: OutboxDocument[] = []
    
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
            {
              $expr: {
                $lt: [
                  "$keepAlive",
                  {
                    $subtract: [
                      now,
                      { $multiply: ["$expireInSeconds", 1000] }
                    ]
                  }
                ]
              }
            },
          ],
        },
        {
          $set: {
            status: "active",
            startedOn: now,
            keepAlive: now
          }
        },
        { returnDocument: "after" }
      )

      if (!result) break
      lockedEvents.push(result)
    }

    if (lockedEvents.length === 0) return

    const busEvents: OutboxEvent[] = lockedEvents.map((e) => ({
      id: e.eventId,
      type: e.type,
      payload: e.payload,
      occurredAt: e.occurredAt,
    }))

    try {
      await handler(busEvents)

      await this.collection.updateMany(
        { _id: { $in: lockedEvents.map(e => e._id) } },
        {
          $set: {
            status: "completed",
            completedOn: new Date()
          }
        }
      )
      
    } catch (e: unknown) {
      // Mark failed
      const msNow = Date.now()
      await Promise.all(
        lockedEvents.map(async (event) => {
          const retryCount = event.retryCount + 1
          const delay = this.poller.calculateBackoff(retryCount)
          
          try {
            await this.collection.updateOne(
              { _id: event._id },
              {
                $set: {
                  status: "failed",
                  retryCount,
                  lastError: e instanceof Error ? e.message : String(e),
                  nextRetryAt: new Date(msNow + delay)
                }
              }
            )
          } catch (updateError) {
             // Error updating failed event - will be retried on next poll
          }
        })
      )
    }
  }
}
