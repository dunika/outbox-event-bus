import Database from "better-sqlite3"
import { describe, beforeEach, afterEach } from "vitest"
import { SqliteBetterSqlite3SagaStore } from "./sqlite-better-sqlite3-saga-store"
import { runSagaStoreTestSuite } from "@outbox-event-bus/saga/tests"

describe("SqliteBetterSqlite3SagaStore", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
  })

  afterEach(() => {
    db.close()
  })

  runSagaStoreTestSuite("SQLite (Memory)", async () => {
    const adapter = new SqliteBetterSqlite3SagaStore({ db })
    await adapter.initialize()
    return { adapter }
  })
})
