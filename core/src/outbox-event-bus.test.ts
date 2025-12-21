import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IOutbox } from "./interfaces"
import { OutboxEventBus } from "./outbox-event-bus"
import type { BusEvent } from "./types"

describe("OutboxEventBus", () => {
  let eventBus: OutboxEventBus<unknown>
  let outbox: IOutbox<unknown>
  let outboxHandler: (event: BusEvent) => Promise<void>
  let onError: any

  beforeEach(() => {
    outbox = {
      publish: vi.fn().mockResolvedValue(undefined),
      start: vi.fn((handler) => {
        outboxHandler = handler
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    }
    onError = vi.fn()
    eventBus = new OutboxEventBus(outbox, onError)
  })

  it("should publish events to the outbox", async () => {
    const event: BusEvent = {
      id: "1",
      type: "test-event",
      payload: {},
      occurredAt: new Date(),
    }

    await eventBus.emit(event)
    expect(outbox.publish).toHaveBeenCalledWith([expect.objectContaining(event)], undefined)

    await eventBus.emitMany([event, event])
    expect(outbox.publish).toHaveBeenCalledWith(
      [expect.objectContaining(event), expect.objectContaining(event)],
      undefined
    )
  })

  it("should start and stop the outbox", async () => {
    eventBus.start()
    expect(outbox.start).toHaveBeenCalledWith(expect.any(Function), onError)

    await eventBus.stop()
    expect(outbox.stop).toHaveBeenCalled()
  })

  it("should automatically add occurredAt timestamp when not provided", async () => {
    const eventWithoutTimestamp: BusEvent = {
      id: "1",
      type: "test-event",
      payload: {},
    }

    await eventBus.emit(eventWithoutTimestamp)
    
    const publishedEvents = (outbox.publish as any).mock.calls[0][0]
    expect(publishedEvents).toHaveLength(1)
    expect(publishedEvents[0].occurredAt).toBeInstanceOf(Date)
    expect(publishedEvents[0].id).toBe("1")
    expect(publishedEvents[0].type).toBe("test-event")
  })

  it("should automatically generate id when not provided", async () => {
    const eventWithoutId: Omit<BusEvent, "id"> = {
      type: "test-event",
      payload: {},
    }

    await eventBus.emit(eventWithoutId as BusEvent)

    const publishedEvents = (outbox.publish as any).mock.calls[0][0]
    expect(publishedEvents).toHaveLength(1)
    expect(publishedEvents[0].id).toBeDefined()
    expect(typeof publishedEvents[0].id).toBe("string")
    expect(publishedEvents[0].id).toHaveLength(36) // UUID length
  })

  it("should preserve custom occurredAt when provided", async () => {
    const customDate = new Date("2023-01-01")
    const eventWithTimestamp: BusEvent = {
      id: "1",
      type: "test-event",
      payload: {},
      occurredAt: customDate,
    }

    await eventBus.emit(eventWithTimestamp)
    
    const publishedEvents = (outbox.publish as any).mock.calls[0][0]
    expect(publishedEvents).toHaveLength(1)
    expect(publishedEvents[0].occurredAt).toBe(customDate)
  })

  it("should dispatch events to subscribers", async () => {
    eventBus.start()
    const handler = vi.fn().mockResolvedValue(undefined)
    eventBus.on("test-event", handler)

    const event: BusEvent = {
      id: "1",
      type: "test-event",
      payload: { foo: "bar" },
      occurredAt: new Date(),
    }

    // Simulate outbox pushing events
    await outboxHandler(event)

    expect(handler).toHaveBeenCalledWith(event)
  })

  it("should not dispatch events to unrelated subscribers", async () => {
    eventBus.start()
    const handler = vi.fn().mockResolvedValue(undefined)
    eventBus.on("other-event", handler)

    const event: BusEvent = {
      id: "1",
      type: "test-event",
      payload: { foo: "bar" },
      occurredAt: new Date(),
    }

    // Simulate outbox pushing events
    await outboxHandler(event)

    expect(handler).not.toHaveBeenCalled()
  })

  it("should handle 'once' subscriptions", async () => {
    eventBus.start()
    const handler = vi.fn().mockResolvedValue(undefined)
    eventBus.once("test-event", handler)

    const event: BusEvent = {
      id: "1",
      type: "test-event",
      payload: {},
      occurredAt: new Date(),
    }

    // First emission
    await outboxHandler(event)
    expect(handler).toHaveBeenCalledTimes(1)

    // Second emission
    await outboxHandler(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("should allow unsubscribing", async () => {
    eventBus.start()
    const handler = vi.fn().mockResolvedValue(undefined)
    eventBus.on("test-event", handler)

    const event: BusEvent = {
      id: "1",
      type: "test-event",
      payload: {},
      occurredAt: new Date(),
    }

    await outboxHandler(event)
    expect(handler).toHaveBeenCalledTimes(1)

    eventBus.off("test-event", handler)

    await outboxHandler(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("should handle errors in subscribers gracefully", async () => {
    eventBus.start()
    const errorHandler = vi.fn().mockRejectedValue(new Error("oops"))

    // Single failing handler
    eventBus.on("test-event", errorHandler)

    const event: BusEvent = {
      id: "1",
      type: "test-event",
      payload: {},
      occurredAt: new Date(),
    }

    // Expect the promise to reject because one handler failed
    await expect(outboxHandler(event)).rejects.toThrow("oops")

    expect(errorHandler).toHaveBeenCalled()
    expect(errorHandler).toHaveBeenCalled()
    // onError is no longer called by processEvent directly, it relies on the adapter/caller to handle the error
  })

  describe("1:1 Command Bus Features", () => {
    it("should throw when adding a second listener for the same event", async () => {
      eventBus.on("test-event", async () => {})
      
      expect(() => {
        eventBus.on("test-event", async () => {})
      }).toThrow(/Event type "test-event" already has a listener/i)
    })

    it("should remove listener", async () => {
      eventBus.start()
      const handler = vi.fn()
      eventBus.on("test-event", handler)

      expect(eventBus.getSubscriptionCount()).toBe(1)

      // Remove specific event listeners
      eventBus.removeAllListeners("test-event")
      expect(eventBus.listenerCount("test-event")).toBe(0)

      // Remove all listeners
      eventBus.on("test-event", handler)
      eventBus.removeAllListeners()
      expect(eventBus.getSubscriptionCount()).toBe(0)
    })

    it("should wait for events", async () => {
      eventBus.start()
      const eventType = "wait-test"

      // Start waiting
      const waitPromise = eventBus.waitFor(eventType, 100)

      // Publish should return immediately
      const event: BusEvent = {
        id: "1",
        type: eventType,
        payload: { success: true },
        occurredAt: new Date(),
      }
      void eventBus.emit(event)

      // Simulate async arrival
      setTimeout(() => {
        void outboxHandler(event)
      }, 10)

      const result = await waitPromise
      expect(result).toBe(event)
    })

    it("should timeout when waiting", async () => {
      eventBus.start()
      await expect(eventBus.waitFor("never-happens", 10)).rejects.toThrow("Timed out waiting")
    })

    it("should support addListener alias", async () => {
      const handler = vi.fn()
      eventBus.addListener("test", handler)
      expect(eventBus.listenerCount("test")).toBe(1)
    })

    it("should support removeListener alias", async () => {
      const handler = vi.fn()
      eventBus.on("test", handler)
      eventBus.removeListener("test", handler)
      expect(eventBus.listenerCount("test")).toBe(0)
    })

    it("should return listener", async () => {
      const handler = vi.fn()
      eventBus.on("test", handler)

      const listener = eventBus.getListener("test")
      expect(listener).toBe(handler)
    })
  })
})
