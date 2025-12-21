import { ObjectId, type Collection, type MongoClient, type ClientSession } from "mongodb"
import { type BusEvent, type IOutbox, type OutboxConfig, type ResolvedOutboxConfig, PollingService, formatErrorMessage } from "outbox-event-bus"

const DEFAULT_EXPIRE_IN_SECONDS = 60

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
  private handler: ((event: BusEvent) => Promise<void>) | null = null
  private onError?: (error: unknown) => void

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
      ...(session ? { session } : {})
    })
  }

  start(
    handler: (event: BusEvent) => Promise<void>,
    onError: (error: unknown) => void
  ): void {
    this.handler = handler
    this.onError = onError
    this.poller.start(async () => {}, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
    const now = new Date()

    const lockedEvents: OutboxDocument[] = []
    
    // MongoDB's findOneAndUpdate doesn't support bulk locking with returnDocument,
    // so we must lock events sequentially to ensure atomic claim-and-update
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
            // This handles cases where a worker crashed while processing
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

    const busEvents: BusEvent[] = lockedEvents.map((e) => ({
      id: e.eventId,
      type: e.type,
      payload: e.payload,
      occurredAt: e.occurredAt,
    }))

    // Process each event individually
    for (const busEvent of busEvents) {
      try {
        await this.handler!(busEvent)
        
        // Mark as completed
        const lockedEvent = lockedEvents.find(e => e.eventId === busEvent.id)
        if (lockedEvent) {
          await this.collection.updateOne(
            { _id: lockedEvent._id },
            {
              $set: {
                status: "completed",
                completedOn: new Date()
              }
            }
          )
        }
      } catch (e: unknown) {
        this.onError?.(e)
        
        // Mark as failed with retry info
        const lockedEvent = lockedEvents.find(ev => ev.eventId === busEvent.id)
        if (lockedEvent) {
          const retryCount = lockedEvent.retryCount + 1
          const delay = this.poller.calculateBackoff(retryCount)
          
          await this.collection.updateOne(
            { _id: lockedEvent._id },
            {
              $set: {
                status: "failed",
                retryCount,
                lastError: formatErrorMessage(e),
                nextRetryAt: new Date(Date.now() + delay)
              }
            }
          )
        }
      }
    }
  }
}
