import type { Middleware, MiddlewareContext, Next } from "../types/middleware"

export async function executeMiddleware<TTransaction>(
  middlewares: Middleware<TTransaction>[],
  context: MiddlewareContext<TTransaction>,
  finalHandler: Next
): Promise<void> {
  let currentIndex = -1

  async function dispatch(index: number): Promise<void> {
    if (index <= currentIndex) {
      throw new Error("next() called multiple times")
    }
    currentIndex = index
    if (index === middlewares.length) {
      return finalHandler()
    }

    const fn = middlewares[index]
    if (!fn) {
      return dispatch(index + 1)
    }

    await fn(context, () => dispatch(index + 1))
  }

  await dispatch(0)
}
