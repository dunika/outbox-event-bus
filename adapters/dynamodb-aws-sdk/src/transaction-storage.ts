import { AsyncLocalStorage } from "node:async_hooks"
import type {
  DynamoDBAwsSdkTransactionCollector,
  TransactWriteItem,
} from "./dynamodb-aws-sdk-outbox"

export const dynamodbAwsSdkTransactionStorage =
  new AsyncLocalStorage<DynamoDBAwsSdkTransactionCollector>()

export async function withDynamoDBAwsSdkTransaction<T>(
  fn: (collector: DynamoDBAwsSdkTransactionCollector) => Promise<T>
): Promise<T> {
  const items: TransactWriteItem[] = []
  const collector: DynamoDBAwsSdkTransactionCollector = {
    push: (item: TransactWriteItem) => items.push(item),
    get items() {
      return items
    },
  }
  return dynamodbAwsSdkTransactionStorage.run(collector, () => fn(collector))
}

export function getDynamoDBAwsSdkCollector(): () => DynamoDBAwsSdkTransactionCollector | undefined {
  return () => dynamodbAwsSdkTransactionStorage.getStore()
}
