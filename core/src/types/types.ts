type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type BusEvent<T extends string = string, P = unknown> = {
  id: string
  type: T
  payload: P
  occurredAt: Date
  metadata?: Record<string, unknown>
}

export type FailedBusEvent<T extends string = string, P = unknown> = BusEvent<T, P> & {
  error?: string
  retryCount: number
  lastAttemptAt?: Date
}

/**
 * Event structure when emitting (initial state). 
 * Optional `id` and `occurredAt` are auto-generated if not provided.
 */
export type BusEventInput<T extends string = string, P = unknown> = 
  PartialBy<BusEvent<T, P>, 'id' | 'occurredAt'>;

export type EventHandler<T extends string = string, P = unknown> = (
  event: BusEvent<T, P>
) => Promise<void>

export type AnyListener = (...args: unknown[]) => unknown

export type ErrorHandler = (error: unknown, event?: BusEvent | FailedBusEvent) => void

export interface RetryOptions {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
}

export interface BatchOptions {
  batchSize?: number
  batchTimeoutMs?: number
}

export interface PublisherConfig {
  retryConfig?: RetryOptions
  batchConfig?: BatchOptions
}

