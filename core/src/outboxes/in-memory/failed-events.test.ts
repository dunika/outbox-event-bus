import { describe, expect, it, vi } from "vitest"
import type { BusEvent } from "../../types/types"
import { InMemoryOutbox } from "./in-memory-outbox"

describe("InMemoryOutbox Failed Events", () => {
  it("should capture failed events in dead letter queue", async () => {
    const outbox = new InMemoryOutbox({ maxRetries: 2 })

    const event: BusEvent = {
      id: "1",
      type: "test",
      payload: {},
      occurredAt: new Date(),
    }

    await outbox.publish([event])

    const handler = vi.fn().mockRejectedValue(new Error("Fail"))
    const onError = vi.fn()

    outbox.start(handler, onError)

    await new Promise((r) => setTimeout(r, 50))

    await new Promise((r) => setTimeout(r, 200))

    const failed = await outbox.getFailedEvents()
    expect(failed).toHaveLength(1)
    expect(failed[0]?.id).toBe("1")
  })

  it("should allow retrying failed events", async () => {
    const outbox = new InMemoryOutbox({ maxRetries: 1 })
    const event: BusEvent = { id: "retry-1", type: "t", payload: {}, occurredAt: new Date() }

    await outbox.publish([event])

    // Fail it until DLQ
    let attempts = 0
    async function handler(_event: BusEvent): Promise<void> {
      attempts++
      if (attempts <= 2) {
        throw new Error("Fail")
      }
    }

    outbox.start(handler, () => {})
    await new Promise((r) => setTimeout(r, 100))

    const failed = await outbox.getFailedEvents()
    expect(failed).toHaveLength(1)
    expect(failed[0]?.error).toBeDefined()

    await outbox.retryEvents([event.id])

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(attempts).toBe(3)

    // Check handling
    const finalFailed = await outbox.getFailedEvents()
    expect(finalFailed).toHaveLength(0)
  })
})
