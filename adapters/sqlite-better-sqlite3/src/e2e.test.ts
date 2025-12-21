import { randomUUID } from "node:crypto"
import { existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import Database from "better-sqlite3"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SqliteBetterSqlite3Outbox } from "./sqlite-better-sqlite3-outbox"

const DB_PATH = join(process.cwd(), `test-outbox-${randomUUID()}.db`)

describe("SqliteBetterSqlite3Outbox E2E", () => {
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
    const outbox = new SqliteBetterSqlite3Outbox({
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

    const processedEvents: any[] = []
    const handler = async (event: any) => {
      processedEvents.push(event)
    }

    outbox.start(handler, (err) => console.error("Outbox Error:", err))

    await new Promise((resolve) => setTimeout(resolve, 1000))

    expect(processedEvents).toHaveLength(1)
    expect(processedEvents[0].id).toBe(eventId)

    // Verify it's moved to archive and deleted from outbox_events
    const eventAfter = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(eventId)
    expect(eventAfter).toBeUndefined()

    const archiveResult = db
      .prepare("SELECT * FROM outbox_events_archive WHERE id = ?")
      .get(eventId) as any
    expect(archiveResult).toBeDefined()
    expect(archiveResult.status).toBe("completed")

    // 3. Stop outbox
    await outbox.stop()
  })

  it("should retry failed events", async () => {
    const outbox = new SqliteBetterSqlite3Outbox({
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
    const handler = async (_event: any) => {
      attempts++
      throw new Error("Processing failed")
    }

    outbox.start(handler, () => {})

    await new Promise((resolve) => setTimeout(resolve, 1500))

    await outbox.stop()

    const result = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(eventId) as any
    expect(result).toBeDefined()
    expect(result.status).toBe("failed")
    expect(result.retry_count).toBeGreaterThan(1)
    expect(attempts).toBeGreaterThan(1)
  })

  it("should support manual management of failed events", async () => {
    const outbox = new SqliteBetterSqlite3Outbox({
      dbPath: DB_PATH,
      pollIntervalMs: 100,
    })

    const eventId = "event-manual"
    const event = {
      id: eventId,
      type: "manual.retry",
      payload: {},
      occurredAt: new Date(),
    }

    // 1. Insert directly as failed
    db.prepare(`
        INSERT INTO outbox_events (id, type, payload, occurred_at, status, retry_count, last_error)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      event.type,
      JSON.stringify(event.payload),
      event.occurredAt.toISOString(),
      "failed",
      5,
      "Manual failure"
    )

    const inserted = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(eventId)
    console.log("SQLITE TEST DEBUG: Inserted row:", inserted)

    // 2. Get failed events
    const failed = await outbox.getFailedEvents()
    const targetEvent = failed.find((e) => e.id === eventId)

    expect(targetEvent).toBeDefined()
    expect(targetEvent!.id).toBe(eventId)
    expect(targetEvent!.error).toBe("Manual failure")
    expect(targetEvent!.retryCount).toBe(5)

    // 3. Retry
    await outbox.retryEvents([eventId])

    // 4. Verify status reset
    const retried = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(eventId) as any
    expect(retried).toBeDefined()
    expect(retried.status).toBe("created")
    expect(retried.retry_count).toBe(0)
    expect(retried.last_error).toBeNull()

    const processed: any[] = []
    outbox.start(
      async (e) => {
        processed.push(e)
      },
      (err) => console.error(err)
    )

    await new Promise((r) => setTimeout(r, 1000))
    await outbox.stop()

    const processedEvent = processed.find((e) => e.id === eventId)
    expect(processedEvent).toBeDefined()
    expect(processedEvent!.id).toBe(eventId)
  })

  it("should recover from stuck events", async () => {
    const outbox = new SqliteBetterSqlite3Outbox({
      dbPath: DB_PATH,
      pollIntervalMs: 100,
    })

    const eventId = "event-stuck"
    const now = new Date()

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
    const handler = async (event: any) => {
      processedEvents.push(event)
    }

    outbox.start(handler, (err) => console.error("Outbox Error:", err))

    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(processedEvents.some((e) => e.id === eventId)).toBe(true)

    await outbox.stop()
  })

  it("should handle concurrent processing safely", async () => {
    const eventCount = 50
    const events = Array.from({ length: eventCount }).map((_, i) => ({
      id: `concurrent-${i}`,
      type: "concurrent.test",
      payload: { index: i },
      occurredAt: new Date(),
    }))

    const outboxPublisher = new SqliteBetterSqlite3Outbox({
      dbPath: DB_PATH,
      pollIntervalMs: 100,
    })
    await outboxPublisher.publish(events)
    await outboxPublisher.stop()

    const workerCount = 5
    const processedEvents: any[] = []
    const workers: SqliteBetterSqlite3Outbox[] = []

    // Shared handler that pushes to processedEvents
    const handler = async (event: any) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 50))
      processedEvents.push(event)
    }

    for (let i = 0; i < workerCount; i++) {
      // Sqlite handle multiple connections via better-sqlite3 (it's sync but supports WAL/concurrency to some extent)
      // Here we test safe locking if implemented or transaction safety.
      // Even with 1 connection, if the logic isn't atomic, we might get duplicates if polling overlaps.
      const worker = new SqliteBetterSqlite3Outbox({
        dbPath: DB_PATH,
        pollIntervalMs: 100 + Math.random() * 50,
        batchSize: 5,
      })
      workers.push(worker)
      worker.start(handler, (err) => console.error(`Worker ${i} Error:`, err))
    }

    // 3. Wait for processing
    const maxWaitTime = 10000
    const startTime = Date.now()

    while (processedEvents.length < eventCount && Date.now() - startTime < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    // 4. Verify results
    await Promise.all(workers.map((w) => w.stop()))

    expect(processedEvents).toHaveLength(eventCount)
    const ids = processedEvents.map((event) => event.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(eventCount)
  })
})
