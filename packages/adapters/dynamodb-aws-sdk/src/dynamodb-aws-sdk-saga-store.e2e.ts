import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { runSagaStoreTestSuite } from "@outbox-event-bus/saga/tests"
import { afterAll, beforeAll, describe } from "vitest"
import { DynamoDBAwsSdkSagaStore } from "./dynamodb-aws-sdk-saga-store"

describe("DynamoDBAwsSdkSagaStore", () => {
  let client: DynamoDBClient
  const tableName = "SagaStoreTest"
  let isAvailable = false

  beforeAll(async () => {
    client = new DynamoDBClient({
      endpoint: "http://localhost:8000",
      region: "local",
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
      maxAttempts: 1,
    })

    const maxRetries = 5
    for (let i = 0; i < maxRetries; i++) {
      try {
        await client.send(
          new CreateTableCommand({
            TableName: tableName,
            KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
            AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
            ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
          })
        )
        isAvailable = true
        break
      } catch (e: any) {
        if (e.name === "ResourceInUseException") {
          isAvailable = true
          break
        }
        if (i === maxRetries - 1) {
          isAvailable = false
          console.warn("DynamoDB Local not available after retries, skipping tests", e)
        } else {
          // Wait a bit before retrying
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
    }
  })

  afterAll(async () => {
    // Optional: delete table
    if (client) client.destroy()
  })

  runSagaStoreTestSuite(
    "DynamoDB (Local)",
    async () => {
      if (!isAvailable) {
        // Return a dummy or throw to skip? The suite doesn't support skipping individual setups easily if the suite runs.
        // But if isAvailable is false, the tests inside suite will fail if we throw here.
        // We really want to skip the whole suite if not available.
        // However, standard vitest describe.skip or if logic is better wrapping the call.
        // Since we are inside the call, we can throw a "skip" error if the runner suppresses it, but it likely doesn't.
        // For now, let's assume if we are running e2e, the service IS available (docker-compose).
        // If it's unit test, it might fail.
        // Let's rely on the outer check.
        throw new Error("DynamoDB not available")
      }

      const { ScanCommand, DeleteCommand, DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb")
      const docClient = DynamoDBDocumentClient.from(client)

      // Clear table
      const scanResult = await docClient.send(new ScanCommand({ TableName: tableName }))
      if (scanResult.Items) {
        await Promise.all(
          scanResult.Items.map((item) => docClient.send(new DeleteCommand({ TableName: tableName, Key: { id: item.id } })))
        )
      }

      const adapter = new DynamoDBAwsSdkSagaStore({ client, tableName })
      return { adapter }
    }
  )
})
