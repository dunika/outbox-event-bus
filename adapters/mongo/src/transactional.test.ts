import { describe, it, expect, vi } from "vitest"
import { MongoOutbox } from "./mongo-outbox"
import { ObjectId } from "mongodb"

describe("MongoOutbox Transactional Support", () => {
  it("should pass session to insertMany when getSession provides one", async () => {
    const mockCollection = {
      insertMany: vi.fn().mockResolvedValue({}),
    }
    const mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection),
    }
    const mockClient = {
      db: vi.fn().mockReturnValue(mockDb),
    }
    const mockSession = { session: "mock-session" } as any

    const outbox = new MongoOutbox({
      client: mockClient as any,
      dbName: "test-db",
      getSession: () => mockSession,
    })

    await outbox.publish([{ id: "1", type: "test", payload: {}, occurredAt: new Date() }])

    expect(mockCollection.insertMany).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ session: mockSession })
    )
  })

  it("should NOT pass session to insertMany when getSession returns undefined", async () => {
     const mockCollection = {
      insertMany: vi.fn().mockResolvedValue({}),
    }
    const mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection),
    }
    const mockClient = {
      db: vi.fn().mockReturnValue(mockDb),
    }

    const outbox = new MongoOutbox({
      client: mockClient as any,
      dbName: "test-db",
      getSession: () => undefined,
    })

    await outbox.publish([{ id: "1", type: "test", payload: {}, occurredAt: new Date() }])

    expect(mockCollection.insertMany).toHaveBeenCalledWith(
      expect.any(Array),
      expect.not.objectContaining({ session: expect.anything() })
    )
  })
})
