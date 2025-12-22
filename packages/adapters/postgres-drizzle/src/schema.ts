import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const outboxStatusEnum = pgEnum("outbox_status", [
  "created",
  "active",
  "completed",
  "failed",
])

export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  occurredAt: timestamp("occurred_at").notNull(),
  status: outboxStatusEnum("status").notNull().default("created"),
  retryCount: integer("retry_count").notNull().default(0),
  lastError: text("last_error"),
  nextRetryAt: timestamp("next_retry_at"),
  createdOn: timestamp("created_on").notNull().defaultNow(),
  startedOn: timestamp("started_on"),
  completedOn: timestamp("completed_on"),
  keepAlive: timestamp("keep_alive"),
  expireInSeconds: integer("expire_in_seconds").notNull().default(300),
})

export const outboxEventsArchive = pgTable("outbox_events_archive", {
  id: uuid("id").primaryKey(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  occurredAt: timestamp("occurred_at").notNull(),
  status: outboxStatusEnum("status").notNull(),
  retryCount: integer("retry_count").notNull(),
  lastError: text("last_error"),
  createdOn: timestamp("created_on").notNull(),
  startedOn: timestamp("started_on"),
  completedOn: timestamp("completed_on").notNull(),
})
