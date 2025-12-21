import { describe, it, expect, vi } from "vitest"
import { DynamoDBOutbox } from "./dynamodb-outbox"
import { TransactWriteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn().mockImplementation((client) => client),
    },
  };
});

describe("DynamoDBOutbox Transactional Support", () => {
  it("should push items to collector and NOT send command when getExecutor provides one", async () => {
    const mockCollector = {
      push: vi.fn(),
    }
    const mockClient = {
      send: vi.fn(),
    }

    const outbox = new DynamoDBOutbox({
      client: mockClient as any,
      tableName: "test-table",
      getExecutor: () => mockCollector,
    })

    await outbox.publish([{ id: "1", type: "test", payload: {}, occurredAt: new Date() }])

    expect(mockCollector.push).toHaveBeenCalledTimes(1)
    expect(mockClient.send).not.toHaveBeenCalled()
  })

  it("should send TransactWriteCommand when getExecutor returns undefined", async () => {
    const mockClient = {
      send: vi.fn().mockResolvedValue({}),
    }

    const outbox = new DynamoDBOutbox({
      client: mockClient as any,
      tableName: "test-table",
      getExecutor: () => undefined,
    })

    await outbox.publish([{ id: "1", type: "test", payload: {}, occurredAt: new Date() }])

    expect(mockClient.send).toHaveBeenCalledWith(expect.any(TransactWriteCommand))
  })

  it("should throw an error if more than 100 events are published", async () => {
    const mockClient = {
      send: vi.fn(),
    }
    const outbox = new DynamoDBOutbox({
      client: mockClient as any,
      tableName: "test-table",
    })

    const events = Array.from({ length: 101 }, (_, i) => ({
      id: `${i}`,
      type: "test",
      payload: {},
      occurredAt: new Date(),
    }))

    await expect(outbox.publish(events)).rejects.toThrow(
      "DynamoDB Outbox: Cannot publish more than 100 events in a single transaction (DynamoDB limit)."
    )
  })

  it("should throw an error if collector and new events combined exceed 100 items", async () => {
    const mockClient = {
      send: vi.fn(),
    }
    const collector = Array.from({ length: 90 }, () => ({}));
    const outbox = new DynamoDBOutbox({
      client: mockClient as any,
      tableName: "test-table",
      getExecutor: () => collector,
    })

    const events = Array.from({ length: 11 }, (_, i) => ({
      id: `${i}`,
      type: "test",
      payload: {},
      occurredAt: new Date(),
    }))

    await expect(outbox.publish(events)).rejects.toThrow(
      "DynamoDB Outbox: Cannot add 11 events because the transaction already has 90 items (DynamoDB limit is 100)."
    )
  })
})
