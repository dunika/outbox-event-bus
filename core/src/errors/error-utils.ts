export function formatErrorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    return `${error.message}: ${error.errors.map(e => formatErrorMessage(e)).join('; ')}`
  }
  return error instanceof Error ? error.message : String(error)
}
