import { describe, expect, it } from "vitest"
import { compress, decompress } from "../../src/utils/compression.js"

describe("Compression Utils", () => {
  it("should compress and decompress data correctly", async () => {
    const original = "Hello, world! This is a test of the compression utility."
    const compressed = await compress(original)

    expect(compressed).not.toBe(original)
    expect(typeof compressed).toBe("string")

    const decompressed = await decompress(compressed)
    expect(decompressed).toBe(original)
  })

  it("should handle large strings", async () => {
    const original = "A".repeat(10000)
    const compressed = await compress(original)

    expect(compressed.length).toBeLessThan(original.length)

    const decompressed = await decompress(compressed)
    expect(decompressed).toBe(original)
  })
})
