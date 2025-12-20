import { describe, it, expect, vi } from "vitest"
import { OutboxEventBus, InMemoryOutbox } from "outbox-event-bus"
import { SQSPublisher } from "./sqs-publisher"
import { SendMessageCommand } from "@aws-sdk/client-sqs"

describe("SQSPublisher E2E (with InMemoryOutbox)", () => {
  it("should process event from outbox to SQS", async () => {
    // 1. Setup
    const outbox = new InMemoryOutbox({ onError: (err) => console.error(err) })
    const bus = new OutboxEventBus(
      outbox,
      () => {},
      (err) => console.error(err)
    )
    
    const mockSqsClient = {
      send: vi.fn().mockResolvedValue({})
    }
    
    const publisher = new SQSPublisher(bus, {
      sqsClient: mockSqsClient as any,
      queueUrl: "http://localhost:4566/my-queue"
    })
    
    publisher.subscribe(["test.event"])
    
    await bus.start()
    
    // 2. Emit event
    const event = {
      id: "evt_1",
      type: "test.event",
      payload: { foo: "bar" },
      occurredAt: new Date()
    }
    
    await bus.emit(event)
    
    // 3. Verify
    // Wait for the asynchronous processing in InMemoryOutbox
    for (let i = 0; i < 10; i++) {
        if (mockSqsClient.send.mock.calls.length > 0) break;
        await new Promise(resolve => setTimeout(resolve, 50))
    }
    
    expect(mockSqsClient.send).toHaveBeenCalled()
    const command = mockSqsClient.send.mock.calls[0][0] as SendMessageCommand
    expect(command).toBeInstanceOf(SendMessageCommand)
    expect(command.input.MessageBody).toContain('"foo":"bar"')
    
    await bus.stop()
  })
})
