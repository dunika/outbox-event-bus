import { InMemoryOutbox, OutboxEventBus } from "outbox-event-bus"
import { describe, expect, it, vi } from "vitest"
import { RoutingSlipBuilder } from "../../src/builder/routing-slip-builder.js"
import { ActivityRegistry } from "../../src/engine/activity-registry.js"
import { SagaEngine } from "../../src/engine/saga-engine.js"
import type { Activity } from "../../src/types/interfaces.js"

describe("Compensation Integration", () => {
  it("should compensate activities in reverse order on failure", async () => {
    const outbox = new InMemoryOutbox()
    const bus = new OutboxEventBus(outbox, {
      onError: vi.fn(),
    })

    const registry = new ActivityRegistry()

    const activity1: Activity = {
      name: "activity1",
      execute: vi.fn().mockResolvedValue({ data: "result1" }),
      compensate: vi.fn().mockResolvedValue(undefined),
    }

    const activity2: Activity = {
      name: "activity2",
      execute: vi.fn().mockRejectedValue(new Error("Activity 2 failed")),
      compensate: vi.fn().mockResolvedValue(undefined),
    }

    registry.register(activity1)
    registry.register(activity2)

    const engine = new SagaEngine({ bus, registry })

    const slip = new RoutingSlipBuilder()
      .addActivity("activity1", { arg: 1 })
      .addActivity("activity2", { arg: 2 })
      .build()

    const emitSpy = vi.spyOn(bus, "emit")

    // 1. Execute first activity successfully
    await engine.execute(slip)
    expect(activity1.execute).toHaveBeenCalled()

    // 2. Execute second activity which fails
    const secondCall = emitSpy.mock.calls[0][0]
    await engine.execute(secondCall.payload as any)

    expect(activity2.execute).toHaveBeenCalled()

    // Should have triggered compensation for activity1
    expect(activity1.compensate).toHaveBeenCalledWith({ data: "result1" }, expect.any(Object))

    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "saga.routing-slip.faulted",
        payload: expect.objectContaining({
          status: "Faulted",
          mode: "compensate",
        }),
      })
    )
  })
})
