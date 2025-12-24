import { ConditionalCheckFailedException, type DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  QueryCommand as DocQueryCommand,
  DynamoDBDocumentClient,
  TransactWriteCommand,
  type TransactWriteCommandInput,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import {
  BatchSizeLimitError,
  type BusEvent,
  type ErrorHandler,
  EventStatus,
  type FailedBusEvent,
  formatErrorMessage,
  type IOutbox,
  type OutboxConfig,
  PollingService,
  reportEventError,
} from "outbox-event-bus"

// DynamoDB has a hard limit of 100 items per transaction
const DYNAMODB_TRANSACTION_LIMIT = 100

export type TransactWriteItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number]

export type DynamoDBAwsSdkTransactionCollector = {
  push: (item: TransactWriteItem) => void
  items?: TransactWriteItem[]
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
            status: EventStatus.CREATED,
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
        ExpressionAttributeValues: { ":status": EventStatus.FAILED },
        Limit: 100,
        ScanIndexForward: false,
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
              ":pending": EventStatus.CREATED,
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
          ":status": EventStatus.CREATED,
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

      try {
        await this.markEventAsProcessing(item.id, now)
        await handler(event)
        await this.markEventAsCompleted(event.id)
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          continue
        }

        const newRetryCount = (item.retryCount || 0) + 1
        reportEventError(this.poller.onError, error, event, newRetryCount, this.config.maxRetries)

        await this.markEventAsFailed(item.id, newRetryCount, error)
      }
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

  private async markEventAsProcessing(id: string, now: number): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.config.tableName,
        Key: { id },
        UpdateExpression: "SET #status = :processing, gsiSortKey = :timeoutAt, startedOn = :now",
        ConditionExpression: "#status = :created OR (#status = :processing AND gsiSortKey <= :now)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":processing": EventStatus.ACTIVE,
          ":timeoutAt": now + this.config.processingTimeoutMs,
          ":now": now,
          ":created": EventStatus.CREATED,
        },
      })
    )
  }

  private async markEventAsCompleted(id: string): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.config.tableName,
        Key: { id },
        UpdateExpression: "SET #status = :completed, completedOn = :now REMOVE gsiSortKey",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":completed": EventStatus.COMPLETED,
          ":now": Date.now(),
        },
      })
    )
  }

  private async markEventAsFailed(id: string, retryCount: number, error: unknown): Promise<void> {
    const isFinalFailure = retryCount >= this.config.maxRetries
    const status = isFinalFailure ? EventStatus.FAILED : EventStatus.CREATED
    const errorMsg = formatErrorMessage(error)
    const now = Date.now()

    const updateExpression = isFinalFailure
      ? "SET #status = :status, retryCount = :rc, lastError = :error, nextRetryAt = :now REMOVE gsiSortKey"
      : "SET #status = :status, retryCount = :rc, lastError = :error, gsiSortKey = :nextAttempt"

    const expressionAttributeValues: Record<string, any> = {
      ":status": status,
      ":rc": retryCount,
      ":error": errorMsg,
    }

    if (isFinalFailure) {
      expressionAttributeValues[":now"] = now
    } else {
      const delay = this.poller.calculateBackoff(retryCount)
      expressionAttributeValues[":nextAttempt"] = now + delay
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.config.tableName,
        Key: { id },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: expressionAttributeValues,
      })
    )
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
          ":status": EventStatus.ACTIVE,
          ":now": now,
        },
      })
    )

    if (result.Items && result.Items.length > 0) {
      await Promise.all(
        result.Items.map((item) =>
          this.markEventAsFailed(item.id, (item.retryCount || 0) + 1, "Processing timeout")
        )
      )
    }
  }
}
