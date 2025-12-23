import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IOutbox } from "../types/interfaces"
import type { BusEvent } from "../types/types"
import { OutboxEventBus } from "./outbox-event-bus"

describe("OutboxEventBus Middleware", () => {
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
      getFailedEvents: vi.fn().mockResolvedValue([]),
      retryEvents: vi.fn().mockResolvedValue(undefined),
    }
    onError = vi.fn()
    eventBus = new OutboxEventBus(outbox, onError)
  })

  it("should execute middleware in onion order during emit", async () => {
    const order: string[] = []

    eventBus.addEmitMiddleware(async (_, next) => {
      order.push(`m1 start emit`)
      await next()
      order.push(`m1 end emit`)
    })

    eventBus.addEmitMiddleware(async (_, next) => {
      order.push(`m2 start emit`)
      await next()
      order.push(`m2 end emit`)
    })

    await eventBus.emit({ type: "test", payload: {} })

    expect(order).toEqual(["m1 start emit", "m2 start emit", "m2 end emit", "m1 end emit"])
  })

  it("should register middleware for both phases using addMiddleware", async () => {
    const order: string[] = []

    eventBus.addMiddleware(async (ctx, next) => {
      order.push(ctx.phase)
      await next()
    })

    const handler = vi.fn()
    eventBus.on("test-event", handler)
    eventBus.start()

    await eventBus.emit({ type: "test-event", payload: {} })
    await outboxHandler({
      id: "1",
      type: "test-event",
      payload: {},
      occurredAt: new Date(),
    })

    expect(order).toEqual(["emit", "handler"])
    expect(handler).toHaveBeenCalled()
  })

  it("should execute middleware in onion order during handler phase", async () => {
    eventBus.start()
    const handler = vi.fn().mockResolvedValue(undefined)
    eventBus.on("test-event", handler)

    const order: string[] = []

    eventBus.addHandlerMiddleware(async (_, next) => {
      order.push("m1 start")
      await next()
      order.push("m1 end")
    })

    eventBus.addHandlerMiddleware(async (_, next) => {
      order.push("m2 start")
      await next()
      order.push("m2 end")
    })

    const event: BusEvent = {
      id: "1",
      type: "test-event",
      payload: {},
      occurredAt: new Date(),
    }

    await outboxHandler(event)

    expect(order).toEqual(["m1 start", "m2 start", "m2 end", "m1 end"])
    expect(handler).toHaveBeenCalled()
  })

  it("should allow middleware to modify event during emit", async () => {
    eventBus.addEmitMiddleware(async (ctx, next) => {
      ctx.event.metadata = { ...ctx.event.metadata, modified: true }
      await next()
    })

    await eventBus.emit({ type: "test", payload: {} })

    const published = (outbox.publish as any).mock.calls[0][0][0]
    expect(published.metadata).toEqual({ modified: true })
  })

  it("should allow middleware to skip processing (idempotency pattern)", async () => {
    eventBus.start()
    const handler = vi.fn()
    eventBus.on("test-event", handler)

    eventBus.addHandlerMiddleware(async (ctx, next) => {
      if (ctx.event.id === "skip-me") {
        await next({ dropEvent: true })
        return
      }
      await next()
    })

    await outboxHandler({
      id: "skip-me",
      type: "test-event",
      payload: {},
      occurredAt: new Date(),
    })
    expect(handler).not.toHaveBeenCalled()

    await outboxHandler({
      id: "process-me",
      type: "test-event",
      payload: {},
      occurredAt: new Date(),
    })
    expect(handler).toHaveBeenCalled()
  })

  it("should propagate errors from middleware", async () => {
    eventBus.addEmitMiddleware(async () => {
      throw new Error("middleware error")
    })

    await expect(eventBus.emit({ type: "test", payload: {} })).rejects.toThrow("middleware error")
    expect(outbox.publish).not.toHaveBeenCalled()
  })

  it("should throw error if next() is called multiple times", async () => {
    eventBus.addEmitMiddleware(async (_ctx, next) => {
      await next()
      await next()
    })

    await expect(eventBus.emit({ type: "test", payload: {} })).rejects.toThrow(
      "next() called multiple times"
    )
  })

  it("should pass transaction context to middleware during emit", async () => {
    const transaction = { id: "tx1" }
    let seenTransaction: any

    eventBus.addEmitMiddleware(async (ctx, next) => {
      seenTransaction = ctx.transaction
      await next()
    })

    await eventBus.emit({ type: "test", payload: {} }, transaction)
    expect(seenTransaction).toBe(transaction)
  })

  it("should allow modifying deep payload properties", async () => {
    eventBus.addEmitMiddleware(async (ctx, next) => {
      const payload = ctx.event.payload as any
      payload.nested = { ...payload.nested, added: true }
      await next()
    })

    await eventBus.emit({ type: "test", payload: { nested: { original: true } } })

    const published = (outbox.publish as any).mock.calls[0][0][0]
    expect(published.payload).toEqual({ nested: { original: true, added: true } })
  })

  it("should validate events in middleware", async () => {
    eventBus.addEmitMiddleware(async (ctx, next) => {
      if (!ctx.event.payload || Object.keys(ctx.event.payload as object).length === 0) {
        throw new Error("Payload required")
      }
      await next()
    })

    await expect(eventBus.emit({ type: "test", payload: {} })).rejects.toThrow("Payload required")

    await eventBus.emit({ type: "test", payload: { foo: "bar" } })
    expect(outbox.publish).toHaveBeenCalled()
  })

  it("should allow middleware to filter events during emit", async () => {
    eventBus.addEmitMiddleware(async (ctx, next) => {
      // Filter out events with type "filter-me"
      if (ctx.event.type === "filter-me") {
        await next({ dropEvent: true })
        return
      }
      await next()
    })

    await eventBus.emitMany([
      { type: "filter-me", payload: {} },
      { type: "keep-me", payload: {} },
    ])

    expect(outbox.publish).toHaveBeenCalledTimes(1)
    const published = (outbox.publish as any).mock.calls[0][0] as BusEvent[]
    expect(published).toHaveLength(1)
    expect(published[0]?.type).toBe("keep-me")
  })

  it("should allow middleware to replace events during emit", async () => {
    eventBus.addEmitMiddleware(async (ctx, next) => {
      ctx.event = { ...ctx.event, type: "replaced" }
      await next()
    })

    await eventBus.emit({ type: "original", payload: {} })

    const published = (outbox.publish as any).mock.calls[0][0][0]
    expect(published.type).toBe("replaced")
  })
  it("should allow middleware to replace events during handler phase", async () => {
    eventBus.start()
    const handler = vi.fn().mockResolvedValue(undefined)
    eventBus.on("test-event", handler)

    eventBus.addHandlerMiddleware(async (ctx, next) => {
      ctx.event = { ...ctx.event, payload: { replaced: true } }
      await next()
    })

    const event: BusEvent = {
      id: "1",
      type: "test-event",
      payload: { original: true },
      occurredAt: new Date(),
    }

    await outboxHandler(event)

    expect(handler).toHaveBeenCalledTimes(1)
    const calledEvent = handler.mock.calls[0]?.[0]
    expect(calledEvent.payload).toEqual({ replaced: true })
  })

  it("should ensure events get unique Date instances to avoid shared reference mutation", async () => {
    eventBus.addEmitMiddleware(async (ctx, next) => {
      if (ctx.event.type === "mutate-date") {
        ctx.event.occurredAt.setFullYear(2000)
      }
      await next()
    })

    await eventBus.emitMany([
      { type: "mutate-date", payload: {} },
      { type: "keep-date", payload: {} },
    ])

    const published = (outbox.publish as any).mock.calls[0][0] as BusEvent[]
    const mutated = published.find((e) => e.type === "mutate-date")
    const kept = published.find((e) => e.type === "keep-date")

    if (!mutated || !kept) {
      throw new Error("Events not found")
    }

    expect(mutated.occurredAt.getFullYear()).toBe(2000)
    // The other event should NOT have been affected
    expect(kept.occurredAt.getFullYear()).not.toBe(2000)
    expect(kept.occurredAt.getFullYear()).toBe(new Date().getFullYear())
  })

  it("should snapshot middlewares to ensure pipeline stability", async () => {
    const order: string[] = []

    eventBus.addEmitMiddleware(async (_ctx, next) => {
      order.push("m1 start")
      eventBus.addEmitMiddleware(async (_ctx2, next2) => {
        order.push("m-dynamic")
        await next2()
      })
      await next()
      order.push("m1 end")
    })

    await eventBus.emit({ type: "test", payload: {} })

    // m-dynamic should NOT have run for the current emit
    expect(order).toEqual(["m1 start", "m1 end"])

    // But it SHOULD run for the next emit
    order.length = 0
    await eventBus.emit({ type: "test", payload: {} })
    expect(order).toEqual(["m1 start", "m-dynamic", "m1 end"])
  })

  it("should run middleware during handler phase even if no handler is registered", async () => {
    let middlewareRan = false
    eventBus.addHandlerMiddleware(async (_, next) => {
      middlewareRan = true
      await next()
    })

    eventBus.start()

    await outboxHandler({
      id: "1",
      type: "unhandled-event",
      payload: {},
      occurredAt: new Date(),
    })

    expect(middlewareRan).toBe(true)
  })

  it("should correctly route to new handler if middleware modifies event type during handler phase", async () => {
    eventBus.start()
    const originalHandler = vi.fn()
    const newHandler = vi.fn()

    eventBus.on("original-type", originalHandler)
    eventBus.on("new-type", newHandler)

    eventBus.addHandlerMiddleware(async (ctx, next) => {
      if (ctx.event.type === "original-type") {
        ctx.event = { ...ctx.event, type: "new-type" }
      }
      await next()
    })

    await outboxHandler({
      id: "1",
      type: "original-type",
      payload: {},
      occurredAt: new Date(),
    })

    expect(originalHandler).not.toHaveBeenCalled()
    expect(newHandler).toHaveBeenCalledTimes(1)
    expect(newHandler.mock.calls[0]?.[0].type).toBe("new-type")
  })

  it("should propagate errors from middleware during handler phase", async () => {
    eventBus.start()
    const handler = vi.fn()
    eventBus.on("test-event", handler)

    eventBus.addHandlerMiddleware(async () => {
      throw new Error("handler middleware error")
    })

    await expect(
      outboxHandler({
        id: "1",
        type: "test-event",
        payload: {},
        occurredAt: new Date(),
      })
    ).rejects.toThrow("handler middleware error")

    expect(handler).not.toHaveBeenCalled()
  })

  it("should process multiple events through middleware with emitMany", async () => {
    const processedEvents: string[] = []

    eventBus.addEmitMiddleware(async (ctx, next) => {
      processedEvents.push(ctx.event.type)
      ctx.event.metadata = { ...ctx.event.metadata, processed: true }
      await next()
    })

    await eventBus.emitMany([
      { type: "event1", payload: {} },
      { type: "event2", payload: {} },
      { type: "event3", payload: {} },
    ])

    expect(processedEvents).toEqual(["event1", "event2", "event3"])
    expect(outbox.publish).toHaveBeenCalledTimes(1)
    const published = (outbox.publish as any).mock.calls[0][0] as BusEvent[]
    expect(published).toHaveLength(3)
    expect(published.every((e) => e.metadata?.processed === true)).toBe(true)
  })

  it("should handle processEvent with no middleware and no handler gracefully", async () => {
    eventBus.start()

    // No handler registered, no middleware
    await expect(
      outboxHandler({
        id: "1",
        type: "unhandled-event",
        payload: {},
        occurredAt: new Date(),
      })
    ).resolves.toBeUndefined()
  })
  it("should throw error if middleware does not call next()", async () => {
    eventBus.addEmitMiddleware(async () => {
      // Forgot to call next()
    })

    await expect(eventBus.emit({ type: "test", payload: {} })).rejects.toThrow("must call next()")
  })

  it("should stop propagation when dropEvent: true is passed", async () => {
    eventBus.addEmitMiddleware(async (ctx, next) => {
      await next({ dropEvent: true })
    })

    const nextMiddleware = vi.fn(async (_ctx, next) => next())
    eventBus.addEmitMiddleware(nextMiddleware)

    await eventBus.emit({ type: "test", payload: {} })

    expect(nextMiddleware).not.toHaveBeenCalled()
    expect(outbox.publish).not.toHaveBeenCalled()
  })

  it("should drop event if downstream middleware drops it", async () => {
    eventBus.addEmitMiddleware(async (ctx, next) => {
      // Upstream middleware blindly calls next
      await next()
    })

    eventBus.addEmitMiddleware(async (ctx, next) => {
      // Downstream middleware drops it
      await next({ dropEvent: true })
    })

    await eventBus.emit({ type: "test", payload: {} })

    expect(outbox.publish).not.toHaveBeenCalled()
  })
})
