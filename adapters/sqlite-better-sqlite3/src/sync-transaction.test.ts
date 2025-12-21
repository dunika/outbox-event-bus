import { existsSync, unlinkSync } from "node:fs"
import Database from "better-sqlite3"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { OutboxEventBus } from "../../../core/src/bus/outbox-event-bus"
import { SqliteBetterSqlite3Outbox } from "./index"

const DB_PATH = "./test-sync-transactions.db"

describe("SqliteBetterSqlite3Outbox Synchronous Transactions", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    // Create business table
    db.exec("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT)")
  })

  afterAll(() => {
    if (db) {
      db.close()
    }
    if (existsSync(DB_PATH)) {
      unlinkSync(DB_PATH)
    }
  })

  it("should atomically commit event and data when using shared connection", async () => {
    // 1. Setup Outbox with getTransaction returning the shared db
    const outbox = new SqliteBetterSqlite3Outbox({
      db,
      getTransaction: () => db, // <--- CRITICAL: Use the same DB instance
    })
    const bus = new OutboxEventBus(outbox, (err) => console.error(err))

    const userId = "user-1"
    const eventId = "event-1"

    // 2. Run synchronous transaction
    const createUser = db.transaction(() => {
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(userId, "Alice")

      // Emit event synchronously (using void to ignore Promise)
      // Since we provided getTransaction: () => db, this uses the SAME connection
      // and thus participates in the transaction via SAVEPOINT
      void bus.emit({
        id: eventId,
        type: "user.created",
        payload: { id: userId, name: "Alice" },
      })
    })

    createUser()

    // 3. Verify both exist
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId)
    expect(user).toBeDefined()

    const event = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(eventId)
    expect(event).toBeDefined()
  })

  it("should atomically rollback event and data on error", async () => {
    const outbox = new SqliteBetterSqlite3Outbox({
      db,
      getTransaction: () => db,
    })
    const bus = new OutboxEventBus(outbox, (err) => console.error(err))

    const userId = "user-2"
    const eventId = "event-2"

    // 2. Run synchronous transaction that fails
    const createUser = db.transaction(() => {
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(userId, "Bob")

      void bus.emit({
        id: eventId,
        type: "user.created",
        payload: { id: userId, name: "Bob" },
      })

      throw new Error("Rollback!")
    })

    expect(() => createUser()).toThrow("Rollback!")

    // 3. Verify NEITHER exist
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId)
    expect(user).toBeUndefined()

    const event = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(eventId)
    expect(event).toBeUndefined()
  })

  it("should throw TypeError if async function is used (preventing await usage)", async () => {
    const outbox = new SqliteBetterSqlite3Outbox({
      dbPath: DB_PATH,
      getTransaction: () => db,
    })
    const _bus = new OutboxEventBus(outbox, (err) => console.error(err))

    const userId = "user-async"

    // @ts-expect-error - Testing runtime behavior
    const tx = db.transaction(async () => {
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(userId, "Async")
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    // It throws TypeError: Transaction function cannot return a promise
    expect(() => tx()).toThrow("Transaction function cannot return a promise")

    // Verify rollback happened
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId)
    expect(user).toBeUndefined()
  })
})
