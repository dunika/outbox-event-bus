import RedisMock from "ioredis-mock"
import type { BusEvent as OutboxEvent } from "outbox-event-bus"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RedisIoRedisOutbox } from "./index"

describe("RedisIoRedisOutbox", () => {
  let redis: any
  let outbox: RedisIoRedisOutbox
  const onError = vi.fn()

  beforeEach(() => {
    redis = new RedisMock()
    outbox = new RedisIoRedisOutbox({
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
    const event: OutboxEvent = {
      id: "1",
      type: "test",
      payload: { foo: "bar" },
      occurredAt: new Date(),
    }

    await outbox.publish([event])

    const pending = await redis.zrange("outbox:pending", 0, -1)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toBe("1")

    const exists = await redis.exists("outbox:event:1")
    expect(exists).toBe(1)

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
    const event: OutboxEvent = {
      id: "1",
      type: "test",
      payload: { foo: "bar" },
      occurredAt: new Date(),
    }

    await outbox.publish([event])

    const handler = vi.fn().mockResolvedValue(undefined)
    outbox.start(handler, onError)

    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }))

    const pending = await redis.zrange("outbox:pending", 0, -1)
    expect(pending).toHaveLength(0)

    const processing = await redis.zrange("outbox:processing", 0, -1)
    expect(processing).toHaveLength(0)

    const eventData = await redis.exists("outbox:event:1")
    expect(eventData).toBe(0)
  })

  it("should retry failed events", async () => {
    const event: OutboxEvent = {
      id: "1",
      type: "test",
      payload: { foo: "bar" },
      occurredAt: new Date(),
    }

    await outbox.publish([event])

    const handler = vi
      .fn(async (_event: unknown) => {})
      .mockRejectedValueOnce(new Error("Fail"))
      .mockResolvedValue(undefined)

    outbox.start(handler, onError)

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(handler).toHaveBeenCalledTimes(1)

    // Verify retry count was incremented
    const retryCount = await redis.hget("outbox:event:1", "retryCount")
    expect(parseInt(retryCount || "0", 10)).toBeGreaterThanOrEqual(1)

    // Verify last error was stored
    const lastError = await redis.hget("outbox:event:1", "lastError")
    expect(lastError).toBe("Fail")
  })

  it("should recover stuck events", async () => {
    // Manually putting an event in processing state
    const now = Date.now()
    const eventKey = "outbox:event:stuck"

    // Set event data using hmset for ioredis-mock compatibility
    await redis.hmset(
      eventKey,
      "id",
      "stuck",
      "type",
      "stuck",
      "payload",
      JSON.stringify({}),
      "occurredAt",
      new Date().toISOString(),
      "retryCount",
      "0",
      "status",
      "active"
    )

    // Add to processing with old score (stuck event - older than processing timeout)
    await redis.zadd("outbox:processing", now - 200, "stuck")

    const handler = vi.fn().mockResolvedValue(undefined)

    // Start outbox (configured with 100ms processing timeout)
    outbox.start(handler, onError)

    // Wait for recovery and processing (need more time for recovery + poll cycle)
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: "stuck" }))
  })
})
