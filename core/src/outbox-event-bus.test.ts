import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IOutbox } from "./interfaces"
import { OutboxEventBus } from "./outbox-event-bus"
import type { BusEvent } from "./types"

describe("OutboxEventBus", () => {
  let eventBus: OutboxEventBus
  let outbox: IOutbox
  let outboxHandler: (events: BusEvent[]) => Promise<void>
  let onMaxListeners: any
  let onError: any

  beforeEach(() => {
    outbox = {
      publish: vi.fn().mockResolvedValue(undefined),
      start: vi.fn((handler) => {
        outboxHandler = handler
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    }
    onMaxListeners = vi.fn()
    onError = vi.fn()
    eventBus = new OutboxEventBus(outbox, onMaxListeners, onError)
  })

  it("should publish events to the outbox", async () => {
    const event: BusEvent = {
      id: "1",
      type: "test-event",
      payload: {},
      occurredAt: new Date(),
    }

    await eventBus.emit(event)
    expect(outbox.publish).toHaveBeenCalledWith([event])

    await eventBus.emitMany([event, event])
    expect(outbox.publish).toHaveBeenCalledWith([event, event])
  })

  it("should start and stop the outbox", async () => {
    eventBus.start()
    expect(outbox.start).toHaveBeenCalled()

    await eventBus.stop()
    expect(outbox.stop).toHaveBeenCalled()
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
    await outboxHandler([event])

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
    await outboxHandler([event])

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
    await outboxHandler([event])
    expect(handler).toHaveBeenCalledTimes(1)

    // Second emission
    await outboxHandler([event])
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

    await outboxHandler([event])
    expect(handler).toHaveBeenCalledTimes(1)

    eventBus.off("test-event", handler)

    await outboxHandler([event])
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("should handle errors in subscribers gracefully", async () => {
    eventBus.start()
    const errorHandler = vi.fn().mockRejectedValue(new Error("oops"))
    const successHandler = vi.fn().mockResolvedValue(undefined)

    // Chaining test
    eventBus.on("test-event", errorHandler).on("test-event", successHandler)

    const event: BusEvent = {
      id: "1",
      type: "test-event",
      payload: {},
      occurredAt: new Date(),
    }

    await outboxHandler([event])

    expect(errorHandler).toHaveBeenCalled()
    expect(successHandler).toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })

  describe("Parity Features", () => {
    it("should remove all listeners", async () => {
      eventBus.start()
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      eventBus.on("event-1", handler1).on("event-2", handler2)

      expect(eventBus.getSubscriptionCount()).toBe(2)

      // Remove specific event listeners
      eventBus.removeAllListeners("event-1")
      expect(eventBus.listenerCount("event-1")).toBe(0)
      expect(eventBus.listenerCount("event-2")).toBe(1)

      // Remove all listeners
      eventBus.removeAllListeners()
      expect(eventBus.getSubscriptionCount()).toBe(0)
    })

    it("should prepend listeners", async () => {
      eventBus.start()
      const callOrder: string[] = []

      const normalHandler = vi.fn().mockImplementation(async () => {
        callOrder.push("normal")
      })
      const prependHandler = vi.fn().mockImplementation(async () => {
        callOrder.push("prepend")
      })

      eventBus.on("test", normalHandler).prependListener("test", prependHandler)

      const event: BusEvent = {
        id: "1",
        type: "test",
        payload: {},
        occurredAt: new Date(),
      }

      await outboxHandler([event])

      expect(callOrder).toEqual(["prepend", "normal"])
    })

    it("should warn on max listeners exceeded", async () => {
      eventBus.setMaxListeners(2)

      eventBus.on("test", async () => {}).on("test", async () => {})

      expect(onMaxListeners).not.toHaveBeenCalled()

      eventBus.on("test", async () => {})

      expect(onMaxListeners).toHaveBeenCalledWith(eventBus, "test", 2)
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
        void outboxHandler([event])
      }, 10)

      const result = await waitPromise
      expect(result).toBe(event)
    })

    it("should timeout when waiting", async () => {
      eventBus.start()
      await expect(eventBus.waitFor("never-happens", 10)).rejects.toThrow("Timed out waiting")
    })

    it("should allow removing multiple listeners with array", async () => {
      eventBus.start()
      const handler = vi.fn()
      eventBus.subscribe(["A", "B"], handler)

      expect(eventBus.listenerCount("A")).toBe(1)
      expect(eventBus.listenerCount("B")).toBe(1)

      eventBus.off(["A", "B"], handler)

      expect(eventBus.listenerCount("A")).toBe(0)
      expect(eventBus.listenerCount("B")).toBe(0)
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

    it("should return raw listeners", async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      eventBus.on("test", handler1)
      eventBus.on("test", handler2)

      const listeners = eventBus.rawListeners("test")
      expect(listeners).toHaveLength(2)
      expect(listeners).toContain(handler1)
      expect(listeners).toContain(handler2)

      // Should return copy or actual array? Node returns a copy of the array of wrappers or functions.
      // My implementation returns a copy `[...handlers]`.
      listeners.pop()
      expect(eventBus.listenerCount("test")).toBe(2)
    })

    it("should support prependOnceListener", async () => {
      eventBus.start()
      const callOrder: string[] = []
      const normalHandler = vi.fn().mockImplementation(async () => {
        callOrder.push("normal")
      })
      const prependOnceHandler = vi.fn().mockImplementation(async () => {
        callOrder.push("prependOnce")
      })

      eventBus.on("test", normalHandler)
      eventBus.prependOnceListener("test", prependOnceHandler)

      const event: BusEvent = {
        id: "1",
        type: "test",
        payload: {},
        occurredAt: new Date(),
      }

      await outboxHandler([event])
      expect(callOrder).toEqual(["prependOnce", "normal"])
      expect(prependOnceHandler).toHaveBeenCalledTimes(1)

      // Emit again, prependOnce should be gone
      callOrder.length = 0
      await outboxHandler([event])
      expect(callOrder).toEqual(["normal"])
      expect(prependOnceHandler).toHaveBeenCalledTimes(1) // still 1
    })

    it("should handle handlers that modify the handlers array during processing", async () => {
      eventBus.start()
      const callOrder: string[] = []

      // This handler removes itself during execution
      const selfRemovingHandler = vi.fn().mockImplementation(async () => {
        callOrder.push("selfRemoving")
        eventBus.off("test", selfRemovingHandler)
      })

      // This handler should still execute even though the previous handler modified the array
      const normalHandler = vi.fn().mockImplementation(async () => {
        callOrder.push("normal")
      })

      // This handler adds a new handler during execution
      const addingHandler = vi.fn().mockImplementation(async () => {
        callOrder.push("adding")
        eventBus.on("test", lateHandler)
      })

      const lateHandler = vi.fn().mockImplementation(async () => {
        callOrder.push("late")
      })

      eventBus.on("test", selfRemovingHandler)
      eventBus.on("test", normalHandler)
      eventBus.on("test", addingHandler)

      const event: BusEvent = {
        id: "1",
        type: "test",
        payload: {},
        occurredAt: new Date(),
      }

      // First emission: all three original handlers should execute
      // The late handler should NOT execute because it was added during processing
      await outboxHandler([event])
      expect(callOrder).toEqual(["selfRemoving", "normal", "adding"])
      expect(eventBus.listenerCount("test")).toBe(3) // selfRemoving removed, lateHandler added

      // Second emission: only normal, adding, and late handlers should execute
      callOrder.length = 0
      await outboxHandler([event])
      expect(callOrder).toEqual(["normal", "adding", "late"])
    })
  })
})
