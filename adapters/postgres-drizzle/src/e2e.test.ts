import { describe, expect, it, beforeAll, afterAll } from "vitest"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { PostgresDrizzleOutbox } from "./index"
import { outboxEvents } from "./schema"
import { eq } from "drizzle-orm"

const DB_URL = "postgres://test_user:test_password@localhost:5432/outbox_test"

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
                throw e;
            }
            // Close failed connection if client was initialized
            if (client) {
                await client.end();
            }
            await new Promise(res => setTimeout(res, delay));
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
      pollIntervalMs: 100, // fast polling for test
      onError: (err: unknown) => console.error("Outbox Error:", err),
    })

    const eventId = crypto.randomUUID()
    const event = {
      id: eventId,
      type: "user.created",
      payload: { userId: "123", email: "test@example.com" },
      occurredAt: new Date(),
    }

    // 1. Publish event
    await outbox.publish([event])

    // Verify it's in the DB with 'created' status
    const result = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId))
    expect(result).toHaveLength(1)
    expect(result[0]?.status).toBe("created")

    // 2. Start processing
    const processedEvents: any[] = []
    const handler = async (_events: any[]) => {
      processedEvents.push(..._events)
    }

    await outbox.start(handler)

    // Wait for polling
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Verify handler was called
    expect(processedEvents).toHaveLength(1)
    expect(processedEvents[0].id).toBe(eventId)

    // Verify it's removed from outbox table (since it completes successfully)
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
        onError: () => {}, // Expected error, no-op
    })

    const eventId = crypto.randomUUID()
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
    await new Promise((resolve) => setTimeout(resolve, 2000))

    await outbox.stop()

    const result = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId))
    expect(result).toHaveLength(1)
    expect(result[0]?.status).toBe("failed")
    expect(result[0]?.retryCount).toBeGreaterThan(1)
    expect(attempts).toBeGreaterThan(1)
  })

  it("should recover from stuck events", async () => {
    outbox = new PostgresDrizzleOutbox({
      db,
      pollIntervalMs: 100,
      onError: (err: unknown) => console.error("Outbox Error:", err),
    })

    const eventId = crypto.randomUUID()
    const now = new Date()
    
    // Manually insert a "stuck" event (status active, timed out)
    await db.insert(outboxEvents).values({
      id: eventId,
      type: "stuck.event",
      payload: { stuck: true },
      occurredAt: new Date(now.getTime() - 400000),
      status: "active",
      retryCount: 0,
      keepAlive: new Date(now.getTime() - 350000),
      expireInSeconds: 300,
      createdOn: new Date(now.getTime() - 400000)
    })

    const processedEvents: any[] = []
    outbox.start(async (events) => {
      processedEvents.push(...events)
    })

    // Wait for recovery poll
    await new Promise((resolve) => setTimeout(resolve, 2000))

    expect(processedEvents.some(e => e.id === eventId)).toBe(true)

    await outbox.stop()
  })
})
