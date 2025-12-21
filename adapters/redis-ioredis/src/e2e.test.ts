import Redis from "ioredis"
import type { BusEvent } from "outbox-event-bus"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { RedisIoRedisOutbox } from "./index"

describe("RedisIoRedisOutbox E2E", () => {
  let redis: Redis
  let outbox: RedisIoRedisOutbox
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
    outbox = new RedisIoRedisOutbox({
      redis,
      pollIntervalMs: 50,
      processingTimeoutMs: 1000,
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
    await outbox.start(handler, onError)

    // Wait for polling to pick it up
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: "e2e-1" }))

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
      occurredAt: new Date().toISOString(),
    })

    // Add to processing with old score (timed out)
    await redis.zadd("outbox:processing", oldTimestamp, eventId)

    const handler = vi.fn().mockResolvedValue(undefined)

    // Start outbox with short timeout
    const recoveryOutbox = new RedisIoRedisOutbox({
      redis,
      pollIntervalMs: 50,
      processingTimeoutMs: 1000, // 1s timeout
    })

    await recoveryOutbox.start(handler, onError)

    // Wait for recovery poll
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: eventId }))

    await recoveryOutbox.stop()
  })

  it("should retry failed events", async () => {
    const eventId = "retry-1"
    const event: BusEvent = {
      id: eventId,
      type: "retry-test",
      payload: { attempt: 1 },
      occurredAt: new Date(),
    }

    await outbox.publish([event])

    let attempts = 0
    const onError = vi.fn()

    const handler = vi.fn().mockImplementation(async () => {
      attempts++
      throw new Error("Temporary failure")
    })

    await outbox.start(handler, onError)

    // Wait for a few polls (pollInterval is 50ms)
    // First attempt: ~50ms
    // Second attempt: +1000ms delay = ~1050ms
    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(attempts).toBeGreaterThan(1)
    expect(onError).toHaveBeenCalled()

    // Check Redis for retry state
    const eventData = await redis.hgetall(`outbox:event:${eventId}`)
    expect(Number.parseInt(eventData.retryCount ?? "0", 10)).toBeGreaterThan(0)
    expect(eventData.lastError).toBe("Temporary failure")
  })

  it("should support manual management of failed events", async () => {
    const eventId = "manual-retry-1"

    // 1. Manually insert a failed event
    await redis.hmset(
      `outbox:event:${eventId}`,
      "id",
      eventId,
      "type",
      "manual.retry",
      "payload",
      JSON.stringify({}),
      "occurredAt",
      new Date().toISOString(),
      "status",
      "FAILED",
      "retryCount",
      "5",
      "lastError",
      "Manual failure"
    )
    await redis.zadd("outbox:failed", Date.now(), eventId)

    // 2. Get failed events
    const failed = await outbox.getFailedEvents()
    expect(failed).toHaveLength(1)
    expect(failed[0]!.id).toBe(eventId)
    expect(failed[0]!.error).toBe("Manual failure")

    // 3. Retry
    await outbox.retryEvents([eventId])

    // 4. Verify state
    const failedAfter = await redis.zrange("outbox:failed", 0, -1)
    expect(failedAfter).toHaveLength(0)

    const pendingAfter = await redis.zrange("outbox:pending", 0, -1)
    expect(pendingAfter).toHaveLength(1)
    expect(pendingAfter[0]).toBe(eventId)

    const eventData = await redis.hgetall(`outbox:event:${eventId}`)
    expect(eventData.status).toBe("created")
    expect(eventData.retryCount).toBe("0")
    expect(eventData.lastError).toBeUndefined()

    // 5. Verify processing
    const handler = vi.fn().mockResolvedValue(undefined)
    await outbox.start(handler, onError)

    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: eventId }))
  })

  it("should handle concurrent processing safely", async () => {
    const eventCount = 50
    const events = Array.from({ length: eventCount }).map((_, i) => ({
      id: `concurrent-${i}`,
      type: "concurrent.test",
      payload: { index: i },
      occurredAt: new Date(),
    }))

    outbox = new RedisIoRedisOutbox({
      redis,
      pollIntervalMs: 100,
    })
    await outbox.publish(events)
    await outbox.stop()

    const workerCount = 5
    const processedEvents: any[] = []

    // We need multiple redis connections for workers to simulate real concurrency
    // because RedisIoRedisOutbox takes a Redis instance.
    const connections: Redis[] = []
    const workers: RedisIoRedisOutbox[] = []

    const handler = async (event: any) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 50))
      processedEvents.push(event)
    }

    for (let i = 0; i < workerCount; i++) {
      const conn = new Redis({
        port: 6379,
        host: "localhost",
      })
      connections.push(conn)

      const worker = new RedisIoRedisOutbox({
        redis: conn,
        pollIntervalMs: 100 + Math.random() * 50,
        batchSize: 5,
      })
      workers.push(worker)
      worker.start(handler, (err) => console.error(`Worker ${i} Error:`, err))
    }

    const maxWaitTime = 10000
    const startTime = Date.now()

    while (processedEvents.length < eventCount && Date.now() - startTime < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    await Promise.all(workers.map((w) => w.stop()))
    await Promise.all(connections.map((c) => c.quit()))

    expect(processedEvents).toHaveLength(eventCount)

    const ids = processedEvents.map((e) => e.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(eventCount)
  })
})
