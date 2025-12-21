
import { describe, expect, it, vi } from "vitest"
import { InMemoryOutbox } from "./in-memory-outbox"
import type { BusEvent } from "../../types/types"

describe("InMemoryOutbox Failed Events", () => {
  it("should capture failed events in dead letter queue", async () => {
    const outbox = new InMemoryOutbox({ maxRetries: 2 })
    
    const event: BusEvent = {
      id: "1",
      type: "test",
      payload: {},
      occurredAt: new Date()
    }

    await outbox.publish([event])

    const handler = vi.fn().mockRejectedValue(new Error("Fail"))
    const onError = vi.fn()

    outbox.start(handler, onError)

    // First attempt
    await Promise.resolve() // Let event loop turn
    // Trigger logic manually or wait? InMemoryOutbox poller is not real poller, it processes immediately on publish if started?
    // start() calls poll() -> processBatch using requestAnimationFrame or setTimeout/immediate.
    // InMemoryOutbox uses `setTimeout(..., 0)` in `poll`.

    await new Promise(r => setTimeout(r, 50))
    // Should be retrying.
    
    // InMemoryOutbox retries immediately in next loop in `processBatch` if it fails?
    // No.
    // In `processBatch`:
    // if failed, adds to `retryCounts`. if < maxRetries, pushes back to events (at front).
    // if >= maxRetries, pushes to `deadLetterQueue`.

    // Wait enough cycles for maxRetries (2)
    // 1st fail -> retry 1.
    // 2nd fail -> retry 2.
    // 3rd fail -> max retries exceeded -> DLQ.

    await new Promise(r => setTimeout(r, 200))

    const failed = await outbox.getFailedEvents()
    expect(failed).toHaveLength(1)
    expect(failed[0].id).toBe("1")
  })

  it("should allow retrying failed events", async () => {
    const outbox = new InMemoryOutbox({ maxRetries: 1 })
    const event: BusEvent = { id: "retry-1", type: "t", payload: {}, occurredAt: new Date() }
    
    await outbox.publish([event])
    
    // Fail it until DLQ
    let shouldFail = true
    const handler = vi.fn().mockImplementation(async () => {
        if (shouldFail) throw new Error("Fail")
    })
    
    outbox.start(handler, () => {})
    await new Promise(r => setTimeout(r, 100))

    const failed = await outbox.getFailedEvents()
    expect(failed).toHaveLength(1)

    // Now make handler succeed
    shouldFail = false
    await outbox.retryEvents([event.id])

    await new Promise(r => setTimeout(r, 50))
    
    // Should be processed
    expect(handler).toHaveBeenCalledTimes(3) // 1 initial fail, 2nd fail (retry 1), 3rd success (manual retry) -> valid?
    // Logic:
    // 1. exec -> fail. retryCount -> 1. Re-queue.
    // 2. exec -> fail. retryCount -> 2 (if maxRetries=1, 1 >= 1? yes). DLQ.
    // Total 2 calls so far.
    // Retry call -> moves to main queue. retryCount deleted.
    // 3. exec -> success.

    // Check handling
    const finalFailed = await outbox.getFailedEvents()
    expect(finalFailed).toHaveLength(0)
  })
})
