/**
 * ============================================================================
 *  باشگاه مشتریان کافه — Cloudflare Worker
 * ----------------------------------------------------------------------------
 *  Hono + Cloudflare D1 + JWT (hono/jwt) + Tailwind CDN + Vanilla JS
 *  همه‌ی مسیرها، API ها، صفحات و جاب‌های Cron در همین پروژه قرار دارند.
 * ============================================================================
 */
import { Hono } from 'hono';

import type { AppEnv, Bindings, InvoiceItem, Role } from './types';
import {
  attachUser,
  assertJwtSecret,
  checkRateLimit,
  clearSessionCookie,
  clientKey,
  createToken,
  getActiveUser,
  homeForRole,
  isSecureRequest,
  requireApiRole,
  requirePageRole,
  resetRateLimit,
  setSessionCookie,
} from './lib/auth';
import {
  adjustPoints,
  createCoupon,
  customerActivityStatus,
  evaluateCoupon,
  findUserByPhone,
  findUserById,
  getCustomerDetail,
  getDashboardStats,
  listCoupons,
  listCustomers,
  listInvoices,
  listSmsLogs,
  listStaff,
  recordInvoice,
  registerCustomer,
} from './lib/db';
import { loadMenuItems, loadSettings, saveSetting } from './lib/settings';
import { fetchWeather, renderSms, sendSms, weatherSummary } from './lib/sms';
import {
  dispatchCron,
  getJobRuns,
  isJobName,
  runJobByName,
} from './lib/jobs';
import { hashPassword, verifyPassword, generateCouponCode } from './lib/crypto';
import {
  DEFAULT_TIMEZONE,
  fail,
  formatJalali,
  formatNumberFa,
  isValidBirthDate,
  normalizePhone,
  ok,
  toIntInRange,
  toPersianDigits,
  toPositiveInt,
  todayISO,
  utcStamp,
  zonedDayRange,
  jalaliMonthRange,
  jalaliWeekday,
} from './lib/utils';

import { errorPage } from './ui/layout';
import { landingPage, loginPage, registerPage } from './ui/public';
import { staffPage, staffHistoryPage, customerSummaryForApi } from './ui/staff';
import {
  adminCustomerDetailPage,
  adminCustomersPage,
  adminDashboardPage,
  adminInvoicesPage,
  customersCsv,
} from './ui/admin';
import {
  adminCouponsPage,
  adminSettingsPage,
  adminSmsPage,
  adminStaffPage,
} from './ui/adminManage';

/* ==========================================================================
 *  راه‌اندازی اپلیکیشن
 * ========================================================================== */

const app = new Hono<AppEnv>();

const TIMEZONE = DEFAULT_TIMEZONE;

/* --------------------------------------------------------------------------
 *  هدرهای امنیتی
 * -------------------------------------------------------------------------- */
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-XSS-Protection', '0');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Cross-Origin-Opener-Policy', 'same-origin');

  const contentType = c.res.headers.get('Content-Type') ?? '';
  if (contentType.includes('text/html')) {
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  // داده‌های احراز هویت‌شده و JSON هرگز در کش ذخیره نشوند
  if (c.req.path.startsWith('/api/')) {
    c.header('Cache-Control', 'no-store');
  }
});

/* --------------------------------------------------------------------------
 *  بارگذاری تنظیمات و کاربر در هر درخواست
 * -------------------------------------------------------------------------- */
app.use('*', async (c, next) => {
  const settings = await loadSettings(c.env);
  c.set('settings', settings);
  await next();
});

app.use('*', attachUser);

/* --------------------------------------------------------------------------
 *  محافظ CSRF: درخواست‌های تغییردهنده باید هم‌مبدأ باشند
 * -------------------------------------------------------------------------- */
app.use('/api/*', async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    await next();
    return;
  }

  const origin = c.req.header('Origin');
  if (origin) {
    try {
      const requestUrl = new URL(c.req.url);
      const originUrl = new URL(origin);
      if (originUrl.host !== requestUrl.host) {
        return c.json({ ok: false, error: 'درخواست غیرمجاز (CSRF).' }, 403);
      }
    } catch {
      return c.json({ ok: false, error: 'مبدأ درخواست نامعتبر است.' }, 403);
    }
  }

  await next();
});

/* --------------------------------------------------------------------------
 *  محدودسازی نرخ عمومی API
 * -------------------------------------------------------------------------- */
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'GET') {
    await next();
    return;
  }
  const limit = checkRateLimit(`api:${clientKey(c)}`, 120, 60_000);
  if (!limit.allowed) {
    c.header('Retry-After', String(limit.retryAfter));
    return c.json({ ok: false, error: 'تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.' }, 429);
  }
  await next();
});

/* ==========================================================================
 *  صفحات عمومی
 * ========================================================================== */

app.get('/', (c) => {
  const settings = c.get('settings');
  const user = c.get('user');
  if (user) {
    return c.redirect(homeForRole(user.role), 302);
  }
  return c.html(landingPage(settings));
});

app.get('/register', (c) => {
  const settings = c.get('settings');
  const ref = (c.req.query('ref') ?? '').trim().slice(0, 30);
  const phone = normalizePhone(c.req.query('phone') ?? '');
  return c.html(registerPage(settings, ref, /^09\d{9}$/.test(phone) ? phone : ''));
});

app.get('/login', (c) => {
  const settings = c.get('settings');
  const user = c.get('user');
  if (user) return c.redirect(homeForRole(user.role), 302);
  const next = (c.req.query('next') ?? '').slice(0, 200);
  return c.html(loginPage(settings, next));
});

/* ==========================================================================
 *  صفحات محافظت‌شده — کارمند
 * ========================================================================== */

app.get('/staff', requirePageRole('staff', 'admin'), async (c) => {
  const settings = c.get('settings');
  const user = c.get('user')!;
  const menu = await loadMenuItems(c.env);
  const day = zonedDayRange(TIMEZONE);

  const statsRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS s
     FROM invoices WHERE registered_by = ? AND created_at >= ? AND created_at < ?`
  )
    .bind(user.uid, day.start, day.end)
    .first<{ c: number; s: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.amount, i.created_at, u.name AS customer_name
     FROM invoices i JOIN users u ON u.id = i.user_id
     WHERE i.registered_by = ? AND i.created_at >= ? AND i.created_at < ?
     ORDER BY i.id DESC LIMIT 8`
  )
    .bind(user.uid, day.start, day.end)
    .all<{ id: number; amount: number; created_at: string; customer_name: string }>();

  return c.html(
    staffPage(
      settings,
      { name: user.name },
      menu,
      { count: statsRow?.c ?? 0, total: statsRow?.s ?? 0 },
      results ?? [],
      user.role === 'admin'
    )
  );
});

app.get('/staff/history', requirePageRole('staff', 'admin'), async (c) => {
  const settings = c.get('settings');
  const user = c.get('user')!;

  const { results } = await c.env.DB.prepare(
    `SELECT i.*, u.name AS customer_name, u.phone AS customer_phone, s.name AS registered_name
     FROM invoices i
     JOIN users u ON u.id = i.user_id
     LEFT JOIN users s ON s.id = i.registered_by
     WHERE i.registered_by = ?
     ORDER BY i.id DESC
     LIMIT 100`
  )
    .bind(user.uid)
    .all<InvoiceRowWithCustomer>();

  const summaryRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS s FROM invoices WHERE registered_by = ?`
  )
    .bind(user.uid)
    .first<{ c: number; s: number }>();

  return c.html(
    staffHistoryPage(settings, { name: user.name }, results ?? [], {
      count: summaryRow?.c ?? 0,
      total: summaryRow?.s ?? 0,
    })
  );
});

/* ==========================================================================
 *  صفحات محافظت‌شده — ادمین
 * ========================================================================== */

app.get('/admin', requirePageRole('admin'), async (c) => {
  const settings = c.get('settings');
  const user = c.get('user')!;
  const day = zonedDayRange(TIMEZONE);
  const month = jalaliMonthRange(TIMEZONE);
  const thirtyDaysAgo = utcStamp(Date.now() - 30 * 86_400_000);

  const [stats, jobRuns] = await Promise.all([
    getDashboardStats(
      c.env.DB,
      settings,
      day.start,
      day.end,
      month.start,
      thirtyDaysAgo
    ),
    getJobRuns(c.env),
  ]);

  const hasWeatherKey = !!(c.env.OPENWEATHER_API_KEY || settings.weather_api_key);
  const weather = hasWeatherKey
    ? await fetchWeather(c.env, settings)
    : {
        ok: false,
        city: settings.cafe_city,
        temp: 0,
        conditionId: 0,
        description: '',
        label: '',
        advice: '',
        emoji: '',
        error: 'کلید API هواشناسی تنظیم نشده است',
      };

  return c.html(
    adminDashboardPage({
      settings,
      userName: user.name,
      stats,
      weather,
      jobRuns,
      monthLabel: month.label,
      todayLabel: `${jalaliWeekday(day.dateISO)} ${formatJalali(day.dateISO)}`,
    })
  );
});

app.get('/admin/customers', requirePageRole('admin'), async (c) => {
  const settings = c.get('settings');
  const user = c.get('user')!;

  const page = toPositiveInt(c.req.query('page'), 1) || 1;
  const tier = c.req.query('tier') ?? '';
  const statusParam = c.req.query('status') ?? '';
  const status =
    statusParam === 'sleeping' || statusParam === 'active' || statusParam === 'no_visit'
      ? statusParam
      : undefined;
  const sortParam = c.req.query('sort') ?? '';
  const sort =
    sortParam === 'points' || sortParam === 'created' || sortParam === 'name'
      ? sortParam
      : undefined;

  const result = await listCustomers(c.env.DB, {
    q: c.req.query('q') ?? '',
    tier,
    status,
    sort,
    page,
    pageSize: 20,
    graceDays: settings.churn_grace_days,
  });

  return c.html(
    adminCustomersPage({
      settings,
      userName: user.name,
      customers: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      params: {
        q: c.req.query('q') ?? '',
        tier,
        status,
        sort,
        page,
      },
    })
  );
});

app.get('/admin/customers/:id', requirePageRole('admin'), async (c) => {
  const settings = c.get('settings');
  const user = c.get('user')!;
  const id = toPositiveInt(c.req.param('id'), 0);

  if (!id) {
    return c.html(errorPage(404, 'شناسه مشتری نامعتبر است.', settings.cafe_name), 404);
  }

  const detail = await getCustomerDetail(c.env.DB, id);
  if (!detail.user) {
    return c.html(errorPage(404, 'مشتری مورد نظر یافت نشد.', settings.cafe_name), 404);
  }

  return c.html(
    adminCustomerDetailPage({
      settings,
      userName: user.name,
      user: detail.user,
      invoices: detail.invoices,
      coupons: detail.coupons,
      referrer: detail.referrer,
      referrals: detail.referrals,
      totalSpent: detail.totalSpent,
      visitCount: detail.visitCount,
    })
  );
});

app.get('/admin/invoices', requirePageRole('admin'), async (c) => {
  const settings = c.get('settings');
  const user = c.get('user')!;
  const page = toPositiveInt(c.req.query('page'), 1) || 1;

  const result = await listInvoices(c.env.DB, {
    q: c.req.query('q') ?? '',
    from: c.req.query('from') ?? '',
    to: c.req.query('to') ?? '',
    page,
    pageSize: 25,
  });

  return c.html(
    adminInvoicesPage({
      settings,
      userName: user.name,
      invoices: result.items,
      total: result.total,
      sum: result.sum,
      page: result.page,
      pageSize: result.pageSize,
      filters: {
        q: c.req.query('q') ?? '',
        from: c.req.query('from') ?? '',
        to: c.req.query('to') ?? '',
      },
    })
  );
});

app.get('/admin/settings', requirePageRole('admin'), async (c) => {
  const settings = c.get('settings');
  const user = c.get('user')!;
  const menu = await loadMenuItems(c.env);
  const day = zonedDayRange(TIMEZONE);

  const smsRow = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
       COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
     FROM sms_logs WHERE sent_at >= ? AND sent_at < ?`
  )
    .bind(day.start, day.end)
    .first<{ sent: number; failed: number }>();

  return c.html(
    adminSettingsPage({
      settings,
      userName: user.name,
      menu,
      smsToday: { sent: smsRow?.sent ?? 0, failed: smsRow?.failed ?? 0 },
    })
  );
});

app.get('/admin/staff', requirePageRole('admin'), async (c) => {
  const settings = c.get('settings');
  const user = c.get('user')!;
  const staff = await listStaff(c.env.DB);

  return c.html(
    adminStaffPage({
      settings,
      userName: user.name,
      currentUserId: user.uid,
      staff,
    })
  );
});

app.get('/admin/sms', requirePageRole('admin'), async (c) => {
  const settings = c.get('settings');
  const user = c.get('user')!;
  const page = toPositiveInt(c.req.query('page'), 1) || 1;
  const type = c.req.query('type') ?? '';
  const status = c.req.query('status') ?? '';

  const result = await listSmsLogs(c.env.DB, { type, status, page, pageSize: 30 });

  const day = zonedDayRange(TIMEZONE);
  const statsRow = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
       COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
     FROM sms_logs WHERE sent_at >= ? AND sent_at < ?`
  )
    .bind(day.start, day.end)
    .first<{ sent: number; failed: number }>();

  return c.html(
    adminSmsPage({
      settings,
      userName: user.name,
      logs: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      filters: { type, status },
      stats: { sentToday: statsRow?.sent ?? 0, failedToday: statsRow?.failed ?? 0 },
    })
  );
});

app.get('/admin/coupons', requirePageRole('admin'), async (c) => {
  const settings = c.get('settings');
  const user = c.get('user')!;
  const page = toPositiveInt(c.req.query('page'), 1) || 1;
  const status = c.req.query('status') ?? '';

  const result = await listCoupons(c.env.DB, { page, pageSize: 25, status });

  return c.html(
    adminCouponsPage({
      settings,
      userName: user.name,
      coupons: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      status,
    })
  );
});

app.get('/admin/export/customers.csv', requirePageRole('admin'), async (c) => {
  const settings = c.get('settings');
  const all: Awaited<ReturnType<typeof listCustomers>>['items'] = [];
  let page = 1;
  let total = Infinity;

  while (all.length < total && page <= 20) {
    const chunk = await listCustomers(c.env.DB, {
      q: c.req.query('q') ?? '',
      tier: c.req.query('tier') ?? '',
      page,
      pageSize: 100,
      graceDays: settings.churn_grace_days,
    });
    total = chunk.total;
    all.push(...chunk.items);
    if (chunk.items.length < 100) break;
    page += 1;
  }

  const csv = customersCsv(all);
  const filename = `customers-${todayISO()}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});

/* ==========================================================================
 *  API — احراز هویت
 * ========================================================================== */

app.post('/api/auth/login', async (c) => {
  const secret = assertJwtSecret(c.env);
  if (!secret) {
    return fail(c, 'کلید JWT تنظیم نشده است. با دستور «wrangler secret put JWT_SECRET» آن را تنظیم کنید.', 500, 'NO_SECRET');
  }

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, 'داده‌های ارسالی نامعتبر است.', 400, 'BAD_JSON');
  }

  const phone = normalizePhone(String(body.phone ?? ''));
  const password = String(body.password ?? '');

  if (!/^09\d{9}$/.test(phone) || password.length < 1) {
    return fail(c, 'شماره موبایل و رمز عبور را وارد کنید.', 400, 'INVALID_INPUT');
  }
  if (password.length > 200) {
    return fail(c, 'رمز عبور نامعتبر است.', 400, 'INVALID_INPUT');
  }

  const rateKey = `login:${clientKey(c)}:${phone}`;
  const rate = checkRateLimit(rateKey, 8, 15 * 60_000);
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfter));
    return fail(c, 'تلاش‌های ناموفق زیاد بوده است. ۱۵ دقیقه بعد دوباره تلاش کنید.', 429, 'RATE_LIMITED');
  }

  const user = await findUserByPhone(c.env.DB, phone);
  if (!user || (user.role !== 'staff' && user.role !== 'admin')) {
    return fail(c, 'شماره موبایل یا رمز عبور اشتباه است.', 401, 'INVALID_CREDENTIALS');
  }
  if (user.is_active !== 1) {
    return fail(c, 'حساب شما غیرفعال شده است. با مدیر تماس بگیرید.', 403, 'ACCOUNT_DISABLED');
  }
  if (!user.password_hash) {
    return fail(c, 'برای این حساب رمز عبور تنظیم نشده است.', 403, 'NO_PASSWORD');
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return fail(c, 'شماره موبایل یا رمز عبور اشتباه است.', 401, 'INVALID_CREDENTIALS');
  }

  resetRateLimit(rateKey);

  const token = await createToken(secret, user);
  setSessionCookie(c, token, isSecureRequest(c));

  return ok(c, {
    name: user.name,
    role: user.role,
    redirect: homeForRole(user.role),
  });
});

app.post('/api/auth/register', async (c) => {
  const settings = c.get('settings');

  const rate = checkRateLimit(`register:${clientKey(c)}`, 6, 10 * 60_000);
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfter));
    return fail(c, 'تعداد ثبت‌نام‌ها زیاد است. کمی بعد تلاش کنید.', 429, 'RATE_LIMITED');
  }

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, 'داده‌های ارسالی نامعتبر است.', 400, 'BAD_JSON');
  }

  const name = String(body.name ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const phone = normalizePhone(String(body.phone ?? ''));
  const birthDate = String(body.birth_date ?? '').slice(0, 10);
  const referral = String(body.referral ?? '').trim().slice(0, 30);

  if (name.length < 2) {
    return fail(c, 'نام و نام خانوادگی را کامل وارد کنید.', 400, 'INVALID_NAME');
  }
  if (!/^09\d{9}$/.test(phone)) {
    return fail(c, 'شماره موبایل باید با ۰۹ شروع شده و ۱۱ رقم باشد.', 400, 'INVALID_PHONE');
  }
  if (!isValidBirthDate(birthDate)) {
    return fail(c, 'تاریخ تولد نامعتبر است.', 400, 'INVALID_BIRTH_DATE');
  }

  const result = await registerCustomer(c.env, settings, {
    name,
    phone,
    birth_date: birthDate,
    referral: referral || null,
  });

  if (result.ok === false) {
    const status = result.code === 'PHONE_EXISTS' ? 409 : result.code === 'INVALID_REFERRAL' ? 400 : 500;
    return fail(c, result.error, status, result.code);
  }

  return ok(
    c,
    {
      name: result.user.name,
      phone: result.user.phone,
      points: result.user.points,
      tier: result.user.tier,
      referralCode: result.referralCode,
      referrerName: result.referrerName,
    },
    201
  );
});

app.post('/api/auth/logout', (c) => {
  clearSessionCookie(c, isSecureRequest(c));
  return ok(c, { loggedOut: true });
});

app.get('/api/auth/logout', (c) => {
  clearSessionCookie(c, isSecureRequest(c));
  return c.redirect('/login', 302);
});

app.get('/api/auth/me', async (c) => {
  const user = c.get('user');
  if (!user) return ok(c, { authenticated: false, user: null });

  const dbUser = await getActiveUser(c.env.DB, user.uid);
  if (!dbUser) return ok(c, { authenticated: false, user: null });

  return ok(c, {
    authenticated: true,
    user: {
      id: dbUser.id,
      name: dbUser.name,
      phone: dbUser.phone,
      role: dbUser.role,
    },
  });
});

/* ==========================================================================
 *  API — کارمند
 * ========================================================================== */

app.get('/api/staff/customer', requireApiRole('staff', 'admin'), async (c) => {
  const settings = c.get('settings');
  const phone = normalizePhone(c.req.query('phone') ?? '');

  if (!/^09\d{9}$/.test(phone)) {
    return fail(c, 'شماره موبایل نامعتبر است.', 400, 'INVALID_PHONE');
  }

  const user = await findUserByPhone(c.env.DB, phone);
  if (!user || user.role !== 'customer') {
    return ok(c, { found: false, customer: null });
  }

  const status = customerActivityStatus(user, settings.churn_grace_days);

  const { results: coupons } = await c.env.DB.prepare(
    `SELECT code, kind, value FROM coupons
     WHERE is_active = 1
       AND (user_id IS NULL OR user_id = ?)
       AND used_count < max_uses
       AND (expires_at IS NULL OR expires_at >= datetime('now'))
     ORDER BY id DESC LIMIT 5`
  )
    .bind(user.id)
    .all<{ code: string; kind: string; value: number }>();

  return ok(c, {
    found: true,
    customer: customerSummaryForApi(user, status, coupons ?? []),
  });
});

app.get('/api/staff/coupons/check', requireApiRole('staff', 'admin'), async (c) => {
  const userId = toPositiveInt(c.req.query('userId'), 0);
  const subtotal = toPositiveInt(c.req.query('subtotal'), 0);
  const code = (c.req.query('code') ?? '').trim();

  if (!userId || subtotal <= 0) {
    return ok(c, { valid: false, discount: 0, error: 'مبلغ یا مشتری نامعتبر است.' });
  }

  const result = await evaluateCoupon(c.env.DB, code, userId, subtotal);
  if (result.ok === false) {
    return ok(c, { valid: false, discount: 0, error: result.error });
  }

  return ok(c, {
    valid: true,
    discount: result.discount,
    code: result.coupon.code,
    kind: result.coupon.kind,
    value: result.coupon.value,
  });
});

app.post('/api/staff/invoices', requireApiRole('staff', 'admin'), async (c) => {
  const settings = c.get('settings');
  const user = c.get('user')!;

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, 'داده‌های ارسالی نامعتبر است.', 400, 'BAD_JSON');
  }

  const userId = toPositiveInt(body.userId, 0);
  if (!userId) return fail(c, 'مشتری را انتخاب کنید.', 400, 'INVALID_USER');

  const items = Array.isArray(body.items) ? (body.items as InvoiceItem[]) : [];
  if (items.length > 50) return fail(c, 'تعداد آیتم‌ها بیش از حد مجاز است.', 400, 'TOO_MANY_ITEMS');

  const amountRaw = body.amount === null || body.amount === undefined ? null : Number(body.amount);
  const couponCode = body.couponCode ? String(body.couponCode).trim().slice(0, 30) : null;

  const result = await recordInvoice(c.env, settings, {
    userId,
    items,
    amount: amountRaw === null || !Number.isFinite(amountRaw) ? null : Math.floor(amountRaw),
    couponCode,
    registeredBy: user.uid,
  });

  if (result.ok === false) {
    const status = result.code === 'USER_NOT_FOUND' ? 404 : 400;
    return fail(c, result.error, status, result.code);
  }

  return ok(c, result, 201);
});

app.get('/api/staff/invoices/today', requireApiRole('staff', 'admin'), async (c) => {
  const user = c.get('user')!;
  const day = zonedDayRange(TIMEZONE);

  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.amount, i.created_at, u.name AS customer_name
     FROM invoices i JOIN users u ON u.id = i.user_id
     WHERE i.registered_by = ? AND i.created_at >= ? AND i.created_at < ?
     ORDER BY i.id DESC LIMIT 50`
  )
    .bind(user.uid, day.start, day.end)
    .all<{ id: number; amount: number; created_at: string; customer_name: string }>();

  return ok(c, { invoices: results ?? [] });
});

/* ==========================================================================
 *  API — ادمین
 * ========================================================================== */

app.get('/api/admin/stats', requireApiRole('admin'), async (c) => {
  const settings = c.get('settings');
  const day = zonedDayRange(TIMEZONE);
  const month = jalaliMonthRange(TIMEZONE);

  const stats = await getDashboardStats(
    c.env.DB,
    settings,
    day.start,
    day.end,
    month.start,
    utcStamp(Date.now() - 30 * 86_400_000)
  );

  return ok(c, stats);
});

app.post('/api/admin/customers', requireApiRole('admin'), async (c) => {
  const settings = c.get('settings');

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, 'داده‌های ارسالی نامعتبر است.', 400, 'BAD_JSON');
  }

  const name = String(body.name ?? '').replace(/[<>]/g, '').trim().slice(0, 60);
  const phone = normalizePhone(String(body.phone ?? ''));
  const birthDate = String(body.birth_date ?? '').slice(0, 10);
  const referral = String(body.referral ?? '').trim().slice(0, 30);

  if (name.length < 2) return fail(c, 'نام را کامل وارد کنید.', 400, 'INVALID_NAME');
  if (!/^09\d{9}$/.test(phone)) return fail(c, 'شماره موبایل نامعتبر است.', 400, 'INVALID_PHONE');
  if (!isValidBirthDate(birthDate)) return fail(c, 'تاریخ تولد نامعتبر است.', 400, 'INVALID_BIRTH_DATE');

  const result = await registerCustomer(c.env, settings, {
    name,
    phone,
    birth_date: birthDate,
    referral: referral || null,
  });

  if (result.ok === false) {
    return fail(c, result.error, result.code === 'PHONE_EXISTS' ? 409 : 400, result.code);
  }

  return ok(c, { id: result.user.id, name: result.user.name, referralCode: result.referralCode }, 201);
});

app.put('/api/admin/customers/:id', requireApiRole('admin'), async (c) => {
  const id = toPositiveInt(c.req.param('id'), 0);
  if (!id) return fail(c, 'شناسه نامعتبر است.', 400, 'INVALID_ID');

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, 'داده‌های ارسالی نامعتبر است.', 400, 'BAD_JSON');
  }

  const user = await findUserById(c.env.DB, id);
  if (!user) return fail(c, 'مشتری یافت نشد.', 404, 'NOT_FOUND');

  const name = String(body.name ?? '').replace(/[<>]/g, '').trim().slice(0, 60);
  const phone = normalizePhone(String(body.phone ?? ''));
  const birthDate = String(body.birth_date ?? '').slice(0, 10);

  if (name.length < 2) return fail(c, 'نام را کامل وارد کنید.', 400, 'INVALID_NAME');
  if (!/^09\d{9}$/.test(phone)) return fail(c, 'شماره موبایل نامعتبر است.', 400, 'INVALID_PHONE');
  if (!isValidBirthDate(birthDate)) return fail(c, 'تاریخ تولد نامعتبر است.', 400, 'INVALID_BIRTH_DATE');

  if (phone !== user.phone) {
    const duplicate = await findUserByPhone(c.env.DB, phone);
    if (duplicate && duplicate.id !== id) {
      return fail(c, 'این شماره موبایل قبلاً برای کاربر دیگری ثبت شده است.', 409, 'PHONE_EXISTS');
    }
  }

  await c.env.DB.prepare('UPDATE users SET name = ?, phone = ?, birth_date = ? WHERE id = ?')
    .bind(name, phone, birthDate, id)
    .run();

  return ok(c, { updated: true });
});

app.post('/api/admin/customers/:id/points', requireApiRole('admin'), async (c) => {
  const settings = c.get('settings');
  const id = toPositiveInt(c.req.param('id'), 0);
  if (!id) return fail(c, 'شناسه نامعتبر است.', 400, 'INVALID_ID');

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, 'داده‌های ارسالی نامعتبر است.', 400, 'BAD_JSON');
  }

  const delta = Math.trunc(Number(body.delta));
  if (!Number.isFinite(delta) || delta === 0) {
    return fail(c, 'مقدار تغییر امتیاز نامعتبر است.', 400, 'INVALID_DELTA');
  }
  if (Math.abs(delta) > 1_000_000) {
    return fail(c, 'مقدار تغییر امتیاز بیش از حد مجاز است.', 400, 'INVALID_DELTA');
  }

  const result = await adjustPoints(c.env.DB, settings, id, delta);
  if (result.ok === false) return fail(c, result.error, 404, 'NOT_FOUND');

  return ok(c, { points: result.points, tier: result.tier });
});

app.post('/api/admin/customers/:id/deactivate', requireApiRole('admin'), async (c) => {
  const id = toPositiveInt(c.req.param('id'), 0);
  if (!id) return fail(c, 'شناسه نامعتبر است.', 400, 'INVALID_ID');

  await c.env.DB.prepare(`UPDATE users SET is_active = 0 WHERE id = ? AND role = 'customer'`)
    .bind(id)
    .run();
  return ok(c, { isActive: false });
});

app.post('/api/admin/customers/:id/activate', requireApiRole('admin'), async (c) => {
  const id = toPositiveInt(c.req.param('id'), 0);
  if (!id) return fail(c, 'شناسه نامعتبر است.', 400, 'INVALID_ID');

  await c.env.DB.prepare(`UPDATE users SET is_active = 1 WHERE id = ? AND role = 'customer'`)
    .bind(id)
    .run();
  return ok(c, { isActive: true });
});

app.get('/api/admin/settings', requireApiRole('admin'), async (c) => {
  const settings = c.get('settings');
  const menu = await loadMenuItems(c.env);
  return ok(c, { settings, menu });
});

app.put('/api/admin/settings', requireApiRole('admin'), async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, 'داده‌های ارسالی نامعتبر است.', 400, 'BAD_JSON');
  }

  try {
    if (body.cafe_name !== undefined) {
      await saveSetting(c.env, 'cafe_name', String(body.cafe_name).trim().slice(0, 60) || 'کافه');
    }
    if (body.cafe_city !== undefined) {
      await saveSetting(c.env, 'cafe_city', String(body.cafe_city).trim().slice(0, 60) || 'تهران');
    }
    if (body.currency_unit !== undefined) {
      await saveSetting(c.env, 'currency_unit', toIntInRange(body.currency_unit, 1, 10_000_000, 1000));
    }
    if (body.points_per_currency !== undefined) {
      await saveSetting(c.env, 'points_per_currency', toIntInRange(body.points_per_currency, 1, 1000, 1));
    }
    if (body.referral_reward_points !== undefined) {
      await saveSetting(c.env, 'referral_reward_points', toIntInRange(body.referral_reward_points, 0, 1_000_000, 50));
    }
    if (body.churn_grace_days !== undefined) {
      await saveSetting(c.env, 'churn_grace_days', toIntInRange(body.churn_grace_days, 0, 60, 2));
    }
    if (body.churn_min_visits !== undefined) {
      await saveSetting(c.env, 'churn_min_visits', toIntInRange(body.churn_min_visits, 1, 100, 3));
    }
    if (body.birthday_coupon_percent !== undefined) {
      await saveSetting(c.env, 'birthday_coupon_percent', toIntInRange(body.birthday_coupon_percent, 1, 100, 15));
    }

    if (body.tiers && typeof body.tiers === 'object') {
      const tiers = body.tiers as Record<string, unknown>;
      const silver = toIntInRange(tiers.silver, 1, 100_000_000, 500);
      const gold = toIntInRange(tiers.gold, 2, 100_000_000, 2000);
      const vip = toIntInRange(tiers.vip, 3, 100_000_000, 5000);
      if (!(silver < gold && gold < vip)) {
        return fail(c, 'آستانه‌های سطح باید صعودی باشند (نقره‌ای < طلایی < الماسی).', 400, 'INVALID_TIERS');
      }
      await saveSetting(c.env, 'tiers', { silver, gold, vip });
    }

    if (body.sms_provider !== undefined) {
      const provider = body.sms_provider === 'kavenegar' ? 'kavenegar' : 'console';
      await saveSetting(c.env, 'sms_provider', provider);
    }
    if (body.sms_api_key !== undefined) {
      await saveSetting(c.env, 'sms_api_key', String(body.sms_api_key).trim().slice(0, 300));
    }
    if (body.sms_sender !== undefined) {
      await saveSetting(c.env, 'sms_sender', String(body.sms_sender).trim().slice(0, 30));
    }
    if (body.weather_api_key !== undefined) {
      await saveSetting(c.env, 'weather_api_key', String(body.weather_api_key).trim().slice(0, 200));
    }

    if (body.sms_templates && typeof body.sms_templates === 'object') {
      const templates = body.sms_templates as Record<string, unknown>;
      const keys = ['welcome', 'invoice', 'birthday', 'churn', 'weather'] as const;
      const current = c.get('settings').sms_templates;
      const next: Record<string, string> = { ...current };
      for (const key of keys) {
        if (templates[key] !== undefined) {
          next[key] = String(templates[key]).slice(0, 1000);
        }
      }
      await saveSetting(c.env, 'sms_templates', next);
    }

    if (Array.isArray(body.menu_items)) {
      const menu = (body.menu_items as Array<Record<string, unknown>>)
        .slice(0, 100)
        .map((item) => ({
          name: String(item.name ?? '').replace(/[<>]/g, '').trim().slice(0, 60),
          price: toIntInRange(item.price, 0, 1_000_000_000, 0),
          category: String(item.category ?? '').replace(/[<>]/g, '').trim().slice(0, 30),
        }))
        .filter((item) => item.name.length > 0);
      if (menu.length === 0) {
        return fail(c, 'حداقل یک آیتم در منو لازم است.', 400, 'INVALID_MENU');
      }
      await saveSetting(c.env, 'menu_items', menu);
    }

    return ok(c, { saved: true });
  } catch (error) {
    console.error('settings update failed:', error);
    return fail(c, 'خطا در ذخیره تنظیمات.', 500, 'DB_ERROR');
  }
});

app.post('/api/admin/jobs/:job', requireApiRole('admin'), async (c) => {
  const job = c.req.param('job');
  if (!isJobName(job)) {
    return fail(c, 'جاب مورد نظر وجود ندارد.', 404, 'UNKNOWN_JOB');
  }

  const settings = await loadSettings(c.env, true);
  const result = await runJobByName(c.env, settings, job, true);
  return ok(c, result);
});

app.post('/api/admin/test-sms', requireApiRole('admin'), async (c) => {
  const settings = c.get('settings');
  const user = c.get('user')!;
  const dbUser = await findUserById(c.env.DB, user.uid);
  if (!dbUser) return fail(c, 'کاربر یافت نشد.', 404, 'NOT_FOUND');

  const message = renderSms(settings, 'invoice', {
    name: dbUser.name,
    amount: formatNumberFa(125000),
    points: toPersianDigits(125),
    total_points: toPersianDigits(1250),
    tier: 'طلایی',
    discount: '۰',
    code: 'TEST',
  });

  const result = await sendSms(c.env, settings, {
    userId: dbUser.id,
    phone: dbUser.phone,
    type: 'admin',
    message: `[پیامک آزمایشی]\n${message}`,
  });

  return ok(c, {
    status: result.status,
    message:
      result.status === 'sent'
        ? `پیامک آزمایشی برای ${dbUser.phone} ثبت شد${settings.sms_provider === 'console' ? ' (حالت آزمایشی: فقط در لاگ)' : ''}.`
        : `ارسال ناموفق بود: ${result.error ?? 'خطای نامشخص'}`,
  });
});

app.get('/api/admin/weather', requireApiRole('admin'), async (c) => {
  const settings = c.get('settings');
  const weather = await fetchWeather(c.env, settings);
  return ok(c, {
    ok: weather.ok,
    message: weather.ok
      ? `${weather.city}: ${weatherSummary(weather)} — ${weather.advice}`
      : `دریافت آب‌وهوا ناموفق بود: ${weather.error ?? 'خطای نامشخص'}`,
    weather,
  });
});

/* ---------------------------- مدیریت کارمندان ---------------------------- */

app.get('/api/admin/staff', requireApiRole('admin'), async (c) => {
  const staff = await listStaff(c.env.DB);
  return ok(c, { staff });
});

app.post('/api/admin/staff', requireApiRole('admin'), async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, 'داده‌های ارسالی نامعتبر است.', 400, 'BAD_JSON');
  }

  const name = String(body.name ?? '').replace(/[<>]/g, '').trim().slice(0, 60);
  const phone = normalizePhone(String(body.phone ?? ''));
  const role = body.role === 'admin' ? 'admin' : 'staff';
  const password = String(body.password ?? '');

  if (name.length < 2) return fail(c, 'نام را کامل وارد کنید.', 400, 'INVALID_NAME');
  if (!/^09\d{9}$/.test(phone)) return fail(c, 'شماره موبایل نامعتبر است.', 400, 'INVALID_PHONE');
  if (password.length < 8 || password.length > 72) {
    return fail(c, 'رمز عبور باید بین ۸ تا ۷۲ کاراکتر باشد.', 400, 'INVALID_PASSWORD');
  }

  const exists = await findUserByPhone(c.env.DB, phone);
  if (exists) return fail(c, 'این شماره موبایل قبلاً ثبت شده است.', 409, 'PHONE_EXISTS');

  const passwordHash = await hashPassword(password);
  const referralCode = generateCouponCode('REF');

  const result = await c.env.DB.prepare(
    `INSERT INTO users (name, phone, role, is_active, password_hash, referral_code)
     VALUES (?, ?, ?, 1, ?, ?)`
  )
    .bind(name, phone, role, passwordHash, referralCode)
    .run();

  return ok(
    c,
    {
      id: Number(result.meta?.last_row_id ?? 0),
      name,
      phone,
      role,
      password,
    },
    201
  );
});

app.put('/api/admin/staff/:id', requireApiRole('admin'), async (c) => {
  const id = toPositiveInt(c.req.param('id'), 0);
  const currentUser = c.get('user')!;
  if (!id) return fail(c, 'شناسه نامعتبر است.', 400, 'INVALID_ID');

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, 'داده‌های ارسالی نامعتبر است.', 400, 'BAD_JSON');
  }

  const target = await findUserById(c.env.DB, id);
  if (!target || (target.role !== 'staff' && target.role !== 'admin')) {
    return fail(c, 'کاربر یافت نشد.', 404, 'NOT_FOUND');
  }

  if (body.is_active !== undefined) {
    const nextActive = Number(body.is_active) === 1 ? 1 : 0;
    if (id === currentUser.uid && nextActive === 0) {
      return fail(c, 'نمی‌توانید حساب خودتان را غیرفعال کنید.', 400, 'SELF_DISABLE');
    }
    if (nextActive === 0 && target.role === 'admin') {
      const adminCount = await c.env.DB.prepare(
        `SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1`
      ).first<{ c: number }>();
      if ((adminCount?.c ?? 0) <= 1) {
        return fail(c, 'حداقل یک ادمین فعال باید باقی بماند.', 400, 'LAST_ADMIN');
      }
    }
    await c.env.DB.prepare('UPDATE users SET is_active = ? WHERE id = ?').bind(nextActive, id).run();
  }

  if (body.role !== undefined) {
    const nextRole: Role = body.role === 'admin' ? 'admin' : 'staff';
    if (id === currentUser.uid && nextRole !== 'admin') {
      return fail(c, 'نمی‌توانید نقش خودتان را تغییر دهید.', 400, 'SELF_ROLE');
    }
    await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(nextRole, id).run();
  }

  return ok(c, { updated: true });
});

app.post('/api/admin/staff/:id/password', requireApiRole('admin'), async (c) => {
  const id = toPositiveInt(c.req.param('id'), 0);
  if (!id) return fail(c, 'شناسه نامعتبر است.', 400, 'INVALID_ID');

  const target = await findUserById(c.env.DB, id);
  if (!target || (target.role !== 'staff' && target.role !== 'admin')) {
    return fail(c, 'کاربر یافت نشد.', 404, 'NOT_FOUND');
  }

  const newPassword = generateReadablePassword(12);
  const passwordHash = await hashPassword(newPassword);

  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(passwordHash, id)
    .run();

  return ok(c, { password: newPassword });
});

app.delete('/api/admin/staff/:id', requireApiRole('admin'), async (c) => {
  const id = toPositiveInt(c.req.param('id'), 0);
  const currentUser = c.get('user')!;
  if (!id) return fail(c, 'شناسه نامعتبر است.', 400, 'INVALID_ID');
  if (id === currentUser.uid) return fail(c, 'نمی‌توانید حساب خودتان را حذف کنید.', 400, 'SELF_DELETE');

  const target = await findUserById(c.env.DB, id);
  if (!target || (target.role !== 'staff' && target.role !== 'admin')) {
    return fail(c, 'کاربر یافت نشد.', 404, 'NOT_FOUND');
  }

  if (target.role === 'admin') {
    const adminCount = await c.env.DB.prepare(
      `SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1`
    ).first<{ c: number }>();
    if ((adminCount?.c ?? 0) <= 1) {
      return fail(c, 'حداقل یک ادمین فعال باید باقی بماند.', 400, 'LAST_ADMIN');
    }
  }

  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return ok(c, { deleted: true });
});

app.post('/api/admin/me/password', requireApiRole('admin', 'staff'), async (c) => {
  const user = c.get('user')!;

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, 'داده‌های ارسالی نامعتبر است.', 400, 'BAD_JSON');
  }

  const current = String(body.current ?? '');
  const next = String(body.next ?? '');

  if (next.length < 8 || next.length > 72) {
    return fail(c, 'رمز جدید باید بین ۸ تا ۷۲ کاراکتر باشد.', 400, 'INVALID_PASSWORD');
  }

  const dbUser = await findUserById(c.env.DB, user.uid);
  if (!dbUser || !dbUser.password_hash) {
    return fail(c, 'کاربر یافت نشد.', 404, 'NOT_FOUND');
  }

  const valid = await verifyPassword(current, dbUser.password_hash);
  if (!valid) return fail(c, 'رمز فعلی اشتباه است.', 401, 'INVALID_PASSWORD');

  const passwordHash = await hashPassword(next);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(passwordHash, dbUser.id)
    .run();

  return ok(c, { changed: true });
});

/* ------------------------------ کدهای تخفیف ------------------------------ */

app.post('/api/admin/coupons', requireApiRole('admin'), async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, 'داده‌های ارسالی نامعتبر است.', 400, 'BAD_JSON');
  }

  const kind = body.kind === 'amount' ? 'amount' : 'percent';
  const value = Math.trunc(Number(body.value));
  const days = toIntInRange(body.days, 1, 365, 30);
  const maxUses = toIntInRange(body.maxUses, 1, 1000, 1);
  const userId = body.userId ? toPositiveInt(body.userId, 0) : null;
  const reason = String(body.reason ?? 'manual').slice(0, 30);

  if (!Number.isFinite(value) || value <= 0) {
    return fail(c, 'مقدار تخفیف نامعتبر است.', 400, 'INVALID_VALUE');
  }
  if (kind === 'percent' && value > 100) {
    return fail(c, 'درصد تخفیف نمی‌تواند بیش از ۱۰۰ باشد.', 400, 'INVALID_VALUE');
  }
  if (kind === 'amount' && value > 1_000_000_000) {
    return fail(c, 'مبلغ تخفیف بیش از حد مجاز است.', 400, 'INVALID_VALUE');
  }
  if (userId) {
    const target = await findUserById(c.env.DB, userId);
    if (!target) return fail(c, 'مشتری یافت نشد.', 404, 'NOT_FOUND');
  }

  const coupon = await createCoupon(c.env.DB, {
    userId,
    kind,
    value,
    reason,
    expiresAt: utcStamp(Date.now() + days * 86_400_000),
    maxUses,
  });

  if (!coupon) return fail(c, 'خطا در ساخت کد تخفیف.', 500, 'DB_ERROR');

  return ok(c, { id: coupon.id, code: coupon.code, value: coupon.value, kind: coupon.kind }, 201);
});

app.delete('/api/admin/coupons/:id', requireApiRole('admin'), async (c) => {
  const id = toPositiveInt(c.req.param('id'), 0);
  if (!id) return fail(c, 'شناسه نامعتبر است.', 400, 'INVALID_ID');

  await c.env.DB.prepare('UPDATE coupons SET is_active = 0 WHERE id = ?').bind(id).run();
  return ok(c, { deactivated: true });
});

/* ------------------------------ سلامت سرویس ------------------------------ */

app.get('/api/health', async (c) => {
  try {
    const row = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM users').first<{ c: number }>();
    return ok(c, {
      status: 'ok',
      database: 'connected',
      users: row?.c ?? 0,
      time: new Date().toISOString(),
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: 'اتصال به دیتابیس برقرار نیست. آیا schema.sql اجرا شده است؟',
        detail: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/* ==========================================================================
 *  مدیریت خطا
 * ========================================================================== */

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ ok: false, error: 'مسیر مورد نظر یافت نشد.' }, 404);
  }
  const settings = c.get('settings');
  return c.html(
    errorPage(404, 'نشانی وارد شده وجود ندارد. ممکن است لینک اشتباه باشد.', settings?.cafe_name ?? 'باشگاه مشتریان'),
    404
  );
});

app.onError((error, c) => {
  console.error('Unhandled error:', error);

  if (c.req.path.startsWith('/api/')) {
    return c.json(
      {
        ok: false,
        error: 'خطای داخلی سرور. لطفاً دوباره تلاش کنید.',
      },
      500
    );
  }

  const settings = c.get('settings');
  return c.html(
    errorPage(500, 'خطای غیرمنتظره‌ای رخ داد. لطفاً چند لحظه بعد دوباره تلاش کنید.', settings?.cafe_name ?? 'باشگاه مشتریان'),
    500
  );
});

/* ==========================================================================
 *  ابزارهای محلی
 * ========================================================================== */

type InvoiceRowWithCustomer = {
  id: number;
  user_id: number;
  amount: number;
  items: string;
  subtotal: number;
  discount: number;
  coupon_code: string | null;
  points_earned: number;
  created_at: string;
  registered_by: number | null;
  customer_name: string;
  customer_phone: string;
  registered_name: string | null;
};

function generateReadablePassword(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(Math.max(8, Math.min(32, length)));
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => alphabet[b % alphabet.length])
    .join('');
}

/* ==========================================================================
 *  جاب‌های Cron
 * ========================================================================== */

async function scheduled(
  controller: ScheduledController,
  env: Bindings,
  ctx: ExecutionContext
): Promise<void> {
  const settings = await loadSettings(env, true);
  console.log(`[cron] triggered: ${controller.cron}`);

  ctx.waitUntil(
    (async () => {
      try {
        const results = await dispatchCron(env, settings, controller.cron);
        for (const result of results) {
          console.log(`[cron] ${result.job} ok=${result.ok} sent=${result.sent} :: ${result.message}`);
        }
      } catch (error) {
        console.error('[cron] failed:', error);
      }
    })()
  );
}

/* ==========================================================================
 *  خروجی Worker
 * ========================================================================== */

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Bindings>;
