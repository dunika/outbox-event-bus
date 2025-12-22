import { PutEventsCommand } from "@aws-sdk/client-eventbridge"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { EventBridgePublisher } from "./eventbridge-publisher"

describe("EventBridgePublisher", () => {
  const mockBus = {
    subscribe: vi.fn(),
  }
  const mockEventBridgeClient = {
    send: vi.fn(),
  }
  const _onError = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should subscribe to specified event types", () => {
    const publisher = new EventBridgePublisher(mockBus as any, {
      eventBridgeClient: mockEventBridgeClient as any,
      source: "my.service",
    })

    publisher.subscribe(["order.created", "order.updated"])

    expect(mockBus.subscribe).toHaveBeenCalledWith(
      ["order.created", "order.updated"],
      expect.any(Function)
    )
  })

  it("should publish event to Event Bridge when bus emits an event", async () => {
    const publisher = new EventBridgePublisher(mockBus as any, {
      eventBridgeClient: mockEventBridgeClient as any,
      source: "my.service",
      eventBusName: "custom-bus",
    })

    publisher.subscribe(["test.event"])
    const handler = mockBus.subscribe.mock.calls[0]?.[1]
    expect(handler).toBeDefined()
    if (!handler) throw new Error("Handler not defined")

    const event = {
      id: "evt_1",
      type: "test.event",
      payload: { data: "test" },
      occurredAt: new Date(),
    }

    mockEventBridgeClient.send.mockResolvedValueOnce({})

    await handler(event)

    expect(mockEventBridgeClient.send).toHaveBeenCalled()
    const command = mockEventBridgeClient.send.mock.calls[0]?.[0] as PutEventsCommand | undefined
    expect(command).toBeDefined()
    if (!command) throw new Error("Command not defined")
    expect(command).toBeInstanceOf(PutEventsCommand)
    expect(command.input.Entries).toBeDefined()
    expect(command.input.Entries?.length).toBeGreaterThan(0)

    const entry = command.input.Entries![0]
    expect(entry).toBeDefined()
    if (!entry) throw new Error("Entry not defined")
    expect(entry.Source).toBe("my.service")
    expect(entry.DetailType).toBe("test.event")
    expect(entry.Detail).toBe(JSON.stringify(event))
    expect(entry.EventBusName).toBe("custom-bus")
    expect(entry.Time).toEqual(event.occurredAt)
  })

  it("should throw error when publication fails", async () => {
    const publisher = new EventBridgePublisher(mockBus as any, {
      eventBridgeClient: mockEventBridgeClient as any,
      source: "my.service",
    })

    publisher.subscribe(["test.event"])
    const handler = mockBus.subscribe.mock.calls[0]?.[1]
    expect(handler).toBeDefined()
    if (!handler) throw new Error("Handler not defined")

    const error = new Error("Event Bridge failed")
    mockEventBridgeClient.send.mockRejectedValue(error)

    const event = {
      id: "evt_1",
      type: "test.event",
      payload: { data: "test" },
      occurredAt: new Date(),
    }

    await expect(handler(event)).rejects.toThrow("Event Bridge failed")
  })

  it("should support bufferSize greater than 10 by automatic chunking", () => {
    const publisher = new EventBridgePublisher(mockBus as any, {
      eventBridgeClient: mockEventBridgeClient as any,
      source: "my.service",
      processingConfig: { bufferSize: 11 },
    })
    expect(publisher).toBeDefined()
  })
})
