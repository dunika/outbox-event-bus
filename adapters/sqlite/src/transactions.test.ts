import { AsyncLocalStorage } from "node:async_hooks"
import Database from "better-sqlite3"
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { OutboxEventBus } from "../../../core/src/outbox-event-bus"
import { SqliteOutbox } from "./index"
import { unlinkSync, existsSync } from "fs"

const DB_PATH = "./test-transactions.db"

describe("SqliteOutbox Transactions with AsyncLocalStorage", () => {
  let db: Database.Database
  const als = new AsyncLocalStorage<Database.Database>()

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

  beforeEach(() => {
    // We don't need to manually clear outbox_events if SqliteOutbox init() is called 
    // but building the outbox will call init() which creates the tables.
  })

  it("should commit both business data and outbox event in a transaction", async () => {
    const outbox = new SqliteOutbox({
      dbPath: DB_PATH,
      getExecutor: () => als.getStore(),
      onError: () => {},
    })

    const eventBus = new OutboxEventBus(outbox, () => {}, () => {})

    // Create a dummy business table
    db.exec("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT)")

    const eventId = "event-commit"
    const userId = "user-commit"

    // Use better-sqlite3 transaction
    const tx = db.transaction(() => {
      // 1. Business logic
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(userId, "Alice")

      // 2. Emit event
      eventBus.emit({
        id: eventId,
        type: "USER_CREATED",
        payload: { userId },
        occurredAt: new Date(),
      })
    })

    // Run in ALS context
    await als.run(db, async () => {
        tx()
    })

    // Verify
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId)
    expect(user).toBeDefined()

    const event = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(eventId)
    expect(event).toBeDefined()
  })

  it("should rollback both business data and outbox event on failure", async () => {
    const outbox = new SqliteOutbox({
      dbPath: DB_PATH,
      getExecutor: () => als.getStore(),
      onError: () => {},
    })

    const eventBus = new OutboxEventBus(outbox, () => {}, () => {})

    const eventId = "event-rollback"
    const userId = "user-rollback"

    const tx = db.transaction(() => {
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(userId, "Bob")

      eventBus.emit({
        id: eventId,
        type: "USER_CREATED",
        payload: { userId },
        occurredAt: new Date(),
      })

      throw new Error("Forced rollback")
    })

    try {
      await als.run(db, async () => {
          tx()
      })
    } catch (err) {
      // Expected
    }

    // Verify
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId)
    expect(user).toBeUndefined()

    const event = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(eventId)
    expect(event).toBeUndefined()
  })
})
