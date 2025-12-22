import { AsyncLocalStorage } from "node:async_hooks"
import { eq } from "drizzle-orm"
import { pgTable, text, timestamp } from "drizzle-orm/pg-core"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { drizzle } from "drizzle-orm/postgres-js"
import { OutboxEventBus } from "outbox-event-bus"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { PostgresDrizzleOutbox } from "./index"
import { outboxEvents } from "./schema"

// Define a dummy business table for the test
const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

type Db = PostgresJsDatabase<Record<string, never>>

describe("PostgresDrizzle Outbox Transactions with AsyncLocalStorage", () => {
  const sql = postgres("postgres://test_user:test_password@localhost:5433/outbox_test")
  const db = drizzle(sql)

  const als = new AsyncLocalStorage<Db>()

  // A helper that acts as a sqlExecutor, grabbing the transaction from ALS if it exists
  const _sqlExecutorProxy = new Proxy(db, {
    get(target, prop, receiver) {
      const transaction = als.getStore()
      return Reflect.get(transaction ?? target, prop, receiver)
    },
  }) as unknown as Db

  const outbox = new PostgresDrizzleOutbox({
    db,
    getTransaction: () => als.getStore(),
    pollIntervalMs: 50,
  })

  // We use the proxy as the context for the event bus
  const eventBus = new OutboxEventBus(
    outbox,
    (_bus, type, count) => console.warn(`Max listeners for ${type}: ${count}`),
    (err) => console.error("Bus error:", err)
  )

  beforeAll(async () => {
    // Schema setup (in a real app this would be migrations)
    await sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, created_at TIMESTAMP DEFAULT NOW())`
    await sql`
      DO $$ BEGIN
        CREATE TYPE outbox_status AS ENUM ('created', 'active', 'completed', 'failed');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `
    await sql`CREATE TABLE IF NOT EXISTS outbox_events (
      id UUID PRIMARY KEY,
      type TEXT NOT NULL,
      payload JSONB NOT NULL,
      occurred_at TIMESTAMP NOT NULL,
      status outbox_status NOT NULL DEFAULT 'created',
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMP,
      created_on TIMESTAMP NOT NULL DEFAULT NOW(),
      started_on TIMESTAMP,
      completed_on TIMESTAMP,
      keep_alive TIMESTAMP,
      expire_in_seconds INTEGER NOT NULL DEFAULT 300
    )`
    await sql`DELETE FROM users`
    await sql`DELETE FROM outbox_events`
  })

  afterAll(async () => {
    await sql.end()
  })

  it("should commit both business data and outbox event in a transaction", async () => {
    const eventId = "3ed0f0a5-f4e1-4c7b-b5d1-1234567890ab"
    const userId = "user_456"

    await db.transaction(async (transaction) => {
      await als.run(transaction, async () => {
        // 1. Perform business operation
        await transaction.insert(users).values({ id: userId, name: "Alice" })

        // 2. Emit event using the transaction from ALS via our proxy
        await eventBus.emit({
          id: eventId,
          type: "USER_CREATED",
          payload: { userId, name: "Alice" },
          occurredAt: new Date(),
        })
      })
    })

    // Verify both are persisted
    const user = await db.select().from(users).where(eq(users.id, userId))
    expect(user).toHaveLength(1)

    const event = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId))
    expect(event).toHaveLength(1)
  })

  it("should rollback both business data and outbox event on failure", async () => {
    const eventId = "4fd1f1b6-f5f2-4d8c-c6e2-2345678901bc"
    const userId = "user_fail"

    try {
      await db.transaction(async (transaction) => {
        await als.run(transaction, async () => {
          await transaction.insert(users).values({ id: userId, name: "Bob" })

          await eventBus.emit({
            id: eventId,
            type: "USER_CREATED",
            payload: { userId, name: "Bob" },
            occurredAt: new Date(),
          })

          throw new Error("Forced rollback")
        })
      })
    } catch (_err) {
      // Expected
    }

    // Verify neither are persisted
    const user = await db.select().from(users).where(eq(users.id, userId))
    expect(user).toHaveLength(0)

    const event = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId))
    expect(event).toHaveLength(0)
  })
})
