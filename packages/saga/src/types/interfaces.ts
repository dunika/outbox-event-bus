export type RoutingSlipMode = "forward" | "compensate"

export type RoutingSlipStatus = "Pending" | "Completed" | "Compensating" | "Faulted"

export interface RetryPolicy {
  maxRetries: number
  interval?: number
}

export interface ActivityDefinition {
  name: string
  arguments: unknown
  retryPolicy?: RetryPolicy | undefined
  retryCount?: number | undefined
}

export interface ActivityLogEntry {
  name: string
  timestamp: string
  compensationData: unknown
}

export interface RoutingSlip {
  id: string
  mode: RoutingSlipMode
  status: RoutingSlipStatus
  itinerary: ActivityDefinition[]
  log: ActivityLogEntry[]
  variables: Record<string, unknown>
  expiresAt: string
}

export interface Activity<TArgs = unknown, TResult = unknown, TComp = unknown> {
  name: string
  execute(args: TArgs, variables: Record<string, unknown>): Promise<TResult>
  compensate(compensationData: TComp, variables: Record<string, unknown>): Promise<void>
}

export interface SagaStoreAdapter {
  put(id: string, data: Buffer, expiresAt: Date): Promise<void>
  get(id: string): Promise<Buffer>
  cleanup?(): Promise<void>
  initialize?(): Promise<void>
}
