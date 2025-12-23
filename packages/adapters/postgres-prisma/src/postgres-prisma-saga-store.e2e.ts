import { PrismaClient } from "@prisma/client"
import { describe, beforeAll, afterAll, it } from "vitest"
import { PostgresPrismaSagaStore } from "./postgres-prisma-saga-store"
import { runSagaStoreTestSuite } from "@outbox-event-bus/saga/tests"

const DATABASE_URL = process.env.DATABASE_URL

describe("PostgresPrismaSagaStore", () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    if (!DATABASE_URL) {
      return
    }
    const { Pool } = await import("pg")
    const { PrismaPg } = await import("@prisma/adapter-pg")

    const pool = new Pool({ connectionString: DATABASE_URL })
    const adapter = new PrismaPg(pool)

    prisma = new PrismaClient({ adapter })
    await prisma.$connect()
  })

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect()
    }
  })

  if (DATABASE_URL) {
    runSagaStoreTestSuite("Prisma (Postgres)", async () => {
      const adapter = new PostgresPrismaSagaStore({ prisma })
      return {
        adapter,
        cleanup: async () => {
          await prisma.sagaStore.deleteMany()
        },
      }
    })
  } else {
    describe("PostgresPrismaSagaStore (Skipped)", () => {
      it.skip("should run tests when DATABASE_URL is provided", () => {})
    })
  }
})
