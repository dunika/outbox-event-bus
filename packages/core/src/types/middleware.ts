import type { BusEvent } from "./types"

export type MiddlewarePhase = "emit" | "consume"

export type EmitMiddlewareContext<TTransaction = unknown> = {
  phase: "emit"
  event: BusEvent
  transaction?: TTransaction | undefined
}

export type ConsumeMiddlewareContext<TTransaction = unknown> = {
  phase: "consume"
  event: BusEvent
  transaction?: TTransaction | undefined
}

export type MiddlewareContext<TTransaction = unknown> =
  | EmitMiddlewareContext<TTransaction>
  | ConsumeMiddlewareContext<TTransaction>

export type Next = () => Promise<void>

export type Middleware<TTransaction = unknown> = (
  ctx: MiddlewareContext<TTransaction>,
  next: Next
) => Promise<void>
