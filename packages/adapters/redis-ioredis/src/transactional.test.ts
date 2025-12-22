import { describe, expect, it, vi } from "vitest"
import { RedisIoRedisOutbox } from "./redis-ioredis-outbox"

describe("RedisIoRedisOutbox Transactional Support", () => {
  it("should use external pipeline and NOT call exec when getExecutor provides one", async () => {
    const mockPipeline = {
      hset: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }
    const mockRedis = {
      pipeline: vi.fn().mockReturnValue({}),
      defineCommand: vi.fn(),
    }

    const outbox = new RedisIoRedisOutbox({
      redis: mockRedis as any,
      getPipeline: () => mockPipeline as any,
    })

    await outbox.publish([{ id: "1", type: "test", payload: {}, occurredAt: new Date() }])

    expect(mockPipeline.hset).toHaveBeenCalled()
    expect(mockPipeline.zadd).toHaveBeenCalled()
    expect(mockPipeline.exec).not.toHaveBeenCalled()
    expect(mockRedis.pipeline).not.toHaveBeenCalled()
  })

  it("should use internal pipeline and call exec when getExecutor returns undefined", async () => {
    const mockPipeline = {
      hset: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }
    const mockRedis = {
      pipeline: vi.fn().mockReturnValue(mockPipeline),
      defineCommand: vi.fn(),
    }

    const outbox = new RedisIoRedisOutbox({
      redis: mockRedis as any,
      getPipeline: () => undefined,
    })

    await outbox.publish([{ id: "1", type: "test", payload: {}, occurredAt: new Date() }])

    expect(mockPipeline.hset).toHaveBeenCalled()
    expect(mockPipeline.zadd).toHaveBeenCalled()
    expect(mockPipeline.exec).toHaveBeenCalled()
    expect(mockRedis.pipeline).toHaveBeenCalled()
  })
})
