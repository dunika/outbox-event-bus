import { InMemoryOutbox, OutboxEventBus } from "outbox-event-bus"
import { describe, expect, it, vi } from "vitest"
import { RoutingSlipBuilder } from "../../src/builder/routing-slip-builder.js"
import { ActivityRegistry } from "../../src/engine/activity-registry.js"
import { SagaEngine } from "../../src/engine/saga-engine.js"
import type { Activity } from "../../src/types/interfaces.js"

describe("Linear Execution Integration", () => {
  it("should execute activities in order", async () => {
    const outbox = new InMemoryOutbox()
    const bus = new OutboxEventBus(outbox, {
      onError: vi.fn(),
    })

    const registry = new ActivityRegistry()

    const activity1: Activity = {
      name: "activity1",
      execute: vi.fn().mockResolvedValue({ data: "result1" }),
      compensate: vi.fn(),
    }

    const activity2: Activity = {
      name: "activity2",
      execute: vi.fn().mockResolvedValue({ data: "result2" }),
      compensate: vi.fn(),
    }

    registry.register(activity1)
    registry.register(activity2)

    const engine = new SagaEngine({ bus, registry })

    const slip = new RoutingSlipBuilder()
      .addActivity("activity1", { arg: 1 })
      .addActivity("activity2", { arg: 2 })
      .build()

    // Spy on bus.emit to track progress
    const emitSpy = vi.spyOn(bus, "emit")

    await engine.execute(slip)

    expect(activity1.execute).toHaveBeenCalledWith({ arg: 1 }, {})
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "activity2",
        payload: expect.objectContaining({
          log: expect.arrayContaining([expect.objectContaining({ name: "activity1" })]),
        }),
      })
    )

    // Simulate next step
    expect(emitSpy.mock.calls[0]).toBeDefined()
    const secondCall = emitSpy.mock.calls[0]?.[0]
    if (!secondCall) throw new Error("Expected call not found")
    await engine.execute(secondCall.payload as any)

    expect(activity2.execute).toHaveBeenCalledWith({ arg: 2 }, {})
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "saga.routing-slip.completed",
        payload: expect.objectContaining({
          status: "Completed",
        }),
      })
    )
  })
})
