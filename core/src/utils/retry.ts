import type { RetryOptions } from "../types/types"

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Required<RetryOptions>
): Promise<T> {
  let lastError: unknown
  let delay = options.initialDelayMs

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt < options.maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay = Math.min(delay * 2, options.maxDelayMs)
      }
    }
  }

  throw lastError
}
