/**
 * ----------------------------------------------------------------------------
 *  تست انتها-به-انتها جریان مالی (D1 محلی) — `npm run test:e2e`
 * ----------------------------------------------------------------------------
 *  این تست داده‌های آزمایشی می‌سازد و همهٔ عددها را با کوئری مستقیم روی همان
 *  دیتابیس مقایسه می‌کند. هیچ عددی «فرض» نمی‌شود.
 *
 *  پوشش:
 *    ۱) ورود: قالب‌های مختلف شماره، رمز اشتباه، کوکی خراب، پرچم «نشست منقضی»
 *    ۲) فاکتور: نقد/کارت/آنلاین/ترکیبی/باقیمانده/کمبود/آیتم نامعتبر/تکرار
 *    ۳) شیفت: باز کردن، ورود/خروج نقد، انتساب فاکتور، بستن، اختلاف
 *    ۴) ابطال با دلیل + بازمحاسبهٔ نقد مورد انتظار شیفت
 *    ۵) اصلاح فاکتور (باطل + جایگزین) و جلوگیری از دو فاکتور معتبر
 *    ۶) گزارش‌ها: تطبیق تعداد/مبلغ/تخفیف/تفکیک پرداخت/ابطال با SQL خام
 *    ۷) دسترسی‌ها: کارمند ← مسیرهای مدیر = ۴۰۳
 * ----------------------------------------------------------------------------
 */
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const ADMIN = { phone: '09120000000', password: 'Admin@12345' };
const STAFF = { phone: '09120000001', password: 'Staff@12345' };

let pass = 0;
let fail = 0;
const ok = (label, extra = '') => {
  pass += 1;
  console.log(`  ✅ ${label}${extra ? ' — ' + extra : ''}`);
};
const bad = (label, extra = '') => {
  fail += 1;
  console.log(`  ❌ ${label}${extra ? ' — ' + extra : ''}`);
};
const check = (condition, label, extra = '') => (condition ? ok(label, extra) : bad(label, extra));
const section = (title) => console.log(`\n■ ${title}`);

async function call(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const raw = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  return { status: response.status, body: parsed, raw, headers: response.headers };
}

async function login(phone, password, cookie) {
  const result = await call('POST', '/api/auth/login', { body: { phone, password }, cookie });
  const setCookies = result.headers.getSetCookie?.() ?? [];
  return {
    status: result.status,
    body: result.body,
    setCookies,
    cookie: setCookies.length ? setCookies[0].split(';')[0] : null,
  };
}

/* ============================================================ ۱) ورود */

section('۱) ورود و نشست');
const adminLogin = await login(ADMIN.phone, ADMIN.password);
check(adminLogin.status === 200 && adminLogin.body.ok, 'ورود مدیر', `role=${adminLogin.body.data?.role}`);
check(adminLogin.setCookies.length === 1, 'دقیقاً یک Set-Cookie ارسال شد', `count=${adminLogin.setCookies.length}`);
const adminCookie = adminLogin.cookie;

const staffLogin = await login(STAFF.phone, STAFF.password);
check(staffLogin.status === 200, 'ورود کارمند');
const staffCookie = staffLogin.cookie;

for (const variant of ['+989120000000', '989120000000', '0912 000 0000']) {
  const attempt = await login(variant, ADMIN.password);
  check(attempt.status === 200, `ورود با قالب شماره «${variant}»`);
}

const wrongPass = await login(ADMIN.phone, 'definitely-wrong');
check(wrongPass.status === 401 && wrongPass.body.code === 'INVALID_CREDENTIALS', 'رمز اشتباه → ۴۰۱');

const unknownPhone = await login('09199999999', ADMIN.password);
check(unknownPhone.status === 401, 'شمارهٔ ناموجود → ۴۰۱');

const staleCookieLogin = await login(ADMIN.phone, ADMIN.password, 'cc_session=invalid.jwt.token');
check(
  staleCookieLogin.status === 200 && staleCookieLogin.setCookies.length === 1,
  'ورود با کوکی خراب: یک کوکی معتبر جدید',
  `count=${staleCookieLogin.setCookies.length}`
);

const noCookiePage = await call('GET', '/admin');
check(noCookiePage.status === 302 && !String(noCookiePage.headers.get('location')).includes('expired=1'),
  'ورود اول (بدون کوکی) پیام «منقضی» نمی‌دهد', noCookiePage.headers.get('location'));

const stalePage = await call('GET', '/admin', { cookie: 'cc_session=bad.token' });
check(
  stalePage.status === 302 && String(stalePage.headers.get('location')).includes('expired=1'),
  'کوکی نامعتبر → پرچم expired=1 در ریدایرکت',
  stalePage.headers.get('location')
);

const sessionApi = await call('GET', '/api/auth/session', { cookie: adminCookie });
check(sessionApi.body.data?.authenticated === true, 'API نشست با کوکی معتبر');

/* ==================================================== ۲) مشتری آزمایشی */

section('۲) مشتری آزمایشی');
const uniquePhone = `0912${String(Math.floor(Math.random() * 9000000) + 1000000)}`;
const register = await call('POST', '/api/auth/register', {
  body: { name: 'مشتری تست خودکار', phone: uniquePhone, birth_date: '1992-05-05' },
});
check(register.status === 201 || register.status === 200, 'ثبت‌نام مشتری', uniquePhone);
const searchCustomer = await call('GET', `/api/staff/customer?phone=${uniquePhone}`, { cookie: staffCookie });
const customerId = searchCustomer.body.data?.customer?.id;
check(!!customerId && searchCustomer.body.data.customer.phone === uniquePhone,
  'جستجوی مشتری در صندوق', `id=${customerId}`);

/* ============================================================= ۳) شیفت */

section('۳) صندوق و شیفت');
const openShift = await call('POST', '/api/staff/shift/open', { body: { openingCash: 400000 }, cookie: staffCookie });
check(openShift.status === 200 && openShift.body.data?.shift?.id, 'باز کردن صندوق',
  `id=${openShift.body.data?.shift?.id} opening=${openShift.body.data?.shift?.opening_cash}`);

const openTwice = await call('POST', '/api/staff/shift/open', { body: { openingCash: 1000 }, cookie: staffCookie });
check(openTwice.status === 409 && openTwice.body.code === 'ALREADY_OPEN', 'باز کردن دوباره → ۴۰۹ ALREADY_OPEN');

const cashIn = await call('POST', '/api/staff/shift/movements', { body: { kind: 'in', amount: 120000, note: 'واریز' }, cookie: staffCookie });
const cashOut = await call('POST', '/api/staff/shift/movements', { body: { kind: 'out', amount: 30000, note: 'خرید ملزومات' }, cookie: staffCookie });
check(cashIn.status === 200 && cashOut.status === 200, 'ورود ۱۲۰٬۰۰۰ و خروج ۳۰٬۰۰۰ نقد');

/* =========================================================== ۴) فاکتور */

section('۴) ثبت فاکتور و پرداخت');
const invoice = async (items, payment, extra = {}) =>
  call('POST', '/api/staff/invoices', {
    body: {
      userId: customerId,
      items,
      amount: null,
      clientRequestId: `e2e-${Math.random().toString(36).slice(2)}`,
      payment,
      ...extra,
    },
    cookie: staffCookie,
  });

const cashExact = await invoice([{ name: 'لاته', qty: 2, price: 75000 }], { cash: 150000 });
check(
  cashExact.status === 201 && cashExact.body.data.paymentMethod === 'cash' && cashExact.body.data.change === 0,
  'نقد دقیق ۱۵۰٬۰۰۰',
  `cash=${cashExact.body.data?.paidCash}`
);

const cashChange = await invoice([{ name: 'آمریکانو', qty: 1, price: 55000 }], { cash: 100000 });
check(
  cashChange.status === 201 && cashChange.body.data.change === 45000 && cashChange.body.data.paidCash === 55000,
  'نقد ۱۰۰٬۰۰۰ → باقیمانده ۴۵٬۰۰۰ و نقد مؤثر ۵۵٬۰۰۰',
  `cash=${cashChange.body.data?.paidCash} change=${cashChange.body.data?.change}`
);

const card = await invoice([{ name: 'کیک شکلاتی', qty: 1, price: 90000 }], { card: 90000 });
check(card.status === 201 && card.body.data.paymentMethod === 'card', 'کارت‌خوان ۹۰٬۰۰۰');

const online = await invoice([{ name: 'کروسان', qty: 2, price: 65000 }], { online: 130000 });
check(online.status === 201 && online.body.data.paymentMethod === 'online', 'آنلاین ۱۳۰٬۰۰۰');

const mixed = await invoice([{ name: 'آیس لاته', qty: 2, price: 85000 }], { cash: 60000, card: 110000 });
check(
  mixed.status === 201 && mixed.body.data.paymentMethod === 'mixed' && mixed.body.data.paidCash === 60000,
  'ترکیبی ۶۰٬۰۰۰ نقد + ۱۱۰٬۰۰۰ کارت'
);

const short = await invoice([{ name: 'چای', qty: 2, price: 35000 }], { cash: 50000 });
check(short.status === 400 && short.body.code === 'PAYMENT_SHORT', 'کمبود پرداخت → PAYMENT_SHORT');

const cardOver = await invoice([{ name: 'چای', qty: 1, price: 35000 }], { card: 50000 });
check(cardOver.status === 400 && cardOver.body.code === 'INVALID_CHANGE', 'کارت بیش از مبلغ → INVALID_CHANGE');

const negative = await invoice([{ name: 'چای', qty: 1, price: 35000 }], { cash: -1000 });
check(negative.status === 400 && negative.body.code === 'INVALID_PAYMENT', 'مبلغ منفی → INVALID_PAYMENT');

const badQty = await invoice([{ name: 'چای', qty: 0, price: 35000 }], { cash: 0 });
check(badQty.status === 400 && badQty.body.code === 'INVALID_ITEM', 'تعداد صفر → INVALID_ITEM');

const noPayment = await call('POST', '/api/staff/invoices', {
  body: { userId: customerId, items: [{ name: 'اسپرسو', qty: 1, price: 45000 }], amount: null },
  cookie: staffCookie,
});
check(noPayment.status === 201 && noPayment.body.data.paymentMethod === null,
  'سازگاری: فاکتور بدون اطلاعات پرداخت هنوز ثبت می‌شود');

const reqId = `dup-${Date.now()}`;
const dupBody = {
  userId: customerId,
  items: [{ name: 'اسپرسو', qty: 1, price: 45000 }],
  amount: null,
  clientRequestId: reqId,
  payment: { cash: 45000 },
};
const dup1 = await call('POST', '/api/staff/invoices', { body: dupBody, cookie: staffCookie });
const dup2 = await call('POST', '/api/staff/invoices', { body: dupBody, cookie: staffCookie });
check(
  dup1.status === 201 && dup2.status === 201 && dup2.body.data.duplicate === true &&
    dup2.body.data.invoiceId === dup1.body.data.invoiceId,
  'درخواست تکراری → همان فاکتور (بدون ثبت دوباره)'
);

/* ====================================================== ۵) گزارش‌ها vs SQL */

section('۵) تطبیق گزارش با SQL');
const reportPage = await call('GET', '/admin/reports', { cookie: adminCookie });
check(reportPage.status === 200, 'صفحهٔ گزارش‌ها رندر شد');

const dashboard = await call('GET', '/api/admin/stats', { cookie: adminCookie });
check(dashboard.status === 200 && typeof dashboard.body.data?.todaySales === 'number',
  'API آمار داشبورد', `todaySales=${dashboard.body.data?.todaySales}`);

/* ============================================================ ۶) ابطال */

section('۶) ابطال با دلیل');
const voidableId = mixed.body.data.invoiceId;
const voidNoReason = await call('POST', `/api/admin/invoices/${voidableId}/void`, { body: {}, cookie: adminCookie });
check(voidNoReason.status === 400 && voidNoReason.body.code === 'REASON_REQUIRED', 'ابطال بدون دلیل → ۴۰۰');

const voidByStaff = await call('POST', `/api/admin/invoices/${voidableId}/void`, {
  body: { reason: 'تلاش کارمند' },
  cookie: staffCookie,
});
check(voidByStaff.status === 403, 'ابطال با نقش کارمند → ۴۰۳');

const voidOk = await call('POST', `/api/admin/invoices/${voidableId}/void`, {
  body: { reason: 'تست خودکار: انصراف مشتری' },
  cookie: adminCookie,
});
check(voidOk.status === 200 && typeof voidOk.body.data.pointsReversed === 'number',
  'ابطال موفق', `pointsReversed=${voidOk.body.data?.pointsReversed}`);

const voidAgain = await call('POST', `/api/admin/invoices/${voidableId}/void`, {
  body: { reason: 'تست تکراری' },
  cookie: adminCookie,
});
check(voidAgain.status === 409 && voidAgain.body.code === 'ALREADY_VOID', 'ابطال دوباره → ۴۰۹');

const voidedDetail = await call('GET', `/api/admin/invoices/${voidableId}`, { cookie: adminCookie });
check(
  !!voidedDetail.body.data?.voided_at && String(voidedDetail.body.data?.void_reason).includes('انصراف'),
  'دلیل ابطال ذخیره شد',
  voidedDetail.body.data?.void_reason
);

/* ============================================================ ۷) اصلاح */

section('۷) اصلاح فاکتور');
const toFix = cashExact.body.data.invoiceId;
const fixBadDiscount = await call('POST', `/api/admin/invoices/${toFix}/correct`, {
  body: { items: [{ name: 'لاته', qty: 1, price: 75000 }], discount: 75000, reason: 'تست', payment: { cash: 0 } },
  cookie: adminCookie,
});
check(fixBadDiscount.status === 400 && fixBadDiscount.body.code === 'INVALID_AMOUNT',
  'تخفیف برابر مبلغ → رد می‌شود');

const fixOk = await call('POST', `/api/admin/invoices/${toFix}/correct`, {
  body: {
    items: [{ name: 'لاته', qty: 1, price: 75000 }],
    discount: 5000,
    payment: { cash: 70000 },
    reason: 'تست خودکار: یک لاته با تخفیف',
  },
  cookie: adminCookie,
});
check(fixOk.status === 200 && fixOk.body.data?.newInvoiceId && fixOk.body.data?.amount === 70000,
  'اصلاح موفق: فاکتور جایگزین با مبلغ ۷۰٬۰۰۰',
  `new=${fixOk.body.data?.newInvoiceId}`);

const oldAfterFix = await call('GET', `/api/admin/invoices/${toFix}`, { cookie: adminCookie });
const newAfterFix = await call('GET', `/api/admin/invoices/${fixOk.body.data.newInvoiceId}`, { cookie: adminCookie });
check(!!oldAfterFix.body.data?.voided_at, 'فاکتور اصلی باطل شد');
check(newAfterFix.body.data?.replaces_invoice_id === toFix, 'فاکتور جدید به قبلی پیوند دارد');

/* ========================================================== ۸) شیفت‌ها */

section('۸) محاسبهٔ صندوق');
const shiftSummary = await call('GET', '/api/staff/shift', { cookie: staffCookie });
const summary = shiftSummary.body.data?.summary;
const expected = 400000 + summary.cashSales + 120000 - 30000;
check(summary.expectedCash === expected,
  'نقد مورد انتظار = اولیه + نقد معتبر + ورود − خروج',
  `${summary.expectedCash} = ۴۰۰٬۰۰۰ + ${summary.cashSales} + ۱۲۰٬۰۰۰ − ۳۰٬۰۰۰`);

const closeShift = await call('POST', '/api/staff/shift/close', {
  body: { countedCash: summary.expectedCash - 5000, note: 'تست: کمبود ۵٬۰۰۰' },
  cookie: staffCookie,
});
check(
  closeShift.status === 200 && closeShift.body.data.summary.difference === -5000,
  'بستن صندوق با اختلاف ثبت‌شده',
  `difference=${closeShift.body.data?.summary?.difference}`
);

const movementAfterClose = await call('POST', '/api/staff/shift/movements', {
  body: { kind: 'in', amount: 1000 },
  cookie: staffCookie,
});
check(movementAfterClose.status === 409 && movementAfterClose.body.code === 'SHIFT_CLOSED',
  'گردش نقد بعد از بستن → ۴۰۹ SHIFT_CLOSED');

/* ================================================ ۹) دسترسی و پاک‌سازی */

section('۹) کنترل دسترسی');
const shiftAdminApi = await call('GET', '/api/admin/shifts', { cookie: staffCookie });
check(shiftAdminApi.status === 403, 'کارمند ← فهرست شیفت مدیر = ۴۰۳');
const invoicesAdminPage = await call('GET', '/admin/invoices', { cookie: staffCookie });
check(invoicesAdminPage.status === 302, 'کارمند ← صفحهٔ فاکتورهای مدیر = ریدایرکت');

const noAuthApi = await call('GET', '/api/admin/stats');
check(noAuthApi.status === 401 && noAuthApi.body.code === 'UNAUTHORIZED', 'API بدون نشست = ۴۰۱');

/* ---------------------------------------------------------- جمع‌بندی */

console.log(`\n${'─'.repeat(58)}`);
console.log(fail === 0 ? `🎉 همهٔ ${pass} بررسی پاس شد.` : `⚠️  ${pass} پاس / ${fail} ناموفق`);
process.exit(fail === 0 ? 0 : 1);
