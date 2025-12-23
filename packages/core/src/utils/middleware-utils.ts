import type { Next } from "../types/middleware"

export async function executeMiddleware<TContext>(
  middlewares: ((ctx: TContext, next: Next) => Promise<void>)[],
  context: TContext
): Promise<boolean> {
  let currentIndex = -1

  async function dispatch(index: number): Promise<boolean> {
    if (index <= currentIndex) {
      throw new Error("next() called multiple times")
    }
    currentIndex = index
    if (index === middlewares.length) {
      return true
    }

    const fn = middlewares[index]
    if (!fn) {
      return dispatch(index + 1)
    }

    let nextCalled = false
    let dropEvent = false
    let isDownstreamComplete = false

    async function next(options?: { dropEvent?: boolean }): Promise<void> {
      if (dropEvent) return

      nextCalled = true

      if (options?.dropEvent) {
        dropEvent = true
        return
      }

      isDownstreamComplete = await dispatch(index + 1)
    }

    await fn(context, next)

    if (!nextCalled) {
      throw new Error(`Middleware at index ${index} must call next()`)
    }

    return !dropEvent && isDownstreamComplete
  }

  return dispatch(0)
}
