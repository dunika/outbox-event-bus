import { type Collection, type MongoClient, Binary } from "mongodb"
import type { SagaStoreAdapter } from "@outbox-event-bus/saga"
import { withAdapterLogAndError } from "outbox-event-bus"

export interface MongodbSagaStoreConfig {
  client: MongoClient
  dbName: string
  collectionName?: string
}

interface SagaDocument {
  _id: string
  data: Binary
  expiresAt: Date
}

export class MongodbSagaStore implements SagaStoreAdapter {
  private readonly collection: Collection<SagaDocument>

  constructor(config: MongodbSagaStoreConfig) {
    this.collection = config.client
      .db(config.dbName)
      .collection<SagaDocument>(config.collectionName ?? "saga_store")
  }

  async initialize(): Promise<void> {
    await this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    console.debug(`[MongodbSagaStore] Initialized TTL index on expiresAt`)
  }

  async put(id: string, data: Buffer, expiresAt: Date): Promise<void> {
    await withAdapterLogAndError("MongodbSagaStore", "Stored payload", id, async () => {
      await this.collection.updateOne(
        { _id: id },
        {
          $set: {
            data: new Binary(data),
            expiresAt,
          },
        },
        { upsert: true }
      )
    })
  }

  async get(id: string): Promise<Buffer> {
    return withAdapterLogAndError("MongodbSagaStore", "Retrieved payload", id, async () => {
      const doc = await this.collection.findOne({ _id: id })

      if (!doc) {
        throw new Error(`Saga data not found for ID: ${id}`)
      }

      return Buffer.from(doc.data.buffer)
    })
  }
}
