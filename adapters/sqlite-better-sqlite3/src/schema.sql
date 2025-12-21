CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TEXT,
  created_on TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_on TEXT,
  completed_on TEXT,
  keep_alive TEXT,
  expire_in_seconds INTEGER NOT NULL DEFAULT 300
);

CREATE TABLE IF NOT EXISTS outbox_events_archive (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL,
  last_error TEXT,
  created_on TEXT NOT NULL,
  started_on TEXT,
  completed_on TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_status_retry ON outbox_events (status, next_retry_at);
