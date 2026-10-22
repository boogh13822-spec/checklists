#!/usr/bin/env bash
# =============================================================================
#  مایگریشن دیتابیس «باشگاه مشتریان کافه» (D1)
# -----------------------------------------------------------------------------
#  این اسکریپت ساختار دیتابیس را با نسخهٔ فعلی کد هم‌تراز می‌کند، بدون این‌که
#  داده‌ای را پاک کند. همهٔ دستورها تکرارپذیر (idempotent) هستند: بار دوم که
#  اجرا شوند خطا نمی‌دهند و چیزی را خراب نمی‌کنند.
#
#  طرز استفاده:
#      bash scripts/migrate.sh              # نسخهٔ محلی (توسعه)
#      bash scripts/migrate.sh --remote     # دیتابیس ابری Cloudflare
#      bash scripts/migrate.sh --remote cafe-club-db
#
#  کاری که می‌کند:
#    ۱) جدول‌های جدید را می‌سازد (کد ورود، محدودسازی نرخ، گزارش اقدامات مدیران)
#    ۲) ستون‌های جدید جدول‌های موجود را اضافه می‌کند
#    ۳) ایندکس‌ها را می‌سازد
#    ۴) ستون lifetime_points را برای داده‌های قدیمی پر می‌کند
#
#  ⚠️ پیش از اجرا روی نسخهٔ ابری، بکاپ بگیرید:
#      npx wrangler d1 export cafe-club-db --remote --output backup-$(date +%F).sql
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

MODE="--local"
DB_NAME=""

for arg in "$@"; do
  case "$arg" in
    --remote) MODE="--remote" ;;
    --local)  MODE="--local" ;;
    -*)       ;;
    *)        DB_NAME="$arg" ;;
  esac
done

DB_NAME="${DB_NAME:-${DB_NAME_ENV:-cafe-club-db}}"

info() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js نصب نیست."
command -v npm  >/dev/null 2>&1 || die "npm نصب نیست."

WRANGLER=(npx --yes wrangler)

# یک دستور SQL را اجرا می‌کند؛ اگر از قبل اعمال شده باشد، فقط اطلاع می‌دهد.
APPLIED=0
SKIPPED=0
FAILED=0

apply() {
  local sql="$1"
  local label="$2"
  local out
  if out="$("${WRANGLER[@]}" d1 execute "$DB_NAME" "$MODE" --command "$sql" 2>&1)"; then
    APPLIED=$((APPLIED + 1))
    ok "$label"
  else
    if printf '%s' "$out" | grep -qiE "duplicate column|already exists|UNIQUE constraint failed: sqlite_master"; then
      SKIPPED=$((SKIPPED + 1))
      printf '   • %s (از قبل موجود بود)\n' "$label"
    else
      FAILED=$((FAILED + 1))
      printf '   ✘ %s\n' "$label"
      printf '%s\n' "$out" | tail -5 | sed 's/^/     /'
    fi
  fi
}

info "مایگریشن دیتابیس «$DB_NAME» ($MODE)"

# --- ۱) جدول‌های جدید ---------------------------------------------------------
apply "CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)" "جدول کدهای ورود مشتری (otp_codes)"

apply "CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON otp_codes (phone, created_at)" \
  "ایندکس کدهای ورود"

apply "CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TEXT NOT NULL
)" "جدول محدودسازی نرخ (rate_limits)"

apply "CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  admin_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)" "جدول گزارش اقدامات مدیران (admin_logs)"

apply "CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC)" \
  "ایندکس زمان گزارش اقدامات"

apply "CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action)" \
  "ایندکس نوع گزارش اقدامات"

# --- ۲) ستون‌های جدید users ---------------------------------------------------
apply "ALTER TABLE users ADD COLUMN lifetime_points INTEGER NOT NULL DEFAULT 0" \
  "ستون lifetime_points (مبنای سطح)"

apply "ALTER TABLE users ADD COLUMN sms_opt_in INTEGER NOT NULL DEFAULT 1" \
  "ستون sms_opt_in (رضایت پیامک)"

apply "ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0" \
  "ستون token_version (ابطال نشست)"

# --- ۳) ستون‌های جدید invoices ------------------------------------------------
apply "ALTER TABLE invoices ADD COLUMN visit_day TEXT" \
  "ستون visit_day (روز امتیاز حضور)"

apply "ALTER TABLE invoices ADD COLUMN client_request_id TEXT" \
  "ستون client_request_id (ضد ثبت تکراری)"

apply "ALTER TABLE invoices ADD COLUMN voided_at TEXT" \
  "ستون voided_at (ابطال فاکتور)"

apply "ALTER TABLE invoices ADD COLUMN voided_by INTEGER" \
  "ستون voided_by (ابطان فاکتور)"

# --- ۴) ایندکس‌ها -------------------------------------------------------------
apply "CREATE INDEX IF NOT EXISTS idx_invoices_voided ON invoices (voided_at)" \
  "ایندکس فاکتورهای باطل‌شده"

apply "CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_visit_day
  ON invoices (user_id, visit_day) WHERE visit_day IS NOT NULL" \
  "ایندکس یکتا: یک امتیاز حضور در هر روز"

apply "CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_client_request
  ON invoices (client_request_id) WHERE client_request_id IS NOT NULL" \
  "ایندکس یکتا: هر درخواست یک فاکتور"

# --- ۵) پر کردن داده‌های قدیمی ------------------------------------------------
apply "UPDATE users SET lifetime_points = points WHERE lifetime_points = 0 AND points > 0" \
  "هم‌تراز کردن lifetime_points با امتیاز فعلی مشتریان قدیمی"

printf '\n────────────────────────────────────────────────────────────\n'
printf 'اعمال‌شده: %d   از قبل موجود: %d   خطا: %d\n' "$APPLIED" "$SKIPPED" "$FAILED"

if [[ "$FAILED" -gt 0 ]]; then
  printf '\033[1;31m✘ بعضی مراحل خطا دادند؛ خروجی بالا را بررسی کنید.\033[0m\n'
  exit 1
fi

if [[ "$MODE" == "--remote" ]]; then
  printf '✅ ساختار دیتابیس ابری به‌روز است.\n'
else
  printf '✅ ساختار دیتابیس محلی به‌روز است.\n'
fi
printf '────────────────────────────────────────────────────────────\n'
