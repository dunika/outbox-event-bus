import { HandlerError, MaxRetriesExceededError } from "../errors"
import type { BusEvent, ErrorHandler } from "../types/types"

export function reportEventError(
  onError: ErrorHandler | undefined,
  error: unknown,
  event: BusEvent,
  retryCount: number,
  maxRetries: number
): void {
  if (!onError) return

  if (retryCount > maxRetries) {
    onError(new MaxRetriesExceededError(error, retryCount), {
      ...event,
      retryCount,
    })
  } else {
    onError(new HandlerError(error), { ...event, retryCount })
  }
}
