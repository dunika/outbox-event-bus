import { execSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { OutboxStatus, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { PostgresPrismaOutbox } from "./index"

const DATABASE_URL = "postgresql://test_user:test_password@127.0.0.1:5434/outbox_test"

describe("PostgresPrismaOutbox E2E", () => {
  let prisma: PrismaClient
  let outbox: PostgresPrismaOutbox

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL

    // Run db push to setup schema
    try {
      // Need to retry a few times as DB might be starting up even with --wait
      let retries = 5
      while (retries > 0) {
        try {
          execSync(`npx prisma db push --accept-data-loss --url "${DATABASE_URL}"`, {
            stdio: "inherit",
            env: process.env,
          })
          break
        } catch (e) {
          retries--
          if (retries === 0) throw e
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
    } catch (e) {
      console.error("Failed to push db schema", e)
      throw e
    }

    // @ts-expect-error
    const { Pool } = await import("pg")
    // @ts-expect-error
    const { PrismaPg } = await import("@prisma/adapter-pg")

    const pool = new Pool({ connectionString: DATABASE_URL })
    const adapter = new PrismaPg(pool)

    // @ts-expect-error - Prisma 7 config workaround
    prisma = new PrismaClient({ adapter })
    await prisma.$connect()
  })

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect()
    }
  })

  it("should process events end-to-end", async () => {
    outbox = new PostgresPrismaOutbox({
      prisma,
      pollIntervalMs: 100,
    })

    const eventId = randomUUID()
    const event = {
      id: eventId,
      type: "test.created",
      payload: { foo: "bar" },
      occurredAt: new Date(),
    }

    // 1. Publish
    await outbox.publish([event])

    // Verify created
    const saved = await prisma.outboxEvent.findUnique({ where: { id: eventId } })
    expect(saved).toBeTruthy()
    expect(saved?.status).toBe(OutboxStatus.created)
    // Verify payload is stored correctly
    expect(saved?.payload).toEqual(event.payload)

    // 2. Start processing
    const processedEvents: any[] = []
    await outbox.start(
      async (event: any) => {
        processedEvents.push(event)
      },
      (err: unknown) => console.error("Outbox Error:", err)
    )

    // Wait for poll
    await new Promise((resolve) => setTimeout(resolve, 2000))

    expect(processedEvents).toHaveLength(1)
    expect(processedEvents[0].id).toBe(eventId)

    // 3. Verify cleanup and archive
    const checkOriginal = await prisma.outboxEvent.findUnique({ where: { id: eventId } })
    expect(checkOriginal).toBeNull()

    const checkArchive = await prisma.outboxEventArchive.findUnique({ where: { id: eventId } })
    expect(checkArchive).toBeTruthy()
    expect(checkArchive?.status).toBe(OutboxStatus.completed)

    await outbox.stop()
  })

  it("should retry failed events", async () => {
    outbox = new PostgresPrismaOutbox({
      prisma,
      pollIntervalMs: 100,
      baseBackoffMs: 100,
    })

    const eventId = randomUUID()
    const event = {
      id: eventId,
      type: "test.failed",
      payload: {},
      occurredAt: new Date(),
    }

    await outbox.publish([event])

    let attempts = 0
    const onError = vi.fn()

    await outbox.start(async () => {
      attempts++
      throw new Error("Processing failed")
    }, onError)

    await new Promise((resolve) => setTimeout(resolve, 2000))

    await outbox.stop()

    const saved = await prisma.outboxEvent.findUnique({ where: { id: eventId } })
    expect(saved).toBeTruthy()
    expect(saved?.status).toBe(OutboxStatus.failed)
    expect(saved?.retryCount).toBeGreaterThan(0)
    expect(attempts).toBeGreaterThan(1)
    expect(onError).toHaveBeenCalled()
  })

  it("should support manual management of failed events", async () => {
    outbox = new PostgresPrismaOutbox({
      prisma,
      pollIntervalMs: 100,
    })

    const eventId = randomUUID()
    const event = {
      id: eventId,
      type: "manual.retry",
      payload: {},
      occurredAt: new Date(),
    }

    // 1. Insert directly as failed
    await prisma.outboxEvent.create({
      data: {
        id: eventId,
        type: event.type,
        payload: event.payload,
        occurredAt: event.occurredAt,
        status: OutboxStatus.failed,
        retryCount: 5,
        lastError: "Manual failure",
      },
    })

    // 2. Get failed events
    const failed = await outbox.getFailedEvents()
    const targetEvent = failed.find((e) => e.id === eventId)

    expect(targetEvent).toBeDefined()
    expect(targetEvent!.id).toBe(eventId)
    expect(targetEvent!.error).toBe("Manual failure")

    // 3. Retry
    await outbox.retryEvents([eventId])

    // 4. Verify status reset
    const retried = await prisma.outboxEvent.findUnique({ where: { id: eventId } })
    expect(retried?.status).toBe(OutboxStatus.created)
    expect(retried?.retryCount).toBe(0)
    expect(retried?.lastError).toBeNull()

    // 5. Verify it gets processed
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
    outbox = new PostgresPrismaOutbox({
      prisma,
      pollIntervalMs: 100,
    })

    const eventId = randomUUID()

    // Manually insert a "stuck" event (status active, timed out)
    // Default expireInSeconds is 300, so we set keepAlive to >300s ago
    const now = new Date()
    await (prisma as any).outboxEvent.create({
      data: {
        id: eventId,
        type: "stuck.event",
        payload: { stuck: true },
        occurredAt: new Date(now.getTime() - 400000),
        status: OutboxStatus.active,
        retryCount: 0,
        keepAlive: new Date(now.getTime() - 350000),
        expireInSeconds: 300,
      },
    })

    const processedEvents: any[] = []
    outbox.start(
      async (event) => {
        processedEvents.push(event)
      },
      (err) => console.error("Outbox Error:", err)
    )

    // Wait for recovery poll
    await new Promise((resolve) => setTimeout(resolve, 2000))

    expect(processedEvents.some((e) => e.id === eventId)).toBe(true)

    await outbox.stop()
  })

  it("should handle concurrent processing safely", async () => {
    // 1. Publish many events
    const eventCount = 50
    const events = Array.from({ length: eventCount }).map((_, i) => ({
      id: randomUUID(),
      type: "concurrent.test",
      payload: { index: i },
      occurredAt: new Date(),
    }))

    outbox = new PostgresPrismaOutbox({
      prisma,
      pollIntervalMs: 100, // This instance is just for publishing
    })
    await outbox.publish(events)
    await outbox.stop() // Stop this instance immediately

    // 2. Start multiple outbox workers
    const workerCount = 5
    const processedEvents: any[] = []
    const workers: PostgresPrismaOutbox[] = []

    // Shared handler that pushes to processedEvents
    const handler = async (event: any) => {
      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 50))
      processedEvents.push(event)
    }

    for (let i = 0; i < workerCount; i++) {
      const worker = new PostgresPrismaOutbox({
        prisma,
        pollIntervalMs: 100 + Math.random() * 50, // Jitter
        batchSize: 5, // Small batch size to encourage contention
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

    // Check count
    expect(processedEvents).toHaveLength(eventCount)

    // Check duplicates
    const ids = processedEvents.map((e) => e.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(eventCount)
  })
})
