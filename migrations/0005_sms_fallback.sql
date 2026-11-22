-- Additive / idempotent: no changes to existing invoices, users or SMS history.
-- Sensitive payload is AES-GCM encrypted; token is never copied to jobs.
CREATE TABLE IF NOT EXISTS fallback_jobs (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK(channel IN ('telegram','bale')),
  chat_id TEXT NOT NULL,
  user_id INTEGER,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  locked_at INTEGER,
  provider_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_fallback_jobs_due ON fallback_jobs(status,next_at);
CREATE INDEX IF NOT EXISTS idx_fallback_jobs_created ON fallback_jobs(created_at DESC);
CREATE TABLE IF NOT EXISTS fallback_dispatch (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  until_ms INTEGER NOT NULL DEFAULT 0,
  owner TEXT
);
INSERT OR IGNORE INTO fallback_dispatch(id,until_ms) VALUES(1,0);
CREATE TABLE IF NOT EXISTS fallback_channel_limits (
  channel TEXT PRIMARY KEY CHECK(channel IN ('telegram','bale')),
  until_ms INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO fallback_channel_limits(channel,until_ms) VALUES('telegram',0),('bale',0);
