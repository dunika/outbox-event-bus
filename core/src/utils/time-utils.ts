export function createTimedPromise<T>(timeoutMs: number, onTimeoutError: () => Error) {
  let timer: ReturnType<typeof setTimeout>
  const cleanups: (() => void)[] = []

  const { promise, resolve, reject } = Promise.withResolvers<T>()

  let completed = false
  let started = false

  function cleanup() {
    if (completed) return
    completed = true
    if (timer) clearTimeout(timer)
    for (const fn of cleanups) {
      fn()
    }
  }

  function safeAttempt(fn: () => void) {
    try {
      cleanup()
      fn()
    } catch (error) {
      reject(error)
    }
  }

  return {
    resolve: (value: T | PromiseLike<T>) => safeAttempt(() => resolve(value)),
    reject: (reason?: unknown) => safeAttempt(() => reject(reason)),
    addCleanup: (fn: () => void) => {
      cleanups.push(fn)
    },
    start: () => {
      if (started) return promise
      started = true
      
      if (completed) return promise

      timer = setTimeout(() => {
        safeAttempt(() => reject(onTimeoutError()))
      }, timeoutMs)

      return promise
    },
  }
}
