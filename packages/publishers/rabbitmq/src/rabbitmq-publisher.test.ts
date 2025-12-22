import { BackpressureError } from "outbox-event-bus"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { RabbitMQPublisher } from "./rabbitmq-publisher"

describe("RabbitMQPublisher", () => {
  let mockChannel: any
  let _mockConnection: any
  let mockBus: any

  beforeEach(() => {
    mockChannel = {
      assertExchange: vi.fn().mockResolvedValue({}),
      publish: vi.fn().mockReturnValue(true),
    }
    _mockConnection = {
      createChannel: vi.fn().mockResolvedValue(mockChannel),
    }
    mockBus = {
      subscribe: vi.fn(),
    }
  })

  it("should throw BackpressureError when channel buffer is full", async () => {
    const publisher = new RabbitMQPublisher(mockBus, {
      channel: mockChannel,
      exchange: "test-exchange",
    })

    publisher.subscribe(["test-event"])
    const handler = mockBus.subscribe.mock.calls[0][1]

    // Simulate backpressure
    mockChannel.publish.mockReturnValue(false)

    const event = {
      id: "1",
      type: "test-event",
      payload: {},
      occurredAt: new Date(),
    }

    await expect(handler([event])).rejects.toThrow(BackpressureError)
  })
})
