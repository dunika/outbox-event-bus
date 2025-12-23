/**
 * Resolves the appropriate executor (transaction or base client) for a database operation.
 *
 * @param transaction - An explicit transaction passed to the method
 * @param getTransaction - A function to retrieve a context-scoped transaction
 * @param db - The base database client
 * @returns The resolved executor to use
 */
export function resolveExecutor<T>(
  transaction: T | undefined,
  getTransaction: (() => T | undefined) | undefined,
  db: T
): T {
  return transaction ?? getTransaction?.() ?? db
}

/**
 * Wraps a saga store operation with standard logging and error handling.
 *
 * @param adapterName - The name of the adapter (e.g., 'PostgresDrizzleSagaStore')
 * @param operation - The operation name (e.g., 'Stored payload', 'Retrieved payload')
 * @param id - The ID of the saga/payload being operated on
 * @param fn - The async function performing the operation
 * @returns The result of the operation
 */
export async function withSagaAdapterLogAndError<T>(
  adapterName: string,
  operation: string,
  id: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    const result = await fn()
    // eslint-disable-next-line no-console
    console.debug(`[${adapterName}] ${operation} success for ${id}`)
    return result
  } catch (error) {
    console.error(`[${adapterName}] ${operation} failed for ${id}`, error)
    throw error
  }
}
