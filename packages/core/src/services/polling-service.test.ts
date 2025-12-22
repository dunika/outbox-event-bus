import { beforeEach, describe, expect, it, vi } from "vitest"
import { MaintenanceError, OperationalError } from "../errors/errors"
import { PollingService } from "./polling-service"

describe("PollingService", () => {
  let onError: any
  let processBatch: any

  beforeEach(() => {
    onError = vi.fn()
    processBatch = vi.fn().mockResolvedValue(undefined)
  })

  it("should wrap maintenance errors in MaintenanceError", async () => {
    const maintenanceError = new Error("Database locked")
    const performMaintenance = vi.fn().mockRejectedValue(maintenanceError)

    const service = new PollingService({
      pollIntervalMs: 10,
      baseBackoffMs: 10,
      processBatch,
      performMaintenance,
    })

    service.start(async () => {}, onError)

    await new Promise((resolve) => setTimeout(resolve, 50))
    await service.stop()

    expect(onError).toHaveBeenCalledWith(expect.any(MaintenanceError))
    const error = onError.mock.calls[0][0]

    // Verify it's a MaintenanceError instance
    expect(error).toBeInstanceOf(MaintenanceError)
    expect(error.name).toBe("MaintenanceError")
    expect(error.message).toBeDefined()

    // Verify cause is preserved in data
    expect(error.context?.cause).toBe(maintenanceError)
  })

  it("should wrap batch processing errors in OperationalError", async () => {
    const batchError = new Error("Select failed")
    processBatch.mockRejectedValue(batchError)

    const service = new PollingService({
      pollIntervalMs: 10,
      baseBackoffMs: 10,
      processBatch,
    })

    service.start(async () => {}, onError)

    await new Promise((resolve) => setTimeout(resolve, 50))
    await service.stop()

    expect(onError).toHaveBeenCalledWith(expect.any(OperationalError))
    const error = onError.mock.calls[0][0]
    expect(error.message).toContain("Polling cycle failed")
    expect(error.context.cause).toBe(batchError)
  })

  it("should not wrap already categorized OutboxErrors", async () => {
    const categorizedError = new OperationalError("Specific fail")
    processBatch.mockRejectedValue(categorizedError)

    const service = new PollingService({
      pollIntervalMs: 10,
      baseBackoffMs: 10,
      processBatch,
    })

    service.start(async () => {}, onError)

    await new Promise((resolve) => setTimeout(resolve, 50))
    await service.stop()

    expect(onError).toHaveBeenCalledWith(categorizedError)
  })
})
