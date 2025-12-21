import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PostgresDrizzleOutbox } from "./index"
import { outboxEvents } from "./schema"

// Mock the database client
const mockDb = {
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
} as unknown as PostgresJsDatabase<any>

describe("PostgresDrizzleOutbox", () => {
  let outbox: PostgresDrizzleOutbox
  let queryBuilder: any

  beforeEach(() => {
    vi.clearAllMocks()

    queryBuilder = {
      values: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      for: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    }

    // Configure db methods to return the builder
    ;(mockDb.insert as any).mockReturnValue(queryBuilder)
    ;(mockDb.select as any).mockReturnValue(queryBuilder)
    ;(mockDb.update as any).mockReturnValue(queryBuilder)
    ;(mockDb.delete as any).mockReturnValue(queryBuilder)

    // Transaction mock
    ;(mockDb.transaction as any).mockImplementation(async (cb: any) => cb(mockDb))

    outbox = new PostgresDrizzleOutbox({ db: mockDb, pollIntervalMs: 50 })
  })

  afterEach(async () => {
    await outbox.stop()
  })

  it("should publish events", async () => {
    const events = [
      {
        id: "1",
        type: "test",
        payload: {},
        occurredAt: new Date(),
      },
    ]

    await outbox.publish(events)

    expect(mockDb.insert).toHaveBeenCalledWith(outboxEvents)
    expect(queryBuilder.values).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "1", status: "created" })])
    )
  })

  it("should poll and process events", async () => {
    const testEvents = [
      {
        id: "1",
        type: "test",
        payload: {},
        occurredAt: new Date(),
        status: "created",
        retryCount: 0,
        createdOn: new Date(),
      },
    ]

    queryBuilder.for.mockResolvedValueOnce(testEvents)
    queryBuilder.for.mockResolvedValue([])

    const handler = vi.fn().mockResolvedValue(undefined)
    const onError = vi.fn()

    outbox.start(handler, onError)

    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(handler).toHaveBeenCalled()
    expect(mockDb.update).toHaveBeenCalled()
    expect(queryBuilder.set).toHaveBeenCalledWith(expect.objectContaining({ status: "active" }))

    expect(mockDb.insert).toHaveBeenCalledWith(expect.anything())
    expect(mockDb.delete).toHaveBeenCalledWith(outboxEvents)
  })

  it("should retry failed events", async () => {
    const testEvents = [
      {
        id: "1",
        type: "test",
        payload: {},
        occurredAt: new Date(),
        status: "created",
        retryCount: 0,
        createdOn: new Date(),
      },
    ]

    queryBuilder.for.mockResolvedValueOnce(testEvents)
    queryBuilder.for.mockResolvedValue([])

    const eventId = "fail-me"
    let attempts = 0
    const handler = vi.fn().mockRejectedValue(new Error("processing failed"))

    outbox.start(handler, vi.fn())
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(handler).toHaveBeenCalled()

    // Should verify it updated to failed state
    expect(queryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        lastError: "processing failed",
        retryCount: 1,
      })
    )
  })

  it("should recover stuck active events", async () => {
    const activeStuckEvent = {
      id: "1",
      type: "test",
      payload: {},
      occurredAt: new Date(),
      status: "active",
      retryCount: 0,
      createdOn: new Date(),
      keepAlive: new Date(Date.now() - 1000 * 60 * 10), // 10 mins ago (default expire is 5 mins)
      expireInSeconds: 300,
    }

    // Mock select return
    queryBuilder.for.mockResolvedValueOnce([activeStuckEvent])
    queryBuilder.for.mockResolvedValue([])

    const handler = vi.fn().mockResolvedValue(undefined)

    outbox.start(handler, vi.fn())
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }))

    // Should be picked up and processed (status updated to active again with new timestamp)
    expect(queryBuilder.set).toHaveBeenCalledWith(expect.objectContaining({ status: "active" }))
  })
})
