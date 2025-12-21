import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { PostgresDrizzleOutbox } from "./index"
import { outboxEvents } from "./schema"

const DB_URL = "postgres://test_user:test_password@localhost:5433/outbox_test"

describe("PostgresDrizzleOutbox E2E", () => {
  let client: postgres.Sql
  let db: ReturnType<typeof drizzle>
  let outbox: PostgresDrizzleOutbox

  beforeAll(async () => {
    // 1. Connect to DB with retry
    const maxRetries = 10
    const delay = 1000

    for (let i = 0; i < maxRetries; i++) {
      try {
        client = postgres(DB_URL)
        db = drizzle(client)
        await client`SELECT 1` // Test connection
        break
      } catch (e: unknown) {
        // The original `this.onError(e)` is not applicable in a `beforeAll` hook.
        // Reverting to original error handling logic for retries.
        if (i === maxRetries - 1) {
          // If it's the last retry, rethrow the error
          throw e
        }
        // Close failed connection if client was initialized
        if (client) {
          await client.end()
        }
        await new Promise((res) => setTimeout(res, delay))
      }
    }

    // 2. Run migrations (push schema)
    // For this example, we'll just push the schema using drizzle-kit or raw sql if needed.
    // However, since we are in code, we can use `migrate` if we had migration files.
    // Instead, let's create tables manually for this test or assume drizzle-kit push was run.
    // Actually, `drizzle-kit push` is for dev.
    // Let's execute raw SQL to create tables to keep it self-contained without needing migration files generated.

    // Use unsafe for multiple statements or split them. Postgres.js template tag effectively prepares statements.

    await client`DROP TABLE IF EXISTS outbox_events_archive`
    await client`DROP TABLE IF EXISTS outbox_events`
    await client`DROP TYPE IF EXISTS outbox_status`

    await client`
      CREATE TYPE outbox_status AS ENUM ('created', 'active', 'completed', 'failed')
    `

    await client`
      CREATE TABLE outbox_events (
        id uuid PRIMARY KEY,
        type text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamp NOT NULL,
        status outbox_status NOT NULL DEFAULT 'created',
        retry_count integer NOT NULL DEFAULT 0,
        last_error text,
        next_retry_at timestamp,
        created_on timestamp NOT NULL DEFAULT now(),
        started_on timestamp,
        completed_on timestamp,
        keep_alive timestamp,
        expire_in_seconds integer NOT NULL DEFAULT 300
      )
    `

    await client`
      CREATE TABLE outbox_events_archive (
        id uuid PRIMARY KEY,
        type text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamp NOT NULL,
        status outbox_status NOT NULL,
        retry_count integer NOT NULL,
        last_error text,
        created_on timestamp NOT NULL,
        started_on timestamp,
        completed_on timestamp NOT NULL
      )
    `
  })

  afterAll(async () => {
    await client.end()
  })

  it("should process events end-to-end", async () => {
    // Initialize outbox
    outbox = new PostgresDrizzleOutbox({
      db,
      pollIntervalMs: 100,
    })

    const eventId = crypto.randomUUID()
    const event = {
      id: eventId,
      type: "user.created",
      payload: { userId: "123", email: "test@example.com" },
      occurredAt: new Date(),
    }

    await outbox.publish([event])

    const result = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId))
    expect(result).toHaveLength(1)
    expect(result[0]?.status).toBe("created")

    const processedEvents: any[] = []
    const handler = async (event: any) => {
      processedEvents.push(event)
    }

    await outbox.start(handler, (err: unknown) => console.error("Outbox Error:", err))

    await new Promise((resolve) => setTimeout(resolve, 2000))

    expect(processedEvents).toHaveLength(1)
    expect(processedEvents[0].id).toBe(eventId)

    const resultAfter = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId))
    expect(resultAfter).toHaveLength(0)

    // 3. Stop outbox
    await outbox.stop()
  })

  it("should retry failed events", async () => {
    outbox = new PostgresDrizzleOutbox({
      db,
      pollIntervalMs: 100,
      baseBackoffMs: 100,
    })

    const eventId = crypto.randomUUID()
    const event = {
      id: eventId,
      type: "order.placed",
      payload: { orderId: "abc" },
      occurredAt: new Date(),
    }

    await outbox.publish([event])

    let _attempts = 0
    const onError = vi.fn()

    const handler = async (_event: any) => {
      _attempts++
      throw new Error("Processing failed")
    }

    await outbox.start(handler, onError)

    // Wait for multiple attempts
    await new Promise((resolve) => setTimeout(resolve, 2000))

    await outbox.stop()

    const result = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId))
    expect(result).toHaveLength(1)
    expect(result[0]?.status).toBe("failed")
    expect(result[0]?.retryCount).toBeGreaterThan(1)
    expect(onError).toHaveBeenCalled()
  })

  it("should support manual management of failed events", async () => {
    outbox = new PostgresDrizzleOutbox({
      db,
      pollIntervalMs: 100,
    })

    const eventId = crypto.randomUUID()
    const event = {
      id: eventId,
      type: "manual.retry",
      payload: {},
      occurredAt: new Date(),
    }

    await db.insert(outboxEvents).values({
      id: eventId,
      type: event.type,
      payload: event.payload,
      occurredAt: event.occurredAt,
      status: "failed",
      retryCount: 5,
      lastError: "Manual failure",
    })

    const inserted = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId))
    console.log("DRIZZLE TEST DEBUG: Inserted row:", inserted)

    const failed = await outbox.getFailedEvents()
    const targetEvent = failed.find((e) => e.id === eventId)

    expect(targetEvent).toBeDefined()
    expect(targetEvent!.id).toBe(eventId)
    expect(targetEvent!.error).toBe("Manual failure")
    expect(targetEvent!.retryCount).toBe(5)
    await outbox.retryEvents([eventId])

    const retried = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId))
    expect(retried[0]?.status).toBe("created")
    expect(retried[0]?.retryCount).toBe(0)
    expect(retried[0]?.lastError).toBeNull()

    const processed: any[] = []
    outbox.start(
      async (e) => {
        processed.push(e)
      },
      (err) => console.error(err)
    )

    await new Promise((r) => setTimeout(r, 1000))
    await outbox.stop()

    expect(processed).toHaveLength(1)
    expect(processed[0].id).toBe(eventId)
  })

  it("should recover from stuck events", async () => {
    outbox = new PostgresDrizzleOutbox({
      db,
      pollIntervalMs: 100,
    })

    const eventId = crypto.randomUUID()
    const now = new Date()

    await db.insert(outboxEvents).values({
      id: eventId,
      type: "stuck.event",
      payload: { stuck: true },
      occurredAt: new Date(now.getTime() - 400000),
      status: "active",
      retryCount: 0,
      keepAlive: new Date(now.getTime() - 350000),
      expireInSeconds: 300,
      createdOn: new Date(now.getTime() - 400000),
    })

    const processedEvents: any[] = []
    outbox.start(
      async (event) => {
        processedEvents.push(event)
      },
      (err: unknown) => console.error("Outbox Error:", err)
    )

    await new Promise((resolve) => setTimeout(resolve, 2000))

    expect(processedEvents.some((e) => e.id === eventId)).toBe(true)

    await outbox.stop()
  })

  it("should handle concurrent processing safely", async () => {
    const eventCount = 50
    const events = Array.from({ length: eventCount }).map((_, i) => ({
      id: crypto.randomUUID(),
      type: "concurrent.test",
      payload: { index: i },
      occurredAt: new Date(),
    }))

    outbox = new PostgresDrizzleOutbox({
      db,
      pollIntervalMs: 100,
    })
    await outbox.publish(events)
    await outbox.stop()

    const workerCount = 5
    const processedEvents: any[] = []
    const workers: PostgresDrizzleOutbox[] = []

    const handler = async (event: any) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 50))
      processedEvents.push(event)
    }

    for (let i = 0; i < workerCount; i++) {
      const worker = new PostgresDrizzleOutbox({
        db,
        pollIntervalMs: 100 + Math.random() * 50,
        batchSize: 5,
      })
      workers.push(worker)
      worker.start(handler, (err) => console.error(`Worker ${i} Error:`, err))
    }

    const maxWaitTime = 10000
    const startTime = Date.now()

    while (processedEvents.length < eventCount && Date.now() - startTime < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    await Promise.all(workers.map((w) => w.stop()))

    expect(processedEvents).toHaveLength(eventCount)
    const ids = processedEvents.map((e) => e.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(eventCount)
  })

  it("should handle partial batch failures (one succeeds, one fails)", async () => {
    outbox = new PostgresDrizzleOutbox({
      db,
      pollIntervalMs: 100,
      baseBackoffMs: 100,
    })

    const successId = randomUUID()
    const failId = randomUUID()

    const events = [
      {
        id: successId,
        type: "partial.success",
        payload: { fail: false },
        occurredAt: new Date(),
      },
      {
        id: failId,
        type: "partial.fail",
        payload: { fail: true },
        occurredAt: new Date(),
      },
    ]

    await outbox.publish(events)

    const processedEvents: any[] = []
    const onError = vi.fn()

    const handler = async (event: any) => {
      if (event.payload.fail) {
        throw new Error("Intentional partial failure")
      }
      processedEvents.push(event)
    }

    await outbox.start(handler, onError)

    await new Promise((resolve) => setTimeout(resolve, 3000))

    await outbox.stop()

    const successResult = await db.select().from(outboxEvents).where(eq(outboxEvents.id, successId))
    expect(successResult).toHaveLength(0)

    // 2. Failed event should be in outbox with failed status
    const failResult = await db.select().from(outboxEvents).where(eq(outboxEvents.id, failId))
    expect(failResult).toHaveLength(1)
    expect(failResult[0]?.status).toBe("failed")
    expect(failResult[0]?.retryCount).toBeGreaterThan(0)

    // 3. Handler should have successfully processed one
    expect(processedEvents).toHaveLength(1)
    expect(processedEvents[0].id).toBe(successId)

    // 4. Error handler should be called
    expect(onError).toHaveBeenCalled()
  })
})
