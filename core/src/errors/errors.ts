import type { BusEvent, FailedBusEvent } from "../types/types"

export interface OutboxErrorContext {
  event?: BusEvent | FailedBusEvent
  cause?: unknown
  [key: string]: unknown
}

export abstract class OutboxError<
  TContext extends OutboxErrorContext = OutboxErrorContext,
> extends Error {
  public context?: TContext | undefined

  constructor(message: string, name: string, context?: TContext) {
    super(message, { cause: context?.cause })
    this.name = name
    this.context = context

    if ("captureStackTrace" in Error) {
      Error.captureStackTrace(this, OutboxError)
    }

    // Restore prototype chain for proper instanceof checks
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// === Configuration Errors ===

export class ConfigurationError<
  TContext extends OutboxErrorContext = OutboxErrorContext,
> extends OutboxError<TContext> {
  constructor(message: string, context?: TContext) {
    super(message, "ConfigurationError", context)
  }
}

export class DuplicateListenerError extends ConfigurationError {
  constructor(eventType: string) {
    super(
      `Event type "${eventType}" already has a listener. You can only register one handler per event type.`,
      { eventType }
    )
    this.name = "DuplicateListenerError"
  }
}

export class UnsupportedOperationError extends ConfigurationError {
  constructor(operation: string, adapterName = "adapter") {
    super(`Underlying outbox ${adapterName} does not support management operation: ${operation}`, {
      operation,
      adapterName,
    })
    this.name = "UnsupportedOperationError"
  }
}

// === Validation Errors ===

export class ValidationError<
  TContext extends OutboxErrorContext = OutboxErrorContext,
> extends OutboxError<TContext> {
  constructor(message: string, context?: TContext) {
    super(message, "ValidationError", context)
  }
}

export class BatchSizeLimitError extends ValidationError {
  constructor(limit: number, actual: number) {
    super(`Cannot publish ${actual} events because the batch size limit is ${limit}.`, {
      limit,
      actual,
    })
    this.name = "BatchSizeLimitError"
  }
}

// === Operational Errors ===

export class OperationalError<
  TContext extends OutboxErrorContext = OutboxErrorContext,
> extends OutboxError<TContext> {
  constructor(message: string, context?: TContext) {
    super(message, "OperationalError", context)
  }
}

export class TimeoutError extends OperationalError {
  constructor(operation: string, timeoutMs: number, context?: OutboxErrorContext) {
    super(`Timed out waiting for ${operation} after ${timeoutMs}ms`, {
      operation,
      timeoutMs,
      ...context,
    })
    this.name = "TimeoutError"
  }
}

export class BackpressureError extends OperationalError {
  constructor(resource: string, context?: OutboxErrorContext) {
    super(`Failed to publish to ${resource}: buffer full (backpressure)`, { resource, ...context })
    this.name = "BackpressureError"
  }
}

export class MaintenanceError<
  TContext extends OutboxErrorContext = OutboxErrorContext,
> extends OperationalError<TContext> {
  constructor(cause: unknown, context?: TContext) {
    const message = cause instanceof Error ? cause.message : String(cause)
    const fullContext = { cause, ...context } as TContext
    super(`Maintenance operation failed: ${message}`, fullContext)
    this.name = "MaintenanceError"
  }
}

// Existing Error - Integrating into hierarchy
export class MaxRetriesExceededError<
  TContext extends OutboxErrorContext = OutboxErrorContext,
> extends OperationalError<TContext> {
  public get retryCount(): number {
    return this.event.retryCount
  }

  constructor(
    cause: unknown,
    public readonly event: FailedBusEvent,
    context?: TContext
  ) {
    const fullContext = {
      cause,
      event,
      ...context,
    } as unknown as TContext

    super(`Max retries exceeded (${event.retryCount}). Event moved to DLQ.`, fullContext)
    this.name = "MaxRetriesExceededError"
  }
}

export class HandlerError<
  TContext extends OutboxErrorContext = OutboxErrorContext,
> extends OutboxError<TContext> {
  constructor(
    cause: unknown,
    public readonly event: BusEvent,
    context?: TContext
  ) {
    const message = cause instanceof Error ? cause.message : String(cause)
    const fullContext = { cause, event, ...context } as unknown as TContext
    super(`Event handler failed: ${message}`, "HandlerError", fullContext)
  }
}
