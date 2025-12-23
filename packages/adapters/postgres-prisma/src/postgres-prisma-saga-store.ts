import type { SagaStoreAdapter } from "@outbox-event-bus/saga"
import type { PrismaClient } from "@prisma/client"
import { resolveExecutor, withSagaAdapterLogAndError } from "outbox-event-bus"

export interface PostgresPrismaSagaStoreConfig {
  prisma: PrismaClient
  getTransaction?: (() => PrismaClient | undefined) | undefined
  modelName?: string
}

export class PostgresPrismaSagaStore implements SagaStoreAdapter {
  private readonly prisma: PrismaClient
  private readonly getTransaction: (() => PrismaClient | undefined) | undefined
  private readonly modelName: string

  constructor(config: PostgresPrismaSagaStoreConfig) {
    this.prisma = config.prisma
    this.getTransaction = config.getTransaction
    this.modelName = config.modelName ?? "sagaStore"
  }

  // biome-ignore lint/suspicious/noExplicitAny: dynamic model access
  private get executor(): any {
    return resolveExecutor(undefined, this.getTransaction, this.prisma) as any
  }

  async put(id: string, data: Buffer, expiresAt: Date): Promise<void> {
    await withSagaAdapterLogAndError("PostgresPrismaSagaStore", "Stored payload", id, async () => {
      await this.executor[this.modelName].upsert({
        where: { id },
        update: { data, expiresAt },
        create: { id, data, expiresAt },
      })
    })
  }

  async get(id: string): Promise<Buffer> {
    return withSagaAdapterLogAndError(
      "PostgresPrismaSagaStore",
      "Retrieved payload",
      id,
      async () => {
        const record = await this.executor[this.modelName].findUnique({
          where: { id },
        })

        if (!record) {
          throw new Error(`Saga data not found for ID: ${id}`)
        }

        return Buffer.from(record.data)
      }
    )
  }

  async initialize(): Promise<void> {
    // Prisma handles schema via migrations, but we can verify the model exists
    if (!this.prisma[this.modelName as keyof PrismaClient]) {
      throw new Error(`Prisma model "${this.modelName}" not found in client`)
    }
    console.debug(`[PostgresPrismaSagaStore] Verified model ${this.modelName}`)
  }

  async cleanup(): Promise<void> {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic model access
    await (this.prisma as any)[this.modelName].deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    })
  }
}
