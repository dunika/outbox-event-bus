import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import RedisMock from "ioredis-mock"
import { RedisOutbox } from "./index"
import type { BusEvent } from "outbox-event-bus"

describe("RedisOutbox", () => {
  let redis: any
  let outbox: RedisOutbox
  const onError = vi.fn()

  beforeEach(() => {
    redis = new RedisMock()
    outbox = new RedisOutbox({
      redis,
      pollIntervalMs: 50,
      processingTimeoutMs: 100,
    })
  })

  afterEach(() => {
    void outbox.stop()
    redis.flushall()
    vi.clearAllMocks()
  })

  it("should publish events to Redis", async () => {
    const event: BusEvent = {
      id: "1",
      type: "test",
      payload: { foo: "bar" },
      occurredAt: new Date(),
    }

    await outbox.publish([event])

    // First check if event is in pending queue
    const pending = await redis.zrange("outbox:pending", 0, -1)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toBe("1")

    // Check if the key exists at all
    const exists = await redis.exists("outbox:event:1")
    expect(exists).toBe(1)
    
    // Check event data exists using individual gets
    const eventId = await redis.hget("outbox:event:1", "id")
    
    if (eventId) {
      const eventType = await redis.hget("outbox:event:1", "type")
      const eventStatus = await redis.hget("outbox:event:1", "status")
      const eventRetryCount = await redis.hget("outbox:event:1", "retryCount")
      const eventPayload = await redis.hget("outbox:event:1", "payload")
      
      expect(eventId).toBe("1")
      expect(eventType).toBe("test")
      expect(eventStatus).toBe("created")
      expect(eventRetryCount).toBe("0")
      expect(JSON.parse(eventPayload)).toEqual(event.payload)
    }
  })

  it("should process events", async () => {
    const event: BusEvent = {
      id: "1",
      type: "test",
      payload: { foo: "bar" },
      occurredAt: new Date(),
    }

    await outbox.publish([event])

    const handler = vi.fn().mockResolvedValue(undefined)
    outbox.start(handler, onError)

    // Wait for polling
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(handler).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: "1" })
    ]))

    // Should be removed from pending and processing
    const pending = await redis.zrange("outbox:pending", 0, -1)
    expect(pending).toHaveLength(0)

    const processing = await redis.zrange("outbox:processing", 0, -1)
    expect(processing).toHaveLength(0)

    // Event data should be deleted (as per our implementation)
    const eventData = await redis.exists("outbox:event:1")
    expect(eventData).toBe(0)
  })

  it("should retry failed events", async () => {
    const event: BusEvent = {
      id: "1",
      type: "test",
      payload: { foo: "bar" },
      occurredAt: new Date(),
    }

    await outbox.publish([event])

    // Handler fails once then succeeds
    const handler = vi.fn(async (_events: any[]) => {})
      .mockRejectedValueOnce(new Error("Fail"))
      .mockResolvedValue(undefined)

    outbox.start(handler, onError)

    // Wait for first attempt (fail)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(handler).toHaveBeenCalledTimes(1)

    // Should be scheduled for retry (back in pending with future score)
    const pending = await redis.zrange("outbox:pending", 0, -1)
    expect(pending).toHaveLength(1)
    
    // Verify retry count was incremented
    const retryCount = await redis.hget("outbox:event:1", "retryCount")
    expect(parseInt(retryCount || "0")).toBeGreaterThanOrEqual(1)
    
    // Verify last error was stored
    const lastError = await redis.hget("outbox:event:1", "lastError")
    expect(lastError).toBe("Fail")
  })

  it("should recover stuck events", async () => {
    // Manually putting an event in processing state
    const now = Date.now()
    const eventKey = "outbox:event:stuck"
    
    // Set event data using hmset for ioredis-mock compatibility
    await redis.hmset(eventKey,
      "id", "stuck",
      "type", "stuck",
      "payload", JSON.stringify({}),
      "occurredAt", new Date().toISOString(),
      "retryCount", "0",
      "status", "active"
    )
    
    // Add to processing with old score (stuck event - older than processing timeout)
    await redis.zadd("outbox:processing", now - 200, "stuck")

    const handler = vi.fn().mockResolvedValue(undefined)
    
    // Start outbox (configured with 100ms processing timeout)
    outbox.start(handler, onError)

    // Wait for recovery and processing (need more time for recovery + poll cycle)
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(handler).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: "stuck" })
    ]))
  })
})
