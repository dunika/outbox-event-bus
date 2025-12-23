import { describe, expect, it, vi } from "vitest"
import { OutboxEventBus, InMemoryOutbox } from "outbox-event-bus"
import { SagaEngine } from "../../src/engine/saga-engine.js"
import { ActivityRegistry } from "../../src/engine/activity-registry.js"
import { RoutingSlipBuilder } from "../../src/builder/routing-slip-builder.js"
import type { Activity, RoutingSlip } from "../../src/types/interfaces.js"

describe("Retry Integration", () => {
  it("should retry an activity if it fails and has a retry policy", async () => {
    const outbox = new InMemoryOutbox()
    const bus = new OutboxEventBus(outbox, {
      onError: vi.fn(),
    })

    const registry = new ActivityRegistry()
    
    let attempts = 0
    const activity1: Activity = {
      name: "activity1",
      execute: vi.fn().mockImplementation(async () => {
        attempts++
        if (attempts < 3) {
          throw new Error("Transient failure")
        }
        return { data: "success" }
      }),
      compensate: vi.fn().mockResolvedValue(undefined),
    }

    registry.register(activity1)

    const engine = new SagaEngine({ bus, registry })
    
    const slip = new RoutingSlipBuilder()
      .addActivity("activity1", { arg: 1 }, { maxRetries: 3 })
      .build()

    const emitSpy = vi.spyOn(bus, "emit")

    // First execution - should fail and emit retry
    await engine.execute(slip)
    expect(attempts).toBe(1)
    
    // Check that it emitted the same activity again
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: "activity1",
      payload: expect.objectContaining({
        itinerary: expect.arrayContaining([
          expect.objectContaining({ retryCount: 1 })
        ])
      })
    }))

    const nextSlip1 = emitSpy.mock.calls[0][0].payload as RoutingSlip

    // Second execution
    emitSpy.mockClear()
    await engine.execute(nextSlip1)
    expect(attempts).toBe(2)
    
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: "activity1",
      payload: expect.objectContaining({
        itinerary: expect.arrayContaining([
          expect.objectContaining({ retryCount: 2 })
        ])
      })
    }))

    const nextSlip2 = emitSpy.mock.calls[0][0].payload as RoutingSlip

    // Third execution - should succeed
    emitSpy.mockClear()
    await engine.execute(nextSlip2)
    expect(attempts).toBe(3)
    
    // Should have emitted RoutingSlipCompleted
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: "saga.routing-slip.completed"
    }))
  })

  it("should compensate if max retries reached", async () => {
    const outbox = new InMemoryOutbox()
    const bus = new OutboxEventBus(outbox, {
      onError: vi.fn(),
    })

    const registry = new ActivityRegistry()
    
    const activity1: Activity = {
      name: "activity1",
      execute: vi.fn().mockRejectedValue(new Error("Permanent failure")),
      compensate: vi.fn().mockResolvedValue(undefined),
    }

    registry.register(activity1)

    const engine = new SagaEngine({ bus, registry })
    
    const slip = new RoutingSlipBuilder()
      .addActivity("activity1", { arg: 1 }, { maxRetries: 1 })
      .build()

    const emitSpy = vi.spyOn(bus, "emit")

    // First execution - fails, retryCount becomes 1
    await engine.execute(slip)
    
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: "activity1"
    }))
    
    const nextSlip = emitSpy.mock.calls[0][0].payload as RoutingSlip

    // Second execution - fails, maxRetries reached (1), should compensate
    emitSpy.mockClear()
    await engine.execute(nextSlip)
    
    // Should have emitted RoutingSlipFaulted (since log is empty)
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: "saga.routing-slip.faulted"
    }))
  })
})
