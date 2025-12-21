import { AsyncLocalStorage } from "node:async_hooks"
import type { DynamoDBAwsSdkTransactionCollector } from "./dynamodb-aws-sdk-outbox"

export const dynamodbAwsSdkTransactionStorage =
  new AsyncLocalStorage<DynamoDBAwsSdkTransactionCollector>()

export async function withDynamoDBAwsSdkTransaction<T>(
  fn: (collector: DynamoDBAwsSdkTransactionCollector) => Promise<T>
): Promise<T> {
  const collector: any[] = []
  return dynamodbAwsSdkTransactionStorage.run(collector as any, () => fn(collector as any))
}

export function getDynamoDBAwsSdkCollector(): () => DynamoDBAwsSdkTransactionCollector | undefined {
  return () => dynamodbAwsSdkTransactionStorage.getStore()
}
