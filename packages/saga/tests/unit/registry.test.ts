import { describe, expect, it, vi } from "vitest"
import { ActivityRegistry } from "../../src/engine/activity-registry.js"
import type { Activity } from "../../src/types/interfaces.js"

describe("ActivityRegistry", () => {
  it("should register and retrieve activities", () => {
    const registry = new ActivityRegistry()
    const activity: Activity = {
      name: "test-activity",
      execute: vi.fn(),
      compensate: vi.fn(),
    }

    registry.register(activity)
    expect(registry.get("test-activity")).toBe(activity)
  })

  it("should return undefined for non-existent activities", () => {
    const registry = new ActivityRegistry()
    expect(registry.get("missing")).toBeUndefined()
  })

  it("should throw if activity with same name is registered", () => {
    const registry = new ActivityRegistry()
    const activity1: Activity = {
      name: "test",
      execute: vi.fn(),
      compensate: vi.fn(),
    }
    const activity2: Activity = {
      name: "test",
      execute: vi.fn(),
      compensate: vi.fn(),
    }

    registry.register(activity1)
    expect(() => registry.register(activity2)).toThrow(
      'Activity with name "test" is already registered'
    )
  })
})
