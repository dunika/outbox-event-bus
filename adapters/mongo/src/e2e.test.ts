import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from "vitest"
import { MongoClient } from "mongodb"
import { MongoOutbox } from "./index"

const MONGO_URL = "mongodb://localhost:27017"
const DB_NAME = "outbox_test"

describe("MongoOutbox E2E", () => {
  let client: MongoClient
  let outbox: MongoOutbox | null = null

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
    outbox = new MongoOutbox({
      client,
      dbName: DB_NAME,
      pollIntervalMs: 100, // fast polling for test
      onError: (err) => console.error("Outbox Error:", err),
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
    const handler = async (events: any[]) => {
      processedEvents.push(...events)
    }

    await outbox.start(handler)

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
    outbox = new MongoOutbox({
        client,
        dbName: DB_NAME,
        pollIntervalMs: 100,
        baseBackoffMs: 100, // short backoff for test
        onError: () => {}, // Expected error, no-op
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
    const handler = async (_events: any[]) => {
        attempts++
        throw new Error("Processing failed")
    }

    await outbox.start(handler)

    // Wait for multiple attempts
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const db = client.db(DB_NAME)
    const result = await db.collection("outbox_events").findOne({ eventId: eventId })
    
    expect(result?.status).toBe("failed")
    expect(result?.retryCount).toBeGreaterThan(1)
    expect(attempts).toBeGreaterThan(1)
  })

  it("should recover from stuck events", async () => {
    outbox = new MongoOutbox({
        client,
        dbName: DB_NAME,
        pollIntervalMs: 100,
        onError: (err) => console.error("Outbox Error:", err),
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
        keepAlive: new Date(now.getTime() - 65000) // In the past, beyond 60s hardcoded timeout
    } as any)

    const processedEvents: any[] = []
    outbox.start(async (events) => {
        processedEvents.push(...events)
    })

    // Wait for recovery poll
    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(processedEvents.some(e => e.id === eventId)).toBe(true)
  })
})
