import type { Activity } from "../types/interfaces.js"

export class ActivityRegistry {
  private activities = new Map<string, Activity>()

  public register(activity: Activity): void {
    if (this.activities.has(activity.name)) {
      throw new Error(`Activity with name "${activity.name}" is already registered`)
    }
    this.activities.set(activity.name, activity)
  }

  public get(name: string): Activity | undefined {
    return this.activities.get(name)
  }

  public has(name: string): boolean {
    return this.activities.has(name)
  }
}
