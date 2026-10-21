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
  points             INTEGER NOT NULL DEFAULT 0,
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
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  registered_by INTEGER,
  FOREIGN KEY (user_id)       REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (registered_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invoices_user_id    ON invoices (user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices (created_at);

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
