import { AsyncLocalStorage } from "node:async_hooks";
import type { DynamoDBTransactionCollector } from "./dynamodb-outbox";

export const dynamodbTransactionStorage = new AsyncLocalStorage<DynamoDBTransactionCollector>();

export async function withDynamoDBTransaction<T>(
  fn: (collector: DynamoDBTransactionCollector) => Promise<T>
): Promise<T> {
  const collector: any[] = [];
  return dynamodbTransactionStorage.run(collector, () => fn(collector));
}

export function getDynamoDBCollector(): () => DynamoDBTransactionCollector | undefined {
  return () => dynamodbTransactionStorage.getStore();
}
