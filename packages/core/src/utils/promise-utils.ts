export async function promiseMap<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  let cursor = 0
  const results = new Array<R>(items.length)

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await mapper(items[index] as T, index)
    }
  })
  await Promise.all(workers)

  return results
}
