#!/usr/bin/env bash
# =============================================================================
#  به‌روزرسانی «باشگاه مشتریان کافه» روی Cloudflare Workers
# -----------------------------------------------------------------------------
#  طرز استفاده (داخل پوشهٔ پروژه):
#      bash scripts/update.sh
#
#  کاری که می‌کند:
#    ۱) مطمئن می‌شود در ریشهٔ پروژه هستید
#    ۲) آخرین تغییرات را از گیت می‌گیرد (اگر پوشه مخزن گیت باشد)
#    ۳) وابستگی‌ها را به‌روز می‌کند
#    ۴) بستهٔ تک‌فایلی را از نو می‌سازد (برای حالت پیست در Quick Edit)
#    ۵) مایگریشن دیتابیس را اجرا می‌کند (فقط ستون/جدول جدید؛ هیچ داده‌ای پاک نمی‌شود)
#    ۶) Worker را روی Cloudflare منتشر می‌کند
#
#  ⚠️ JWT_SECRET و داده‌های موجود دست نمی‌خورند. مایگریشن تکرارپذیر است و
#     فقط چیزهای تازه را اضافه می‌کند؛ اما پیش از اجرا بکاپ بگیرید:
#       npx wrangler d1 export cafe-club-db --remote --output backup-$(date +%F).sql
#
#  متغیرهای اختیاری:
#      BRANCH="..."   نام شاخه برای pull (پیش‌فرض: شاخهٔ فعلی)
#      SKIP_GIT=1     بدون pull؛ فقط نصب و انتشار
#      SKIP_BUILD=1   بدون ساخت بستهٔ تک‌فایلی
#      SKIP_MIGRATE=1 بدون مایگریشن دیتابیس
#      DRY_RUN=1      همهٔ بررسی‌ها بدون هیچ تغییری
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

DRY_RUN="${DRY_RUN:-0}"
SKIP_GIT="${SKIP_GIT:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_MIGRATE="${SKIP_MIGRATE:-0}"

info() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }
run()  {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '   [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# --- ۰) پیش‌نیاز --------------------------------------------------------------
command -v node >/dev/null 2>&1 || die "Node.js نصب نیست."
command -v npm  >/dev/null 2>&1 || die "npm نصب نیست."

# --- ۱) بررسی پوشه ------------------------------------------------------------
info "بررسی پروژه در: $PROJECT_ROOT"
for f in wrangler.toml schema.sql package.json src/index.ts; do
  [[ -f "$f" ]] || die "فایل «$f» پیدا نشد. دستور را از ریشهٔ پروژه اجرا کنید."
done
ok "ساختار پروژه درست است."

# --- ۲) گرفتن تغییرات از گیت --------------------------------------------------
if [[ "$SKIP_GIT" == "1" ]]; then
  warn "pull گیت رد شد (SKIP_GIT=1)."
elif [[ -d .git ]]; then
  BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
  info "شاخهٔ فعلی: $BRANCH"

  if [[ -n "$(git status --porcelain)" ]]; then
    warn "تغییرات ذخیره‌نشده دارید؛ برای جلوگیری از تداخل، pull انجام نمی‌شود."
    warn "اول این‌ها را commit یا stash کنید:  git stash -u"
  else
    if [[ "$DRY_RUN" == "1" ]]; then
      printf '   [dry-run] git pull origin %s\n' "$BRANCH"
    else
      git fetch origin "$BRANCH" >/dev/null 2>&1 || die "شاخهٔ $BRANCH روی origin پیدا نشد."
      BEFORE="$(git rev-parse HEAD)"
      git pull --ff-only origin "$BRANCH" >/dev/null 2>&1 || die "pull با خطا مواجه شد (تاریخچه واگرا شده است)."
      AFTER="$(git rev-parse HEAD)"
      if [[ "$BEFORE" == "$AFTER" ]]; then
        ok "شما از قبل آخرین نسخه را دارید."
      else
        ok "کد به‌روزرسانی شد:"
        git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/     /'
      fi
    fi
  fi
else
  warn "این پوشه مخزن گیت نیست؛ مرحلهٔ pull رد شد."
  warn "برای دریافت نسخهٔ تازه: git clone -b arena/ba9e1761-checklists https://github.com/boogh13822-spec/checklists.git"
fi

# --- ۳) وابستگی‌ها -------------------------------------------------------------
info "بررسی وابستگی‌ها (npm install)..."
run npm install --no-audit --no-fund
ok "وابستگی‌ها آماده است."

# --- ۴) بررسی نوع‌ها ----------------------------------------------------------
if [[ -x node_modules/.bin/tsc ]]; then
  info "بررسی نوع‌های TypeScript..."
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '   [dry-run] npx tsc --noEmit\n'
  else
    npx tsc --noEmit || die "خطای TypeScript — انتشار متوقف شد."
  fi
  ok "کد از نظر نوع‌ها سالم است."
fi

# --- ۵) ساخت بستهٔ تک‌فایلی ---------------------------------------------------
if [[ "$SKIP_BUILD" == "1" ]]; then
  warn "ساخت بستهٔ تک‌فایلی رد شد (SKIP_BUILD=1)."
else
  info "ساخت بستهٔ تک‌فایلی (single-file/worker.js)..."
  run npm run build:single
  if [[ "$DRY_RUN" != "1" && -f single-file/worker.js ]]; then
    ok "ساخته شد: $(du -h single-file/worker.js | cut -f1)"
  fi
fi

# --- ۵.۵) مایگریشن دیتابیس ----------------------------------------------------
if [[ "$SKIP_MIGRATE" == "1" ]]; then
  warn "مایگریشن دیتابیس رد شد (SKIP_MIGRATE=1). اگر نسخهٔ تازه جدول/ستون جدید داشته باشد، خطا می‌گیرید."
elif [[ -f scripts/migrate.sh ]]; then
  info "هم‌تراز کردن ساختار دیتابیس (مایگریشن)..."
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '   [dry-run] bash scripts/migrate.sh --remote\n'
  else
    bash scripts/migrate.sh --remote || die "مایگریشن با خطا متوقف شد؛ پیش از انتشار مشکل را حل کنید."
  fi
  ok "ساختار دیتابیس هم‌تراز شد."
else
  warn "فایل scripts/migrate.sh پیدا نشد؛ مایگریشن رد شد."
fi

# --- ۶) انتشار ----------------------------------------------------------------
info "انتشار نسخهٔ جدید Worker..."
if [[ "$DRY_RUN" == "1" ]]; then
  npx --yes wrangler deploy --dry-run
else
  npx --yes wrangler deploy
fi

if [[ "$DRY_RUN" == "1" ]]; then
  printf '\n────────────────────────────────────────────────────────────\n'
  printf 'ℹ️  این اجرا فقط آزمایشی بود (DRY_RUN=1)؛ هیچ چیزی منتشر نشد.\n'
  printf '    برای انتشار واقعی همین دستور را بدون DRY_RUN اجرا کنید.\n'
  printf '────────────────────────────────────────────────────────────\n'
  exit 0
fi

cat <<'EOF'

────────────────────────────────────────────────────────────
✅ نسخهٔ جدید منتشر شد.

دیتابیس دست نخورد (schema.sql اجرا نشد) و JWT_SECRET هم عوض نشد؛
پس مشتریان، امتیازها و نشست‌های فعلی سرجایشان هستند.

بررسی سریع بعد از انتشار:
  curl -s https://<آدرس-ورکر>/api/health
  npx wrangler tail

دیتابیس به‌صورت خودکار مایگریت شد (ستون/جدول جدید اضافه شد، داده‌ای پاک نشد).
برای اجرای دستی مایگریشن در آینده:
  bash scripts/migrate.sh --remote
پیش از هر مایگریشن، بکاپ توصیه می‌شود:
  npx wrangler d1 export cafe-club-db --remote --output backup-$(date +%F).sql
────────────────────────────────────────────────────────────
EOF
