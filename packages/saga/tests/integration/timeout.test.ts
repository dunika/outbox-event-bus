import { InMemoryOutbox, OutboxEventBus } from "outbox-event-bus"
import { describe, expect, it, vi } from "vitest"
import { RoutingSlipBuilder } from "../../src/builder/routing-slip-builder.js"
import { ActivityRegistry } from "../../src/engine/activity-registry.js"
import { SagaEngine } from "../../src/engine/saga-engine.js"
import type { Activity } from "../../src/types/interfaces.js"

describe("Timeout Integration", () => {
  it("should trigger compensation if slip is expired", async () => {
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

    registry.register(activity1)

    const engine = new SagaEngine({ bus, registry })

    // Create a slip that is already expired
    const slip = new RoutingSlipBuilder()
      .addActivity("activity1", { arg: 1 })
      .expiresAt(new Date(Date.now() - 1000))
      .build()

    const emitSpy = vi.spyOn(bus, "emit")

    await engine.execute(slip)

    // Should NOT have executed activity1
    expect(activity1.execute).not.toHaveBeenCalled()

    // Should have triggered compensation (which immediately faults because log is empty)
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "saga.routing-slip.faulted",
        payload: expect.objectContaining({
          status: "Faulted",
          mode: "compensate",
        }),
        metadata: expect.objectContaining({
          reason: "Timeout",
        }),
      })
    )
  })
})
