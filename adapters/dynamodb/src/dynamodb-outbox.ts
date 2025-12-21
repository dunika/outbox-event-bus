import { 
  DynamoDBClient, 
} from "@aws-sdk/client-dynamodb";
import { 
  DynamoDBDocumentClient, 
  UpdateCommand, 
  QueryCommand as DocQueryCommand,
  TransactWriteCommand
} from "@aws-sdk/lib-dynamodb";
import { type BusEvent, type IOutbox, type OutboxConfig, type ResolvedOutboxConfig, PollingService, formatErrorMessage } from "outbox-event-bus";

export type DynamoDBTransactionCollector = {
  push: (item: any) => void;
  items?: any[];
};

export interface DynamoDBOutboxConfig extends OutboxConfig {
  client: DynamoDBClient;
  tableName: string;
  statusIndexName?: string;
  processingTimeoutMs?: number; // Time before a PROCESSING event is considered stuck
  getCollector?: (() => DynamoDBTransactionCollector | undefined) | undefined;
}

export class DynamoDBOutbox implements IOutbox<DynamoDBTransactionCollector> {
  private readonly config: Required<DynamoDBOutboxConfig>
  private readonly docClient: DynamoDBDocumentClient;
  private readonly poller: PollingService;
  
  constructor(config: DynamoDBOutboxConfig) {
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
      marshallOptions: { removeUndefinedValues: true }
    });
    
    this.poller = new PollingService(
      {
        pollIntervalMs: this.config.pollIntervalMs,
        baseBackoffMs: this.config.baseBackoffMs,
        maxErrorBackoffMs: this.config.maxErrorBackoffMs,
        performMaintenance: () => this.recoverStuckEvents(),
        processBatch: (handler) => this.processBatch(handler),
      }
    )
  }

  async publish(events: BusEvent[], transaction?: DynamoDBTransactionCollector): Promise<void> {
    if (events.length === 0) return;
    
    // DynamoDB has a hard limit of 100 items per transaction
    const DYNAMODB_TRANSACTION_LIMIT = 100;
    if (events.length > DYNAMODB_TRANSACTION_LIMIT) {
      throw new Error(`DynamoDB Outbox: Cannot publish more than ${DYNAMODB_TRANSACTION_LIMIT} events in a single transaction (DynamoDB limit).`);
    }

    const collector = transaction ?? this.config.getCollector?.();

    const items = events.map(event => {
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
            gsiSortKey: event.occurredAt.getTime()
          }
        }
      };
    });

    if (collector) {
      const itemsInCollector = collector.items?.length ?? 0;
      
      if (itemsInCollector + items.length > 100) {
        throw new Error(`DynamoDB Outbox: Cannot add ${items.length} events because the transaction already has ${itemsInCollector} items (DynamoDB limit is 100).`);
      }

      for (const item of items) {
        collector.push(item);
      }
    } else {
      await this.docClient.send(new TransactWriteCommand({
        TransactItems: items
      }));
    }
  }

  start(
    handler: (event: BusEvent) => Promise<void>,
    onError: (error: unknown) => void
  ): void {
    this.poller.start(handler, onError);
  }

  async stop(): Promise<void> {
    await this.poller.stop();
  }

  private async recoverStuckEvents() {
    const now = Date.now()

    const result = await this.docClient.send(new DocQueryCommand({
      TableName: this.config.tableName,
      IndexName: this.config.statusIndexName,
      KeyConditionExpression: "#status = :status AND gsiSortKey <= :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "PROCESSING",
        ":now": now
      }
    }))

    if (result.Items) {
      for (const item of result.Items) {
        if (item.retryCount >= this.config.maxRetries) {
          await this.docClient.send(new UpdateCommand({
            TableName: this.config.tableName,
            Key: { id: item.id },
            UpdateExpression: "SET #status = :failed, nextRetryAt = :now REMOVE gsiSortKey",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":failed": "FAILED",
              ":now": now
            }
          }))
        } else {
          await this.docClient.send(new UpdateCommand({
            TableName: this.config.tableName,
            Key: { id: item.id },
            UpdateExpression: "SET #status = :pending, gsiSortKey = :now",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":pending": "PENDING",
              ":now": now
            }
          }))
        }
      }
    }
  }

  private async processBatch(handler: (event: BusEvent) => Promise<void>) {
    const now = Date.now()

    const result = await this.docClient.send(new DocQueryCommand({
      TableName: this.config.tableName,
      IndexName: this.config.statusIndexName,
      KeyConditionExpression: "#status = :status AND gsiSortKey <= :now",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":status": "PENDING",
        ":now": now
      },
      Limit: this.config.batchSize
    }))

    if (!result.Items || result.Items.length === 0) return

    for (const item of result.Items) {
      // Try to lock the event
      try {
        await this.docClient.send(new UpdateCommand({
          TableName: this.config.tableName,
          Key: { id: item.id },
          UpdateExpression: "SET #status = :processing, gsiSortKey = :timeoutAt, startedOn = :now",
          ConditionExpression: "#status = :pending",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":processing": "PROCESSING",
            ":timeoutAt": now + this.config.processingTimeoutMs,
            ":pending": "PENDING",
            ":now": now
          }
        }))

        const event: BusEvent = {
          id: item.id,
          type: item.type,
          payload: item.payload,
          occurredAt: item.occurredAt ? (item.occurredAt instanceof Date ? item.occurredAt : new Date(item.occurredAt as string)) : new Date(),
        }

        // Process event
        await handler(event)

        // Mark completed
        await this.docClient.send(new UpdateCommand({
          TableName: this.config.tableName,
          Key: { id: event.id },
          UpdateExpression: "SET #status = :completed, completedOn = :now REMOVE gsiSortKey",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":completed": "COMPLETED",
            ":now": Date.now()
          }
        }))

      } catch (e: unknown) {
        if (e && typeof e === 'object' && 'name' in e && e.name === "ConditionalCheckFailedException") {
          // Someone else got it, skip
          continue
        }

        // Handle processing failure
        this.poller.onError?.(e)
        
        const newRetryCount = (item.retryCount || 0) + 1
        const errorMsg = formatErrorMessage(e)
        const delay = this.poller.calculateBackoff(newRetryCount)

          if (newRetryCount >= this.config.maxRetries) {
            await this.docClient.send(new UpdateCommand({
              TableName: this.config.tableName,
              Key: { id: item.id },
              UpdateExpression: "SET #status = :failed, retryCount = :rc, lastError = :err REMOVE gsiSortKey",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":failed": "FAILED",
                ":rc": newRetryCount,
                ":err": errorMsg
              }
            }))
          } else {
            await this.docClient.send(new UpdateCommand({
              TableName: this.config.tableName,
              Key: { id: item.id },
              UpdateExpression: "SET #status = :pending, retryCount = :rc, lastError = :err, gsiSortKey = :nextAttempt",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":pending": "PENDING",
                ":rc": newRetryCount,
                ":err": errorMsg,
                ":nextAttempt": Date.now() + delay
              }
            }))
          }
      }
    }
  }
}
