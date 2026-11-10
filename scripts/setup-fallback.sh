#!/usr/bin/env bash
# Create the encryption Secret ONCE; never print it, persist it in Git or rotate it implicitly.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
node -e 'const fs=require("fs");const s=fs.readFileSync("wrangler.toml","utf8");if(s.includes("00000000-0000-0000-0000-000000000000")){console.error("ابتدا database_id واقعی را در wrangler.toml تنظیم کنید.");process.exit(1)}'
# Failure to authenticate must stop the script, not be interpreted as a missing Secret.
secrets="$(npx wrangler secret list --format json)"
present="$(printf '%s' "$secrets" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const data=JSON.parse(s);if(!Array.isArray(data))process.exit(1);process.stdout.write(data.some(x=>x.name==="FALLBACK_ENCRYPTION_KEY")?"yes":"no")})')"
if [[ "$present" == "yes" ]]; then
  printf 'کلید رمزنگاری از قبل موجود است؛ بدون تغییر نگه داشته شد.\n'
else
  # Can also be supplied securely by a password manager via the process environment.
  key="$(node -e 'const c=require("crypto");const key=process.env.FALLBACK_ENCRYPTION_KEY||c.randomBytes(32).toString("base64");const bytes=Buffer.from(key,"base64");if(bytes.length!==32||bytes.toString("base64")!==key)process.exit(1);process.stdout.write(key)')"
  printf '%s' "$key" | npx wrangler secret put FALLBACK_ENCRYPTION_KEY
  unset key
  printf 'کلید رمزنگاری ساخته شد؛ آن را حذف یا بدون برنامهٔ مهاجرت عوض نکنید.\n'
fi
