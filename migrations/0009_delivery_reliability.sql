-- Additive upgrade from v8. No customer/financial data rewritten.
CREATE TABLE IF NOT EXISTS invoice_receipts (
  invoice_id INTEGER PRIMARY KEY REFERENCES invoices(id),
  status TEXT NOT NULL DEFAULT 'pending',
  owner TEXT,
  until_ms INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoice_receipts_due ON invoice_receipts(status,until_ms);
CREATE TABLE IF NOT EXISTS campaign_issues (
  job TEXT NOT NULL,
  day TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(job,day,user_id)
);
