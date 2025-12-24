import { describe, expect, it, vi } from "vitest"
import { RedisIoRedisOutbox } from "./redis-ioredis-outbox"

describe("RedisIoRedisOutbox Transactional Support", () => {
  it("should use external pipeline and NOT call exec when passed as argument", async () => {
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

    await outbox.publish([{ id: "1", type: "test", payload: {}, occurredAt: new Date() }], mockPipeline)

    expect(mockPipeline.hset).toHaveBeenCalled()
    expect(mockPipeline.zadd).toHaveBeenCalled()
    expect(mockPipeline.exec).not.toHaveBeenCalled()
    expect(mockRedis.pipeline).not.toHaveBeenCalled()
  })

  it("should use internal pipeline and call exec when no transaction passed", async () => {
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

  it("should use pipeline from getPipeline and NOT call exec when no transaction passed", async () => {
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
})
