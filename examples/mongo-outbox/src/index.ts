import { ObjectId, type Collection, type MongoClient } from "mongodb"
import type { BusEvent, IOutbox } from "outbox-event-bus"

export interface MongoOutboxConfig {
  client: MongoClient
  dbName: string
  collectionName?: string
  maxRetries?: number
  baseBackoffMs?: number
  pollIntervalMs?: number
  batchSize?: number
  onError: (error: unknown) => void
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

export class MongoOutbox implements IOutbox {
  private readonly collection: Collection<OutboxDocument>
  private readonly maxRetries: number
  private readonly baseBackoffMs: number
  private readonly pollIntervalMs: number
  private readonly batchSize: number
  private readonly onError: (error: unknown) => void

  private isPolling = false
  private pollTimer: NodeJS.Timeout | null = null
  private errorCount = 0
  private readonly maxErrorBackoffMs = 30000

  constructor(config: MongoOutboxConfig) {
    this.collection = config.client
      .db(config.dbName)
      .collection(config.collectionName ?? "outbox_events")
    this.maxRetries = config.maxRetries ?? 5
    this.baseBackoffMs = config.baseBackoffMs ?? 1000
    this.pollIntervalMs = config.pollIntervalMs ?? 1000
    this.batchSize = config.batchSize ?? 50
    this.onError = config.onError
  }

  async publish(events: BusEvent[]): Promise<void> {
    if (events.length === 0) return

    const now = new Date()
    const documents: OutboxDocument[] = events.map((e) => ({
      _id: new ObjectId(),
      eventId: e.id,
      type: e.type,
      payload: e.payload,
      occurredAt: e.occurredAt,
      status: "created",
      retryCount: 0,
      nextRetryAt: now,
      expireInSeconds: 60,
      keepAlive: now,
    }))

    await this.collection.insertMany(documents)
  }

  async start(handler: (events: BusEvent[]) => Promise<void>): Promise<void> {
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
    const now = new Date()

    // 1. Find and lock events
    // We'll process them one by one for simplicity in locking, or use a multi-stage approach.
    // MongoDB doesn't have "SKIP LOCKED" exactly like Postgres, but we can use findOneAndUpdate 
    // to atomically mark events as "active".

    const lockedEvents: OutboxDocument[] = []
    
    for (let i = 0; i < this.batchSize; i++) {
      const result = await this.collection.findOneAndUpdate(
        {
          $or: [
            { status: "created" },
            { 
              status: "failed", 
              retryCount: { $lt: this.maxRetries },
              nextRetryAt: { $lte: now }
            },
            {
              status: "active",
              keepAlive: { $lt: new Date(now.getTime() - 60000) } // Stuck if no keep-alive for 60s
            }
          ]
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

    try {
      // 2. Process events
      await handler(busEvents)

      // 3. Mark as completed
      await this.collection.updateMany(
        { _id: { $in: lockedEvents.map(e => e._id) } },
        {
          $set: {
            status: "completed",
            completedOn: new Date()
          }
        }
      )
      
      // Optionally move to archive or delete. Drizzle example moves to archive and deletes.
      // For MongoDB, we'll just leave it as 'completed' for now, or we could delete.
      // Let's follow the Drizzle pattern and delete after "processing" if we had an archive collection.
      // But for this simple example, marking as completed is enough.
      
    } catch (error: unknown) {
      // 4. Build retry updates on failure
      const msNow = Date.now()
      for (const event of lockedEvents) {
        const retryCount = event.retryCount + 1
        const delay = this.baseBackoffMs * 2 ** (retryCount - 1)
        
        try {
          await this.collection.updateOne(
            { _id: event._id },
            {
              $set: {
                status: "failed",
                retryCount,
                lastError: error instanceof Error ? error.message : String(error),
                nextRetryAt: new Date(msNow + delay)
              }
            }
          )
        } catch (updateError) {
          this.onError(updateError)
        }
      }
    }
  }
}
