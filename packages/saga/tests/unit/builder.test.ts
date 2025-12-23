import { describe, expect, it } from "vitest"
import { RoutingSlipBuilder } from "../../src/builder/routing-slip-builder.js"

describe("RoutingSlipBuilder", () => {
  it("should build a routing slip with activities", () => {
    const builder = new RoutingSlipBuilder()
    const slip = builder
      .addActivity("activity1", { foo: "bar" })
      .addActivity("activity2", { baz: "qux" })
      .withVariable("var1", "val1")
      .build()

    expect(slip.itinerary).toHaveLength(2)
    expect(slip.itinerary[0].name).toBe("activity1")
    expect(slip.itinerary[1].name).toBe("activity2")
    expect(slip.variables.var1).toBe("val1")
    expect(slip.mode).toBe("forward")
    expect(slip.status).toBe("Pending")
  })

  it("should throw if no activities are added", () => {
    const builder = new RoutingSlipBuilder()
    expect(() => builder.build()).toThrow("Routing slip must have at least one activity")
  })

  it("should allow setting a custom ID", () => {
    const builder = new RoutingSlipBuilder()
    const slip = builder.withId("custom-id").addActivity("activity1", {}).build()
    expect(slip.id).toBe("custom-id")
  })

  it("should allow setting expiration", () => {
    const builder = new RoutingSlipBuilder()
    const future = new Date(Date.now() + 10000)
    const slip = builder.addActivity("activity1", {}).expiresAt(future).build()
    expect(slip.expiresAt).toBe(future.toISOString())
  })
})
