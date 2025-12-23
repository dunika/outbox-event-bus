import RedisMock from "ioredis-mock"
import { describe, beforeEach, afterEach } from "vitest"
import { RedisIoredisSagaStore } from "./redis-ioredis-saga-store"
import { runSagaStoreTestSuite } from "@outbox-event-bus/saga/tests"

describe("RedisIoredisSagaStore", () => {
  let redis: any

  beforeEach(() => {
    redis = new RedisMock()
  })

  afterEach(() => {
    redis.flushall()
  })

  runSagaStoreTestSuite("Redis (Mock)", async () => {
    const adapter = new RedisIoredisSagaStore({ redis })
    return { adapter }
  })
})
