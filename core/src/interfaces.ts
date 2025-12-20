import type { BusEvent, AnyListener } from "./types"

export interface IOutbox {
  publish: (events: BusEvent[]) => Promise<void>
  start: (handler: (events: BusEvent[]) => Promise<void>) => void
  stop: () => Promise<void>
}

export interface IOutboxEventBus {
  emit: <T extends string, P>(event: BusEvent<T, P>) => Promise<void>
  emitMany: <T extends string, P>(events: BusEvent<T, P>[]) => Promise<void>
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
