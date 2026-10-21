#!/usr/bin/env bash
# =============================================================================
#  دیپلوی خودکار «باشگاه مشتریان کافه» روی Cloudflare Workers
# -----------------------------------------------------------------------------
#  طرز استفاده:
#      bash scripts/deploy.sh
#
#  این اسکریپت به‌ترتیب انجام می‌دهد:
#    ۱) بررسی این‌که در ریشهٔ درست پروژه هستید (wrangler.toml / schema.sql / src)
#    ۲) نصب پکیج‌ها (npm install) اگر node_modules وجود نداشته باشد
#    ۳) ورود به حساب Cloudflare (wrangler login) در صورت نیاز
#    ۴) ساخت دیتابیس D1 با نام cafe-club-db (اگر از قبل نباشد)
#    ۵) گذاشتن database_id واقعی داخل wrangler.toml
#    ۶) اجرای schema.sql روی دیتابیس ابری
#    ۷) ساخت JWT_SECRET (تصادفی و امن) و ذخیره به‌عنوان Secret
#       — اگر از قبل تنظیم شده باشد، دست نمی‌خورد (وگرنه همه از حساب خارج می‌شدند)
#    ۸) دیپلوی نهایی
#
#  متغیرهای اختیاری:
#      JWT_SECRET="..."   از این مقدار به‌جای ساخت تصادفی استفاده می‌کند
#      DB_NAME="..."      نام دیتابیس (پیش‌فرض: cafe-club-db)
#      DRY_RUN=1          فقط بررسی‌ها را انجام می‌دهد و چیزی را تغییر نمی‌دهد
#      ROTATE_SECRET=1    JWT_SECRET موجود را عمداً با مقدار تازه جایگزین می‌کند
# =============================================================================
set -euo pipefail

# --- رفتن به ریشهٔ پروژه (پوشهٔ والدِ همین اسکریپت) --------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

DB_NAME="${DB_NAME:-cafe-club-db}"
DRY_RUN="${DRY_RUN:-0}"

info()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()   { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }
run()   {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '   [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# --- ۰) پیش‌نیازها ------------------------------------------------------------
command -v node >/dev/null 2>&1 || die "Node.js نصب نیست. از https://nodejs.org نسخهٔ ۱۸ یا بالاتر را نصب کنید."
command -v npm  >/dev/null 2>&1 || die "npm نصب نیست (همراه Node.js نصب می‌شود)."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 18 ]] || die "نسخهٔ Node.js شما $NODE_MAJOR است؛ حداقل ۱۸ لازم است."

# --- ۱) بررسی ساختار پروژه ---------------------------------------------------
info "بررسی فایل‌های پروژه در: $PROJECT_ROOT"
MISSING=0
for f in wrangler.toml schema.sql package.json src/index.ts; do
  if [[ -f "$f" ]]; then
    ok "پیدا شد: $f"
  else
    warn "پیدا نشد: $f"
    MISSING=1
  fi
done

if [[ "$MISSING" == "1" ]]; then
  cat >&2 <<'EOF'

✘ فای‌های پروژه در این پوشه نیستند؛ به همین دلیل خطاهای
   «Unable to read SQL text file "schema.sql"» و
   «Required Worker name missing»
   رخ می‌دهد. این دو خطا یعنی دستور از پوشهٔ اشتباه اجرا شده است
   (wrangler.toml و schema.sql باید در همان پوشه‌ای باشند که دستور را می‌زنید).

راه‌حل: پروژه را از شاخهٔ درست دریافت کنید:

  git clone -b arena/ba9e1761-checklists https://github.com/boogh13822-spec/checklists.git cafe-club
  cd cafe-club
  bash scripts/deploy.sh

EOF
  exit 1
fi

# --- ۲) نصب وابستگی‌ها --------------------------------------------------------
if [[ -d node_modules && -f node_modules/.package-lock.json ]]; then
  ok "وابستگی‌ها از قبل نصب شده‌اند."
else
  info "نصب وابستگی‌ها (npm install)..."
  run npm install
fi

WRANGLER=(npx --yes wrangler)

# --- ۳) احراز هویت -----------------------------------------------------------
info "بررسی ورود به Cloudflare..."
if "${WRANGLER[@]}" whoami 2>&1 | grep -qi "not authenticated"; then
  warn "وارد حساب نشده‌اید؛ مرورگر باز می‌شود. اجازهٔ دسترسی (OAuth) را تأیید کنید."
  run "${WRANGLER[@]}" login
else
  ok "به Cloudflare وارد هستید."
fi

# --- ۴) ساخت D1 در صورت نبود -------------------------------------------------
info "بررسی وجود دیتابیس D1 با نام «$DB_NAME»..."
DB_JSON="$("${WRANGLER[@]}" d1 list --json 2>/dev/null || echo '[]')"

DB_ID="$(printf '%s' "$DB_JSON" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d));
  process.stdin.on("end", () => {
    try {
      const list = JSON.parse(s);
      const target = process.argv[1];
      const hit = list.find((x) => x.name === target || x.database_name === target);
      if (hit) console.log(hit.uuid || hit.database_id || hit.id || "");
    } catch (e) {
      /* خروجی JSON نبود؛ شناسه‌ای چاپ نمی‌کنیم */
    }
  });
' "$DB_NAME")"

if [[ -z "$DB_ID" ]]; then
  info "دیتابیس پیدا نشد؛ ساخته می‌شود..."
  run "${WRANGLER[@]}" d1 create "$DB_NAME" --location weur
  if [[ "$DRY_RUN" != "1" ]]; then
    DB_JSON="$("${WRANGLER[@]}" d1 list --json 2>/dev/null || echo '[]')"
    DB_ID="$(printf '%s' "$DB_JSON" | node -e '
      let s = "";
      process.stdin.on("data", (d) => (s += d));
      process.stdin.on("end", () => {
        try {
          const list = JSON.parse(s);
          const hit = list.find((x) => x.name === process.argv[1]);
          if (hit) console.log(hit.uuid || hit.database_id || hit.id || "");
        } catch (e) {}
      });
    ' "$DB_NAME")"
  fi
fi

if [[ "$DRY_RUN" != "1" && -z "$DB_ID" ]]; then
  die "شناسهٔ دیتابیس خوانده نشد. یک‌بار «npx wrangler d1 list» را اجرا کنید و database_id را دستی در wrangler.toml بگذارید."
fi

if [[ -n "$DB_ID" ]]; then
  ok "شناسهٔ دیتابیس: $DB_ID"
  info "نوشتن database_id داخل wrangler.toml..."
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '   [dry-run] database_id ← %s\n' "$DB_ID"
  else
    DB_ID="$DB_ID" node -e '
      const fs = require("fs");
      const file = "wrangler.toml";
      const id = process.env.DB_ID;
      const src = fs.readFileSync(file, "utf8");
      if (!/database_id\s*=\s*"[^"]*"/.test(src)) {
        console.error("خط: خط database_id در wrangler.toml پیدا نشد.");
        process.exit(1);
      }
      fs.writeFileSync(file, src.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${id}"`));
    '
    ok "wrangler.toml به‌روزرسانی شد."
  fi
fi

# --- ۵) اجرای schema.sql روی دیتابیس ابری ------------------------------------
info "ساخت جدول‌ها و داده‌های اولیه (schema.sql)..."
run "${WRANGLER[@]}" d1 execute "$DB_NAME" --remote --file=./schema.sql

# --- ۶) Secret مربوط به JWT --------------------------------------------------
ROTATE_SECRET="${ROTATE_SECRET:-0}"
WORKER_NAME="$(node -e '
  try {
    const src = require("fs").readFileSync("wrangler.toml", "utf8");
    const m = /^\s*name\s*=\s*"([^"]+)"/m.exec(src);
    if (m) process.stdout.write(m[1]);
  } catch (e) {}
')"
WORKER_NAME="${WORKER_NAME:-cafe-club}"

# خواندن فهرست Secretها فقط‌خواندنی است و در حالت dry-run هم بی‌خطر است
SECRET_KEYS="$("${WRANGLER[@]}" secret list --name "$WORKER_NAME" --format json 2>/dev/null || echo '[]')" 

HAS_JWT_SECRET=0
if printf '%s' "$SECRET_KEYS" | grep -q '"JWT_SECRET"'; then
  HAS_JWT_SECRET=1
fi

if [[ -n "${JWT_SECRET:-}" ]]; then
  info "تنظیم JWT_SECRET از متغیر محیطی..."
  SECRET="$JWT_SECRET"
  SHOULD_SET_SECRET=1
elif [[ "$HAS_JWT_SECRET" == "1" && "$ROTATE_SECRET" != "1" ]]; then
  info "JWT_SECRET از قبل روی Worker تنظیم شده است؛ دست نمی‌خورد."
  ok "برای چرخش عمدی کلید: ROTATE_SECRET=1 bash scripts/deploy.sh"
  SHOULD_SET_SECRET=0
elif [[ "$ROTATE_SECRET" == "1" ]]; then
  warn "چرخش JWT_SECRET درخواست شده است؛ همهٔ نشست‌های فعال باطل می‌شوند."
  SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(48).toString("base64url"))')"
  SHOULD_SET_SECRET=1
else
  SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(48).toString("base64url"))')"
  warn "یک JWT_SECRET تصادفی ساخته شد. آن را جایی امن نگه دارید (با تغییر آن همهٔ نشست‌ها باطل می‌شوند)."
  printf '   JWT_SECRET=%s\n' "$SECRET"
  SHOULD_SET_SECRET=1
fi

if [[ "$SHOULD_SET_SECRET" == "1" ]]; then
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '   [dry-run] npx wrangler secret put JWT_SECRET  (مقدار تصادفی)\n'
  else
    printf '%s' "$SECRET" | "${WRANGLER[@]}" secret put JWT_SECRET --name "$WORKER_NAME"
    ok "Secret ذخیره شد."
  fi
fi

# --- ۷) دیپلوی ----------------------------------------------------------------
info "انتشار Worker..."
if [[ "$DRY_RUN" == "1" ]]; then
  "${WRANGLER[@]}" deploy --dry-run
else
  "${WRANGLER[@]}" deploy
fi

cat <<EOF

────────────────────────────────────────────────────────────
✅ کار تمام شد.

آدرس اپلیکیشن به‌صورت زیر است:
   https://${DB_NAME%-db}.<subdomain>.workers.dev
   (لینک دقیق در خروجی «Deployed» بالا چاپ شده است)

ورود اولیه:
   مدیر   : 09120000000 / Admin@12345
   کارمند : 09120000001 / Staff@12345

⚠️ بلافاصله بعد از ورود، رمز هر دو حساب را عوض کنید
   (پنل مدیریت → کارمندان → تغییر رمز) و رمزهای نمونه را
   از schema.sql قبل از عمومی‌کردن مخزن حذف کنید.

دستورهای بعدی:
   npx wrangler tail                 # دیدن لاگ زنده
   npx wrangler d1 execute ${DB_NAME} --remote --command "SELECT COUNT(*) FROM users;"
   npx wrangler deployments list     # تاریخچهٔ انتشار
────────────────────────────────────────────────────────────
EOF
