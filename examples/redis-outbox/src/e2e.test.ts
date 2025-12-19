import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import Redis from "ioredis"
import { RedisOutbox } from "./index"
import type { BusEvent } from "outbox-event-bus"

describe("RedisOutbox E2E", () => {
  let redis: Redis
  let outbox: RedisOutbox
  const onError = vi.fn()

  beforeAll(() => {
    redis = new Redis({
      port: 6379,
      host: "localhost",
    })
  })

  afterAll(async () => {
    await redis.quit()
  })

  beforeEach(async () => {
    await redis.flushall()
    outbox = new RedisOutbox({
      redis,
      pollIntervalMs: 50,
      processingTimeoutMs: 1000,
      onError,
    })
  })

  afterEach(async () => {
    await outbox.stop()
    vi.clearAllMocks()
  })

  it("should process events end-to-end", async () => {
    const event: BusEvent = {
        id: "e2e-1",
        type: "e2e-test",
        payload: { message: "hello world" },
        occurredAt: new Date(),
    }

    await outbox.publish([event])

    // Verify it's in pending
    const pending = await redis.zrange("outbox:pending", 0, -1)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toBe("e2e-1")

    const handler = vi.fn().mockResolvedValue(undefined)
    await outbox.start(handler)

    // Wait for polling to pick it up
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(handler).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ id: "e2e-1" })
    ]))

    // Should be removed from pending and processing
    const pendingAfter = await redis.zrange("outbox:pending", 0, -1)
    expect(pendingAfter).toHaveLength(0)

    const processingAfter = await redis.zrange("outbox:processing", 0, -1)
    expect(processingAfter).toHaveLength(0)
  })

  it("should recover from partial failures (simulated)", async () => {
     // This test simulates a crash by manually interacting with Redis
     // 1. Put an event in processing with an old timestamp (timed out)
     const eventId = "crash-1"
     const now = Date.now()
     const oldTimestamp = now - 2000 // 2 seconds ago
     
     // Create the event hash
     await redis.hset(`outbox:event:${eventId}`, {
         id: eventId,
         type: "crash-test",
         payload: JSON.stringify({ recover: true }),
         occurredAt: new Date().toISOString()
     })
     
     // Add to processing with old score (timed out)
     await redis.zadd("outbox:processing", oldTimestamp, eventId)

     const handler = vi.fn().mockResolvedValue(undefined)
     
     // Start outbox with short timeout
     const recoveryOutbox = new RedisOutbox({
         redis,
         pollIntervalMs: 50,
         processingTimeoutMs: 1000, // 1s timeout
         onError,
     })
     
     await recoveryOutbox.start(handler)

     // Wait for recovery poll
     await new Promise(resolve => setTimeout(resolve, 500))

     expect(handler).toHaveBeenCalledWith(expect.arrayContaining([
         expect.objectContaining({ id: eventId })
     ]))

     await recoveryOutbox.stop()
  })

})
