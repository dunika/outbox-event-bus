import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it, vi } from "vitest"
import { DynamoDBAwsSdkOutbox } from "./dynamodb-aws-sdk-outbox"

vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn().mockImplementation((client) => client),
    },
  }
})

describe("DynamoDBAwsSdkOutbox Transactional Support", () => {
  it("should push items to collector and NOT send command when getExecutor provides one", async () => {
    const mockCollector = {
      push: vi.fn(),
    }
    const mockClient = {
      send: vi.fn(),
    }

    const outbox = new DynamoDBAwsSdkOutbox({
      client: mockClient as any,
      tableName: "test-table",
      getCollector: () => mockCollector,
    })

    await outbox.publish([{ id: "1", type: "test", payload: {}, occurredAt: new Date() }])

    expect(mockCollector.push).toHaveBeenCalledTimes(1)
    expect(mockClient.send).not.toHaveBeenCalled()
  })

  it("should send TransactWriteCommand when getExecutor returns undefined", async () => {
    const mockClient = {
      send: vi.fn().mockResolvedValue({}),
    }

    const outbox = new DynamoDBAwsSdkOutbox({
      client: mockClient as any,
      tableName: "test-table",
      getCollector: () => undefined,
    })

    await outbox.publish([{ id: "1", type: "test", payload: {}, occurredAt: new Date() }])

    expect(mockClient.send).toHaveBeenCalledWith(expect.any(TransactWriteCommand))
  })

  it("should throw an error if more than 100 events are published", async () => {
    const mockClient = {
      send: vi.fn(),
    }
    const outbox = new DynamoDBAwsSdkOutbox({
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
      "Cannot publish 101 events because the batch size limit is 100."
    )
  })

  it("should throw an error if collector and new events combined exceed 100 items", async () => {
    const mockClient = {
      send: vi.fn(),
    }
    const collector = {
      push: vi.fn(),
      items: Array.from({ length: 90 }, () => ({})),
    }
    const outbox = new DynamoDBAwsSdkOutbox({
      client: mockClient as any,
      tableName: "test-table",
      getCollector: () => collector as any,
    })

    const events = Array.from({ length: 11 }, (_, i) => ({
      id: `${i}`,
      type: "test",
      payload: {},
      occurredAt: new Date(),
    }))

    await expect(outbox.publish(events)).rejects.toThrow(
      "Cannot publish 101 events because the batch size limit is 100."
    )
  })
})
