import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OutboxEventBus } from "../outbox-event-bus"
import type { BusEvent } from "../types"
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
  const outbox = new InMemoryOutbox(vi.fn())
  return new OutboxEventBus(
    outbox,
    (_bus, _type, _count) => {},
    (_error) => {}
  )
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
      await eventBus.start()

      const event = createTestEvent()
      await eventBus.emit(event)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(event)
    })

    it("should allow registering same event type multiple times via on()", async () => {
      const eventBus = createEventBus()
      const handler1 = vi.fn().mockResolvedValue(undefined)
      const handler2 = vi.fn().mockResolvedValue(undefined)

      eventBus.on("usersService.create", handler1)
      eventBus.on("usersService.create", handler2)
      await eventBus.start()

      const event = createTestEvent()
      await eventBus.emit(event)

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler1).toHaveBeenCalledWith(event)
      expect(handler2).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledWith(event)
    })

    it("should publish many events", async () => {
      const eventBus = createEventBus()
      const handler = vi.fn().mockResolvedValue(undefined)

      eventBus.on("usersService.create", handler)
      await eventBus.start()

      const event1 = createTestEvent()
      const event2 = createTestEvent()
      await eventBus.emitMany([event1, event2])

      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler).toHaveBeenCalledWith(event1)
      expect(handler).toHaveBeenCalledWith(event2)
    })
  })

  describe("EventEmitter Interface", () => {
    let bus: OutboxEventBus

    beforeEach(() => {
      bus = createEventBus()
    })

    it("should support 'once'", async () => {
      await bus.start()
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
      expect(handler).toHaveBeenCalledTimes(1)

      const event2: BusEvent<string, unknown> = {
        id: "2",
        type: eventType,
        payload: {},
        occurredAt: new Date(),
      }

      await bus.emit(event2)
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it("should support 'off'", async () => {
      await bus.start()
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
      bus.on("A", async () => {})
      bus.on("B", async () => {})

      expect(bus.eventNames()).toContain("A")
      expect(bus.eventNames()).toContain("B")
      expect(bus.listenerCount("A")).toBe(2)
      expect(bus.listenerCount("B")).toBe(1)
    })

    it("should track subscription count", async () => {
      expect(bus.getSubscriptionCount()).toBe(0)

      bus.on("A", async () => {})
      expect(bus.getSubscriptionCount()).toBe(1)

      // Multiple handlers for same event type should increase count
      bus.on("A", async () => {})
      expect(bus.getSubscriptionCount()).toBe(2)
    })

    it("should allow single handler to subscribe to multiple events", async () => {
      await bus.start()
      const handler = vi.fn()
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

      // Wait for outbox processing
      await vi.advanceTimersByTimeAsync(10)

      expect(handler).toHaveBeenCalledTimes(2)
    })
  })

  describe("Performance", () => {
    it("should publish events without blocking", async () => {
      const bus = createEventBus()

      await bus.start()

      let handlerStarted = false
      let handlerFinished = false

      const event: BusEvent<"test", { foo: string }> = {
        id: "1",
        type: "test",
        payload: { foo: "bar" },
        occurredAt: new Date(),
      }

      // controlled promise to resolve handler
      let finishHandler: () => void
      const handlerPromise = new Promise<void>((resolve) => {
        finishHandler = resolve
      })

      bus.on("test", async () => {
        handlerStarted = true
        await handlerPromise
        handlerFinished = true
      })

      // Publish should return immediately
      const publishPromise = bus.emit(event)

      // With Outbox pattern, publish returns immediately after enqueue.
      // Processing happens asynchronously.

      await publishPromise

      // Wait for processing to pick up
      await vi.advanceTimersByTimeAsync(10)

      expect(handlerStarted).toBe(true)
      expect(handlerFinished).toBe(false)

      finishHandler!()
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
      await bus.start()

      let resolveHandler: () => void
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
      resolveHandler!()

      // Now stop should complete
      await stopPromise
      expect(params.stopped).toBe(true)
    })

    it("should allow re-registering after restart", async () => {
      const bus = createEventBus()
      await bus.start()

      // In STRICT mode, multiple register calls throw.
      // This test was originally checking that restart doesn't break multi-registration.
      // Now it should just check that restart clears registrations so we can re-register.

      bus.on("usersService.create", async () => {})
      // await bus.on("usersService.create", async () => {}) // This would now fail
      // await bus.on("usersService.create", async () => {}) // This would now fail

      await bus.stop()

      await bus.start()

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
      await bus.start()

      const processedEvents: string[] = []

      // Use a controlled promise to simulate "work"
      let resolveWork: () => void
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
      resolveWork!()

      await stopPromise

      expect(processedEvents).toHaveLength(5)
      expect(processedEvents).toEqual(["id-0", "id-1", "id-2", "id-3", "id-4"])
    })
  })
})
