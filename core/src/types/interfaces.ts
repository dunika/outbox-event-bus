import type { Middleware } from "./middleware"
import type { AnyListener, BusEvent, BusEventInput, ErrorHandler, FailedBusEvent } from "./types"

export interface IOutbox<TTransaction> {
  publish: (events: BusEvent[], transaction?: TTransaction) => Promise<void>
  start: (handler: (event: BusEvent) => Promise<void>, onError: ErrorHandler) => void
  stop: () => Promise<void>
  getFailedEvents: () => Promise<FailedBusEvent[]>
  retryEvents: (eventIds: string[]) => Promise<void>
}

export interface IOutboxEventBus<TTransaction> {
  use: (...middlewares: Middleware<TTransaction>[]) => this
  emit: <T extends string, P>(
    event: BusEventInput<T, P>,
    transaction?: TTransaction
  ) => Promise<void>
  emitMany: <T extends string, P>(
    events: BusEventInput<T, P>[],
    transaction?: TTransaction
  ) => Promise<void>
  on: <T extends string, P = unknown>(
    eventType: T,
    handler: (event: BusEvent<T, P>) => Promise<void>
  ) => this
  addListener: <T extends string, P = unknown>(
    eventType: T,
    handler: (event: BusEvent<T, P>) => Promise<void>
  ) => this
  off: <T extends string, P = unknown>(
    eventType: T,
    handler: (event: BusEvent<T, P>) => Promise<void>
  ) => this
  removeListener: <T extends string, P = unknown>(
    eventType: T,
    handler: (event: BusEvent<T, P>) => Promise<void>
  ) => this
  once: <T extends string, P = unknown>(
    eventType: T,
    handler: (event: BusEvent<T, P>) => Promise<void>
  ) => this
  removeAllListeners: <T extends string>(eventType?: T) => this
  getSubscriptionCount: () => number
  listenerCount: (eventType: string) => number
  getListener: (eventType: string) => AnyListener | undefined
  eventNames: () => string[]
  start: () => void
  stop: () => Promise<void>
  subscribe: <T extends string, P = unknown>(
    eventTypes: T[],
    handler: (event: BusEvent<T, P>) => Promise<void>
  ) => this
  waitFor: <T extends string, P = unknown>(
    eventType: T,
    timeoutMs?: number
  ) => Promise<BusEvent<T, P>>
  getFailedEvents: () => Promise<FailedBusEvent[]>
  retryEvents: (eventIds: string[]) => Promise<void>
}

export interface IPublisher {
  subscribe(eventTypes: string[]): void
}

export interface OutboxConfig {
  maxRetries?: number
  baseBackoffMs?: number
  pollIntervalMs?: number
  batchSize?: number
  processingTimeoutMs?: number
  maxErrorBackoffMs?: number
}

export type ResolvedOutboxConfig = Required<OutboxConfig>

export interface PollingServiceConfig {
  pollIntervalMs: number
  baseBackoffMs: number
  maxErrorBackoffMs?: number
  processBatch: (handler: (event: BusEvent) => Promise<void>) => Promise<void>
  performMaintenance?: () => Promise<void>
}
