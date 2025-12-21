import type { BusEvent, OutboxEvent, AnyListener } from "./types"

export interface IOutbox<TTransaction> {
  publish: (events: OutboxEvent[], transaction?: TTransaction) => Promise<void>
  start: (
    handler: (events: OutboxEvent[]) => Promise<void>,
    onError: (error: unknown) => void
  ) => void
  stop: () => Promise<void>
}

export interface IOutboxEventBus<TTransaction> {
  emit: <T extends string, P>(
    event: BusEvent<T, P>,
    transaction?: TTransaction
  ) => Promise<void>
  emitMany: <T extends string, P>(
    events: BusEvent<T, P>[],
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
    eventType: T | T[],
    handler: (event: BusEvent<T, P>) => Promise<void>
  ) => this
  removeListener: <T extends string, P = unknown>(
    eventType: T | T[],
    handler: (event: BusEvent<T, P>) => Promise<void>
  ) => this
  once: <T extends string, P = unknown>(
    eventType: T,
    handler: (event: BusEvent<T, P>) => Promise<void>
  ) => this
  prependOnceListener: <T extends string, P = unknown>(
    eventType: T,
    handler: (event: BusEvent<T, P>) => Promise<void>
  ) => this
  removeAllListeners: <T extends string>(eventType?: T) => this
  prependListener: <T extends string, P = unknown>(
    eventType: T,
    handler: (event: BusEvent<T, P>) => Promise<void>
  ) => this
  setMaxListeners: (n: number) => this
  getSubscriptionCount: () => number
  listenerCount: (eventType: string) => number
  rawListeners: (eventType: string) => AnyListener[]
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
  processBatch: (handler: (events: OutboxEvent[]) => Promise<void>) => Promise<void>
  performMaintenance?: () => Promise<void>
}
