#!/usr/bin/env bash
# =============================================================================
#  نجات حساب مدیر (Rescue Admin)
# -----------------------------------------------------------------------------
#  اگر نمی‌توانید وارد پنل شوید (رمز را فراموش کرده‌اید، حساب غیرفعال شده،
#  نقش حساب تغییر کرده یا حساب پاک شده است) این اسکریپت حساب را بازمی‌گرداند.
#
#  طرز استفاده:
#      bash scripts/rescue-admin.sh
#          → حساب پیش‌فرض 09120000000 را با یک رمز قوی تصادفی بازنشانی می‌کند
#
#      bash scripts/rescue-admin.sh 09121234567
#          → همان کار برای شمارهٔ دلخواه
#
#      bash scripts/rescue-admin.sh 09121234567 'MyPass@1404'
#          → با رمز دلخواه خودتان
#
#      bash scripts/rescue-admin.sh 09120000000 'MyPass@1404' --local
#          → روی دیتابیس محلی (wrangler dev) به‌جای نسخهٔ ابری
#
#  این اسکریپت:
#    • رمز را با همان الگوریتم برنامه (PBKDF2-SHA256، ۲۵٬۰۰۰ دور) می‌سازد
#    • نقش را admin و حساب را فعال می‌کند
#    • اگر شماره وجود نداشته باشد، حساب مدیر جدید می‌سازد
#    • در پایان، وضعیت نهایی ردیف را از دیتابیس نشان می‌دهد
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

DB_NAME="${DB_NAME:-cafe-club-db}"
SCOPE_FLAG="--remote"
PHONE=""
PASSWORD=""
NAME="مدیر باشگاه"

# --- خواندن آرگومان‌ها -------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --local)   SCOPE_FLAG="--local" ;;
    --remote)  SCOPE_FLAG="--remote" ;;
    --help|-h)
      sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      if [[ -z "$PHONE" && "$arg" =~ ^0?9[0-9]{9}$ ]]; then
        PHONE="$arg"
      elif [[ -z "$PASSWORD" ]]; then
        PASSWORD="$arg"
      else
        printf '✘ آرگومان ناشناخته: %s\n' "$arg" >&2
        exit 1
      fi
      ;;
  esac
done

PHONE="${PHONE:-09120000000}"

# --- بررسی‌های اولیه ---------------------------------------------------------
command -v node >/dev/null 2>&1 || { printf '✘ Node.js نصب نیست.\n' >&2; exit 1; }
[[ -f wrangler.toml ]] || { printf '✘ wrangler.toml پیدا نشد؛ از ریشهٔ پروژه اجرا کنید.\n' >&2; exit 1; }

if ! [[ "$PHONE" =~ ^09[0-9]{9}$ ]]; then
  printf '✘ شماره موبایل معتبر نیست: %s (باید با ۰۹ شروع شود و ۱۱ رقم باشد)\n' "$PHONE" >&2
  exit 1
fi

# --- ساخت رمز در صورت لازم ---------------------------------------------------
IFS= read -r -d '' NODE_HELPER <<'NODE' || true
const crypto = require('crypto');
const phone = process.argv[1];
const passwordIn = process.argv[2] || '';
const name = process.argv[3];

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^&*-_+=';
let password = passwordIn;
if (!password) {
  const bytes = crypto.randomBytes(18);
  password = '';
  for (let i = 0; i < bytes.length; i += 1) password += alphabet[bytes[i] % alphabet.length];
}
if (password.length < 8) {
  console.error('PASSWORD_TOO_SHORT');
  process.exit(2);
}

const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(password, salt, 25000, 32, 'sha256');
const stored = 'pbkdf2$25000$' + salt.toString('base64') + '$' + hash.toString('base64');

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const cb = crypto.randomBytes(6);
let code = 'REF-';
for (let i = 0; i < cb.length; i += 1) code += codeAlphabet[cb[i] % codeAlphabet.length];

const esc = (v) => String(v).replace(/'/g, "''");

const sql = [
  `INSERT INTO users (name, phone, role, is_active, password_hash, referral_code)`,
  `SELECT '${esc(name)}', '${esc(phone)}', 'admin', 1, '${stored}', '${code}'`,
  `WHERE NOT EXISTS (SELECT 1 FROM users WHERE phone = '${esc(phone)}');`,
  ``,
  `UPDATE users`,
  `   SET password_hash = '${stored}',`,
  `       role = 'admin',`,
  `       is_active = 1`,
  ` WHERE phone = '${esc(phone)}';`,
  ``,
].join('\n');

process.stdout.write(JSON.stringify({ password, sql }) + '\n');
NODE

RESULT="$(node -e "$NODE_HELPER" "$PHONE" "$PASSWORD" "$NAME")" || {
  printf '✘ ساخت هش رمز ناموفق بود (رمز باید حداقل ۸ کاراکتر باشد).\n' >&2
  exit 1
}

NEW_PASSWORD="$(printf '%s' "$RESULT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).password))')"
SQL="$(printf '%s' "$RESULT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).sql))')"

TMP_SQL="$(mktemp "${TMPDIR:-/tmp}/rescue-admin-XXXXXX.sql")"
cleanup() { rm -f "$TMP_SQL"; }
trap cleanup EXIT INT TERM

printf '%s\n' "$SQL" > "$TMP_SQL"

# --- اجرای SQL ---------------------------------------------------------------
printf '\033[1;36m▸ شماره: %s\033[0m\n' "$PHONE"
printf '\033[1;36m▸ دیتابیس: %s (%s)\033[0m\n' "$DB_NAME" "${SCOPE_FLAG#--}"
printf '\033[1;36m▸ بازنشانی رمز و تنظیم نقش مدیر…\033[0m\n'

if [[ "$SCOPE_FLAG" == "--remote" ]]; then
  DB_LIST="$(npx --yes wrangler d1 list --json 2>/dev/null || true)"
  # اگر فهرست خوانده نشد (مثلاً هنوز login نکرده‌اید)، بررسی را رد می‌کنیم تا
  # خطای واقعی wrangler در مرحلهٔ اجرا دیده شود.
  if [[ -n "$DB_LIST" ]] && ! printf '%s' "$DB_LIST" | grep -q "\"$DB_NAME\""; then
    printf '\033[1;31m✘ دیتابیس «%s» روی Cloudflare پیدا نشد.\033[0m\n' "$DB_NAME" >&2
    printf '  دیتابیس‌های موجود:\n' >&2
    printf '%s' "$DB_LIST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s).forEach(x=>console.log("   -",x.name,"("+(x.uuid||x.database_id||"")+")"))}catch(e){}})' >&2 || true
    printf '  نام درست را این‌طور بدهید:\n' >&2
    printf '      DB_NAME="نام-دیتابیس" bash scripts/rescue-admin.sh %s\n' "$PHONE" >&2
    exit 1
  fi
fi

npx --yes wrangler d1 execute "$DB_NAME" "$SCOPE_FLAG" --file="$TMP_SQL" >/tmp/rescue-admin.log 2>&1 || {
  printf '✘ اجرای دستور روی دیتابیس ناموفق بود. خروجی:\n' >&2
  tail -20 /tmp/rescue-admin.log >&2
  exit 1
}

# --- نمایش نتیجه -------------------------------------------------------------
printf '\033[1;36m▸ بررسی وضعیت نهایی…\033[0m\n'
npx --yes wrangler d1 execute "$DB_NAME" "$SCOPE_FLAG" --json \
  --command "SELECT id, name, phone, role, is_active FROM users WHERE phone = '$PHONE';" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try {
        const rows = JSON.parse(s)[0].results || [];
        for (const r of rows) {
          console.log("   id=" + r.id + "  phone=" + r.phone + "  role=" + r.role + "  active=" + r.is_active);
        }
        if (!rows.length) console.log("   (ردیفی پیدا نشد)");
      } catch (e) {}
    })' || true

cat <<EOF

────────────────────────────────────────────────────────────
✅ حساب مدیر آماده است.

   شماره موبایل : $PHONE
   رمز عبور     : $NEW_PASSWORD

   آدرس ورود    : /login
   (روی نسخهٔ ابری: https://<آدرس-ورکر>/login)

⚠️ این رمز را همین حالا جایی امن ذخیره کنید و بعد از ورود،
   از «کارمندان → تغییر رمز عبور خودم» آن را عوض کنید.
────────────────────────────────────────────────────────────
EOF
