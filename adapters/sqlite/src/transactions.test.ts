import Database from "better-sqlite3"
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { OutboxEventBus } from "../../../core/src/outbox-event-bus"
import { SqliteOutbox, withSqliteTransaction, getSqliteTransaction } from "./index"
import { unlinkSync, existsSync } from "fs"

const DB_PATH = "./test-transactions.db"

describe("SqliteOutbox Transactions with AsyncLocalStorage", () => {
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

  beforeEach(() => {
    // Tables are created by init() in constructor
  })

  it("should commit both business data and outbox event in a transaction", async () => {
    const outbox = new SqliteOutbox({
      dbPath: DB_PATH,
      getTransaction: getSqliteTransaction(),
    })

    const eventBus = new OutboxEventBus(outbox, () => {}, () => {})

    // Create a dummy business table
    db.exec("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT)")

    const eventId = "event-commit"
    const userId = "user-commit"

    // Use withSqliteTransaction helper
    await withSqliteTransaction(db, async () => {
      // 1. Business logic
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(userId, "Alice")

      // 2. Emit event
      await eventBus.emit({
        id: eventId,
        type: "USER_CREATED",
        payload: { userId },
        occurredAt: new Date(),
      })
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
      getTransaction: getSqliteTransaction(),
    })

    const eventBus = new OutboxEventBus(outbox, () => {}, () => {})

    const eventId = "event-rollback"
    const userId = "user-rollback"

    try {
      await withSqliteTransaction(db, async () => {
        db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(userId, "Bob")

        await eventBus.emit({
          id: eventId,
          type: "USER_CREATED",
          payload: { userId },
          occurredAt: new Date(),
        })

        throw new Error("Forced rollback")
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

  it("should work with explicit transaction parameter", async () => {
    const outbox = new SqliteOutbox({
      dbPath: DB_PATH,
    })

    const eventBus = new OutboxEventBus(outbox, () => {}, () => {})

    const eventId = "event-explicit"
    const userId = "user-explicit"

    const transaction = db.transaction(() => {
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(userId, "Charlie")

      eventBus.emit({
        id: eventId,
        type: "USER_CREATED",
        payload: { userId },
        occurredAt: new Date(),
      }, db) // Pass db explicitly
    })

    transaction()

    // Verify
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId)
    expect(user).toBeDefined()

    const event = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(eventId)
    expect(event).toBeDefined()
  })

  it("should rollback with explicit transaction parameter on failure", async () => {
    const outbox = new SqliteOutbox({
      dbPath: DB_PATH,
    })

    const eventBus = new OutboxEventBus(outbox, () => {}, () => {})

    const eventId = "event-explicit-rollback"
    const userId = "user-explicit-rollback"

    const transaction = db.transaction(() => {
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(userId, "Dave")

      eventBus.emit({
        id: eventId,
        type: "USER_CREATED",
        payload: { userId },
        occurredAt: new Date(),
      }, db)

      throw new Error("Forced rollback")
    })

    try {
      transaction()
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
