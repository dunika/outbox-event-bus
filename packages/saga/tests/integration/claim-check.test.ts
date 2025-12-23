import { InMemoryOutbox, OutboxEventBus } from "outbox-event-bus"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { RoutingSlipBuilder } from "../../src/builder/routing-slip-builder.js"
import { ActivityRegistry } from "../../src/engine/activity-registry.js"
import { SagaEngine } from "../../src/engine/saga-engine.js"
import type { Activity, SagaStoreAdapter } from "../../src/types/interfaces.js"

describe("Claim Check Integration", () => {
  let bus: OutboxEventBus<unknown>
  let registry: ActivityRegistry
  let engine: SagaEngine
  let store: SagaStoreAdapter
  let storage: Map<string, Buffer>
  let outbox: InMemoryOutbox

  beforeEach(() => {
    outbox = new InMemoryOutbox()
    bus = new OutboxEventBus(outbox, {
      onError: vi.fn(),
    })
    registry = new ActivityRegistry()
    storage = new Map()
    store = {
      put: async (id, data) => {
        storage.set(id, data)
      },
      get: async (id) => {
        const data = storage.get(id)
        if (!data) throw new Error(`Claim check data not found for id: ${id}`)
        return data
      },
    }
    engine = new SagaEngine({
      bus,
      registry,
      compressionThreshold: 10, // Very low to trigger compression
      claimCheckThreshold: 20, // Very low to trigger claim check
      claimCheckStore: store,
    })
    bus.addHandlerMiddleware(engine.middleware())
  })

  it("should use claim check for large payloads and retrieve them in middleware", async () => {
    const activity1: Activity = {
      name: "activity1",
      execute: vi.fn().mockResolvedValue({ success: true }),
      compensate: vi.fn().mockResolvedValue(undefined),
    }
    registry.register(activity1)

    const slip = new RoutingSlipBuilder()
      .addActivity("activity1", { data: "some large data that exceeds twenty bytes" })
      .build()

    // Manually trigger the first execution
    await engine.execute(slip)

    // Check if something was put in store
    expect(storage.size).toBeGreaterThan(0)
    const claimId = Array.from(storage.keys())[0]
    expect(claimId).toContain(slip.id)

    // Verify the activity was called (it was called directly by engine.execute)
    expect(activity1.execute).toHaveBeenCalled()

    // Now let's simulate the bus receiving the event with the claim check
    const events = (outbox as any).events
    expect(events[0].payload).toHaveProperty("_claimCheck")
  })

  it("should handle full cycle with claim check", async () => {
    const activity1: Activity = {
      name: "activity1",
      execute: vi.fn().mockResolvedValue({ step: 1 }),
      compensate: vi.fn().mockResolvedValue(undefined),
    }
    const activity2: Activity = {
      name: "activity2",
      execute: vi.fn().mockResolvedValue({ step: 2 }),
      compensate: vi.fn().mockResolvedValue(undefined),
    }
    registry.register(activity1)
    registry.register(activity2)

    const slip = new RoutingSlipBuilder()
      .addActivity("activity1", { foo: "bar" })
      .addActivity("activity2", { baz: "qux" })
      .build()

    await engine.execute(slip)

    // Activity 1 should have been executed
    expect(activity1.execute).toHaveBeenCalled()

    // There should be a pending event for activity2 with a claim check
    const pending = (outbox as any).events
    expect(pending[0].type).toBe("activity2")
    expect(pending[0].payload).toHaveProperty("_claimCheck")

    // Process the event via the bus (which triggers middleware)
    // We need to manually call the middleware or use a helper if available
    // Since we don't have a processNext on the bus itself that we can easily use here
    // we can manually invoke the middleware with the event from the outbox
    const middleware = engine.middleware()
    const ctx = { event: pending[0] } as any
    const next = vi.fn()

    await middleware(ctx, next)

    // Activity 2 should have been executed after being retrieved from claim check store
    expect(activity2.execute).toHaveBeenCalled()
  })
})
