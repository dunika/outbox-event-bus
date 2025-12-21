import { ConditionalCheckFailedException, type DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  QueryCommand as DocQueryCommand,
  DynamoDBDocumentClient,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import {
  BatchSizeLimitError,
  type BusEvent,
  type ErrorHandler,
  type FailedBusEvent,
  formatErrorMessage,
  type IOutbox,
  MaxRetriesExceededError,
  type OutboxConfig,
  PollingService,
} from "outbox-event-bus"

// DynamoDB has a hard limit of 100 items per transaction
const DYNAMODB_TRANSACTION_LIMIT = 100

export type DynamoDBAwsSdkTransactionCollector = {
  push: (item: any) => void
  items?: any[]
}

export interface DynamoDBAwsSdkOutboxConfig extends OutboxConfig {
  client: DynamoDBClient
  tableName: string
  statusIndexName?: string
  processingTimeoutMs?: number // Time before a PROCESSING event is considered stuck
  getCollector?: (() => DynamoDBAwsSdkTransactionCollector | undefined) | undefined
}

export class DynamoDBAwsSdkOutbox implements IOutbox<DynamoDBAwsSdkTransactionCollector> {
  private readonly config: Required<DynamoDBAwsSdkOutboxConfig>
  private readonly docClient: DynamoDBDocumentClient
  private readonly poller: PollingService

  constructor(config: DynamoDBAwsSdkOutboxConfig) {
    this.config = {
      batchSize: config.batchSize ?? 50,
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      maxRetries: config.maxRetries ?? 5,
      baseBackoffMs: config.baseBackoffMs ?? 1000,
      processingTimeoutMs: config.processingTimeoutMs ?? 30000,
      maxErrorBackoffMs: config.maxErrorBackoffMs ?? 30000,
      tableName: config.tableName,
      statusIndexName: config.statusIndexName ?? "status-gsiSortKey-index",
      client: config.client,
      getCollector: config.getCollector,
    }

    this.docClient = DynamoDBDocumentClient.from(config.client, {
      marshallOptions: { removeUndefinedValues: true },
    })

    this.poller = new PollingService({
      pollIntervalMs: this.config.pollIntervalMs,
      baseBackoffMs: this.config.baseBackoffMs,
      maxErrorBackoffMs: this.config.maxErrorBackoffMs,
      performMaintenance: () => this.recoverStuckEvents(),
      processBatch: (handler) => this.processBatch(handler),
    })
  }

  async publish(
    events: BusEvent[],
    transaction?: DynamoDBAwsSdkTransactionCollector
  ): Promise<void> {
    if (events.length === 0) return

    if (events.length > DYNAMODB_TRANSACTION_LIMIT) {
      throw new BatchSizeLimitError(DYNAMODB_TRANSACTION_LIMIT, events.length)
    }

    const collector = transaction ?? this.config.getCollector?.()

    const items = events.map((event) => {
      return {
        Put: {
          TableName: this.config.tableName,
          Item: {
            id: event.id,
            type: event.type,
            payload: event.payload,
            occurredAt: event.occurredAt.toISOString(),
            status: "PENDING",
            retryCount: 0,
            gsiSortKey: event.occurredAt.getTime(),
          },
        },
      }
    })

    if (collector) {
      const itemsInCollector = collector.items?.length ?? 0

      if (itemsInCollector + items.length > DYNAMODB_TRANSACTION_LIMIT) {
        throw new BatchSizeLimitError(DYNAMODB_TRANSACTION_LIMIT, itemsInCollector + items.length)
      }

      for (const item of items) {
        collector.push(item)
      }
    } else {
      await this.docClient.send(
        new TransactWriteCommand({
          TransactItems: items,
        })
      )
    }
  }

  async getFailedEvents(): Promise<FailedBusEvent[]> {
    const result = await this.docClient.send(
      new DocQueryCommand({
        TableName: this.config.tableName,
        IndexName: this.config.statusIndexName,
        KeyConditionExpression: "#status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": "FAILED" },
        Limit: 100,
        ScanIndexForward: false, // Newest first
      })
    )

    if (!result.Items) return []

    return result.Items.map((item) => {
      const event: FailedBusEvent = {
        id: item.id,
        type: item.type,
        payload: item.payload,
        occurredAt: this.parseOccurredAt(item.occurredAt),
        retryCount: item.retryCount || 0,
      }
      if (item.lastError) event.error = item.lastError
      if (item.startedOn) event.lastAttemptAt = new Date(item.startedOn)
      return event
    })
  }

  async retryEvents(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return

    await Promise.all(
      eventIds.map((id) =>
        this.docClient.send(
          new UpdateCommand({
            TableName: this.config.tableName,
            Key: { id },
            UpdateExpression:
              "SET #status = :pending, retryCount = :zero, gsiSortKey = :now REMOVE lastError, nextRetryAt, startedOn",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":pending": "PENDING",
              ":zero": 0,
              ":now": Date.now(),
            },
          })
        )
      )
    )
  }

  start(handler: (event: BusEvent) => Promise<void>, onError: ErrorHandler): void {
    this.poller.start(handler, onError)
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }

  private async updateEventAfterFailure(
    itemId: string,
    retryCount: number,
    now: number
  ): Promise<void> {
    if (retryCount >= this.config.maxRetries) {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.config.tableName,
          Key: { id: itemId },
          UpdateExpression: "SET #status = :failed, nextRetryAt = :now REMOVE gsiSortKey",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":failed": "FAILED",
            ":now": now,
          },
        })
      )
    } else {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.config.tableName,
          Key: { id: itemId },
          UpdateExpression: "SET #status = :pending, gsiSortKey = :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":pending": "PENDING",
            ":now": now,
          },
        })
      )
    }
  }

  private parseOccurredAt(occurredAt: unknown): Date {
    if (occurredAt instanceof Date) {
      return occurredAt
    }
    if (typeof occurredAt === "string") {
      return new Date(occurredAt)
    }
    return new Date()
  }

  private async recoverStuckEvents() {
    const now = Date.now()

    const result = await this.docClient.send(
      new DocQueryCommand({
        TableName: this.config.tableName,
        IndexName: this.config.statusIndexName,
        KeyConditionExpression: "#status = :status AND gsiSortKey <= :now",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": "PROCESSING",
          ":now": now,
        },
      })
    )

    if (result.Items && result.Items.length > 0) {
      await Promise.all(
        result.Items.map((item) => this.updateEventAfterFailure(item.id, item.retryCount || 0, now))
      )
    }
  }

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
    const now = Date.now()

    const result = await this.docClient.send(
      new DocQueryCommand({
        TableName: this.config.tableName,
        IndexName: this.config.statusIndexName,
        KeyConditionExpression: "#status = :status AND gsiSortKey <= :now",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": "PENDING",
          ":now": now,
        },
        Limit: this.config.batchSize,
      })
    )

    if (!result.Items || result.Items.length === 0) return

    for (const item of result.Items) {
      const event: BusEvent = {
        id: item.id,
        type: item.type,
        payload: item.payload,
        occurredAt: this.parseOccurredAt(item.occurredAt),
      }

      // Try to lock the event
      try {
        await this.docClient.send(
          new UpdateCommand({
            TableName: this.config.tableName,
            Key: { id: item.id },
            UpdateExpression:
              "SET #status = :processing, gsiSortKey = :timeoutAt, startedOn = :now",
            ConditionExpression: "#status = :pending",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":processing": "PROCESSING",
              ":timeoutAt": now + this.config.processingTimeoutMs,
              ":pending": "PENDING",
              ":now": now,
            },
          })
        )

        await handler(event)

        await this.docClient.send(
          new UpdateCommand({
            TableName: this.config.tableName,
            Key: { id: event.id },
            UpdateExpression: "SET #status = :completed, completedOn = :now REMOVE gsiSortKey",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":completed": "COMPLETED",
              ":now": Date.now(),
            },
          })
        )
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          continue
        }

        const newRetryCount = (item.retryCount || 0) + 1
        if (newRetryCount >= this.config.maxRetries) {
          this.poller.onError?.(new MaxRetriesExceededError(error, newRetryCount), {
            ...event,
            retryCount: newRetryCount,
          })
        } else {
          this.poller.onError?.(error, { ...event, retryCount: newRetryCount })
        }

        const errorMsg = formatErrorMessage(error)
        const delay = this.poller.calculateBackoff(newRetryCount)

        if (newRetryCount >= this.config.maxRetries) {
          await this.docClient.send(
            new UpdateCommand({
              TableName: this.config.tableName,
              Key: { id: item.id },
              UpdateExpression:
                "SET #status = :failed, retryCount = :rc, lastError = :err REMOVE gsiSortKey",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":failed": "FAILED",
                ":rc": newRetryCount,
                ":err": errorMsg,
              },
            })
          )
        } else {
          await this.docClient.send(
            new UpdateCommand({
              TableName: this.config.tableName,
              Key: { id: item.id },
              UpdateExpression:
                "SET #status = :pending, retryCount = :rc, lastError = :err, gsiSortKey = :nextAttempt",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":pending": "PENDING",
                ":rc": newRetryCount,
                ":err": errorMsg,
                ":nextAttempt": Date.now() + delay,
              },
            })
          )
        }
      }
    }
  }
}
