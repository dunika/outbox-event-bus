import { describe, it, expect, vi, beforeEach } from "vitest"
import { SQSPublisher } from "./sqs-publisher"
import { SendMessageCommand } from "@aws-sdk/client-sqs"

describe("SQSPublisher", () => {
  let mockSqsClient: any
  let mockBus: any

  const config = {
    queueUrl: "http://localhost:4566/000000000000/my-queue"
  }

  beforeEach(() => {
    mockSqsClient = {
      send: vi.fn()
    }
    mockBus = {
      subscribe: vi.fn()
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
      occurredAt: new Date()
    }
    
    await handler(event)
    
    expect(mockSqsClient.send).toHaveBeenCalled()
    const command = mockSqsClient.send.mock.calls[0][0]
    expect(command).toBeInstanceOf(SendMessageCommand)
    expect(command.input.QueueUrl).toBe(config.queueUrl)
    expect(command.input.MessageBody).toBe(JSON.stringify(event))
    expect(command.input.MessageAttributes?.EventType?.StringValue).toBe(event.type)
  })

  it("should call onError when SQS send fails", async () => {
    const onError = vi.fn()
    const publisher = new SQSPublisher(mockBus, { ...config, sqsClient: mockSqsClient, onError })
    
    publisher.subscribe(["user.created"])
    const handler = mockBus.subscribe.mock.calls[0][1]
    
    const error = new Error("SQS Error")
    mockSqsClient.send.mockRejectedValue(error)
    
    await handler({ type: "user.created" } as any)
    
    expect(onError).toHaveBeenCalledWith(error)
  })
})
