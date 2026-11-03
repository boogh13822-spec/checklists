/**
 * ----------------------------------------------------------------------------
 *  تست خودکار رابط کاربری (بدون مرورگر) — قابل اجرا با `npm run test:ui`
 * ----------------------------------------------------------------------------
 *  این اسکریپت سه چیز را بررسی می‌کند و هیچ تغییری در داده‌ها نمی‌دهد:
 *
 *   ۱) هر صفحهٔ اصلی با نقش درست، کد ۲۰۰ بدهد.
 *   ۲) اسکریپت‌های درون‌صفحه‌ای از نظر نحوی سالم باشند (node --check).
 *   ۳) هر شناسه‌ای که کد سمت کلاینت با `$('#id')` صدا می‌زند، در HTML همان
 *      صفحه واقعاً وجود داشته باشد (کشف دکمه/فیلد گم‌شده).
 *   ۴) منطق «محاسبهٔ پرداخت» صفحهٔ صندوق در یک DOM جعلی اجرا و با ۱۱ حالت
 *      مرزی سنجیده شود (نقد، کارت، آنلاین، ترکیبی، کمبود، باقیمانده).
 *
 *  پیش‌نیاز:
 *     bash scripts/seed-test-users.sh        # کاربران تست
 *     npm run preview                        # سرور روی 8787
 *     BASE_URL=http://127.0.0.1:8787 ADMIN_PHONE=09120000000 \
 *       ADMIN_PASSWORD='Admin@12345' STAFF_PHONE=09120000001 \
 *       STAFF_PASSWORD='Staff@12345' npm run test:ui
 * ----------------------------------------------------------------------------
 */
import vm from 'node:vm';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const ADMIN = { phone: process.env.ADMIN_PHONE ?? '09120000000', password: process.env.ADMIN_PASSWORD ?? 'Admin@12345' };
const STAFF = { phone: process.env.STAFF_PHONE ?? '09120000001', password: process.env.STAFF_PASSWORD ?? 'Staff@12345' };

let failures = 0;
const ok = (label, extra = '') => console.log(`✅ ${label}${extra ? ' — ' + extra : ''}`);
const bad = (label, extra = '') => {
  failures += 1;
  console.log(`❌ ${label}${extra ? ' — ' + extra : ''}`);
};

async function login(phone, password) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const cookie = response.headers.get('set-cookie');
  if (!response.ok || !cookie) throw new Error(`ورود ناموفق برای ${phone} (${response.status})`);
  return cookie.split(';')[0];
}

const adminCookie = await login(ADMIN.phone, ADMIN.password);
const staffCookie = await login(STAFF.phone, STAFF.password);

/* ---------------------------------------------------------------- ۱) صفحات */

const pages = [
  ['/', '', null],
  ['/login', '', null],
  ['/admin', adminCookie, null],
  ['/admin/customers', adminCookie, null],
  ['/admin/invoices', adminCookie, null],
  ['/admin/shifts', adminCookie, null],
  ['/admin/reports', adminCookie, null],
  ['/admin/settings', adminCookie, ['fallback-enabled','fallback-save','sms_enabled']],
  ['/admin/fallback', adminCookie, ['fallback-enabled','fallback-history','fallback-save']],
  ['/admin/sms', adminCookie, null],
  ['/admin/logs', adminCookie, null],
  ['/staff', staffCookie, ['payment-modes', 'pay-cash-input', 'mix-cash', 'menu-search', 'submit-invoice']],
  ['/staff/history', staffCookie, null],
  ['/staff/shift', staffCookie, ['open-shift']],
];

const html = new Map();
for (const [path, cookie, requiredIds] of pages) {
  const response = await fetch(BASE + path, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
  if (response.status !== 200) {
    bad(`${path} → ${response.status}`);
    continue;
  }
  const body = await response.text();
  html.set(path, body);
  ok(`${path} → 200`);

  for (const id of requiredIds ?? []) {
    if (body.includes(`id="${id}"`)) ok(`${path} شامل #${id}`);
    else bad(`${path} فاقد #${id}`);
  }
}

/* ---------------------------------------------- ۲) شناسه‌های ارجاع‌شده در JS */

for (const [path, body] of html) {
  const used = new Set([
    ...[...body.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1]),
    ...[...body.matchAll(/getElementById\('([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1]),
  ]);
  // عناصر شرطی (مثل دکمهٔ بستن شیفت) فقط در حالت خاص رندر می‌شوند
  const conditional = new Set(['close-shift', 'clear-sms-key', 'clear-weather-key']);
  const missing = [...used].filter((id) => !conditional.has(id) && !body.includes(`id="${id}"`));
  if (missing.length === 0) ok(`${path}: ${used.size} شناسهٔ ارجاع‌شده همه موجودند`);
  else bad(`${path}: شناسه(های) گم‌شده`, missing.join(', '));
}

/* ------------------------------------------ ۳) صحت نحوی اسکریپت‌های صفحه */

for (const [path, body] of html) {
  const blocks = [...body.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((block) => block.trim());
  let broken = 0;
  for (const block of blocks) {
    try {
      new vm.Script(block, { filename: `${path}#inline` });
    } catch (error) {
      broken += 1;
      bad(`${path}: خطای نحوی در اسکریپت`, String(error.message));
    }
  }
  if (broken === 0) ok(`${path}: ${blocks.length} اسکریپت سالم`);
}

/* ------------------------------------- ۴) منطق پرداخت در DOM جعلی (بدون مرورگر) */

const staffHtml = html.get('/staff');
const logicBlock = [...(staffHtml ?? '').matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .find((block) => block.includes('function computePayment'));

if (!logicBlock) {
  bad('اسکریپت منطق پرداخت در صفحهٔ صندوق پیدا نشد');
} else {
  const element = () => {
    const node = {
      value: '', textContent: '', innerHTML: '', disabled: false, readOnly: false,
      dataset: {}, style: {},
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      addEventListener() {}, removeEventListener() {}, focus() {}, select() {}, click() {},
      querySelector() { return element(); }, querySelectorAll() { return []; },
      closest() { return null; }, setAttribute() {}, getAttribute() { return null; }, remove() {},
    };
    return node;
  };
  const sandbox = {
    document: {
      getElementById() { return element(); },
      querySelector() { return element(); },
      querySelectorAll() { return []; },
      addEventListener() {},
      createElement() { return element(); },
      body: element(),
    },
    console, setTimeout, clearTimeout, Date, Math, JSON, Number, String, Array, Object, Intl,
    navigator: { language: 'fa' },
    location: { href: '', replace() {}, reload() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    history: { replaceState() {} },
    crypto: { randomUUID: () => 'test-uuid' },
    fa: (v) => String(v), money: (v) => String(v), moneyFa: (v) => String(v),
    escapeHtml: (v) => String(v), toast() {}, api: async () => ({}), setLoading() {},
    initJalaliRange() {}, readJalaliRange: () => ({ iso: '', partial: false }),
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    $: (selector) => element(),
    $$: () => [],
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  const marker = '    // init\n    renderMenu();';
  const hook =
    '    globalThis.__probe = { run: function (mode, tender, mc, mk, mo, total) { ' +
    'payMode = mode; payTender = tender; mixCash = mc; mixCard = mk; mixOnline = mo; return computePayment(total); } };\n';

  let loaded = logicBlock.includes(marker);
  if (loaded) {
    try {
      vm.runInContext(logicBlock.replace(marker, hook + marker), context, { filename: 'staff-page.js' });
      ok('اسکریپت صفحهٔ ثبت فاکتور بدون خطای زمان اجرا بارگذاری شد');
    } catch (error) {
      loaded = false;
      bad('خطای زمان اجرا در اسکریپت صفحهٔ ثبت فاکتور', String(error.message));
    }
  }

  if (loaded) {
    const cases = [
      ['نقد دقیق', 'cash', 100000, 0, 0, 0, 100000, { valid: true, cash: 100000, change: 0 }],
      ['نقد با باقیمانده', 'cash', 120000, 0, 0, 0, 100000, { valid: true, cash: 100000, change: 20000 }],
      ['نقد کمبود', 'cash', 70000, 0, 0, 0, 100000, { valid: false }],
      ['کارت دقیق', 'card', 100000, 0, 0, 0, 100000, { valid: true, card: 100000 }],
      ['کارت بیش از فاکتور', 'card', 120000, 0, 0, 0, 100000, { valid: false }],
      ['آنلاین دقیق', 'online', 100000, 0, 0, 0, 100000, { valid: true, online: 100000 }],
      ['ترکیبی ۴۰+۶۰', 'mixed', 0, 40000, 60000, 0, 100000, { valid: true, cash: 40000, card: 60000 }],
      ['ترکیبی ۶۰+۶۰ با باقیمانده', 'mixed', 0, 60000, 60000, 0, 100000, { valid: true, change: 20000 }],
      ['ترکیبی کمبود', 'mixed', 0, 20000, 30000, 0, 100000, { valid: false }],
      ['ترکیبی باقیمانده = نقد', 'mixed', 0, 10000, 100000, 0, 100000, { valid: true, change: 10000 }],
      ['ترکیبی باقیمانده > نقد', 'mixed', 0, 5000, 110000, 0, 100000, { valid: false }],
    ];

    let passed = 0;
    for (const [label, mode, tender, cash, card, online, total, expect] of cases) {
      const result = vm.runInContext(
        `JSON.stringify(__probe.run('${mode}',${tender},${cash},${card},${online},${total}))`,
        context
      );
      const output = JSON.parse(result);
      const good = Object.entries(expect).every(([key, value]) => output[key] === value);
      if (good) passed += 1;
      console.log(`${good ? '✅' : '❌'} پرداخت: ${label} → valid=${output.valid} cash=${output.cash} card=${output.card} change=${output.change}`);
      if (!good) failures += 1;
    }
    console.log(`\n${passed}/${cases.length} حالت پرداخت درست بود`);
  }
}

console.log(`\n${failures === 0 ? '🎉 همهٔ بررسی‌ها پاس شد.' : `⚠️ ${failures} بررسی ناموفق.`}`);
process.exit(failures === 0 ? 0 : 1);
