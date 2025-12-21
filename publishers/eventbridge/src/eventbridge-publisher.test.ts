import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventBridgePublisher } from "./eventbridge-publisher"
import { PutEventsCommand } from "@aws-sdk/client-eventbridge"

describe("EventBridgePublisher", () => {
  const mockBus = {
    subscribe: vi.fn()
  }
  const mockEventBridgeClient = {
    send: vi.fn()
  }
  const onError = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should subscribe to specified event types", () => {
    const publisher = new EventBridgePublisher(mockBus as any, {
      eventBridgeClient: mockEventBridgeClient as any,
      source: "my.service"
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
      eventBusName: "custom-bus"
    })

    publisher.subscribe(["test.event"])
    const handler = mockBus.subscribe.mock.calls[0]?.[1]
    expect(handler).toBeDefined()
    if (!handler) throw new Error("Handler not defined")

    const event = {
      id: "evt_1",
      type: "test.event",
      payload: { data: "test" },
      occurredAt: new Date()
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
    expect(entry.Source).toBe("my.service")
    expect(entry.DetailType).toBe("test.event")
    expect(entry.Detail).toBe(JSON.stringify(event))
    expect(entry.EventBusName).toBe("custom-bus")
    expect(entry.Time).toEqual(event.occurredAt)
  })

  it("should throw error when publication fails", async () => {
    const publisher = new EventBridgePublisher(mockBus as any, {
      eventBridgeClient: mockEventBridgeClient as any,
      source: "my.service"
    })

    publisher.subscribe(["test.event"])
    const handler = mockBus.subscribe.mock.calls[0]?.[1]
    expect(handler).toBeDefined()
    if (!handler) throw new Error("Handler not defined")

    const error = new Error("Event Bridge failed")
    // Mock rejection for all retry attempts (default is 3)
    mockEventBridgeClient.send.mockRejectedValue(error)

    const event = {
      id: "evt_1",
      type: "test.event",
      payload: { data: "test" },
      occurredAt: new Date()
    }

    // Should throw error after all retries
    await expect(handler(event)).rejects.toThrow("Event Bridge failed")
  })
})
