export async function promiseMap<T>(
  items: T[],
  mapper: (item: T, index: number) => Promise<void>,
  concurrency: number
): Promise<void> {
  const iterator = items.entries()
  const workers = Array.from({ length: concurrency }, async () => {
    for (const [index, item] of iterator) {
      await mapper(item, index)
    }
  })
  await Promise.all(workers)
}
