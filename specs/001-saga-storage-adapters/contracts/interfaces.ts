export interface SagaStoreAdapter {
  /**
   * Persists the saga payload.
   * @param id Unique identifier for the payload (Claim ID)
   * @param data The binary payload to store
   * @param expiresAt Optional expiration date for TTL-based cleanup
   */
  put(id: string, data: Buffer, expiresAt?: Date): Promise<void>;

  /**
   * Retrieves the saga payload.
   * @param id Unique identifier for the payload
   */
  get(id: string): Promise<Buffer>;

  /**
   * Optional cleanup method for adapters that don't support native TTL.
   */
  cleanup?(): Promise<void>;
}
