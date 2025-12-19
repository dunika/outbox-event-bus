import { describe, it, expect, vi, beforeEach } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBOutbox } from "./index";

const mockSend = vi.fn();

vi.mock("@aws-sdk/lib-dynamodb", async () => {
    const actual = await vi.importActual("@aws-sdk/lib-dynamodb") as any;
    return {
        ...actual,
        DynamoDBDocumentClient: {
            from: vi.fn(() => ({
                send: mockSend
            }))
        }
    };
});

describe("DynamoDBOutbox Unit Tests", () => {
    let outbox: DynamoDBOutbox;
    let client: DynamoDBClient;

    beforeEach(() => {
        vi.clearAllMocks();
        client = new DynamoDBClient({});
        outbox = new DynamoDBOutbox({
            client,
            tableName: "test-table",
            statusIndexName: "status-index",
            onError: (err) => console.error(err)
        });
    });

    it("should publish events", async () => {
        const events = [
            { id: "e1", type: "t1", payload: { a: 1 }, occurredAt: new Date() },
            { id: "e2", type: "t2", payload: { b: 2 }, occurredAt: new Date() }
        ];

        await outbox.publish(events);

        expect(mockSend).toHaveBeenCalledWith(expect.any(Object));
    });

    it("should process a batch of events", async () => {
        const mockItems = [
            { id: "e1", type: "t1", payload: { a: 1 }, occurredAt: new Date().toISOString(), status: "PENDING" }
        ];

        mockSend
            .mockResolvedValueOnce({ Items: [] }) // recoverStuckEvents
            .mockResolvedValueOnce({ Items: mockItems }) // fetch PENDING
            .mockResolvedValueOnce({}); // claim update
            
        await outbox.start(async () => {});
        
        // Wait for one poll cycle
        await new Promise(res => setTimeout(res, 200));
        
        expect(mockSend).toHaveBeenCalled();
        await outbox.stop();
    });

    it("should handle processing failure", async () => {
        const mockItems = [
            { id: "e1", type: "t1", payload: { a: 1 }, occurredAt: new Date().toISOString(), status: "PENDING", retryCount: 0 }
        ];

        mockSend
            .mockResolvedValueOnce({ Items: [] }) // recoverStuckEvents
            .mockResolvedValueOnce({ Items: mockItems }) // fetch PENDING
            .mockResolvedValueOnce({}); // claim update

        await outbox.start(async () => {
            throw new Error("Failed");
        });

        await new Promise(res => setTimeout(res, 200));
        await outbox.stop();

        // Should have called update for retry
        const retryUpdate = mockSend.mock.calls.find(call => 
            call[0].input?.UpdateExpression?.includes("retryCount")
        );
        expect(retryUpdate).toBeDefined();
    });
});
