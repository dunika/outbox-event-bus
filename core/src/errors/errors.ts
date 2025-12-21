export abstract class OutboxError extends Error {
  public data: Record<string, unknown> | undefined

  constructor(message: string, name: string, context?: Record<string, unknown>) {
    super(message)
    this.name = name
    this.data = context
    // Restore prototype chain for proper instanceof checks
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// === Configuration Errors ===

export class ConfigurationError extends OutboxError {
  constructor(message: string, context?: Record<string, unknown>) {
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

export class ValidationError extends OutboxError {
  constructor(message: string, context?: Record<string, unknown>) {
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

export class OperationalError extends OutboxError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "OperationalError", context)
  }
}

export class TimeoutError extends OperationalError {
  constructor(operation: string, timeoutMs: number, context?: Record<string, unknown>) {
    super(`Timed out waiting for ${operation} after ${timeoutMs}ms`, {
      operation,
      timeoutMs,
      ...context,
    })
    this.name = "TimeoutError"
  }
}

export class BackpressureError extends OperationalError {
  constructor(resource: string, context?: Record<string, unknown>) {
    super(`Failed to publish to ${resource}: buffer full (backpressure)`, { resource, ...context })
    this.name = "BackpressureError"
  }
}

export class MaintenanceError extends OperationalError {
  constructor(originalError: unknown, context?: Record<string, unknown>) {
    const message = originalError instanceof Error ? originalError.message : String(originalError)
    super(`Maintenance operation failed: ${message}`, { originalError, ...context })
    this.name = "MaintenanceError"
    if (originalError instanceof Error && originalError.stack) {
      this.stack = originalError.stack
    }
  }
}

// Existing Error - Integrating into hierarchy
export class MaxRetriesExceededError extends OperationalError {
  constructor(
    public readonly originalError: unknown,
    public readonly retryCount: number,
    context?: Record<string, unknown>
  ) {
    super(`Max retries exceeded (${retryCount}). Event moved to DLQ.`, {
      originalError,
      retryCount,
      ...context,
    })
    this.name = "MaxRetriesExceededError"
  }
}

export class HandlerError extends OutboxError {
  constructor(
    public readonly originalError: unknown,
    context?: Record<string, unknown>
  ) {
    const message = originalError instanceof Error ? originalError.message : String(originalError)
    super(`Event handler failed: ${message}`, "HandlerError", { originalError, ...context })
    if (originalError instanceof Error && originalError.stack) {
      this.stack = originalError.stack
    }
  }
}
