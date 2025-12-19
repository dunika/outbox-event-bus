import { describe, expect, it, vi, afterEach } from "vitest"
import { InMemoryOutbox } from "./index"

describe("InMemoryOutbox", () => {
  let outbox: InMemoryOutbox | undefined

  afterEach(async () => {
    if (outbox) {
      await outbox.stop()
      outbox = undefined // Reset for the next test
    }
  })

  it("should process events when they are published", async () => {
    const onError = vi.fn()
    outbox = new InMemoryOutbox({ onError })
    const handler = vi.fn().mockResolvedValue(undefined)

    await outbox.start(handler)

    const event = {
      id: "1",
      type: "test",
      payload: {},
      occurredAt: new Date(),
    }

    await outbox.publish([event])

    expect(handler).toHaveBeenCalledWith([event])
    expect(onError).not.toHaveBeenCalled()
  })

  it("should process buffered events when started", async () => {
    const onError = vi.fn()
    outbox = new InMemoryOutbox({ onError })
    const handler = vi.fn().mockResolvedValue(undefined)

    const event = {
      id: "1",
      type: "test",
      payload: {},
      occurredAt: new Date(),
    }

    await outbox.publish([event])
    expect(handler).not.toHaveBeenCalled()

    await outbox.start(handler)
    expect(handler).toHaveBeenCalledWith([event])
  })

  it("should call onError when handler fails", async () => {
    const onError = vi.fn()
    outbox = new InMemoryOutbox({ onError })
    const error = new Error("failed")
    const handler = vi.fn().mockRejectedValue(error)

    await outbox.start(handler)

    const event = {
      id: "1",
      type: "test",
      payload: {},
      occurredAt: new Date(),
    }

    await outbox.publish([event])

    expect(handler).toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(error)
  })

  it("should stop processing when stopped", async () => {
    const onError = vi.fn()
    outbox = new InMemoryOutbox({ onError })
    const handler = vi.fn().mockResolvedValue(undefined)

    await outbox.start(handler)
    await outbox.stop()

    const event = {
      id: "1",
      type: "test",
      payload: {},
      occurredAt: new Date(),
    }

    await outbox.publish([event])
    expect(handler).not.toHaveBeenCalled()
  })
})
