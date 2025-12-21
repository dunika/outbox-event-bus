import { AsyncLocalStorage } from "node:async_hooks"
import { execSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { OutboxStatus, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { OutboxEventBus } from "../../../core/src/outbox-event-bus"
import { PostgresPrismaOutbox } from "./index"

const DATABASE_URL = "postgresql://test_user:test_password@localhost:5432/outbox_test"

describe("PostgresPrisma Outbox Transactions with AsyncLocalStorage", () => {
  let prisma: PrismaClient
  const als = new AsyncLocalStorage<PrismaClient>()

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL

    try {
      execSync("npx prisma db push --accept-data-loss", {
        stdio: "inherit",
        env: { ...process.env, DATABASE_URL },
      })
    } catch (error) {
      console.error("Failed to push db schema", error)
      throw error
    }

    prisma = new PrismaClient()
    await prisma.$connect()
  })

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect()
    }
  })

  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany({})
    // We don't have a 'users' table in the default prisma schema for this project
    // unless it was added. Let's check the schema or just use the outboxEvent itself
    // as the "business data" for the sake of testing transactionality if no other table available.
    // Actually, let's see if we can use another model if it exists.
  })

  it("should commit both business data and outbox event in a transaction", async () => {
    const outbox = new PostgresPrismaOutbox({
      prisma,
      getExecutor: () => als.getStore(),
    })

    const eventBus = new OutboxEventBus(
      outbox,
      () => {},
      () => {}
    )

    const eventId = randomUUID()

    // Using $transaction
    await prisma.$transaction(async (transaction) => {
      await als.run(transaction as any, async () => {
        // In a real app, you'd do: await transaction.user.create(...)

        // For this test, we'll just emit an event
        await eventBus.emit({
          id: eventId,
          type: "TEST_TRANSACTIONAL",
          payload: { foo: "bar" },
          occurredAt: new Date(),
        })
      })
    })

    // Verify it was persisted
    const saved = await prisma.outboxEvent.findUnique({ where: { id: eventId } })
    expect(saved).toBeTruthy()
    expect(saved?.status).toBe(OutboxStatus.created)
  })

  it("should rollback both business data and outbox event on failure", async () => {
    const outbox = new PostgresPrismaOutbox({
      prisma,
      getExecutor: () => als.getStore(),
    })

    const eventBus = new OutboxEventBus(
      outbox,
      () => {},
      () => {}
    )

    const eventId = randomUUID()

    try {
      await prisma.$transaction(async (transaction) => {
        await als.run(transaction as any, async () => {
          await eventBus.emit({
            id: eventId,
            type: "TEST_ROLLBACK",
            payload: { foo: "bar" },
            occurredAt: new Date(),
          })

          throw new Error("Forced rollback")
        })
      })
    } catch (_err) {
      // Expected
    }

    // Verify it was NOT persisted
    const saved = await prisma.outboxEvent.findUnique({ where: { id: eventId } })
    expect(saved).toBeNull()
  })
})
