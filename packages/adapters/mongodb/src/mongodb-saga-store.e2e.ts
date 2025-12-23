import { runSagaStoreTestSuite } from "@outbox-event-bus/saga/tests"
import { MongoClient } from "mongodb"
import { afterAll, beforeAll, describe } from "vitest"
import { MongodbSagaStore } from "./mongodb-saga-store"

const MONGO_URL = "mongodb://localhost:27017"
const DB_NAME = "saga_test"
const COLLECTION_NAME = "sagas"

describe("MongodbSagaStore", () => {
  let client: MongoClient
  let isAvailable = false

  beforeAll(async () => {
    client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 1000 })
    try {
      await client.connect()
      await client.db(DB_NAME).command({ ping: 1 })
      isAvailable = true
    } catch (_e) {
      isAvailable = false
      console.warn("MongoDB not available, skipping tests")
    }
  })

  afterAll(async () => {
    if (client) {
      await client.close()
    }
  })

  // We can't easily skip inside the runSagaStoreTestSuite based on a variable set in beforeAll
  // because the suite definition runs immediately.
  // However, we can wrap it in a describe block or conditional if we knew availability synchronously.
  // Since we don't, we'll let it run and fail if not available, OR we can try to conditionally execute.
  // BUT: standard pattern for these tests in this repo seems to be: check availability, if not, skip specific tests.
  // runSagaStoreTestSuite defines the tests.
  // The setup function is async. We can throw there.
  
  runSagaStoreTestSuite(
    "MongoDB (Local)",
    async () => {
      if (!isAvailable) {
         throw new Error("MongoDB not available")
      }
      
      // Cleanup
      await client.db(DB_NAME).collection(COLLECTION_NAME).deleteMany({})

      const adapter = new MongodbSagaStore({ client, dbName: DB_NAME, collectionName: COLLECTION_NAME })
      return { adapter }
    }
  )
})
