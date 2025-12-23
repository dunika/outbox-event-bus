import type { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb"
import type { SagaStoreAdapter } from "@outbox-event-bus/saga"
import { withSagaAdapterLogAndError } from "outbox-event-bus"

export interface DynamoDBAwsSdkSagaStoreConfig {
  client: DynamoDBClient
  tableName?: string
}

export class DynamoDBAwsSdkSagaStore implements SagaStoreAdapter {
  private readonly docClient: DynamoDBDocumentClient
  private readonly tableName: string

  constructor(config: DynamoDBAwsSdkSagaStoreConfig) {
    this.docClient = DynamoDBDocumentClient.from(config.client, {
      marshallOptions: { removeUndefinedValues: true },
    })
    this.tableName = config.tableName ?? "sagas"
  }

  async put(id: string, data: Buffer, expiresAt: Date): Promise<void> {
    // DynamoDB TTL uses Unix timestamp in seconds
    const ttl = Math.floor(expiresAt.getTime() / 1000)

    // DynamoDB item size limit is 400KB
    if (data.length > 400 * 1024) {
      throw new Error(`Payload size (${data.length} bytes) exceeds DynamoDB limit of 400KB`)
    }

    await withSagaAdapterLogAndError("DynamoDBAwsSdkSagaStore", "Stored payload", id, async () => {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            id,
            data,
            expiresAt: ttl,
          },
        })
      )
    })
  }

  async get(id: string): Promise<Buffer> {
    return withSagaAdapterLogAndError(
      "DynamoDBAwsSdkSagaStore",
      "Retrieved payload",
      id,
      async () => {
        const response = await this.docClient.send(
          new GetCommand({
            TableName: this.tableName,
            Key: { id },
          })
        )

        if (!response.Item) {
          throw new Error(`Saga data not found for ID: ${id}`)
        }

        // AWS SDK v3 returns Uint8Array for binary data, we need to convert it to Buffer
        return Buffer.from(response.Item.data as Uint8Array)
      }
    )
  }

  async initialize(): Promise<void> {
    // DynamoDB table creation is usually handled via IaC, but we can log the table name
    console.debug(`[DynamoDBAwsSdkSagaStore] Initialized with table ${this.tableName}`)
  }
}
