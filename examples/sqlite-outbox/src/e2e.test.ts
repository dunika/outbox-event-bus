import { describe, expect, it, beforeAll, afterAll } from "vitest"
import { SqliteOutbox } from "./index"
import Database from "better-sqlite3"
import { unlinkSync, existsSync } from "fs"

const DB_PATH = "./test-outbox.db"

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
      onError: (err) => console.error("Outbox Error:", err),
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

    await outbox.start(handler)

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
      onError: () => {}, // Expected error, no-op
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

    await outbox.start(handler)

    // Wait for multiple attempts
    await new Promise((resolve) => setTimeout(resolve, 1500))

    await outbox.stop()

    const result = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(eventId) as any
    expect(result).toBeDefined()
    expect(result.status).toBe("failed")
    expect(result.retry_count).toBeGreaterThan(1)
    expect(attempts).toBeGreaterThan(1)
  })
})
