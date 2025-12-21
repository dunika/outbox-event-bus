import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { DynamoDBClient, CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBOutbox } from "./index";
import { OutboxEventBus } from "outbox-event-bus";

describe("DynamoDBOutbox E2E", () => {
    let client: DynamoDBClient;
    const tableName = "OutboxEvents";
    const indexName = "StatusIndex";

    beforeAll(async () => {
        const endpoint = "http://localhost:8000";
        client = new DynamoDBClient({
            endpoint,
            region: "local",
            credentials: { accessKeyId: "local", secretAccessKey: "local" }
        });

        // Retry logic for table creation
        const maxRetries = 10;
        const delay = 1000;

        for (let i = 0; i < maxRetries; i++) {
            try {
                await client.send(new CreateTableCommand({
                    TableName: tableName,
                    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
                    AttributeDefinitions: [
                        { AttributeName: "id", AttributeType: "S" },
                        { AttributeName: "status", AttributeType: "S" },
                        { AttributeName: "gsiSortKey", AttributeType: "N" }
                    ],
                    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
                    GlobalSecondaryIndexes: [
                        {
                            IndexName: indexName,
                            KeySchema: [
                                { AttributeName: "status", KeyType: "HASH" },
                                { AttributeName: "gsiSortKey", KeyType: "RANGE" }
                            ],
                            Projection: { ProjectionType: "ALL" },
                            ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
                        }
                    ]
                }));
                break;
            } catch (err: any) {
                if (err.name === "ResourceInUseException") break;
                if (i === maxRetries - 1) throw err;
                await new Promise(res => setTimeout(res, delay));
            }
        }
    });

    afterAll(async () => {
        // No need to stop container here
    });

    it("should process events end-to-end", async () => {
        const outbox = new DynamoDBOutbox({
            client,
            tableName,
            statusIndexName: indexName,
            pollIntervalMs: 100,
        });

        const eventBus = new OutboxEventBus(
            outbox, 
            (_bus, type, count) => console.warn(`Max listeners for ${type}: ${count}`),
            (err) => console.error("Bus error:", err)
        );
        
        const received: any[] = [];
        eventBus.subscribe(["test.event"], async (event) => {
            received.push(event);
        });

        await eventBus.start();

        const eventId = `e1-${Date.now()}`;
        await eventBus.emit({
            id: eventId,
            type: "test.event",
            payload: { message: "hello" },
            occurredAt: new Date()
        });

        // Wait for polling
        await new Promise(resolve => setTimeout(resolve, 1500));

        expect(received).toHaveLength(1);
        expect(received[0].payload.message).toBe("hello");

        await eventBus.stop();
    });

    it("should retry failed events", async () => {
        const outbox = new DynamoDBOutbox({
            client,
            tableName,
            statusIndexName: indexName,
            pollIntervalMs: 100,
            baseBackoffMs: 100,
        });

        let attempts = 0;
        const handler = async (events: any[]) => {
            attempts += events.length;
            throw new Error("Temporary failure");
        };

        const eventId = `retry-me-${Date.now()}`;
        await outbox.publish([{
            id: eventId,
            type: "fail.event",
            payload: { foo: "bar" },
            occurredAt: new Date()
        }]);

        // Wait for DynamoDB GSI to become consistent
        await new Promise(resolve => setTimeout(resolve, 800));

        await outbox.start(handler, () => {}); // Expected error, no-op

        // Wait for first attempt (100ms) + backoff (100ms) + second attempt (100ms)
        // 1500ms should be plenty
        await new Promise(resolve => setTimeout(resolve, 1500));

        await outbox.stop();

        expect(attempts).toBeGreaterThanOrEqual(2);
    });

    it("should recover from stuck events", async () => {
        const outbox = new DynamoDBOutbox({
            client,
            tableName,
            statusIndexName: indexName,
            pollIntervalMs: 100,
            processingTimeoutMs: 1000,
        });

        const eventId = `stuck-${Date.now()}`;
        const now = Date.now();
        
        // Manually insert a "stuck" event (status PROCESSING, timed out)
        const { PutCommand } = await import("@aws-sdk/lib-dynamodb");
        const docClient = (outbox as any).docClient;
        await docClient.send(new PutCommand({
            TableName: tableName,
            Item: {
                id: eventId,
                type: "stuck.event",
                payload: { stuck: true },
                occurredAt: new Date(now - 5000).toISOString(),
                status: "PROCESSING",
                retryCount: 0,
                gsiSortKey: now - 2000 // In the past
            }
        }));

        const received: any[] = [];
        await outbox.start(async (events) => {
            received.push(...events);
        }, (err) => console.error("Outbox error:", err));

        // Wait for recovery poll
        await new Promise(resolve => setTimeout(resolve, 1500));

        expect(received.some(e => e.id === eventId)).toBe(true);

        await outbox.stop();
    });

    it("should handle concurrent processing safely", async () => {
        const eventCount = 50;
        const events = Array.from({ length: eventCount }).map((_, i) => ({
            id: `concurrent-${i}-${Date.now()}`,
            type: "concurrent.test",
            payload: { index: i },
            occurredAt: new Date()
        }));

        const outbox = new DynamoDBOutbox({
            client,
            tableName,
            statusIndexName: indexName,
            pollIntervalMs: 100,
        });
        await outbox.publish(events);
        await outbox.stop();

        // 2. Start multiple outbox workers
        const workerCount = 5;
        const processedEvents: any[] = [];
        const workers: DynamoDBOutbox[] = [];

        const handler = async (events: any[]) => {
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
            processedEvents.push(...events);
        };

        for (let i = 0; i < workerCount; i++) {
            // Re-use client for dynamoDB local (it supports concurrent requests)
            const worker = new DynamoDBOutbox({
                client,
                tableName,
                statusIndexName: indexName,
                pollIntervalMs: 100 + (Math.random() * 50),
                batchSize: 5,
            });
            workers.push(worker);
            worker.start(handler, (err) => console.error(`Worker ${i} Error:`, err));
        }

        // 3. Wait for processing
        const maxWaitTime = 10000;
        const startTime = Date.now();
        
        while (processedEvents.length < eventCount && (Date.now() - startTime) < maxWaitTime) {
            await new Promise((resolve) => setTimeout(resolve, 200));
        }

        // 4. Verify results
        await Promise.all(workers.map(w => w.stop()));

        // Check count
        expect(processedEvents).toHaveLength(eventCount);

        // Check duplicates
        const ids = processedEvents.map(e => e.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(eventCount);
    });
});
