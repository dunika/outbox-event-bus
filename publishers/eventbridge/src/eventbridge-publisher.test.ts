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
    const handler = mockBus.subscribe.mock.calls[0][1]

    const event = {
      id: "evt_1",
      type: "test.event",
      payload: { data: "test" },
      occurredAt: new Date()
    }

    mockEventBridgeClient.send.mockResolvedValueOnce({})

    await handler(event)

    expect(mockEventBridgeClient.send).toHaveBeenCalled()
    const command = mockEventBridgeClient.send.mock.calls[0][0] as PutEventsCommand
    expect(command).toBeInstanceOf(PutEventsCommand)
    expect(command.input.Entries).toBeDefined()
    const entry = command.input.Entries![0]
    expect(entry.Source).toBe("my.service")
    expect(entry.DetailType).toBe("test.event")
    expect(entry.Detail).toBe(JSON.stringify(event))
    expect(entry.EventBusName).toBe("custom-bus")
    expect(entry.Time).toEqual(event.occurredAt)
  })

  it("should call onError when publication fails", async () => {
    const publisher = new EventBridgePublisher(mockBus as any, {
      eventBridgeClient: mockEventBridgeClient as any,
      source: "my.service",
      onError
    })

    publisher.subscribe(["test.event"])
    const handler = mockBus.subscribe.mock.calls[0][1]

    const error = new Error("Event Bridge failed")
    mockEventBridgeClient.send.mockRejectedValueOnce(error)

    await handler({ type: "test.event" })

    expect(onError).toHaveBeenCalledWith(error)
  })

  it("should log error to console when publication fails and no onError provided", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const publisher = new EventBridgePublisher(mockBus as any, {
      eventBridgeClient: mockEventBridgeClient as any,
      source: "my.service"
    })

    publisher.subscribe(["test.event"])
    const handler = mockBus.subscribe.mock.calls[0][1]

    const error = new Error("Event Bridge failed")
    mockEventBridgeClient.send.mockRejectedValueOnce(error)

    await handler({ type: "test.event" })

    expect(consoleSpy).toHaveBeenCalledWith("Failed to publish event to Event Bridge:", error)
    consoleSpy.mockRestore()
  })
})
