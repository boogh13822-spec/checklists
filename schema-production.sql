CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT    NOT NULL,
  phone              TEXT    NOT NULL UNIQUE,
  nickname           TEXT NOT NULL DEFAULT '',
  permissions        TEXT DEFAULT NULL,
  staff_role         TEXT DEFAULT NULL,                      
  staff_active       INTEGER NOT NULL DEFAULT 1,              
  birth_date         TEXT,                                   
  points             INTEGER NOT NULL DEFAULT 0,             
  lifetime_points    INTEGER NOT NULL DEFAULT 0,             
  tier               TEXT    NOT NULL DEFAULT 'bronze',       
  referred_by        INTEGER,                                
  referral_code      TEXT    UNIQUE,                         
  last_visit_date    TEXT,                                   
  avg_visit_interval REAL    NOT NULL DEFAULT 0,             
  role               TEXT    NOT NULL DEFAULT 'customer',     
  password_hash      TEXT,                                   
  is_active          INTEGER NOT NULL DEFAULT 1,
  first_purchase_at  TEXT,                                   
  referral_rewarded  INTEGER NOT NULL DEFAULT 0,
  last_churn_sms_at  TEXT,
  sms_opt_in         INTEGER NOT NULL DEFAULT 1,              
  token_version      INTEGER NOT NULL DEFAULT 0,              
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (referred_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  amount        INTEGER NOT NULL,                            
  items         TEXT    NOT NULL DEFAULT '[]',               
  subtotal      INTEGER NOT NULL DEFAULT 0,                  
  discount      INTEGER NOT NULL DEFAULT 0,                  
  coupon_code   TEXT,                                        
  points_earned INTEGER NOT NULL DEFAULT 0,
  visit_day     TEXT,                                        
  client_request_id TEXT,                                    
  voided_at     TEXT,                                        
  voided_by     INTEGER,
  void_reason   TEXT,                                        
  payment_method TEXT,                                       
  paid_cash     INTEGER NOT NULL DEFAULT 0,                  
  paid_card     INTEGER NOT NULL DEFAULT 0,                  
  paid_online   INTEGER NOT NULL DEFAULT 0,                  
  change_amount INTEGER NOT NULL DEFAULT 0,                  
  shift_id      INTEGER,                                     
  replaces_invoice_id INTEGER,                               
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  registered_by INTEGER,
  FOREIGN KEY (user_id)       REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (registered_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sms_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER,
  type            TEXT    NOT NULL,   
  status          TEXT    NOT NULL,   
  message         TEXT,
  provider_id     TEXT,
  fallback_ids    TEXT NOT NULL DEFAULT '[]',
  delivery_kind   TEXT NOT NULL DEFAULT 'legacy',
  error           TEXT,
  sent_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS coupons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  user_id     INTEGER,
  kind        TEXT    NOT NULL DEFAULT 'percent',            
  value       INTEGER NOT NULL DEFAULT 0,
  reason      TEXT    NOT NULL DEFAULT 'birthday',
  max_uses    INTEGER NOT NULL DEFAULT 1,
  used_count  INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT    NOT NULL,
  code_hash   TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key       TEXT PRIMARY KEY,
  count     INTEGER NOT NULL DEFAULT 0,
  reset_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id          INTEGER,
  staff_name        TEXT    NOT NULL,
  opened_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  closed_at         TEXT,
  opening_cash      INTEGER NOT NULL DEFAULT 0,   
  counted_cash      INTEGER,                      
  expected_cash     INTEGER,                      
  difference        INTEGER,                      
  status            TEXT    NOT NULL DEFAULT 'open', 
  closed_by         INTEGER,
  closed_by_name    TEXT,
  notes             TEXT,
  invoice_count     INTEGER NOT NULL DEFAULT 0,   
  cash_sales        INTEGER NOT NULL DEFAULT 0,
  card_sales        INTEGER NOT NULL DEFAULT 0,
  online_sales      INTEGER NOT NULL DEFAULT 0,
  total_sales       INTEGER NOT NULL DEFAULT 0,
  void_count        INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (staff_id)  REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (closed_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id   INTEGER NOT NULL,
  kind       TEXT    NOT NULL,                    
  amount     INTEGER NOT NULL,
  reason     TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER,
  FOREIGN KEY (shift_id) REFERENCES shifts (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  admin_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fallback_jobs (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK(channel IN ('telegram','bale')),
  chat_id TEXT NOT NULL,
  user_id INTEGER,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  handoff_key TEXT,
  manual_sent_at TEXT,
  manual_sent_by INTEGER,
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

CREATE TABLE IF NOT EXISTS fallback_dispatch (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  until_ms INTEGER NOT NULL DEFAULT 0,
  owner TEXT
);

CREATE TABLE IF NOT EXISTS fallback_channel_limits (
  channel TEXT PRIMARY KEY CHECK(channel IN ('telegram','bale')),
  until_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS operation_assertions (
  valid INTEGER NOT NULL CHECK(valid = 1)
);

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

CREATE TABLE IF NOT EXISTS campaign_issues (
  job TEXT NOT NULL,
  day TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(job,day,user_id)
);

CREATE INDEX IF NOT EXISTS idx_users_phone             ON users (phone);

CREATE INDEX IF NOT EXISTS idx_users_role              ON users (role);

CREATE INDEX IF NOT EXISTS idx_users_referred_by       ON users (referred_by);

CREATE INDEX IF NOT EXISTS idx_users_referral_code     ON users (referral_code);

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_referral_code ON users (referral_code) WHERE referral_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_last_visit_date   ON users (last_visit_date);

CREATE INDEX IF NOT EXISTS idx_users_birth_date        ON users (birth_date);

CREATE INDEX IF NOT EXISTS idx_users_created_at        ON users (created_at);

CREATE INDEX IF NOT EXISTS idx_invoices_user_id    ON invoices (user_id);

CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices (created_at);

CREATE INDEX IF NOT EXISTS idx_invoices_voided     ON invoices (voided_at);

CREATE INDEX IF NOT EXISTS idx_invoices_payment    ON invoices (payment_method, created_at);

CREATE INDEX IF NOT EXISTS idx_invoices_shift      ON invoices (shift_id);

CREATE INDEX IF NOT EXISTS idx_invoices_staff_day  ON invoices (registered_by, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_visit_day
  ON invoices (user_id, visit_day) WHERE visit_day IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_client_request
  ON invoices (client_request_id) WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sms_logs_user_id ON sms_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_sms_logs_type    ON sms_logs (type, sent_at);

CREATE INDEX IF NOT EXISTS idx_coupons_user_id ON coupons (user_id);

CREATE INDEX IF NOT EXISTS idx_coupons_code    ON coupons (code);

CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON otp_codes (phone, created_at);

CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts (status, opened_at);

CREATE INDEX IF NOT EXISTS idx_shifts_staff  ON shifts (staff_id, opened_at);

CREATE UNIQUE INDEX IF NOT EXISTS ux_shifts_open_staff
  ON shifts (staff_id) WHERE status = 'open' AND staff_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON cash_movements (shift_id, created_at);

CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action);

CREATE INDEX IF NOT EXISTS idx_fallback_jobs_due ON fallback_jobs(status,next_at);

CREATE INDEX IF NOT EXISTS idx_fallback_jobs_created ON fallback_jobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fallback_handoff ON fallback_jobs(handoff_key,manual_sent_at);

CREATE INDEX IF NOT EXISTS idx_invoice_receipts_due ON invoice_receipts(status,until_ms);
INSERT OR IGNORE INTO fallback_dispatch(id,until_ms) VALUES(1,0);
INSERT OR IGNORE INTO fallback_channel_limits(channel,until_ms) VALUES('telegram',0),('bale',0);
