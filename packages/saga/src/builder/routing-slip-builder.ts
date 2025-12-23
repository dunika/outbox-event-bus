import { randomUUID } from "node:crypto"
import type { ActivityDefinition, RetryPolicy, RoutingSlip } from "../types/interfaces.js"

export class RoutingSlipBuilder {
  private id: string = randomUUID()
  private itinerary: ActivityDefinition[] = []
  private variables: Record<string, unknown> = {}
  private _expiresAt: string = new Date(Date.now() + 1000 * 60 * 60).toISOString() // Default 1 hour

  public withId(id: string): this {
    this.id = id
    return this
  }

  public addActivity(name: string, args: unknown, retryPolicy?: RetryPolicy): this {
    this.itinerary.push({ name, arguments: args, retryPolicy, retryCount: 0 })
    return this
  }

  public withVariable(key: string, value: unknown): this {
    this.variables[key] = value
    return this
  }

  public withVariables(variables: Record<string, unknown>): this {
    this.variables = { ...this.variables, ...variables }
    return this
  }

  public expiresAt(date: Date): this {
    this._expiresAt = date.toISOString()
    return this
  }

  public build(): RoutingSlip {
    if (this.itinerary.length === 0) {
      throw new Error("Routing slip must have at least one activity")
    }

    return {
      id: this.id,
      mode: "forward",
      status: "Pending",
      itinerary: this.itinerary,
      log: [],
      variables: this.variables,
      expiresAt: this._expiresAt,
    }
  }
}
