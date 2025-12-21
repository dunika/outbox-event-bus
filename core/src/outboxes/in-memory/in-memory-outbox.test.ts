import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OutboxEventBus } from "../../bus/outbox-event-bus"
import { DuplicateListenerError } from "../../errors/errors"
import type { BusEvent } from "../../types/types"
import { InMemoryOutbox } from "./in-memory-outbox"

function createTestEvent(): BusEvent<
  "usersService.create",
  { userId: string; email: string; name: string }
> {
  return {
    id: "1",
    type: "usersService.create",
    payload: {
      userId: "user-1",
      email: "test@example.com",
      name: "Test User",
    },
    occurredAt: new Date(),
  }
}

function createEventBus() {
  const outbox = new InMemoryOutbox()
  return new OutboxEventBus(outbox, (error) => {
    console.error("Test EventBus Error:", error)
  })
}

describe("OutboxEventBus with InMemoryOutbox", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("Core Functionality", () => {
    it("should publish and receive events", async () => {
      const eventBus = createEventBus()
      const handler = vi.fn().mockResolvedValue(undefined)

      eventBus.on("usersService.create", handler)
      eventBus.start()

      const event = createTestEvent()
      await eventBus.emit(event)
      await vi.advanceTimersByTimeAsync(20)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(event)
    })

    it("should throw when registering same event type multiple times", async () => {
      const eventBus = createEventBus()
      const handler1 = vi.fn().mockResolvedValue(undefined)
      const handler2 = vi.fn().mockResolvedValue(undefined)

      eventBus.on("usersService.create", handler1)

      expect(() => {
        eventBus.on("usersService.create", handler2)
      }).toThrow(DuplicateListenerError)
    })

    it("should publish many events", async () => {
      const eventBus = createEventBus()
      const handler = vi.fn().mockResolvedValue(undefined)

      eventBus.on("usersService.create", handler)
      eventBus.start()

      const event1 = createTestEvent()
      const event2 = createTestEvent()
      await eventBus.emitMany([event1, event2])
      await vi.advanceTimersByTimeAsync(20)

      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler).toHaveBeenCalledWith(event1)
      expect(handler).toHaveBeenCalledWith(event2)
    })

    it("should automatically add occurredAt when not provided", async () => {
      const eventBus = createEventBus()
      const handler = vi.fn().mockResolvedValue(undefined)

      eventBus.on("usersService.create", handler)
      eventBus.start()

      // Emit event without occurredAt
      await eventBus.emit({
        id: "1",
        type: "usersService.create",
        payload: {
          userId: "user-1",
          email: "test@example.com",
          name: "Test User",
        },
      })
      await vi.advanceTimersByTimeAsync(20)

      expect(handler).toHaveBeenCalledTimes(1)
      const receivedEvent = handler.mock.calls[0]?.[0]
      expect(receivedEvent?.occurredAt).toBeInstanceOf(Date)
      expect(receivedEvent?.id).toBe("1")
    })
  })

  describe("EventEmitter Interface", () => {
    let bus: OutboxEventBus<unknown>

    beforeEach(() => {
      bus = createEventBus()
    })

    it("should support 'once'", async () => {
      bus.start()
      const handler = vi.fn()
      const eventType = "TEST_EVENT"

      bus.once(eventType, handler)

      const event1: BusEvent<string, unknown> = {
        id: "1",
        type: eventType,
        payload: {},
        occurredAt: new Date(),
      }

      await bus.emit(event1)
      await vi.advanceTimersByTimeAsync(20)
      expect(handler).toHaveBeenCalledTimes(1)

      const event2: BusEvent<string, unknown> = {
        id: "2",
        type: eventType,
        payload: {},
        occurredAt: new Date(),
      }

      await bus.emit(event2)
      await vi.advanceTimersByTimeAsync(20)
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it("should support 'off'", async () => {
      bus.start()
      const handler = vi.fn()
      const eventType = "TEST_EVENT"

      bus.on(eventType, handler)
      expect(bus.listenerCount(eventType)).toBe(1)

      bus.off(eventType, handler)
      expect(bus.listenerCount(eventType)).toBe(0)

      const event: BusEvent<string, unknown> = {
        id: "1",
        type: eventType,
        payload: {},
        occurredAt: new Date(),
      }

      await bus.emit(event)
      expect(handler).not.toHaveBeenCalled()
    })

    it("should track event names and listener counts", async () => {
      bus.on("A", async () => {})
      // bus.on("A", async () => {}) // Duplicate not allowed
      bus.on("B", async () => {})

      expect(bus.eventNames()).toContain("A")
      expect(bus.eventNames()).toContain("B")
      expect(bus.listenerCount("A")).toBe(1)
      expect(bus.listenerCount("B")).toBe(1)
    })

    it("should track subscription count", async () => {
      expect(bus.getSubscriptionCount()).toBe(0)

      bus.on("A", async () => {})
      expect(bus.getSubscriptionCount()).toBe(1)

      // Multiple handlers for same event type should increase count
      // Multiple handlers for same event type should throw
      expect(() => {
        bus.on("A", async () => {})
      }).toThrow(DuplicateListenerError)
      expect(bus.getSubscriptionCount()).toBe(1)
    })

    it("should allow single handler to subscribe to multiple events", async () => {
      bus.start()
      const handler = vi.fn().mockResolvedValue(undefined)
      bus.subscribe(["A", "B"], handler)

      expect(bus.listenerCount("A")).toBe(1)
      expect(bus.listenerCount("B")).toBe(1)
      expect(bus.getSubscriptionCount()).toBe(2)

      await bus.emit({
        id: "1",
        type: "A",
        payload: {},
        occurredAt: new Date(),
      })
      await bus.emit({
        id: "2",
        type: "B",
        payload: {},
        occurredAt: new Date(),
      })

      // Wait for outbox processing (sequential, so needs more time)
      await vi.advanceTimersByTimeAsync(50)

      expect(handler).toHaveBeenCalledTimes(2)
    })
  })

  describe("Performance", () => {
    it("should publish events without blocking", async () => {
      const bus = createEventBus()

      bus.start()

      let handlerStarted = false
      let handlerFinished = false

      const event: BusEvent<"test", { foo: string }> = {
        id: "1",
        type: "test",
        payload: { foo: "bar" },
        occurredAt: new Date(),
      }

      // controlled promise to resolve handler
      function resolveHandlerDefault() {}
      let resolveHandler: () => void = resolveHandlerDefault
      const handler = vi.fn().mockImplementation(() => {
        return new Promise<void>((resolve) => {
          resolveHandler = resolve
        })
      })
      bus.on("test", async () => {
        handlerStarted = true
        await handler() // Call the mocked handler which returns a promise
        handlerFinished = true
      })

      // Publish should return immediately
      const publishPromise = bus.emit(event)

      // With Outbox pattern, publish returns immediately after enqueue.
      await new Promise((resolve) => setTimeout(resolve, 100))
      await vi.advanceTimersByTimeAsync(10)

      expect(handlerStarted).toBe(true)
      expect(handlerFinished).toBe(false)

      resolveHandler?.()
      // We need to wait for the microtask queue to process the resolution
      await Promise.resolve()
      // Or simple process pending promises
      await bus.stop() // stop awaits pending promises

      expect(handlerFinished).toBe(true)
    })
  })

  describe("Graceful Shutdown", () => {
    it("should wait for active handlers to complete when stopping", async () => {
      const bus = createEventBus()
      bus.start()

      let resolveHandler: (() => void) | undefined
      const handlerFinished = new Promise<void>((resolve) => {
        resolveHandler = resolve
      })

      const handlerSpy = vi.fn(async () => {
        await handlerFinished
      })

      bus.on("usersService.create", handlerSpy)

      // Publish event
      await bus.emit(createTestEvent())

      // Stop bus - should block until handler finishes
      const params = { stopped: false }
      const stopPromise = bus.stop().then(() => {
        params.stopped = true
      })

      // Advance timers just in case, though this uses promises
      await vi.advanceTimersByTimeAsync(10)

      expect(params.stopped).toBe(false)
      expect(handlerSpy).toHaveBeenCalled()

      // Allow handler to finish
      resolveHandler?.()

      // Now stop should complete
      await stopPromise
      expect(params.stopped).toBe(true)
    })

    it("should allow re-registration after restart", async () => {
      const bus = createEventBus()
      bus.start()

      const handler = vi.fn().mockResolvedValue(undefined)
      bus.on("usersService.create", handler)

      await bus.stop()

      bus.start()

      bus.removeAllListeners("usersService.create")

      expect(() => {
        bus.on("usersService.create", async () => {})
      }).not.toThrow()
    })

    it("should process all queued events even after stop() is called", async () => {
      // LocalEventBus handles events synchronously (kick-off) so "queued" events
      // usually implies waiting for async handlers to finish.
      // The current implementation of LocalEventBus doesn't have an internal queue that persists after stop is called,
      // except for the `pendingPromises` which are awaited.
      // The original test simulated a "queue" by having slow handlers.

      const bus = createEventBus()
      bus.start()

      const processedEvents: string[] = []

      // Use a controlled promise to simulate "work"
      let resolveWork: (() => void) | undefined
      const workPromise = new Promise<void>((resolve) => {
        resolveWork = resolve
      })

      async function handler(event: BusEvent<string, { id: string }>) {
        await workPromise
        processedEvents.push(event.payload.id)
      }

      bus.on("TEST_EVENT", handler)

      const events: BusEvent<string, { id: string }>[] = Array.from({ length: 5 }, (_, i) => ({
        id: `evt-${i}`,
        type: "TEST_EVENT",
        payload: { id: `id-${i}` },
        occurredAt: new Date(),
      }))

      // Fire all events
      await bus.emitMany(events)

      // Initiate stop, which should wait for handlers
      const stopPromise = bus.stop()

      expect(processedEvents).toHaveLength(0)

      // Finish work
      resolveWork?.()

      await stopPromise

      expect(processedEvents).toHaveLength(5)
      expect(processedEvents).toEqual(["id-0", "id-1", "id-2", "id-3", "id-4"])
    })
  })
})
