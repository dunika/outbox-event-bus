import type { BusEvent, ErrorHandler, FailedBusEvent } from "../types/types"

import { HandlerError, MaxRetriesExceededError } from "./errors"

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
