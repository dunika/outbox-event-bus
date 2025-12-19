import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
            onError: (err) => console.error("Outbox error:", err)
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
            onError: () => {}, // Expected error, no-op
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

        await outbox.start(handler);

        // Wait for first attempt (100ms) + backoff (100ms) + second attempt (100ms)
        // 1500ms should be plenty
        await new Promise(resolve => setTimeout(resolve, 1500));

        await outbox.stop();

        expect(attempts).toBeGreaterThanOrEqual(2);
    });
});
