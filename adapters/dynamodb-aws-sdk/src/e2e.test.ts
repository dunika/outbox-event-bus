import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { OutboxEventBus } from "outbox-event-bus"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { DynamoDBAwsSdkOutbox } from "./index"

describe("DynamoDBAwsSdkOutbox E2E", () => {
  let client: DynamoDBClient
  const tableName = "OutboxEvents"
  const indexName = "StatusIndex"

  beforeAll(async () => {
    const endpoint = "http://localhost:8000"
    client = new DynamoDBClient({
      endpoint,
      region: "local",
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    })

    // Retry logic for table creation
    const maxRetries = 10
    const delay = 1000

    for (let i = 0; i < maxRetries; i++) {
      try {
        await client.send(
          new CreateTableCommand({
            TableName: tableName,
            KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
            AttributeDefinitions: [
              { AttributeName: "id", AttributeType: "S" },
              { AttributeName: "status", AttributeType: "S" },
              { AttributeName: "gsiSortKey", AttributeType: "N" },
            ],
            ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
            GlobalSecondaryIndexes: [
              {
                IndexName: indexName,
                KeySchema: [
                  { AttributeName: "status", KeyType: "HASH" },
                  { AttributeName: "gsiSortKey", KeyType: "RANGE" },
                ],
                Projection: { ProjectionType: "ALL" },
                ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
              },
            ],
          })
        )
        break
      } catch (err: any) {
        if (err.name === "ResourceInUseException") break
        if (i === maxRetries - 1) throw err
        await new Promise((res) => setTimeout(res, delay))
      }
    }
  })

  afterAll(async () => {
    // No need to stop container here
  })

  it("should process events end-to-end", async () => {
    const outbox = new DynamoDBAwsSdkOutbox({
      client,
      tableName,
      statusIndexName: indexName,
      pollIntervalMs: 100,
    })

    const eventBus = new OutboxEventBus(outbox, (err) => console.error("Bus error:", err))

    const received: any[] = []
    eventBus.subscribe(["test.event"], async (event) => {
      received.push(event)
    })

    await eventBus.start()

    const eventId = `e1-${Date.now()}`
    await eventBus.emit({
      id: eventId,
      type: "test.event",
      payload: { message: "hello" },
      occurredAt: new Date(),
    })

    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(received).toHaveLength(1)
    expect(received[0].payload.message).toBe("hello")

    await eventBus.stop()
  })

  it("should retry failed events", async () => {
    const outbox = new DynamoDBAwsSdkOutbox({
      client,
      tableName,
      statusIndexName: indexName,
      pollIntervalMs: 100,
      baseBackoffMs: 100,
    })

    let attempts = 0
    const handler = async (_event: any) => {
      attempts++
      throw new Error("Temporary failure")
    }

    const eventId = `retry-me-${Date.now()}`
    await outbox.publish([
      {
        id: eventId,
        type: "fail.event",
        payload: { foo: "bar" },
        occurredAt: new Date(),
      },
    ])

    // Wait for DynamoDB GSI to become consistent
    await new Promise((resolve) => setTimeout(resolve, 800))

    await outbox.start(handler, () => {}) // Expected error, no-op

    // Wait for first attempt (100ms) + backoff (100ms) + second attempt (100ms)
    // 1500ms should be plenty
    await new Promise((resolve) => setTimeout(resolve, 1500))

    await outbox.stop()

    expect(attempts).toBeGreaterThanOrEqual(2)
  })

  it("should support manual management of failed events", async () => {
    const outbox = new DynamoDBAwsSdkOutbox({
      client,
      tableName,
      statusIndexName: indexName,
      pollIntervalMs: 100,
    })

    try {
      const eventId = `manual-retry-${Date.now()}`
      const event = {
        id: eventId,
        type: "manual.retry",
        payload: {},
        occurredAt: new Date(),
      }

      // 1. Insert directly as failed
      const { PutCommand } = await import("@aws-sdk/lib-dynamodb")
      const docClient = (outbox as any).docClient
      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            id: event.id,
            type: event.type,
            payload: event.payload,
            occurredAt: event.occurredAt.toISOString(),
            status: "FAILED",
            retryCount: 5,
            gsiSortKey: event.occurredAt.getTime(),
            lastError: "Manual failure",
          },
        })
      )

      // 2. Get failed events
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const failed = await outbox.getFailedEvents()
      const targetEvent = failed.find((e) => e.id === eventId)

      expect(targetEvent).toBeDefined()
      expect(targetEvent!.id).toBe(eventId)
      expect(targetEvent!.error).toBe("Manual failure")

      // 3. Retry
      await outbox.retryEvents([eventId])

      // 4. Verify processed
      const eventBus = new OutboxEventBus(outbox, (err) => console.error("Bus error:", err))

      const processed: any[] = []
      const _sub = eventBus.subscribe(["manual.retry"], async (event) => {
        processed.push(event)
      })

      await eventBus.start()

      await new Promise((resolve) => setTimeout(resolve, 3000))

      const uniqueProcessed = [...new Set(processed.map((p) => p.id))]

      expect(uniqueProcessed).toContain(eventId)
      expect(uniqueProcessed).toHaveLength(1)
    } finally {
      await outbox.stop()
    }
  }, 15000)

  it("should recover from stuck events", async () => {
    const outbox = new DynamoDBAwsSdkOutbox({
      client,
      tableName,
      statusIndexName: indexName,
      pollIntervalMs: 100,
      processingTimeoutMs: 1000,
    })

    const eventId = `stuck-${Date.now()}`
    const now = Date.now()

    // Manually insert a "stuck" event (status PROCESSING, timed out)
    const { PutCommand } = await import("@aws-sdk/lib-dynamodb")
    const docClient = (outbox as any).docClient
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          id: eventId,
          type: "stuck.event",
          payload: { stuck: true },
          occurredAt: new Date(now - 5000).toISOString(),
          status: "PROCESSING",
          retryCount: 0,
          gsiSortKey: now - 2000, // In the past
        },
      })
    )

    const received: any[] = []
    await outbox.start(
      async (event) => {
        received.push(event)
      },
      (err) => console.error("Outbox error:", err)
    )

    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(received.some((e) => e.id === eventId)).toBe(true)

    await outbox.stop()
  })

  it("should handle concurrent processing safely", async () => {
    const eventCount = 50
    const events = Array.from({ length: eventCount }).map((_, i) => ({
      id: `concurrent-${i}-${Date.now()}`,
      type: "concurrent.test",
      payload: { index: i },
      occurredAt: new Date(),
    }))

    const outbox = new DynamoDBAwsSdkOutbox({
      client,
      tableName,
      statusIndexName: indexName,
      pollIntervalMs: 100,
    })
    await outbox.publish(events)
    await outbox.stop()

    // 2. Start multiple outbox workers
    const workerCount = 5
    const processedEvents: any[] = []
    const workers: DynamoDBAwsSdkOutbox[] = []

    const handler = async (event: any) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 50))
      processedEvents.push(event)
    }

    for (let i = 0; i < workerCount; i++) {
      // Re-use client for dynamoDB local (it supports concurrent requests)
      const worker = new DynamoDBAwsSdkOutbox({
        client,
        tableName,
        statusIndexName: indexName,
        pollIntervalMs: 100 + Math.random() * 50,
        batchSize: 5,
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

    await Promise.all(workers.map((w) => w.stop()))

    expect(processedEvents).toHaveLength(eventCount)
    const ids = processedEvents.map((event) => event.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(eventCount)
  }, 15000)
})
