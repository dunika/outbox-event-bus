import { describe, expect, it, beforeAll, afterAll, vi } from "vitest"
import { SqliteOutbox } from "./sqlite-outbox"
import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { unlinkSync, existsSync } from "node:fs"
import { join } from "node:path"

const DB_PATH = join(process.cwd(), `test-outbox-${randomUUID()}.db`)

describe("SqliteOutbox E2E", () => {
  let db: Database.Database

  beforeAll(() => {
    if (existsSync(DB_PATH)) {
      unlinkSync(DB_PATH)
    }
    db = new Database(DB_PATH)
  })

  afterAll(() => {
    if (db) {
      db.close()
    }
    if (existsSync(DB_PATH)) {
      unlinkSync(DB_PATH)
    }
  })

  it("should process events end-to-end", async () => {
    const outbox = new SqliteOutbox({
      dbPath: DB_PATH,
      pollIntervalMs: 100,
    })

    const eventId = "event-1"
    const event = {
      id: eventId,
      type: "user.created",
      payload: { userId: "123", email: "test@example.com" },
      occurredAt: new Date(),
    }

    // 1. Publish event
    await outbox.publish([event])

    // Verify it's in the DB with 'created' status
    const result = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(eventId) as any
    expect(result).toBeDefined()
    expect(result.status).toBe("created")

    // 2. Start processing
    const processedEvents: any[] = []
    const handler = async (events: any[]) => {
      processedEvents.push(...events)
    }

    outbox.start(handler, (err) => console.error("Outbox Error:", err))

    // Wait for polling
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Verify handler was called
    expect(processedEvents).toHaveLength(1)
    expect(processedEvents[0].id).toBe(eventId)

    // Verify it's moved to archive and deleted from outbox_events
    const eventAfter = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(eventId)
    expect(eventAfter).toBeUndefined()

    const archiveResult = db.prepare("SELECT * FROM outbox_events_archive WHERE id = ?").get(eventId) as any
    expect(archiveResult).toBeDefined()
    expect(archiveResult.status).toBe("completed")

    // 3. Stop outbox
    await outbox.stop()
  })

  it("should retry failed events", async () => {
    const outbox = new SqliteOutbox({
      dbPath: DB_PATH,
      pollIntervalMs: 100,
      baseBackoffMs: 100,
    })

    const eventId = "event-2"
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

    outbox.start(handler, () => {}) // Expected error, no-op

    // Wait for multiple attempts
    await new Promise((resolve) => setTimeout(resolve, 1500))

    await outbox.stop()

    const result = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(eventId) as any
    expect(result).toBeDefined()
    expect(result.status).toBe("failed")
    expect(result.retry_count).toBeGreaterThan(1)
    expect(attempts).toBeGreaterThan(1)
  })

  it("should recover from stuck events", async () => {
    const outbox = new SqliteOutbox({
      dbPath: DB_PATH,
      pollIntervalMs: 100,
    })

    const eventId = "event-stuck"
    const now = new Date()
    
    // Manually insert a "stuck" event (status active, timed out)
    // Default expire_in_seconds is 300
    db.prepare(`
      INSERT INTO outbox_events (id, type, payload, occurred_at, status, retry_count, keep_alive, expire_in_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId, 
      "stuck.event", 
      JSON.stringify({ stuck: true }), 
      new Date(now.getTime() - 400000).toISOString(),
      "active",
      0,
      new Date(now.getTime() - 350000).toISOString(),
      300
    )

    const processedEvents: any[] = []
    const handler = async (events: any[]) => {
      processedEvents.push(...events)
    }

    outbox.start(handler, (err) => console.error("Outbox Error:", err))

    // Wait for recovery poll
    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(processedEvents.some(e => e.id === eventId)).toBe(true)

    await outbox.stop()
  })

  it("should handle concurrent processing safely", async () => {
    // 1. Publish many events
    const eventCount = 50
    const events = Array.from({ length: eventCount }).map((_, i) => ({
      id: `concurrent-${i}`,
      type: "concurrent.test",
      payload: { index: i },
      occurredAt: new Date(),
    }))

    const outboxPublisher = new SqliteOutbox({
        dbPath: DB_PATH,
        pollIntervalMs: 100, // This instance is just for publishing
    })
    await outboxPublisher.publish(events)
    await outboxPublisher.stop()

    // 2. Start multiple outbox workers
    const workerCount = 5
    const processedEvents: any[] = []
    const workers: SqliteOutbox[] = []

    // Shared handler that pushes to processedEvents
    const handler = async (events: any[]) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 50))
      processedEvents.push(...events)
    }

    for (let i = 0; i < workerCount; i++) {
        // Sqlite handle multiple connections via better-sqlite3 (it's sync but supports WAL/concurrency to some extent)
        // Here we test safe locking if implemented or transaction safety.
        // Even with 1 connection, if the logic isn't atomic, we might get duplicates if polling overlaps.
        const worker = new SqliteOutbox({
            dbPath: DB_PATH, // Same DB file
            pollIntervalMs: 100 + (Math.random() * 50),
            batchSize: 5,
        })
        workers.push(worker)
        worker.start(handler, (err) => console.error(`Worker ${i} Error:`, err))
    }

    // 3. Wait for processing
    const maxWaitTime = 10000
    const startTime = Date.now()
    
    while (processedEvents.length < eventCount && (Date.now() - startTime) < maxWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, 200))
    }

    // 4. Verify results
    await Promise.all(workers.map(w => w.stop()))

    // Check count
    expect(processedEvents).toHaveLength(eventCount)

    // Check duplicates
    const ids = processedEvents.map(e => e.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(eventCount)
  })
})
