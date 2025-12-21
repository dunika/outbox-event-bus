import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTimedPromise } from './time-utils'

describe('createTimedPromise', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should resolve successfully before timeout', async () => {
    const { start, resolve } = createTimedPromise(1000, () => new Error('timeout'))
    const p = start()
    
    resolve('success')
    await expect(p).resolves.toBe('success')
  })

  it('should reject with custom error on timeout', async () => {
    const errorFn = vi.fn(() => new Error('custom timeout'))
    const { start } = createTimedPromise(1000, errorFn)
    const p = start()

    vi.advanceTimersByTime(1000)
    await expect(p).rejects.toThrow('custom timeout')
    expect(errorFn).toHaveBeenCalled()
  })

  it('should run cleanups when resolved', async () => {
    const cleanup = vi.fn()
    const { start, resolve, addCleanup } = createTimedPromise(1000, () => new Error('timeout'))
    
    addCleanup(cleanup)
    void start()
    resolve('done')

    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('should run cleanups when timed out', async () => {
    const cleanup = vi.fn()
    const { start, addCleanup } = createTimedPromise(1000, () => new Error('timeout'))
    
    addCleanup(cleanup)
    const p = start()
    
    vi.advanceTimersByTime(1000)
    await expect(p).rejects.toThrow('timeout')
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('should handle early resolution (before start)', async () => {
    const cleanup = vi.fn()
    const { start, resolve, addCleanup } = createTimedPromise(1000, () => new Error('timeout'))
    addCleanup(cleanup)

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

    resolve('early')
    expect(cleanup).toHaveBeenCalledTimes(1)

    const p = start()
    await expect(p).resolves.toBe('early')
    
    // Timer should NEVER be scheduled if already completed
    expect(setTimeoutSpy).not.toHaveBeenCalled()
  })

  it('should be safe to call start() multiple times (idempotent)', async () => {
    const { start } = createTimedPromise(1000, () => new Error('timeout'))
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

    const p1 = start()
    const p2 = start()

    expect(p1).toBe(p2)
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
  })

  it('should reject if cleanup fails on resolve', async () => {
    const { start, resolve, addCleanup } = createTimedPromise(1000, () => new Error('timeout'))
    
    addCleanup(() => {
      throw new Error('cleanup boom')
    })
    
    // We expect the promise to REJECT with the cleanup error
    const p = start()
    resolve('ok')
    
    await expect(p).rejects.toThrow('cleanup boom')
  })
})
