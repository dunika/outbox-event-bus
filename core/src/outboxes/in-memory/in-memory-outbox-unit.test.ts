import { afterEach, describe, expect, it, vi } from "vitest"
import { MaxRetriesExceededError } from "../../errors/errors"
import { InMemoryOutbox } from "./in-memory-outbox"

describe("InMemoryOutbox Unit", () => {
  let outbox: InMemoryOutbox | undefined

  afterEach(async () => {
    if (outbox) {
      await outbox.stop()
      outbox = undefined // Reset for the next test
    }
  })

  it("should process events when they are published", async () => {
    const onError = vi.fn()
    outbox = new InMemoryOutbox()
    const handler = vi.fn().mockResolvedValue(undefined)

    outbox.start(handler, onError)

    const event = {
      id: "1",
      type: "test",
      payload: {},
      occurredAt: new Date(),
    }

    await outbox.publish([event])
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(handler).toHaveBeenCalledWith(event)
    expect(onError).not.toHaveBeenCalled()
  })

  it("should process buffered events when started", async () => {
    const onError = vi.fn()
    outbox = new InMemoryOutbox()
    const handler = vi.fn().mockResolvedValue(undefined)

    const event = {
      id: "1",
      type: "test",
      payload: {},
      occurredAt: new Date(),
    }

    await outbox.publish([event])
    expect(handler).not.toHaveBeenCalled()

    outbox.start(handler, onError)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(handler).toHaveBeenCalledWith(event)
  })

  it("should call onError when handler fails", async () => {
    const onError = vi.fn()
    outbox = new InMemoryOutbox()
    const error = new Error("failed")
    const handler = vi.fn().mockRejectedValueOnce(error)

    outbox.start(handler, onError)

    const event = {
      id: "1",
      type: "test",
      payload: {},
      occurredAt: new Date(),
    }

    await outbox.publish([event])
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(handler).toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(error, event)
  })

  it("should stop processing when stopped", async () => {
    const onError = vi.fn()
    outbox = new InMemoryOutbox()
    const handler = vi.fn().mockResolvedValue(undefined)

    outbox.start(handler, onError)
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
  it("should stop retrying after maxRetries is exceeded", async () => {
    const onError = vi.fn()
    // Configure with maxRetries: 2 (total 3 attempts: 1 initial + 2 retries)
    outbox = new InMemoryOutbox({ maxRetries: 2 })
    const error = new Error("permanent failure")
    const handler = vi.fn().mockRejectedValue(error)

    outbox.start(handler, onError)

    const event = {
      id: "retry-test-1",
      type: "test",
      payload: {},
      occurredAt: new Date(),
    }

    await outbox.publish([event])

    // Wait enough time for retries to happen
    // Initial + 2 retries with backoff
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Should be called 3 times: 1 initial + 2 retries
    expect(handler).toHaveBeenCalledTimes(3)

    // Should call onError 3 times: 2 times for the original error (retries)
    // AND 1 time for the "Max retries exceeded" error on the final attempt
    expect(onError).toHaveBeenCalledTimes(3)

    // Check that we got the max retries error
    expect(onError).toHaveBeenLastCalledWith(
      expect.any(MaxRetriesExceededError),
      expect.objectContaining(event)
    )
  })
})
