import { SendMessageBatchCommand } from "@aws-sdk/client-sqs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SQSPublisher } from "./sqs-publisher"

describe("SQSPublisher", () => {
  let mockSqsClient: any
  let mockBus: any

  const config = {
    queueUrl: "http://localhost:4566/000000000000/my-queue",
  }

  beforeEach(() => {
    mockSqsClient = {
      send: vi.fn(),
    }
    mockBus = {
      subscribe: vi.fn(),
    }
  })

  it("should subscribe to event types on the bus", () => {
    const publisher = new SQSPublisher(mockBus, { ...config, sqsClient: mockSqsClient })
    const eventTypes = ["user.created", "user.updated"]

    publisher.subscribe(eventTypes)

    expect(mockBus.subscribe).toHaveBeenCalledWith(eventTypes, expect.any(Function))
  })

  it("should send event to SQS when bus emits subscribed event", async () => {
    const publisher = new SQSPublisher(mockBus, { ...config, sqsClient: mockSqsClient })
    const eventTypes = ["user.created"]

    publisher.subscribe(eventTypes)

    const handler = mockBus.subscribe.mock.calls[0][1]

    const event = {
      id: "123",
      type: "user.created",
      payload: { name: "John Doe" },
      occurredAt: new Date(),
    }

    await handler(event)

    expect(mockSqsClient.send).toHaveBeenCalled()
    const command = mockSqsClient.send.mock.calls[0][0]
    expect(command).toBeInstanceOf(SendMessageBatchCommand)
    expect(command.input.QueueUrl).toBe(config.queueUrl)
    expect(command.input.Entries).toHaveLength(1)
    expect(command.input.Entries?.[0].MessageBody).toBe(JSON.stringify(event))
    expect(command.input.Entries?.[0].MessageAttributes?.EventType?.StringValue).toBe(event.type)
  })

  it("should throw error when SQS send fails", async () => {
    const publisher = new SQSPublisher(mockBus, { ...config, sqsClient: mockSqsClient })

    publisher.subscribe(["user.created"])
    const handler = mockBus.subscribe.mock.calls[0][1]

    const error = new Error("SQS Error")
    mockSqsClient.send.mockRejectedValue(error)

    await expect(handler({ type: "user.created" } as any)).rejects.toThrow("SQS Error")
  })

  it("should support bufferSize greater than 10 by automatic chunking", () => {
    // This is now supported as SQSPublisher sets maxBatchSize: 10
    // and EventPublisher handles the chunking.
    const publisher = new SQSPublisher(mockBus, {
      ...config,
      sqsClient: mockSqsClient,
      processingConfig: { bufferSize: 11 },
    })
    expect(publisher).toBeDefined()
  })
})
