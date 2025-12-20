import { 
  DynamoDBClient, 
} from "@aws-sdk/client-dynamodb";
import { 
  DynamoDBDocumentClient, 
  UpdateCommand, 
  QueryCommand as DocQueryCommand,
  BatchWriteCommand
} from "@aws-sdk/lib-dynamodb";
import type { BusEvent, IOutbox } from "outbox-event-bus";

export interface DynamoDBOutboxConfig {
  client: DynamoDBClient;
  tableName: string;
  statusIndexName: string;
  batchSize?: number;
  pollIntervalMs?: number;
  processingTimeoutMs?: number; // Time before a PROCESSING event is considered stuck
  maxRetries?: number;
  baseBackoffMs?: number;
  onError: (error: unknown) => void;
}

export class DynamoDBOutbox implements IOutbox {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly statusIndexName: string;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly processingTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly onError: (error: unknown) => void;

  private isPolling = false;
  private pollTimeout: NodeJS.Timeout | null = null;
  private errorCount = 0;
  private readonly maxErrorBackoffMs = 30000;

  constructor(config: DynamoDBOutboxConfig) {
    this.docClient = DynamoDBDocumentClient.from(config.client, {
      marshallOptions: { removeUndefinedValues: true }
    });
    this.tableName = config.tableName;
    this.statusIndexName = config.statusIndexName;
    this.batchSize = config.batchSize ?? 10;
    this.pollIntervalMs = config.pollIntervalMs ?? 1000;
    this.processingTimeoutMs = config.processingTimeoutMs ?? 30000;
    this.maxRetries = config.maxRetries ?? 5;
    this.baseBackoffMs = config.baseBackoffMs ?? 1000;
    this.onError = config.onError;
  }

  async publish(events: BusEvent[]): Promise<void> {
    const chunks = [];
    for (let i = 0; i < events.length; i += 25) {
      chunks.push(events.slice(i, i + 25));
    }

    for (const chunk of chunks) {
      const putRequests = chunk.map(event => ({
        PutRequest: {
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
      }));

      await this.docClient.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: putRequests
        }
      }));
    }
  }

  start(handler: (events: BusEvent[]) => Promise<void>): void {
    if (this.isPolling) return;
    this.isPolling = true;
    void this.poll(handler);
  }

  async stop(): Promise<void> {
    this.isPolling = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  private async poll(handler: (events: BusEvent[]) => Promise<void>) {
    if (!this.isPolling) return;

    try {
      await this.recoverStuckEvents()
      await this.processBatch(handler)
      this.errorCount = 0
    } catch (err) {
      this.onError(err)
      this.errorCount++
    }

    if (this.isPolling) {
      const backoff = Math.min(
        this.pollIntervalMs * Math.pow(2, this.errorCount),
        this.maxErrorBackoffMs
      )
      this.pollTimeout = setTimeout(() => {
        void this.poll(handler)
      }, backoff)
    }
  }

  private async recoverStuckEvents() {
    const now = Date.now()

    const result = await this.docClient.send(new DocQueryCommand({
      TableName: this.tableName,
      IndexName: this.statusIndexName,
      KeyConditionExpression: "#status = :status AND gsiSortKey <= :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "PROCESSING",
        ":now": now
      }
    }))

    if (result.Items) {
      for (const item of result.Items) {
        try {
          await this.docClient.send(new UpdateCommand({
            TableName: this.tableName,
            Key: { id: item.id },
            UpdateExpression: "SET #status = :pending, gsiSortKey = :now",
            ConditionExpression: "#status = :processing", 
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":pending": "PENDING",
              ":processing": "PROCESSING",
              ":now": now
            }
          }))
        } catch (e: unknown) {
          this.onError(e)
        }
      }
    }
  }

  private async processBatch(handler: (events: BusEvent[]) => Promise<void>) {
    const now = Date.now()

    const result = await this.docClient.send(new DocQueryCommand({
      TableName: this.tableName,
      IndexName: this.statusIndexName,
      KeyConditionExpression: "#status = :status AND gsiSortKey <= :now",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":status": "PENDING",
        ":now": now
      },
      Limit: this.batchSize
    }))

    if (!result.Items || result.Items.length === 0) return

    const eventsToProcess: BusEvent[] = []
    const successfulClaims: Record<string, unknown>[] = []

    for (const item of result.Items) {
      try {
        await this.docClient.send(new UpdateCommand({
          TableName: this.tableName,
          Key: { id: item.id },
          UpdateExpression: "SET #status = :processing, gsiSortKey = :timeoutAt, startedOn = :now",
          ConditionExpression: "#status = :pending",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":processing": "PROCESSING",
            ":timeoutAt": now + this.processingTimeoutMs,
            ":pending": "PENDING",
            ":now": now
          }
        }))

        eventsToProcess.push({
          id: item.id,
          type: item.type,
          payload: item.payload,
          occurredAt: new Date(item.occurredAt)
        })
        successfulClaims.push(item)
      } catch (e: unknown) {
        if (e && typeof e === 'object' && 'name' in e && e.name === "ConditionalCheckFailedException") {
          // Someone else got it, skip
        } else {
          throw e
        }
      }
    }

    if (eventsToProcess.length === 0) return

    try {
      await handler(eventsToProcess)

      for (const event of eventsToProcess) {
        await this.docClient.send(new UpdateCommand({
          TableName: this.tableName,
          Key: { id: event.id },
          UpdateExpression: "SET #status = :completed, completedOn = :now REMOVE gsiSortKey",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":completed": "COMPLETED",
            ":now": Date.now()
          }
        }))
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)

      for (const item of successfulClaims) {
        const newRetryCount = (+(item.retryCount ?? 0)) + 1

        if (newRetryCount >= this.maxRetries) {
          await this.docClient.send(new UpdateCommand({
            TableName: this.tableName,
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
            TableName: this.tableName,
            Key: { id: item.id },
            UpdateExpression: "SET #status = :pending, retryCount = :rc, lastError = :err, gsiSortKey = :nextAttempt",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":pending": "PENDING",
              ":rc": newRetryCount,
              ":err": errorMsg,
              ":nextAttempt": Date.now() + this.baseBackoffMs * 2 ** (newRetryCount - 1)
            }
          }))
        }
      }
    }
  }
}
