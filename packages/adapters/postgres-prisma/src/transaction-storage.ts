import { AsyncLocalStorage } from "node:async_hooks"
import type { PrismaClient } from "@prisma/client"

export const prismaTransactionStorage = new AsyncLocalStorage<PrismaClient>()

export async function withPrismaTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    return prismaTransactionStorage.run(tx as PrismaClient, () => fn(tx as PrismaClient))
  })
}

export function getPrismaTransaction(): () => PrismaClient | undefined {
  return () => prismaTransactionStorage.getStore()
}
