import { HandlerError, MaxRetriesExceededError } from "src/errors/errors"
import type { BusEvent, ErrorHandler, FailedBusEvent } from "../types/types"

export function reportEventError(
  onError: ErrorHandler | undefined,
  error: unknown,
  event: BusEvent,
  retryCount: number,
  maxRetries: number
): void {
  if (!onError) return

  if (retryCount > maxRetries) {
    const failedEvent: FailedBusEvent = { ...event, retryCount }
    onError(new MaxRetriesExceededError(error, failedEvent))
  } else {
    onError(new HandlerError(error, event))
  }
}
