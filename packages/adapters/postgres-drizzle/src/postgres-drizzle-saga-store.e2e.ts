import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { describe, beforeAll, afterAll, beforeEach, it } from "vitest"
import { PostgresDrizzleSagaStore } from "./postgres-drizzle-saga-store"
import { runSagaStoreTestSuite } from "@outbox-event-bus/saga/tests"

const DB_URL = process.env.DATABASE_URL ?? "postgres://test_user:test_password@localhost:5433/outbox_test"

describe("PostgresDrizzleSagaStore", () => {
  let client: postgres.Sql
  let db: any

  beforeAll(async () => {
    if (!DB_URL) return
    client = postgres(DB_URL)
    db = drizzle(client)

    try {
      await client`
        CREATE TABLE IF NOT EXISTS saga_store (
          id TEXT PRIMARY KEY,
          data BYTEA NOT NULL,
          expires_at TIMESTAMP NOT NULL
        )
      `
    } catch (_e) {
      // Table might already exist or other error
    }
  })

  beforeEach(async () => {
    if (!DB_URL) return
    await client`TRUNCATE TABLE saga_store`
  })

  afterAll(async () => {
    if (client) await client.end()
  })

  if (DB_URL) {
    runSagaStoreTestSuite("Drizzle (Postgres)", async () => {
      const adapter = new PostgresDrizzleSagaStore({ db })
      return { adapter }
    })
  } else {
    describe("PostgresDrizzleSagaStore (Skipped)", () => {
      it.skip("should run tests when DATABASE_URL is provided", () => {})
    })
  }
})
