-- ============================================================================
--  باشگاه مشتریان کافه — ساختار دیتابیس Cloudflare D1 (SQLite)
--  اجرا روی نسخه محلی :  npm run db:init:local
--  اجرا روی نسخه ابری  :  npm run db:init:remote
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- ۱) کاربران (مشتری، کارمند، ادمین)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT    NOT NULL,
  phone              TEXT    NOT NULL UNIQUE,
  birth_date         TEXT,                                   -- قالب YYYY-MM-DD
  points             INTEGER NOT NULL DEFAULT 0,             -- موجودی امتیاز (قابل خرج)
  lifetime_points    INTEGER NOT NULL DEFAULT 0,             -- مجموع امتیازهای کسب‌شده (مبنای سطح)
  tier               TEXT    NOT NULL DEFAULT 'bronze',       -- bronze | silver | gold | vip
  referred_by        INTEGER,                                -- شناسه معرف
  referral_code      TEXT    UNIQUE,                         -- کد معرف اختصاصی این مشتری
  last_visit_date    TEXT,                                   -- آخرین خرید (ISO)
  avg_visit_interval REAL    NOT NULL DEFAULT 0,             -- میانگین فاصله خریدها (روز)
  role               TEXT    NOT NULL DEFAULT 'customer',     -- customer | staff | admin
  password_hash      TEXT,                                   -- فقط برای کارمند/ادمین
  is_active          INTEGER NOT NULL DEFAULT 1,
  first_purchase_at  TEXT,                                   -- پاداش معرف پس از اولین خرید
  referral_rewarded  INTEGER NOT NULL DEFAULT 0,
  last_churn_sms_at  TEXT,
  sms_opt_in         INTEGER NOT NULL DEFAULT 1,              -- رضایت دریافت پیامک تبلیغاتی
  token_version      INTEGER NOT NULL DEFAULT 0,              -- با تغییر رمز، نشست‌های قبلی باطل می‌شوند
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (referred_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_users_phone             ON users (phone);
CREATE INDEX IF NOT EXISTS idx_users_role              ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_referred_by       ON users (referred_by);
CREATE INDEX IF NOT EXISTS idx_users_referral_code     ON users (referral_code);
CREATE INDEX IF NOT EXISTS idx_users_last_visit_date   ON users (last_visit_date);
CREATE INDEX IF NOT EXISTS idx_users_birth_date        ON users (birth_date);
CREATE INDEX IF NOT EXISTS idx_users_created_at        ON users (created_at);

-- ----------------------------------------------------------------------------
-- ۲) فاکتورها
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  amount        INTEGER NOT NULL,                            -- مبلغ به تومان
  items         TEXT    NOT NULL DEFAULT '[]',               -- JSON آرایه آیتم‌ها
  subtotal      INTEGER NOT NULL DEFAULT 0,                  -- جمع قبل از تخفیف
  discount      INTEGER NOT NULL DEFAULT 0,                  -- مبلغ تخفیف
  coupon_code   TEXT,                                        -- کد تخفیف استفاده‌شده
  points_earned INTEGER NOT NULL DEFAULT 0,
  visit_day     TEXT,                                        -- روز شمسی/میلادی تهران برای امتیاز «هر روز یک‌بار»
  client_request_id TEXT,                                    -- جلوگیری از ثبت تکراری فاکتور
  voided_at     TEXT,                                        -- زمان ابطال (NULL = معتبر)
  voided_by     INTEGER,
  void_reason   TEXT,                                        -- دلیل ابطال (برای حسابرسی)
  payment_method TEXT,                                       -- cash | card | online | mixed (NULL = فاکتور قدیمی)
  paid_cash     INTEGER NOT NULL DEFAULT 0,                  -- نقد مؤثر در صندوق (بدون باقیمانده)
  paid_card     INTEGER NOT NULL DEFAULT 0,                  -- کارت‌خوان
  paid_online   INTEGER NOT NULL DEFAULT 0,                  -- پرداخت آنلاین/لینک
  change_amount INTEGER NOT NULL DEFAULT 0,                  -- باقیمانده‌ای که به مشتری برگشت
  shift_id      INTEGER,                                     -- شیفت صندوق مرتبط
  replaces_invoice_id INTEGER,                               -- اگر اصلاح فاکتور قبلی است
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  registered_by INTEGER,
  FOREIGN KEY (user_id)       REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (registered_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invoices_user_id    ON invoices (user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices (created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_voided     ON invoices (voided_at);
CREATE INDEX IF NOT EXISTS idx_invoices_payment    ON invoices (payment_method, created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_shift      ON invoices (shift_id);
CREATE INDEX IF NOT EXISTS idx_invoices_staff_day  ON invoices (registered_by, created_at);

-- امتیاز «یک‌بار در روز» فقط برای یک فاکتور در هر روز معتبر است
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_visit_day
  ON invoices (user_id, visit_day) WHERE visit_day IS NOT NULL;

-- هر درخواست ثبت فاکتور تنها یک‌بار اعمال می‌شود
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_client_request
  ON invoices (client_request_id) WHERE client_request_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- ۳) تنظیمات (کلید/مقدار — مقدار به صورت JSON ذخیره می‌شود)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- ۴) لاگ پیامک‌ها
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER,
  type            TEXT    NOT NULL,   -- welcome | invoice | birthday | churn | weather | referral
  status          TEXT    NOT NULL,   -- sent | failed | skipped
  message         TEXT,
  provider_id     TEXT,
  error           TEXT,
  sent_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_user_id ON sms_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_type    ON sms_logs (type, sent_at);

-- ----------------------------------------------------------------------------
-- ۵) کدهای تخفیف (تولد، پاداش معرف و ...)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  user_id     INTEGER,
  kind        TEXT    NOT NULL DEFAULT 'percent',            -- percent | amount
  value       INTEGER NOT NULL DEFAULT 0,
  reason      TEXT    NOT NULL DEFAULT 'birthday',
  max_uses    INTEGER NOT NULL DEFAULT 1,
  used_count  INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coupons_user_id ON coupons (user_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code    ON coupons (code);

-- ----------------------------------------------------------------------------
-- ۶) کدهای یک‌بارمصرف ورود مشتری (OTP)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT    NOT NULL,
  code_hash   TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON otp_codes (phone, created_at);

-- ----------------------------------------------------------------------------
-- ۷) محدودسازی نرخ درخواست (مشترک بین همه ایزوله‌ها)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limits (
  key       TEXT PRIMARY KEY,
  count     INTEGER NOT NULL DEFAULT 0,
  reset_at  TEXT    NOT NULL
);

-- ============================================================================
--  شیفت صندوق (باز/بسته کردن صندوق و کنترل نقدینگی)
-- ============================================================================
CREATE TABLE IF NOT EXISTS shifts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id          INTEGER,
  staff_name        TEXT    NOT NULL,
  opened_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  closed_at         TEXT,
  opening_cash      INTEGER NOT NULL DEFAULT 0,   -- مبلغ اولیهٔ صندوق
  counted_cash      INTEGER,                      -- مبلغ شمارش‌شده در پایان
  expected_cash     INTEGER,                      -- مبلغ مورد انتظار (محاسبه‌شده)
  difference        INTEGER,                      -- اختلاف (شمارش − انتظار)
  status            TEXT    NOT NULL DEFAULT 'open', -- open | closed
  closed_by         INTEGER,
  closed_by_name    TEXT,
  notes             TEXT,
  invoice_count     INTEGER NOT NULL DEFAULT 0,   -- عکس لحظهٔ بستن (برای حسابرسی)
  cash_sales        INTEGER NOT NULL DEFAULT 0,
  card_sales        INTEGER NOT NULL DEFAULT 0,
  online_sales      INTEGER NOT NULL DEFAULT 0,
  total_sales       INTEGER NOT NULL DEFAULT 0,
  void_count        INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (staff_id)  REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (closed_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts (status, opened_at);
CREATE INDEX IF NOT EXISTS idx_shifts_staff  ON shifts (staff_id, opened_at);

-- هر کارمند فقط یک صندوق باز می‌تواند داشته باشد
CREATE UNIQUE INDEX IF NOT EXISTS ux_shifts_open_staff
  ON shifts (staff_id) WHERE status = 'open' AND staff_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cash_movements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id   INTEGER NOT NULL,
  kind       TEXT    NOT NULL,                    -- in (دریافت نقد) | out (پرداخت نقد)
  amount     INTEGER NOT NULL,
  reason     TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER,
  FOREIGN KEY (shift_id) REFERENCES shifts (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON cash_movements (shift_id, created_at);

-- ============================================================================
--  گزارش اقدامات مدیران (ردپای تغییرات حساس)
-- ============================================================================
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
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action);

-- ============================================================================
--  داده‌های اولیه
-- ============================================================================

-- ادمین پیش‌فرض  |  شماره: 09120000000  |  رمز عبور: Admin@12345
-- ⚠️ بلافاصله پس از اولین ورود، رمز عبور را از بخش «مدیریت کارمندان» تغییر دهید.
INSERT INTO users (name, phone, role, is_active, password_hash)
VALUES (
  'مدیر باشگاه',
  '09120000000',
  'admin',
  1,
  'pbkdf2$25000$2qmBxvUUUsoHnkNI8TJ0sQ==$0h0jweqD5x5UfV/MM+J/1FGvBKYuW5TXAqLmW+9+tGs='
)
ON CONFLICT (phone) DO NOTHING;

-- کارمند نمونه  |  شماره: 09120000001  |  رمز عبور: Staff@12345
-- (در صورت نیاز از داشبورد ادمین غیرفعال یا حذف کنید)
-- هش رمز: برای ساخت هش جدید از «npm run hash-password 'YourPassword'» استفاده کنید.
INSERT INTO users (name, phone, role, is_active, password_hash)
VALUES (
  'کارمند نمونه',
  '09120000001',
  'staff',
  1,
  'pbkdf2$25000$WGzL3eKGGQiLplcEmrJL+Q==$EM2ACxk1AoH2M0BuNE7ULuQfjeJsgl3FzFRHArKb9Zk='
)
ON CONFLICT (phone) DO NOTHING;

-- تنظیمات پیش‌فرض -------------------------------------------------------------
INSERT INTO settings (key, value) VALUES
  ('sms_templates', '{
      "welcome": "سلام {name} عزیز 🌟\nبه باشگاه مشتریان کافه خوش آمدید!\nبا هر خرید امتیاز جمع کنید و از تخفیف‌های ویژه بهره‌مند شوید.",
      "invoice": "{name} عزیز، خرید شما به مبلغ {amount} تومان ثبت شد و {points} امتیاز به حساب شما اضافه شد. موجودی: {total_points} امتیاز. سطح: {tier} ☕",
      "birthday": "{name} عزیز، تولدت مبارک 🎂\nبه مناسبت تولدت این کد تخفیف هدیه ما به توست: {coupon}\nمنتظر دیدارت هستیم.",
      "churn": "{name} عزیز، دلمان برایت تنگ شده ☕\n{last_visit} روز از آخرین دیدارمان گذشته؛ با این پیامک ۱۰٪ تخفیف روی فاکتور بعدی مهمان ما باش.",
      "weather": "سلام {name}، هوای امروز {city}: {weather} و {temp} درجه است. {advice} ☕"
    }'),
  ('points_per_currency', '1'),
  ('currency_unit', '1000'),
  ('tiers', '{
      "silver": 500,
      "gold": 2000,
      "vip": 5000
    }'),
  ('cafe_name', '"کافه ملت"'),
  ('cafe_city', '"تهران"'),
  ('weather_api_key', '""'),
  ('sms_provider', '"console"'),
  ('sms_api_key', '""'),
  ('sms_sender', '""'),
  ('referral_reward_points', '50'),
  ('churn_grace_days', '2'),
  ('churn_min_visits', '3'),
  ('birthday_coupon_percent', '15')
ON CONFLICT (key) DO NOTHING;

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
