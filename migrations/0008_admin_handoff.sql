
-- Internal transactional assertions. Successful operations never insert a row.
CREATE TABLE IF NOT EXISTS operation_assertions (
  valid INTEGER NOT NULL CHECK(valid = 1)
);

ALTER TABLE fallback_jobs ADD COLUMN handoff_key TEXT;
ALTER TABLE fallback_jobs ADD COLUMN manual_sent_at TEXT;
ALTER TABLE fallback_jobs ADD COLUMN manual_sent_by INTEGER;


CREATE TABLE IF NOT EXISTS campaign_progress (
  job TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  queued INTEGER NOT NULL DEFAULT 0,
  scanned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  context TEXT,
  until_ms INTEGER NOT NULL DEFAULT 0,
  owner TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fallback_handoff ON fallback_jobs(handoff_key,manual_sent_at);
