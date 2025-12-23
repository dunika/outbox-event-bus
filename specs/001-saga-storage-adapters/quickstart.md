# Quickstart: Saga Storage Adapters

## Redis (ioredis)

```typescript
import { Redis } from "ioredis";
import { RedisSagaStore } from "@outbox-event-bus/redis-ioredis-outbox";
import { SagaEngine } from "@outbox-event-bus/saga";

const redis = new Redis();
const sagaStore = new RedisSagaStore({ 
  redis,
  keyPrefix: "my-app:sagas" 
});

const engine = new SagaEngine({
  bus,
  registry,
  claimCheckStore: sagaStore,
  claimCheckThreshold: 50000 // 50KB
});
```

## Postgres (Prisma)

```typescript
import { PrismaClient } from "@prisma/client";
import { PrismaSagaStore } from "@outbox-event-bus/postgres-prisma-outbox";

const prisma = new PrismaClient();
const sagaStore = new PrismaSagaStore({ prisma });

// Use in engine
const engine = new SagaEngine({
  bus,
  registry,
  claimCheckStore: sagaStore
});

// Cleanup expired records (e.g., in a cron job)
await sagaStore.cleanup();
```

## Postgres (Drizzle)

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import { DrizzleSagaStore } from "@outbox-event-bus/postgres-drizzle-outbox";

const db = drizzle(...);
const sagaStore = new DrizzleSagaStore({ db });

// Cleanup expired records
await sagaStore.cleanup();
```

## SQLite (better-sqlite3)

```typescript
import Database from "better-sqlite3";
import { SqliteSagaStore } from "@outbox-event-bus/sqlite-better-sqlite3-outbox";

const db = new Database("app.db");
const sagaStore = new SqliteSagaStore({ db });

// Cleanup expired records
await sagaStore.cleanup();
```

## DynamoDB (AWS SDK v3)

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBSagaStore } from "@outbox-event-bus/dynamodb-aws-sdk-outbox";

const client = new DynamoDBClient({});
const sagaStore = new DynamoDBSagaStore({ 
  client,
  tableName: "outbox_saga_store" 
});

// TTL is handled automatically by DynamoDB
```

## MongoDB

```typescript
import { MongoClient } from "mongodb";
import { MongodbSagaStore } from "@outbox-event-bus/mongodb-outbox";

const client = new MongoClient("mongodb://localhost:27017");
const sagaStore = new MongodbSagaStore({ 
  client,
  dbName: "myapp" 
});

// Ensure TTL index is created
await sagaStore.ensureIndexes();

// TTL is handled automatically by MongoDB
```
