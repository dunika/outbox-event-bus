import type { BusEvent } from "./types"

export type MiddlewarePhase = "emit" | "handler"

export type EmitMiddlewareContext<TTransaction = unknown> = {
  phase: "emit"
  event: BusEvent
  transaction?: TTransaction | undefined
}

export type HandlerMiddlewareContext<TTransaction = unknown> = {
  phase: "handler"
  event: BusEvent
  transaction?: TTransaction | undefined
}

export type MiddlewareContext<TTransaction = unknown> =
  | EmitMiddlewareContext<TTransaction>
  | HandlerMiddlewareContext<TTransaction>

export type Next = (options?: { dropEvent?: boolean }) => Promise<void>

export type Middleware<TTransaction = unknown> = (
  ctx: MiddlewareContext<TTransaction>,
  next: Next
) => Promise<void>

export type EmitMiddleware<TTransaction = unknown> = (
  ctx: EmitMiddlewareContext<TTransaction>,
  next: Next
) => Promise<void>

export type HandlerMiddleware<TTransaction = unknown> = (
  ctx: HandlerMiddlewareContext<TTransaction>,
  next: Next
) => Promise<void>
