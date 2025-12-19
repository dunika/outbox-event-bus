export type BusEvent<T extends string = string, P = unknown> = {
  id: string
  type: T
  payload: P
  occurredAt: Date
  metadata?: Record<string, unknown>
}

export type EventHandler<T extends string = string, P = unknown> = (
  event: BusEvent<T, P>
) => Promise<void>
