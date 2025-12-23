import { describe, expect, it } from "vitest"
import type { SagaStoreAdapter } from "../types/interfaces.js"

export function runSagaStoreTestSuite(
  name: string,
  setup: () => Promise<{ adapter: SagaStoreAdapter; cleanup?: () => Promise<void> }>
) {
  describe(`SagaStoreAdapter: ${name}`, () => {
    it("should store and retrieve data", async () => {
      const { adapter, cleanup } = await setup()
      try {
        const id = "test-id"
        const data = Buffer.from("test-data")
        const expiresAt = new Date(Date.now() + 10000)

        await adapter.put(id, data, expiresAt)
        const retrieved = await adapter.get(id)

        expect(retrieved.toString()).toBe("test-data")
      } finally {
        await cleanup?.()
      }
    })

    it("should throw error when getting non-existent data", async () => {
      const { adapter, cleanup } = await setup()
      try {
        await expect(adapter.get("non-existent")).rejects.toThrow()
      } finally {
        await cleanup?.()
      }
    })

    it("should overwrite existing data", async () => {
      const { adapter, cleanup } = await setup()
      try {
        const id = "test-id"
        const data1 = Buffer.from("data-1")
        const data2 = Buffer.from("data-2")
        const expiresAt = new Date(Date.now() + 10000)

        await adapter.put(id, data1, expiresAt)
        await adapter.put(id, data2, expiresAt)
        const retrieved = await adapter.get(id)

        expect(retrieved.toString()).toBe("data-2")
      } finally {
        await cleanup?.()
      }
    })
  })
}
