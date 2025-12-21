import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from "vitest"
import { MongoClient } from "mongodb"
import { MongoMongodbOutbox } from "./index"

const MONGO_URL = "mongodb://localhost:27017"
const DB_NAME = "outbox_test"

describe("MongoMongodbOutbox E2E", () => {
  let client: MongoClient
  let outbox: MongoMongodbOutbox | null = null

  beforeAll(async () => {
    // 1. Connect to MongoDB with retry
    const maxRetries = 10
    const delay = 1000

    for (let i = 0; i < maxRetries; i++) {
        try {
            client = new MongoClient(MONGO_URL)
            await client.connect()
            await client.db(DB_NAME).command({ ping: 1 })
            break
        } catch (err) {
            if (i === maxRetries - 1) throw err
            await new Promise(res => setTimeout(res, delay))
        }
    }
  })

  afterAll(async () => {
    if (client) {
        await client.close()
    }
  })

  beforeEach(async () => {
    const db = client.db(DB_NAME)
    await db.collection("outbox_events").deleteMany({})
    outbox = null
  })

  afterEach(async () => {
    if (outbox) {
      await outbox.stop()
    }
  })

  it("should process events end-to-end", async () => {
    // Initialize outbox
    outbox = new MongoMongodbOutbox({
      client,
      dbName: DB_NAME,
      pollIntervalMs: 100, // fast polling for test
    })

    const eventId = "507f1f77bcf86cd799439011" // Valid hex string for ObjectId
    const event = {
      id: eventId,
      type: "user.created",
      payload: { userId: "123", email: "test@example.com" },
      occurredAt: new Date(),
    }

    // 1. Publish event
    await outbox.publish([event])

    // Verify it's in the DB with 'created' status
    const db = client.db(DB_NAME)
    const result = await db.collection("outbox_events").findOne({ eventId: eventId })
    expect(result).not.toBeNull()
    expect(result?.status).toBe("created")

    // 2. Start processing
    const processedEvents: any[] = []
    const handler = async (event: any) => {
      processedEvents.push(event)
    }

    await outbox.start(handler, () => {})

    // Wait for polling
    await new Promise((resolve) => setTimeout(resolve, 800))

    // Verify handler was called
    expect(processedEvents).toHaveLength(1)
    expect(processedEvents[0].id).toBe(eventId)

    // Verify it's marked as 'completed' in DB
    const resultAfter = await db.collection("outbox_events").findOne({ eventId: eventId })
    expect(resultAfter?.status).toBe("completed")
  })

  it("should retry failed events", async () => {
    outbox = new MongoMongodbOutbox({
        client,
        dbName: DB_NAME,
        pollIntervalMs: 100,
        baseBackoffMs: 100, // short backoff for test
    })

    const eventId = "507f1f77bcf86cd799439012"
    const event = {
        id: eventId,
        type: "order.placed",
        payload: { orderId: "abc" },
        occurredAt: new Date(),
    }

    await outbox.publish([event])

    let attempts = 0
    const handler = async (_event: any) => {
        attempts++
        throw new Error("Processing failed")
    }

    await outbox.start(handler, () => {})

    // Wait for multiple attempts
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const db = client.db(DB_NAME)
    const result = await db.collection("outbox_events").findOne({ eventId: eventId })
    
    expect(result?.status).toBe("failed")
    expect(result?.retryCount).toBeGreaterThan(1)
    expect(attempts).toBeGreaterThan(1)
  })

  it("should support manual management of failed events", async () => {
    outbox = new MongoMongodbOutbox({
      client,
      dbName: DB_NAME,
      pollIntervalMs: 100,
    })

    const eventId = "507f1f77bcf86cd799439014"
    const event = {
      id: eventId,
      type: "manual.retry",
      payload: {},
      occurredAt: new Date(),
    }

    // 1. Insert directly as failed
    const db = client.db(DB_NAME)
    await db.collection("outbox_events").insertOne({
        eventId: eventId,
        type: event.type,
        payload: event.payload,
        occurredAt: event.occurredAt,
        status: "failed",
        retryCount: 5,
        lastError: "Manual failure"
    } as any)

    // 2. Get failed events
    const failed = await outbox.getFailedEvents()
    expect(failed).toHaveLength(1)
    expect(failed[0].id).toBe(eventId)
    expect(failed[0].error).toBe("Manual failure")

    // 3. Retry
    await outbox.retryEvents([eventId])

    // 4. Verify status reset
    const retried = await db.collection("outbox_events").findOne({ eventId: eventId })
    expect(retried?.status).toBe("created")
    expect(retried?.retryCount).toBe(0)
    expect(retried?.lastError).toBeUndefined()

    // 5. Verify it gets processed
    const processed: any[] = []
    outbox.start(async (e) => {
      processed.push(e)
    }, (err) => console.error(err))

    await new Promise(r => setTimeout(r, 1000))
    await outbox.stop()

    expect(processed).toHaveLength(1)
    expect(processed[0].id).toBe(eventId)
  })

  it("should recover from stuck events", async () => {
    outbox = new MongoMongodbOutbox({
        client,
        dbName: DB_NAME,
        pollIntervalMs: 100,
    })

    const eventId = "507f1f77bcf86cd799439013"
    const now = new Date()
    
    // Manually insert a "stuck" event (status active, timed out)
    const db = client.db(DB_NAME)
    await db.collection("outbox_events").insertOne({
        eventId: eventId,
        type: "stuck.event",
        payload: { stuck: true },
        occurredAt: new Date(now.getTime() - 70000),
        status: "active",
        retryCount: 0,
        expireInSeconds: 60,
        keepAlive: new Date(now.getTime() - 65000) // In the past, beyond 60s hardcoded timeout
    } as any)

    const processedEvents: any[] = []
    outbox.start(async (event) => {
        processedEvents.push(event)
    }, (err) => console.error("Outbox Error:", err))

    // Wait for recovery poll
    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(processedEvents.some(e => e.id === eventId)).toBe(true)
  })

  it("should handle concurrent processing safely", async () => {
    const eventCount = 50
    const events = Array.from({ length: eventCount }).map((_, i) => ({
      id: "507f1f77bcf86cd799439" + (100 + i).toString(), // Valid ObjectId-ish
      type: "concurrent.test",
      payload: { index: i },
      occurredAt: new Date(),
    }))

    outbox = new MongoMongodbOutbox({
        client,
        dbName: DB_NAME,
        pollIntervalMs: 100,
    })
    await outbox.publish(events)
    await outbox.stop()

    const workerCount = 5
    const processedEvents: any[] = []
    const workers: MongoMongodbOutbox[] = []

    const handler = async (event: any) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 50))
      processedEvents.push(event)
    }

    const clientsToClose: MongoClient[] = []
    
    for (let i = 0; i < workerCount; i++) {
        // New client for each worker to simulate separate processes
        const workerClient = new MongoClient(MONGO_URL)
        await workerClient.connect()
        clientsToClose.push(workerClient)
        
        const worker = new MongoMongodbOutbox({
            client: workerClient,
            dbName: DB_NAME,
            pollIntervalMs: 100 + (Math.random() * 50),
            batchSize: 5,
        })
        workers.push(worker)
        worker.start(handler, (err) => console.error(`Worker ${i} Error:`, err))
    }

    const maxWaitTime = 10000
    const startTime = Date.now()
    
    while (processedEvents.length < eventCount && (Date.now() - startTime) < maxWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, 200))
    }

    await Promise.all(workers.map(w => w.stop()))
    await Promise.all(clientsToClose.map(c => c.close()))
    
    // Check count
    expect(processedEvents).toHaveLength(eventCount)

    // Check duplicates
    const ids = processedEvents.map(e => e.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(eventCount)
  })
})
