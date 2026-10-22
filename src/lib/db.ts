/**
 * ----------------------------------------------------------------------------
 *  منطق کسب‌وکار: مشتری، فاکتور، امتیاز، سطح، معرف و آمار
 * ----------------------------------------------------------------------------
 */
import type { AppSettings, Bindings, InvoiceItem, InvoiceRow, UserRow, CouponRow, Role, SmsLogRow } from '../types';
import {
  DEFAULT_TIMEZONE,
  resolveTimeZone,
  todayISO,
  safeJsonParse,
  normalizePhone,
  toPersianDigits,
  sqliteToMs,
  utcStamp,
  jalaliMonthRangeAt,
  zonedDateStartMs,
  zonedDayRange,
  formatNumberFa,
  formatJalali,
} from './utils';
import { generateCouponCode } from './crypto';
import { renderSms, sendSms } from './sms';
import { CHURN_DEFAULT_INTERVAL } from './settings';

/* ==========================================================================
 * ۱) محاسبات امتیاز و سطح
 * ========================================================================== */

/** محاسبه امتیاز بر اساس مبلغ و تنظیمات
 *  مثال: هر ۱۰۰۰ تومان = ۱ امتیاز
 */
export function calculatePoints(amount: number, settings: AppSettings): number {
  const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
  const unit = Math.max(1, settings.currency_unit);
  const ratio = Math.max(1, settings.points_per_currency);
  return Math.floor(safeAmount / unit) * ratio;
}

/** محاسبه سطح مشتری بر اساس امتیاز */
export function calculateTier(points: number, settings: AppSettings): string {
  const p = Math.max(0, Math.floor(points));
  if (p >= settings.tiers.vip) return 'vip';
  if (p >= settings.tiers.gold) return 'gold';
  if (p >= settings.tiers.silver) return 'silver';
  return 'bronze';
}

export const TIER_LABELS: Record<string, string> = {
  bronze: 'برنزی',
  silver: 'نقره‌ای',
  gold: 'طلایی',
  vip: 'الماسی',
};

export function tierLabel(tier: string): string {
  return TIER_LABELS[tier] ?? 'برنزی';
}

/* ==========================================================================
 * ۲) کاربران
 * ========================================================================== */

export async function findUserByPhone(
  db: D1Database,
  phone: string
): Promise<UserRow | null> {
  return db
    .prepare('SELECT * FROM users WHERE phone = ? LIMIT 1')
    .bind(normalizePhone(phone))
    .first<UserRow>();
}

export async function findUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').bind(id).first<UserRow>();
}

/** تولید کد معرف یکتا */
export async function generateUniqueReferralCode(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateCouponCode('REF');
    const exists = await db
      .prepare('SELECT id FROM users WHERE referral_code = ? LIMIT 1')
      .bind(code)
      .first<{ id: number }>();
    if (!exists) return code;
  }
  return `REF-${Date.now().toString(36).toUpperCase()}`;
}

/** یافتن معرف از روی کد معرف یا شماره موبایل */
export async function resolveReferrer(
  db: D1Database,
  codeOrPhone: string
): Promise<UserRow | null> {
  const raw = String(codeOrPhone ?? '').trim();
  if (!raw) return null;

  const byCode = await db
    .prepare('SELECT * FROM users WHERE UPPER(referral_code) = UPPER(?) LIMIT 1')
    .bind(raw)
    .first<UserRow>();
  if (byCode) return byCode;

  const normalized = normalizePhone(raw);
  if (/^09\d{9}$/.test(normalized)) {
    const byPhone = await findUserByPhone(db, normalized);
    if (byPhone && byPhone.role === 'customer') return byPhone;
  }
  return null;
}

export type RegisterInput = {
  name: string;
  phone: string;
  birth_date: string | null;
  referral: string | null;
  /** رضایت دریافت پیامک تبلیغاتی (پیش‌فرض ۱) */
  sms_opt_in?: number;
};

export type RegisterResult =
  | { ok: true; user: UserRow; referrerName: string | null; referralCode: string }
  | { ok: false; error: string; code: 'PHONE_EXISTS' | 'INVALID_REFERRAL' | 'DB_ERROR' };

/** ثبت‌نام مشتری جدید */
export async function registerCustomer(
  env: Bindings,
  settings: AppSettings,
  input: RegisterInput
): Promise<RegisterResult> {
  const phone = normalizePhone(input.phone);

  const existing = await findUserByPhone(env.DB, phone);
  if (existing) {
    return { ok: false, error: 'این شماره موبایل قبلاً ثبت شده است.', code: 'PHONE_EXISTS' };
  }

  let referrer: UserRow | null = null;
  if (input.referral && input.referral.trim()) {
    referrer = await resolveReferrer(env.DB, input.referral);
    if (!referrer) {
      return { ok: false, error: 'کد معرف نامعتبر است.', code: 'INVALID_REFERRAL' };
    }
    if (referrer.phone === phone) {
      return { ok: false, error: 'کد معرف نمی‌تواند شماره خودتان باشد.', code: 'INVALID_REFERRAL' };
    }
  }

  const referralCode = await generateUniqueReferralCode(env.DB);

  try {
    const smsOptIn = input.sms_opt_in === 0 ? 0 : 1;
    const result = await env.DB.prepare(
      `INSERT INTO users (name, phone, birth_date, points, tier, referred_by, role, referral_code, sms_opt_in)
       VALUES (?, ?, ?, 0, 'bronze', ?, 'customer', ?, ?)`
    )
      .bind(
        input.name,
        phone,
        input.birth_date,
        referrer ? referrer.id : null,
        referralCode,
        smsOptIn
      )
      .run();

    const userId = Number(result.meta?.last_row_id ?? 0);
    const user = await findUserById(env.DB, userId);
    if (!user) {
      return { ok: false, error: 'خطا در ایجاد حساب کاربری.', code: 'DB_ERROR' };
    }

    // پیامک خوش‌آمدگویی — برای کسی که رضایت نداده ارسال نمی‌شود
    if (smsOptIn === 1) {
    await sendSms(env, settings, {
      userId: user.id,
      phone: user.phone,
      type: 'welcome',
      message: renderSms(settings, 'welcome', {
        name: user.name,
        referral_code: user.referral_code ?? referralCode,
        points: 0,
      }),
    });
    }

    return {
      ok: true,
      user,
      referrerName: referrer?.name ?? null,
      referralCode: user.referral_code ?? referralCode,
    };
  } catch (error) {
    console.error('registerCustomer failed:', error);
    return { ok: false, error: 'خطای پایگاه داده در ثبت‌نام.', code: 'DB_ERROR' };
  }
}

/* ==========================================================================
 * ۳) فاکتور
 * ========================================================================== */

export type InvoiceInput = {
  userId: number;
  items: InvoiceItem[];
  amount: number | null;
  couponCode: string | null;
  registeredBy: number;
  /** شناسه یکتای درخواست (برای جلوگیری از ثبت تکراری با دوبار کلیک/تلاش مجدد) */
  clientRequestId?: string | null;
};

export type InvoiceResult =
  | {
      ok: true;
      invoiceId: number;
      subtotal: number;
      discount: number;
      amount: number;
      pointsEarned: number;
      totalPoints: number;
      tier: string;
      tierChanged: boolean;
      customerName: string;
      /** توضیح امتیاز این فاکتور (برای نمایش در پنل پرسنل) */
      pointsNote: string;
      /** آیا این درخواست تکراری بود و همان فاکتور قبلی برگشت داده شد */
      duplicate: boolean;
    }
  | { ok: false; error: string; code: string };

/** محاسبه جمع آیتم‌ها */
export function itemsSubtotal(items: InvoiceItem[]): number {
  return (items ?? []).reduce((sum, item) => {
    const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
    const price = Math.max(0, Math.floor(Number(item.price) || 0));
    return sum + qty * price;
  }, 0);
}

/** پاک‌سازی و اعتبارسنجی آیتم‌های فاکتور */
export function normalizeItems(raw: unknown): InvoiceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 50)
    .map((item) => {
      const obj = (item ?? {}) as Record<string, unknown>;
      const name = String(obj.name ?? '').replace(/[<>]/g, '').trim().slice(0, 60);
      const qty = Math.min(99, Math.max(1, Math.floor(Number(obj.qty) || 1)));
      const price = Math.min(1_000_000_000, Math.max(0, Math.floor(Number(obj.price) || 0)));
      if (!name) return null;
      return { name, qty, price };
    })
    .filter((item): item is InvoiceItem => item !== null);
}

/** کد تخفیف را اعتبارسنجی و مقدار تخفیف را محاسبه می‌کند */
export async function evaluateCoupon(
  db: D1Database,
  code: string,
  userId: number,
  subtotal: number
): Promise<{ ok: true; coupon: CouponRow; discount: number } | { ok: false; error: string }> {
  const clean = String(code ?? '').trim().toUpperCase();
  if (!clean) return { ok: false, error: 'کد تخفیف خالی است.' };

  const coupon = await db
    .prepare('SELECT * FROM coupons WHERE UPPER(code) = ? LIMIT 1')
    .bind(clean)
    .first<CouponRow>();

  if (!coupon) return { ok: false, error: 'کد تخفیف یافت نشد.' };
  if (coupon.is_active !== 1) return { ok: false, error: 'این کد تخفیف غیرفعال شده است.' };
  if (coupon.user_id !== null && coupon.user_id !== userId) {
    return { ok: false, error: 'این کد تخفیف مخصوص مشتری دیگری است.' };
  }
  if (coupon.used_count >= coupon.max_uses) {
    return { ok: false, error: 'این کد تخفیف قبلاً استفاده شده است.' };
  }
  if (coupon.expires_at) {
    const expiresMs = sqliteToMs(coupon.expires_at);
    if (expiresMs !== null && expiresMs < Date.now()) {
      return { ok: false, error: 'اعتبار این کد تخفیف به پایان رسیده است.' };
    }
  }

  const discount =
    coupon.kind === 'percent'
      ? Math.floor((subtotal * Math.min(100, Math.max(0, coupon.value))) / 100)
      : Math.min(subtotal, Math.max(0, coupon.value));

  return { ok: true, coupon, discount };
}

/** آیا مشتری در این روز (تاریخ تهران) امتیاز حضور گرفته است؟ */
export async function hasVisitPointsToday(
  db: D1Database,
  userId: number,
  timeZone: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM invoices
       WHERE user_id = ? AND visit_day = ? AND voided_at IS NULL
       LIMIT 1`
    )
    .bind(userId, todayISO(timeZone))
    .first<{ id: number }>();
  return !!row;
}

/**
 * محاسبه‌ی امتیاز یک فاکتور بر اساس روش امتیازدهی انتخاب‌شده.
 *  - amount: بر اساس مبلغ (هر X تومان = Y امتیاز)
 *  - visit : هر روز که مشتری خرید می‌کند و مبلغ فاکتور از حداقل عبور کند،
 *            یک‌بار امتیاز ثابت می‌گیرد (مثل مهر/استمپ باشگاه‌های حرفه‌ای)
 */
export function calculateInvoicePoints(input: {
  amount: number;
  settings: AppSettings;
  visitAlreadyEarned: boolean;
}):
  | { points: number; note: string; visitDay: boolean }
  | { points: 0; note: string; visitDay: false } {
  const { amount, settings } = input;

  if (settings.points_mode === 'visit') {
    if (amount < settings.visit_min_amount) {
      return {
        points: 0,
        note: `مبلغ فاکتور کمتر از حداقل ${formatNumberFa(settings.visit_min_amount)} تومان است؛ امتیاز روزانه ثبت نشد.`,
        visitDay: false,
      };
    }
    if (input.visitAlreadyEarned) {
      return {
        points: 0,
        note: 'امتیاز حضور امروز قبلاً برای این مشتری ثبت شده است.',
        visitDay: false,
      };
    }
    return {
      points: settings.visit_points,
      note: `امتیاز حضور امروز (${toPersianDigits(settings.visit_points)} امتیاز)`,
      visitDay: true,
    };
  }

  const points = calculatePoints(amount, settings);
  return {
    points,
    note:
      points > 0
        ? `${toPersianDigits(points)} امتیاز بر اساس مبلغ خرید`
        : 'مبلغ خرید برای دریافت امتیاز کافی نبود.',
    visitDay: false,
  };
}

/** نتیجه‌ی فاکتور از روی رکورد موجود (برای درخواست‌های تکراری) */
async function invoiceResultFromRow(
  db: D1Database,
  row: InvoiceRow,
  customer: UserRow,
  settings: AppSettings
): Promise<InvoiceResult> {
  const after = await db
    .prepare('SELECT points, tier FROM users WHERE id = ?')
    .bind(customer.id)
    .first<{ points: number; tier: string }>();

  return {
    ok: true,
    invoiceId: row.id,
    subtotal: row.subtotal,
    discount: row.discount,
    amount: row.amount,
    pointsEarned: row.points_earned,
    totalPoints: after?.points ?? customer.points,
    tier: after?.tier ?? customer.tier,
    tierChanged: false,
    customerName: customer.name,
    pointsNote: 'این فاکتور قبلاً ثبت شده بود؛ از ثبت دوباره جلوگیری شد.',
    duplicate: true,
  };
}

/** ثبت فاکتور، محاسبه امتیاز، به‌روزرسانی سطح و پاداش معرف */
export async function recordInvoice(
  env: Bindings,
  settings: AppSettings,
  input: InvoiceInput
): Promise<InvoiceResult> {
  const customer = await findUserById(env.DB, input.userId);
  if (!customer) {
    return { ok: false, error: 'مشتری یافت نشد.', code: 'USER_NOT_FOUND' };
  }
  if (customer.role !== 'customer') {
    return { ok: false, error: 'فقط برای مشتریان می‌توان فاکتور ثبت کرد.', code: 'INVALID_ROLE' };
  }
  if (customer.is_active !== 1) {
    return {
      ok: false,
      error: 'حساب این مشتری غیرفعال است؛ ابتدا آن را از پنل مدیریت فعال کنید.',
      code: 'INACTIVE_CUSTOMER',
    };
  }

  // درخواست تکراری (دوبار کلیک یا تلاش مجدد شبکه) → همان فاکتور قبلی
  const requestId = (input.clientRequestId ?? '').trim().slice(0, 64) || null;
  if (requestId) {
    const existing = await env.DB.prepare(
      'SELECT * FROM invoices WHERE client_request_id = ? LIMIT 1'
    )
      .bind(requestId)
      .first<InvoiceRow>();
    if (existing) return invoiceResultFromRow(env.DB, existing, customer, settings);
  }

  const items = normalizeItems(input.items);
  const subtotal = items.length > 0 ? itemsSubtotal(items) : Math.floor(Number(input.amount) || 0);

  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return { ok: false, error: 'مبلغ فاکتور باید بزرگ‌تر از صفر باشد.', code: 'INVALID_AMOUNT' };
  }
  if (subtotal > 5_000_000_000) {
    return { ok: false, error: 'مبلغ فاکتور بیش از حد مجاز است.', code: 'INVALID_AMOUNT' };
  }

  // تخفیف
  let discount = 0;
  let couponCode: string | null = null;
  let coupon: CouponRow | null = null;

  if (input.couponCode && input.couponCode.trim()) {
    const couponResult = await evaluateCoupon(env.DB, input.couponCode, customer.id, subtotal);
    if (couponResult.ok === false) {
      return { ok: false, error: couponResult.error, code: 'INVALID_COUPON' };
    }
    coupon = couponResult.coupon;
    discount = Math.min(subtotal, couponResult.discount);
    couponCode = coupon.code;
  }

  const amount = subtotal - discount;
  const timeZone = resolveTimeZone(env.TZ_NAME);
  const visitAlreadyEarned =
    settings.points_mode === 'visit'
      ? await hasVisitPointsToday(env.DB, customer.id, timeZone)
      : false;

  const calc = calculateInvoicePoints({
    amount,
    settings,
    visitAlreadyEarned,
  });

  let pointsEarned = calc.points;
  let pointsNote = calc.note;
  let visitDay: string | null = calc.visitDay ? todayISO(timeZone) : null;
  const nowISO = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // مقدار «تخمینی»؛ بعد از ثبت، مقدار نهایی را از DB می‌خوانیم
  let newPoints = Math.max(0, customer.points + pointsEarned);
  let newTier = calculateTier(
    Math.max(0, customer.lifetime_points + pointsEarned),
    settings
  );
  let tierChanged = newTier !== customer.tier;

  const buildStatements = (earned: number, day: string | null) => {
    const list = [
      env.DB.prepare(
        `INSERT INTO invoices
           (user_id, amount, items, points_earned, registered_by, discount, coupon_code,
            subtotal, created_at, visit_day, client_request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        customer.id,
        amount,
        JSON.stringify(items),
        earned,
        input.registeredBy,
        discount,
        couponCode,
        subtotal,
        nowISO,
        day,
        requestId
      ),
      // افزایش اتمیک امتیاز؛ سطح بر اساس امتیاز «طول عمر» محاسبه می‌شود تا
      // خرج کردن امتیاز باعث افت سطح نشود.
      env.DB.prepare(
        `UPDATE users
         SET points = points + ?,
             lifetime_points = lifetime_points + ?,
             tier = CASE
                      WHEN lifetime_points + ? >= ? THEN 'vip'
                      WHEN lifetime_points + ? >= ? THEN 'gold'
                      WHEN lifetime_points + ? >= ? THEN 'silver'
                      ELSE 'bronze'
                    END,
             last_visit_date = ?,
             first_purchase_at = COALESCE(first_purchase_at, ?)
         WHERE id = ? AND role = 'customer'`
      ).bind(
        earned,
        earned,
        earned,
        settings.tiers.vip,
        earned,
        settings.tiers.gold,
        earned,
        settings.tiers.silver,
        nowISO,
        nowISO,
        customer.id
      ),
    ];

    if (coupon) {
      list.push(
        env.DB.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').bind(coupon.id)
      );
    }
    return list;
  };

  let invoiceId = 0;
  try {
    const results = await env.DB.batch(buildStatements(pointsEarned, visitDay));
    invoiceId = Number(results[0]?.meta?.last_row_id ?? 0);
  } catch (error) {
    const message = String(error);

    // دو درخواست هم‌زمان با یک شناسه → یکی ثبت شده است
    if (requestId && message.includes('client_request_id')) {
      const existing = await env.DB.prepare(
        'SELECT * FROM invoices WHERE client_request_id = ? LIMIT 1'
      )
        .bind(requestId)
        .first<InvoiceRow>();
      if (existing) return invoiceResultFromRow(env.DB, existing, customer, settings);
    }

    // در همین لحظه فاکتور دیگری امتیاز حضور امروز را گرفته است
    if (visitDay && (message.includes('visit_day') || message.includes('ux_invoices_visit_day'))) {
      try {
        const results = await env.DB.batch(buildStatements(0, null));
        invoiceId = Number(results[0]?.meta?.last_row_id ?? 0);
        pointsEarned = 0;
        pointsNote = 'امتیاز حضور امروز قبلاً برای این مشتری ثبت شده است.';
        visitDay = null;
      } catch (retryError) {
        console.error('recordInvoice retry failed:', retryError);
        return { ok: false, error: 'خطا در ثبت فاکتور.', code: 'DB_ERROR' };
      }
    } else {
      console.error('recordInvoice batch failed:', error);
      return { ok: false, error: 'خطا در ثبت فاکتور.', code: 'DB_ERROR' };
    }
  }

  // خواندن مقدار نهایی امتیاز/سطح از دیتابیس (منبع حقیقت)
  const after = await env.DB.prepare('SELECT points, tier FROM users WHERE id = ?')
    .bind(customer.id)
    .first<{ points: number; tier: string }>();
  if (after) {
    newPoints = after.points;
    newTier = after.tier;
    tierChanged = newTier !== customer.tier;
  }

  // به‌روزرسانی میانگین فاصله خرید (خارج از تراکنش اصلی)
  await recomputeAvgInterval(env.DB, customer.id);

  // پاداش معرف پس از اولین خرید
  if (customer.referred_by && customer.referral_rewarded !== 1) {
    await rewardReferrer(env, settings, customer);
  }

  // پیامک تأیید فاکتور (پیامک تراکنشی است و به رضایت تبلیغاتی نیاز ندارد)
  await sendSms(env, settings, {
    userId: customer.id,
    phone: customer.phone,
    type: 'invoice',
    message: renderSms(settings, 'invoice', {
      name: customer.name,
      amount: formatNumberFa(amount),
      points: toPersianDigits(pointsEarned),
      total_points: toPersianDigits(newPoints),
      tier: tierLabel(newTier),
      discount: formatNumberFa(discount),
      code: couponCode ?? '',
    }),
  });

  return {
    ok: true,
    invoiceId,
    subtotal,
    discount,
    amount,
    pointsEarned,
    totalPoints: newPoints,
    tier: newTier,
    tierChanged,
    customerName: customer.name,
    pointsNote,
    duplicate: false,
  };
}

/** پاداش دادن به معرف پس از اولین خرید مشتری */
async function rewardReferrer(
  env: Bindings,
  settings: AppSettings,
  customer: UserRow
): Promise<void> {
  if (!customer.referred_by) return;

  const referrer = await findUserById(env.DB, customer.referred_by);
  if (!referrer || referrer.is_active !== 1) return;

  const reward = Math.max(0, settings.referral_reward_points);

  // «ثبت پاداش» را اول و به‌صورت شرطی انجام می‌دهیم: اگر دو فاکتور هم‌زمان برسد،
  // فقط یکی از آن‌ها می‌تواند این ردیف را از 0 به 1 ببرد و پاداش دوبار داده نشود.
  const claim = await env.DB.prepare(
    'UPDATE users SET referral_rewarded = 1 WHERE id = ? AND referral_rewarded = 0'
  )
    .bind(customer.id)
    .run();
  if (!claim.meta?.changes) return;

  if (reward > 0) {
    // افزایش اتمیک امتیاز معرف + محاسبه‌ی سطح از مقدار نهایی
    const updated = await env.DB.prepare(
      `UPDATE users
       SET points = points + ?, lifetime_points = lifetime_points + ?
       WHERE id = ? AND role = 'customer'
       RETURNING points, lifetime_points`
    )
      .bind(reward, reward, referrer.id)
      .first<{ points: number; lifetime_points: number }>();

    if (updated) {
      await env.DB.prepare('UPDATE users SET tier = ? WHERE id = ?')
        .bind(calculateTier(updated.lifetime_points, settings), referrer.id)
        .run();
    }

    await sendSms(env, settings, {
      userId: referrer.id,
      phone: referrer.phone,
      type: 'referral',
      message: renderSms(settings, 'welcome', {
        name: referrer.name,
        points: reward,
        referral_code: customer.name,
      }),
    });
  }
}

/** میانگین فاصله روزهای خرید یک کاربر را از روی فاکتورها محاسبه می‌کند */
export async function recomputeAvgInterval(db: D1Database, userId: number): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT created_at FROM invoices
       WHERE user_id = ? AND voided_at IS NULL
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .bind(userId)
    .all<{ created_at: string }>();

  const days = Array.from(
    new Set(
      (results ?? [])
        .map((row) => row.created_at.slice(0, 10))
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    )
  ).sort();

  let avg = 0;
  if (days.length >= 2) {
    const msList = days.map((d) => Date.parse(`${d}T00:00:00Z`));
    let total = 0;
    let count = 0;
    for (let i = 1; i < msList.length; i += 1) {
      const diff = Math.round((msList[i] - msList[i - 1]) / 86_400_000);
      if (diff > 0) {
        total += diff;
        count += 1;
      }
    }
    avg = count > 0 ? Math.round((total / count) * 10) / 10 : 0;
  }

  await db
    .prepare('UPDATE users SET avg_visit_interval = ? WHERE id = ?')
    .bind(avg, userId)
    .run();

  return avg;
}

/* ==========================================================================
 * ۴) آمار داشبورد
 * ========================================================================== */

export type DashboardStats = {
  totalCustomers: number;
  newCustomers30d: number;
  totalInvoices: number;
  todaySales: number;
  monthSales: number;
  todayInvoices: number;
  sleepingCustomers: number;
  activeCustomers30d: number;
  pointsOutstanding: number;
  smsSentToday: number;
  topCustomers: Array<{ id: number; name: string; phone: string; points: number; tier: string }>;
  recentInvoices: Array<{
    id: number;
    amount: number;
    created_at: string;
    customer_name: string;
    customer_id: number;
  }>;
  salesSeries: Array<{ date: string; total: number }>;
};

/**
 * آمار داشبورد.
 * @param dayStartUtc شروع روز (به وقت تهران) در قالب «YYYY-MM-DD HH:MM:SS» UTC
 * @param dayEndUtc پایان روز
 * @param monthStartUtc شروع ماه شمسی/میلادی جاری
 */
export async function getDashboardStats(
  db: D1Database,
  settings: AppSettings,
  dayStartUtc: string,
  dayEndUtc: string,
  monthStartUtc: string,
  daysAgo30Utc: string,
  /**
   * بازه‌های از پیش محاسبه‌شده‌ی نمودار فروش (به ترتیب قدیمی → جدید).
   * اگر داده نشود، از روزهای UTC استفاده می‌شود (سازگاری با فراخوانی‌های قدیمی).
   */
  seriesDays?: Array<{ start: string; end: string; date: string }>
): Promise<DashboardStats> {
  const [
    totalCustomers,
    newCustomers30d,
    totalInvoices,
    todaySales,
    monthSales,
    todayInvoices,
    pointsOutstanding,
    smsSentToday,
    activeCustomers30d,
  ] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'customer'`).first<{ c: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'customer' AND created_at >= ?`)
      .bind(daysAgo30Utc)
      .first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE voided_at IS NULL').first<{ c: number }>(),
    db
      .prepare('SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c FROM invoices WHERE voided_at IS NULL AND created_at >= ? AND created_at < ?')
      .bind(dayStartUtc, dayEndUtc)
      .first<{ s: number; c: number }>(),
    db
      .prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM invoices WHERE voided_at IS NULL AND created_at >= ?')
      .bind(monthStartUtc)
      .first<{ s: number }>(),
    db
      .prepare('SELECT COUNT(*) AS c FROM invoices WHERE voided_at IS NULL AND created_at >= ? AND created_at < ?')
      .bind(dayStartUtc, dayEndUtc)
      .first<{ c: number }>(),
    db
      .prepare(`SELECT COALESCE(SUM(points), 0) AS s FROM users WHERE role = 'customer'`)
      .first<{ s: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS c FROM sms_logs WHERE sent_at >= ? AND sent_at < ? AND status = 'sent'`)
      .bind(dayStartUtc, dayEndUtc)
      .first<{ c: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'customer' AND last_visit_date >= ?`)
      .bind(daysAgo30Utc)
      .first<{ c: number }>(),
  ]);

  const { results: sleepRows } = await db
    .prepare(
      `SELECT u.id, u.name, u.last_visit_date, u.avg_visit_interval,
              (SELECT COUNT(*) FROM invoices i WHERE i.user_id = u.id AND i.voided_at IS NULL) AS visits
       FROM users u
       WHERE u.role = 'customer' AND u.is_active = 1 AND u.last_visit_date IS NOT NULL
       LIMIT 5000`
    )
    .all<{
      id: number;
      name: string;
      last_visit_date: string;
      avg_visit_interval: number;
      visits: number;
    }>();

  // هم‌قاعده با جاب ریزش: میانگین فقط وقتی معتبر است که تعداد خرید به حداقل برسد،
  // در غیر این صورت مبنای ۳۰ روز.
  const sleeping = (sleepRows ?? []).filter((row) => {
    const ms = sqliteToMs(row.last_visit_date);
    if (ms === null) return false;
    const days = Math.floor((Date.now() - ms) / 86_400_000);
    const reliable = row.visits >= settings.churn_min_visits && row.avg_visit_interval > 0;
    const baseline = reliable ? row.avg_visit_interval : CHURN_DEFAULT_INTERVAL;
    return days > baseline + settings.churn_grace_days;
  });

  const { results: top } = await db
    .prepare(
      `SELECT id, name, phone, points, tier FROM users
       WHERE role = 'customer' AND is_active = 1
       ORDER BY points DESC LIMIT 5`
    )
    .all<{ id: number; name: string; phone: string; points: number; tier: string }>();

  const { results: recent } = await db
    .prepare(
      `SELECT i.id, i.amount, i.created_at, u.name AS customer_name, u.id AS customer_id
       FROM invoices i JOIN users u ON u.id = i.user_id
       WHERE i.voided_at IS NULL
       ORDER BY i.created_at DESC, i.id DESC LIMIT 8`
    )
    .all<{
      id: number;
      amount: number;
      created_at: string;
      customer_name: string;
      customer_id: number;
    }>();

  let salesSeries: Array<{ date: string; total: number }> = [];

  if (seriesDays && seriesDays.length > 0) {
    // روزهای تقویمی تهران — هم‌خوان با کارت «فروش امروز» و برچسب‌های نمودار
    const totals = await Promise.all(
      seriesDays.map((range) =>
        db
          .prepare(
            'SELECT COALESCE(SUM(amount), 0) AS s FROM invoices WHERE voided_at IS NULL AND created_at >= ? AND created_at < ?'
          )
          .bind(range.start, range.end)
          .first<{ s: number }>()
      )
    );
    salesSeries = seriesDays.map((range, index) => ({
      date: range.date,
      total: totals[index]?.s ?? 0,
    }));
  } else {
    const { results: seriesRows } = await db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day, COALESCE(SUM(amount), 0) AS total
         FROM invoices
         WHERE voided_at IS NULL AND created_at >= datetime('now', '-6 days')
         GROUP BY day ORDER BY day ASC`
      )
      .all<{ day: string; total: number }>();

    const salesByDay = new Map((seriesRows ?? []).map((r) => [r.day, r.total]));
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      salesSeries.push({ date: d, total: salesByDay.get(d) ?? 0 });
    }
  }

  return {
    totalCustomers: totalCustomers?.c ?? 0,
    newCustomers30d: newCustomers30d?.c ?? 0,
    totalInvoices: totalInvoices?.c ?? 0,
    todaySales: todaySales?.s ?? 0,
    monthSales: monthSales?.s ?? 0,
    todayInvoices: todayInvoices?.c ?? 0,
    sleepingCustomers: sleeping.length,
    activeCustomers30d: activeCustomers30d?.c ?? 0,
    pointsOutstanding: pointsOutstanding?.s ?? 0,
    smsSentToday: smsSentToday?.c ?? 0,
    topCustomers: top ?? [],
    recentInvoices: recent ?? [],
    salesSeries,
  };
}

/* ==========================================================================
 * ۵) فهرست مشتریان
 * ========================================================================== */

export type CustomerListItem = {
  id: number;
  name: string;
  phone: string;
  birth_date: string | null;
  points: number;
  tier: string;
  last_visit_date: string | null;
  avg_visit_interval: number;
  created_at: string;
  visits: number;
  total_spent: number;
  referral_code: string | null;
  is_active: number;
};

/**
 * همه‌ی مشتریان برای خروجی CSV — با یک کوئری.
 * (نسخه‌ی صفحه‌به‌صفحه روی پلن رایگان به سقف ۵۰ کوئری D1 می‌خورد و خروجی را ناقص می‌کرد.)
 */
export async function exportCustomers(db: D1Database): Promise<CustomerListItem[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.name, u.phone, u.birth_date, u.points, u.tier, u.last_visit_date,
              u.avg_visit_interval, u.created_at, u.referral_code, u.is_active,
              (SELECT COUNT(*) FROM invoices i WHERE i.user_id = u.id AND i.voided_at IS NULL) AS visits,
              (SELECT COALESCE(SUM(amount), 0) FROM invoices i WHERE i.user_id = u.id AND i.voided_at IS NULL) AS total_spent
       FROM users u
       WHERE u.role = 'customer'
       ORDER BY u.created_at DESC
       LIMIT 20000`
    )
    .all<CustomerListItem>();

  return results ?? [];
}

export type ListCustomersParams = {
  q?: string;
  tier?: string;
  status?: 'sleeping' | 'active' | 'no_visit';
  page?: number;
  pageSize?: number;
  sort?: 'points' | 'recent' | 'created' | 'name';
  graceDays?: number;
  /** حداقل تعداد خرید برای معتبر بودن میانگین (هم‌قاعده با جاب ریزش) */
  minVisits?: number;
};

export async function listCustomers(
  db: D1Database,
  params: ListCustomersParams
): Promise<{ items: CustomerListItem[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(5, Math.floor(params.pageSize ?? 20)));
  const offset = (page - 1) * pageSize;

  const where: string[] = [`u.role = 'customer'`];
  const binds: Array<string | number> = [];

  const q = String(params.q ?? '').trim().slice(0, 60);
  if (q) {
    where.push('(u.name LIKE ? OR u.phone LIKE ? OR u.referral_code LIKE ?)');
    const like = `%${q}%`;
    binds.push(like, like, like);
  }
  if (params.tier && ['bronze', 'silver', 'gold', 'vip'].includes(params.tier)) {
    where.push('u.tier = ?');
    binds.push(params.tier);
  }
  if (params.status === 'sleeping' || params.status === 'active') {
    // همان قاعدهٔ جاب ریزش: میانگین فقط با تعداد خرید کافی معتبر است،
    // وگرنه مبنای ۳۰ روز (تا مشتری تک‌خرید هم درست دسته‌بندی شود).
    const baseline =
      `(CASE WHEN u.avg_visit_interval > 0
             AND (SELECT COUNT(*) FROM invoices i WHERE i.user_id = u.id AND i.voided_at IS NULL) >= ?
        THEN u.avg_visit_interval ELSE ? END)`;
    const comparison = params.status === 'sleeping' ? '>' : '<=';
    where.push(
      `u.last_visit_date IS NOT NULL
       AND (julianday('now') - julianday(u.last_visit_date)) ${comparison} (${baseline} + ?)`
    );
    binds.push(
      Math.max(1, Math.floor(params.minVisits ?? 3)),
      CHURN_DEFAULT_INTERVAL,
      params.graceDays ?? 2
    );
  } else if (params.status === 'no_visit') {
    where.push('u.last_visit_date IS NULL');
  }

  const orderBy =
    params.sort === 'points'
      ? 'u.points DESC'
      : params.sort === 'name'
        ? 'u.name ASC'
        : params.sort === 'created'
          ? 'u.created_at DESC'
          : 'COALESCE(u.last_visit_date, u.created_at) DESC';

  const whereSql = where.join(' AND ');

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS c FROM users u WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ c: number }>();

  const { results } = await db
    .prepare(
      `SELECT u.id, u.name, u.phone, u.birth_date, u.points, u.tier, u.last_visit_date,
              u.avg_visit_interval, u.created_at, u.referral_code, u.is_active,
              (SELECT COUNT(*) FROM invoices i WHERE i.user_id = u.id AND i.voided_at IS NULL) AS visits,
              (SELECT COALESCE(SUM(amount), 0) FROM invoices i WHERE i.user_id = u.id AND i.voided_at IS NULL) AS total_spent
       FROM users u
       WHERE ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, pageSize, offset)
    .all<CustomerListItem>();

  return {
    items: results ?? [],
    total: countRow?.c ?? 0,
    page,
    pageSize,
  };
}

/** جزئیات کامل یک مشتری */
export async function getCustomerDetail(
  db: D1Database,
  id: number
): Promise<{
  user: UserRow | null;
  invoices: InvoiceRow[];
  coupons: CouponRow[];
  referrer: { id: number; name: string; phone: string } | null;
  referrals: Array<{ id: number; name: string; created_at: string; rewarded: boolean }>;
  totalSpent: number;
  visitCount: number;
}> {
  const user = await findUserById(db, id);
  // فقط مشتری‌ها پروفایل مشتری دارند؛ نه کارمندان و مدیران
  if (!user || user.role !== 'customer') {
    return { user: null, invoices: [], coupons: [], referrer: null, referrals: [], totalSpent: 0, visitCount: 0 };
  }

  const { results: invoices } = await db
    .prepare('SELECT * FROM invoices WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .bind(id)
    .all<InvoiceRow>();

  const { results: coupons } = await db
    .prepare('SELECT * FROM coupons WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .bind(id)
    .all<CouponRow>();

  const referrer = user.referred_by
    ? await db
        .prepare('SELECT id, name, phone FROM users WHERE id = ? LIMIT 1')
        .bind(user.referred_by)
        .first<{ id: number; name: string; phone: string }>()
    : null;

  const { results: referrals } = await db
    .prepare(
      'SELECT id, name, created_at, referral_rewarded AS rewarded FROM users WHERE referred_by = ? ORDER BY id DESC LIMIT 50'
    )
    .bind(id)
    .all<{ id: number; name: string; created_at: string; rewarded: number }>();

  const totalRow = await db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c FROM invoices WHERE user_id = ? AND voided_at IS NULL')
    .bind(id)
    .first<{ s: number; c: number }>();

  return {
    user,
    invoices: invoices ?? [],
    coupons: coupons ?? [],
    referrer: referrer ?? null,
    referrals: (referrals ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      created_at: r.created_at,
      rewarded: !!r.rewarded,
    })),
    totalSpent: totalRow?.s ?? 0,
    visitCount: totalRow?.c ?? 0,
  };
}

/* ==========================================================================
 * ۶) کدهای تخفیف
 * ========================================================================== */

export async function createCoupon(
  db: D1Database,
  input: {
    userId: number | null;
    kind: 'percent' | 'amount';
    value: number;
    reason: string;
    expiresAt: string | null;
    maxUses?: number;
    code?: string;
  }
): Promise<CouponRow | null> {
  const code = (input.code ?? generateCouponCode('CAFE')).toUpperCase();
  try {
    const result = await db
      .prepare(
        `INSERT INTO coupons (code, user_id, kind, value, reason, max_uses, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        code,
        input.userId,
        input.kind,
        input.value,
        input.reason,
        input.maxUses ?? 1,
        input.expiresAt
      )
      .run();
    return await db
      .prepare('SELECT * FROM coupons WHERE id = ?')
      .bind(Number(result.meta?.last_row_id ?? 0))
      .first<CouponRow>();
  } catch (error) {
    console.error('createCoupon failed:', error);
    return null;
  }
}

/* ==========================================================================
 * ۷) ابزارهای نمایشی مشترک
 * ========================================================================== */

/** وضعیت مشتری برای نمایش (خوابیده / در خطر / فعال) */
export function customerActivityStatus(
  user: Pick<UserRow, 'last_visit_date' | 'avg_visit_interval'> & { visits?: number },
  graceDays: number,
  minVisits = 3
): { label: string; tone: string } {
  const ms = sqliteToMs(user.last_visit_date);
  if (ms === null) return { label: 'بدون خرید', tone: 'muted' };
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  // میانگینِ مشتریِ کم‌خرید (مثلاً تک‌خرید) معتبر نیست → مبنای ۳۰ روز
  const reliable = (user.visits ?? 0) >= minVisits && user.avg_visit_interval > 0;
  const baseline = reliable ? user.avg_visit_interval : CHURN_DEFAULT_INTERVAL;
  const threshold = baseline + graceDays;
  if (days > threshold + 14) return { label: 'خوابیده', tone: 'danger' };
  if (days > threshold) return { label: 'در خطر ریزش', tone: 'warning' };
  return { label: 'فعال', tone: 'success' };
}

/** خلاصه‌ی خوانا از آیتم‌های فاکتور */
export function describeItems(raw: string): string {
  const items = safeJsonParse<InvoiceItem[]>(raw, []);
  if (!Array.isArray(items) || items.length === 0) return '—';
  return items
    .slice(0, 4)
    .map((item) => `${item.name} ×${toPersianDigits(item.qty)}`)
    .join('، ');
}

/** تاریخ شمسی کوتاه برای جدول‌ها */
export function shortJalali(value: string | null | undefined): string {
  return formatJalali(value);
}

/* ==========================================================================
 * ۸) فهرست فاکتورها (پنل ادمین)
 * ========================================================================== */

export type InvoiceListItem = InvoiceRow & {
  customer_name: string;
  customer_phone: string;
  staff_name: string | null;
};

export async function listInvoices(
  db: D1Database,
  params: {
    q?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
    staffId?: number;
    /** منطقه‌ی زمانی مرز روزها (پیش‌فرض تهران) */
    timeZone?: string;
  }
): Promise<{ items: InvoiceListItem[]; total: number; sum: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(5, Math.floor(params.pageSize ?? 25)));
  const offset = (page - 1) * pageSize;

  const where: string[] = ['1 = 1'];
  const binds: Array<string | number> = [];

  const q = String(params.q ?? '').trim().slice(0, 60);
  if (q) {
    where.push('(u.name LIKE ? OR u.phone LIKE ? OR CAST(i.id AS TEXT) = ?)');
    binds.push(`%${q}%`, `%${q}%`, q);
  }
  const tz = params.timeZone ?? DEFAULT_TIMEZONE;
  // مرز روزها به وقت محلی (نه UTC) و «تا» به‌صورت بازه‌ی نیم‌باز تا ثانیه‌ی آخر از دست نرود
  if (params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from)) {
    const startMs = zonedDateStartMs(params.from, tz);
    if (startMs !== null) {
      where.push('i.created_at >= ?');
      binds.push(utcStamp(startMs));
    }
  }
  if (params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to)) {
    const startMs = zonedDateStartMs(params.to, tz);
    if (startMs !== null) {
      where.push('i.created_at < ?');
      binds.push(utcStamp(startMs + 86_400_000));
    }
  }
  if (params.staffId) {
    where.push('i.registered_by = ?');
    binds.push(params.staffId);
  }

  const whereSql = where.join(' AND ');

  const totalRow = await db
    .prepare(
      `SELECT COUNT(*) AS c,
              COALESCE(SUM(CASE WHEN i.voided_at IS NULL THEN i.amount ELSE 0 END), 0) AS s
       FROM invoices i JOIN users u ON u.id = i.user_id
       WHERE ${whereSql}`
    )
    .bind(...binds)
    .first<{ c: number; s: number }>();

  const { results } = await db
    .prepare(
      `SELECT i.*, u.name AS customer_name, u.phone AS customer_phone, s.name AS staff_name
       FROM invoices i
       JOIN users u ON u.id = i.user_id
       LEFT JOIN users s ON s.id = i.registered_by
       WHERE ${whereSql}
       ORDER BY i.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, pageSize, offset)
    .all<InvoiceListItem>();

  return {
    items: results ?? [],
    total: totalRow?.c ?? 0,
    sum: totalRow?.s ?? 0,
    page,
    pageSize,
  };
}

/* ==========================================================================
 * ۹) کارمندان و ادمین‌ها
 * ========================================================================== */

export type StaffListItem = {
  id: number;
  name: string;
  phone: string;
  role: Role;
  is_active: number;
  created_at: string;
  invoices_count: number;
};

export async function listStaff(db: D1Database): Promise<StaffListItem[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.name, u.phone, u.role, u.is_active, u.created_at,
              (SELECT COUNT(*) FROM invoices i WHERE i.registered_by = u.id AND i.voided_at IS NULL) AS invoices_count
       FROM users u
       WHERE u.role IN ('staff', 'admin')
       ORDER BY u.role ASC, u.id ASC`
    )
    .all<StaffListItem>();
  return results ?? [];
}

/* ==========================================================================
 * ۱۰) لاگ پیامک‌ها
 * ========================================================================== */

export type SmsLogListItem = SmsLogRow & { user_name: string | null; user_phone: string | null };

export async function listSmsLogs(
  db: D1Database,
  params: { type?: string; status?: string; page?: number; pageSize?: number }
): Promise<{ items: SmsLogListItem[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(params.pageSize ?? 30)));
  const offset = (page - 1) * pageSize;

  const where: string[] = ['1 = 1'];
  const binds: Array<string | number> = [];

  if (params.type && ['welcome', 'invoice', 'birthday', 'churn', 'weather', 'referral', 'admin'].includes(params.type)) {
    where.push('l.type = ?');
    binds.push(params.type);
  }
  if (params.status && ['sent', 'failed', 'skipped', 'pending'].includes(params.status)) {
    where.push('l.status = ?');
    binds.push(params.status);
  }

  const whereSql = where.join(' AND ');

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS c FROM sms_logs l WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ c: number }>();

  const { results } = await db
    .prepare(
      `SELECT l.*, u.name AS user_name, u.phone AS user_phone
       FROM sms_logs l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE ${whereSql}
       ORDER BY l.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, pageSize, offset)
    .all<SmsLogListItem>();

  return {
    items: results ?? [],
    total: totalRow?.c ?? 0,
    page,
    pageSize,
  };
}

/* ==========================================================================
 * ۱۱) کدهای تخفیف
 * ========================================================================== */

export type CouponListItem = CouponRow & { user_name: string | null; user_phone: string | null };

export async function listCoupons(
  db: D1Database,
  params: { page?: number; pageSize?: number; status?: string }
): Promise<{ items: CouponListItem[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(params.pageSize ?? 25)));
  const offset = (page - 1) * pageSize;

  const where: string[] = ['1 = 1'];
  const binds: Array<string | number> = [];

  if (params.status === 'active') {
    where.push(`c.is_active = 1 AND (c.expires_at IS NULL OR c.expires_at >= datetime('now')) AND c.used_count < c.max_uses`);
  } else if (params.status === 'expired') {
    where.push(`(c.is_active = 0 OR (c.expires_at IS NOT NULL AND c.expires_at < datetime('now')))`);
  } else if (params.status === 'used') {
    where.push('c.used_count >= c.max_uses');
  }

  const whereSql = where.join(' AND ');

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS c FROM coupons c WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ c: number }>();

  const { results } = await db
    .prepare(
      `SELECT c.*, u.name AS user_name, u.phone AS user_phone
       FROM coupons c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE ${whereSql}
       ORDER BY c.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, pageSize, offset)
    .all<CouponListItem>();

  return {
    items: results ?? [],
    total: totalRow?.c ?? 0,
    page,
    pageSize,
  };
}

/* ==========================================================================
 * ۱۲) به‌روزرسانی امتیاز دستی
 * ========================================================================== */

export async function adjustPoints(
  db: D1Database,
  settings: AppSettings,
  userId: number,
  delta: number
): Promise<
  { ok: true; points: number; tier: string } | { ok: false; error: string; code: 'NOT_FOUND' | 'NOT_CUSTOMER' }
> {
  const user = await findUserById(db, userId);
  if (!user) return { ok: false, error: 'کاربر یافت نشد.', code: 'NOT_FOUND' };
  // امتیاز فقط برای مشتری معنا دارد؛ حساب پرسنل/ادمین نباید امتیاز بگیرد.
  if (user.role !== 'customer')
    return { ok: false, error: 'این کاربر مشتری نیست.', code: 'NOT_CUSTOMER' };

  // یک UPDATE اتمیک: دو درخواست هم‌زمان نمی‌توانند امتیاز یکدیگر را بازنویسی کنند.
  const signed = Math.trunc(delta);
  const row = await db
    .prepare(
      `UPDATE users
       SET points = MAX(0, points + ?),
           lifetime_points = MAX(0, lifetime_points + ?)
       WHERE id = ? AND role = 'customer'
       RETURNING points, lifetime_points`
    )
    .bind(signed, signed, userId)
    .first<{ points: number; lifetime_points: number }>();
  if (!row) return { ok: false, error: 'کاربر یافت نشد.', code: 'NOT_FOUND' };

  // سطح از مجموع امتیازهای طول عمر محاسبه می‌شود (نه موجودی قابل خرج)
  const tier = calculateTier(row.lifetime_points, settings);
  await db.prepare('UPDATE users SET tier = ? WHERE id = ?').bind(tier, userId).run();

  return { ok: true, points: row.points, tier };
}

/* ==========================================================================
 * ۱۳) ابطال فاکتور
 * ========================================================================== */

export async function voidInvoice(
  env: Bindings,
  settings: AppSettings,
  invoiceId: number,
  adminId: number
): Promise<
  | { ok: true; pointsReversed: number; customerId: number; customerName: string }
  | { ok: false; error: string; code: string }
> {
  const invoice = await env.DB.prepare('SELECT * FROM invoices WHERE id = ? LIMIT 1')
    .bind(invoiceId)
    .first<InvoiceRow>();

  if (!invoice) return { ok: false, error: 'فاکتور یافت نشد.', code: 'NOT_FOUND' };
  if (invoice.voided_at) {
    return { ok: false, error: 'این فاکتور قبلاً ابطال شده است.', code: 'ALREADY_VOID' };
  }

  const customer = await findUserById(env.DB, invoice.user_id);
  if (!customer) return { ok: false, error: 'مشتری فاکتور یافت نشد.', code: 'NOT_FOUND' };

  const nowISO = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // قفل کردن ابطال: فقط اولین درخواست موفق می‌شود
  const claim = await env.DB.prepare(
    `UPDATE invoices
     SET voided_at = ?, voided_by = ?, visit_day = NULL
     WHERE id = ? AND voided_at IS NULL`
  )
    .bind(nowISO, adminId, invoiceId)
    .run();

  if (!claim.meta?.changes) {
    return { ok: false, error: 'این فاکتور قبلاً ابطال شده است.', code: 'ALREADY_VOID' };
  }

  const points = Math.max(0, Math.floor(invoice.points_earned));
  const statements = [
    env.DB.prepare(
      `UPDATE users
       SET points = MAX(0, points - ?),
           lifetime_points = MAX(0, lifetime_points - ?)
       WHERE id = ?`
    ).bind(points, points, invoice.user_id),
  ];

  // مصرف کد تخفیف برگردانده می‌شود تا مشتری بتواند دوباره استفاده کند
  if (invoice.coupon_code) {
    statements.push(
      env.DB.prepare(
        `UPDATE coupons SET used_count = MAX(0, used_count - 1)
         WHERE UPPER(code) = UPPER(?)`
      ).bind(invoice.coupon_code)
    );
  }

  await env.DB.batch(statements);

  // سطح و آخرین خرید از روی فاکتورهای معتبر بازمحاسبه می‌شوند
  const lifeRow = await env.DB.prepare('SELECT lifetime_points FROM users WHERE id = ?')
    .bind(invoice.user_id)
    .first<{ lifetime_points: number }>();
  if (lifeRow) {
    await env.DB.prepare('UPDATE users SET tier = ? WHERE id = ?')
      .bind(calculateTier(lifeRow.lifetime_points, settings), invoice.user_id)
      .run();
  }

  const lastRow = await env.DB.prepare(
    'SELECT MAX(created_at) AS d FROM invoices WHERE user_id = ? AND voided_at IS NULL'
  )
    .bind(invoice.user_id)
    .first<{ d: string | null }>();
  await env.DB.prepare('UPDATE users SET last_visit_date = ? WHERE id = ?')
    .bind(lastRow?.d ?? null, invoice.user_id)
    .run();
  await recomputeAvgInterval(env.DB, invoice.user_id);

  return {
    ok: true,
    pointsReversed: points,
    customerId: invoice.user_id,
    customerName: customer.name,
  };
}

/* ==========================================================================
 * ۱۴) تبدیل امتیاز به کد تخفیف (مشتری)
 * ========================================================================== */

export async function redeemPointsForCoupon(
  env: Bindings,
  settings: AppSettings,
  userId: number
): Promise<
  | { ok: true; code: string; value: number; expiresAt: string; pointsLeft: number }
  | { ok: false; error: string; code: string }
> {
  if (settings.redeem_enabled !== 1) {
    return { ok: false, error: 'تبدیل امتیاز به کد تخفیف در حال حاضر فعال نیست.', code: 'REDEEM_DISABLED' };
  }

  const user = await findUserById(env.DB, userId);
  if (!user || user.role !== 'customer') {
    return { ok: false, error: 'کاربر یافت نشد.', code: 'NOT_FOUND' };
  }
  if (user.points < settings.redeem_points) {
    return {
      ok: false,
      error: `برای این جایزه ${toPersianDigits(settings.redeem_points)} امتیاز لازم است؛ موجودی شما ${toPersianDigits(user.points)} امتیاز است.`,
      code: 'NOT_ENOUGH_POINTS',
    };
  }

  // کسر اتمیک: اگر هم‌زمان دو درخواست برسد، فقط یکی موفق می‌شود
  const deducted = await env.DB.prepare(
    `UPDATE users SET points = points - ?
     WHERE id = ? AND role = 'customer' AND points >= ?
     RETURNING points`
  )
    .bind(settings.redeem_points, userId, settings.redeem_points)
    .first<{ points: number }>();

  if (!deducted) {
    return { ok: false, error: 'موجودی امتیاز کافی نیست.', code: 'NOT_ENOUGH_POINTS' };
  }

  const expiresAt = utcStamp(Date.now() + settings.redeem_expiry_days * 86_400_000);
  const coupon = await createCoupon(env.DB, {
    userId,
    kind: 'amount',
    value: settings.redeem_value,
    reason: 'redeem',
    expiresAt,
    maxUses: 1,
  });

  if (!coupon) {
    // اگر ساخت کد شکست خورد، امتیاز برمی‌گردد
    await env.DB.prepare('UPDATE users SET points = points + ? WHERE id = ?')
      .bind(settings.redeem_points, userId)
      .run();
    return { ok: false, error: 'ساخت کد تخفیف ناموفق بود؛ امتیاز شما برگشت داده شد.', code: 'COUPON_FAILED' };
  }

  await sendSms(env, settings, {
    userId,
    phone: user.phone,
    type: 'redeem',
    message: renderSms(settings, 'redeem', {
      name: user.name,
      points: toPersianDigits(settings.redeem_points),
      coupon: coupon.code,
      value: formatNumberFa(settings.redeem_value),
      expiry: formatJalali(expiresAt),
    }),
  });

  return {
    ok: true,
    code: coupon.code,
    value: coupon.value,
    expiresAt,
    pointsLeft: deducted.points,
  };
}

/* ==========================================================================
 * ۱۵) داده‌های پنل مشتری
 * ========================================================================== */

export type CustomerPanelData = {
  user: UserRow;
  invoices: InvoiceRow[];
  coupons: CouponRow[];
  activeCoupons: CouponRow[];
  totalSpent: number;
  visits: number;
  referrals: number;
  nextTier: { key: string; label: string; current: number; target: number; need: number } | null;
};

export async function getCustomerPanelData(
  db: D1Database,
  userId: number,
  settings: AppSettings
): Promise<CustomerPanelData | null> {
  const user = await findUserById(db, userId);
  if (!user || user.role !== 'customer') return null;

  const { results: invoices } = await db
    .prepare(
      `SELECT * FROM invoices
       WHERE user_id = ? AND voided_at IS NULL
       ORDER BY id DESC LIMIT 20`
    )
    .bind(userId)
    .all<InvoiceRow>();

  const { results: coupons } = await db
    .prepare('SELECT * FROM coupons WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .bind(userId)
    .all<CouponRow>();

  const totalRow = await db
    .prepare(
      'SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c FROM invoices WHERE user_id = ? AND voided_at IS NULL'
    )
    .bind(userId)
    .first<{ s: number; c: number }>();

  const refRow = await db
    .prepare('SELECT COUNT(*) AS c FROM users WHERE referred_by = ?')
    .bind(userId)
    .first<{ c: number }>();

  const order: Array<{ key: string; label: string; threshold: number }> = [
    { key: 'silver', label: 'نقره‌ای', threshold: settings.tiers.silver },
    { key: 'gold', label: 'طلایی', threshold: settings.tiers.gold },
    { key: 'vip', label: 'الماسی', threshold: settings.tiers.vip },
  ];
  const next = order.find((tier) => user.lifetime_points < tier.threshold) ?? null;
  const currentFloor =
    [...order].reverse().find((tier) => user.lifetime_points >= tier.threshold)?.threshold ?? 0;

  return {
    user,
    invoices: invoices ?? [],
    coupons: coupons ?? [],
    activeCoupons: (coupons ?? []).filter((coupon) => {
      if (coupon.is_active !== 1) return false;
      if (coupon.used_count >= coupon.max_uses) return false;
      if (!coupon.expires_at) return true;
      const ms = sqliteToMs(coupon.expires_at);
      return ms === null || ms >= Date.now();
    }),
    totalSpent: totalRow?.s ?? 0,
    visits: totalRow?.c ?? 0,
    referrals: refRow?.c ?? 0,
    nextTier: next
      ? {
          key: next.key,
          label: next.label,
          current: Math.max(0, user.lifetime_points - currentFloor),
          target: Math.max(1, next.threshold - currentFloor),
          need: Math.max(0, next.threshold - user.lifetime_points),
        }
      : null,
  };
}

/* ==========================================================================
 * ۱۶) گزارش اقدامات مدیران
 * ========================================================================== */

export type AdminLogRow = {
  id: number;
  admin_id: number | null;
  admin_name: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: string | null;
  ip: string | null;
  created_at: string;
};

export type AdminLogInput = {
  adminId: number | null;
  adminName: string;
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  details?: string | null;
  ip?: string | null;
};

/**
 * ثبت یک اقدام حساس مدیر. خطا هرگز جلوی عملیات اصلی را نمی‌گیرد؛
 * فقط در کنسول لاگ می‌شود تا نبودِ جدول باعث شکست عملیات نشود.
 */
export async function logAdminAction(db: D1Database, input: AdminLogInput): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO admin_logs (admin_id, admin_name, action, target_type, target_id, details, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        input.adminId,
        String(input.adminName).slice(0, 80),
        String(input.action).slice(0, 60),
        input.targetType ? String(input.targetType).slice(0, 40) : null,
        input.targetId === null || input.targetId === undefined
          ? null
          : String(input.targetId).slice(0, 40),
        input.details ? String(input.details).slice(0, 500) : null,
        input.ip ? String(input.ip).slice(0, 60) : null
      )
      .run();
  } catch (error) {
    console.error('logAdminAction failed:', error);
  }
}

/** فهرست صفحه‌بندی‌شدهٔ اقدامات مدیران */
export async function listAdminLogs(
  db: D1Database,
  params: { page?: number; pageSize?: number; action?: string; q?: string } = {}
): Promise<{ items: AdminLogRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(params.pageSize ?? 50)));
  const offset = (page - 1) * pageSize;

  const where: string[] = ['1 = 1'];
  const binds: Array<string | number> = [];

  const action = String(params.action ?? '').trim().slice(0, 60);
  if (action) {
    where.push('action = ?');
    binds.push(action);
  }

  const q = String(params.q ?? '').trim().slice(0, 60);
  if (q) {
    where.push('(admin_name LIKE ? OR details LIKE ? OR target_id LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const whereSql = where.join(' AND ');

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS c FROM admin_logs WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ c: number }>();

  const { results } = await db
    .prepare(`SELECT * FROM admin_logs WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .bind(...binds, pageSize, offset)
    .all<AdminLogRow>();

  return { items: results ?? [], total: totalRow?.c ?? 0, page, pageSize };
}

/** همهٔ اقدام‌های ثبت‌شده برای خروجی CSV */
export async function exportAdminLogs(db: D1Database, limit = 5000): Promise<AdminLogRow[]> {
  const safeLimit = Math.min(20_000, Math.max(1, Math.floor(limit)));
  const { results } = await db
    .prepare('SELECT * FROM admin_logs ORDER BY id DESC LIMIT ?')
    .bind(safeLimit)
    .all<AdminLogRow>();
  return results ?? [];
}

/* ==========================================================================
 * ۱۷) گزارش‌های تحلیلی (فروش، کارمند، ماندگاری، منو)
 * ========================================================================== */

export type StaffSalesRow = {
  staff_id: number | null;
  staff_name: string;
  invoices: number;
  amount: number;
  points: number;
};

export type MenuItemSalesRow = { name: string; qty: number; amount: number };

export type MonthlySalesRow = { label: string; amount: number; invoices: number };

export type ReportsData = {
  thisMonth: { label: string; sales: number; invoices: number; customers: number; avgBasket: number };
  lastMonth: { label: string; sales: number; invoices: number; customers: number; avgBasket: number };
  growth: { salesPct: number | null; invoicesPct: number | null };
  staff: StaffSalesRow[];
  retention: {
    buyers: number;
    repeatBuyers: number;
    rate: number | null;
    newThisMonth: number;
    newLastMonth: number;
  };
  topItems: MenuItemSalesRow[];
  months: MonthlySalesRow[];
  totals: { customers: number; active: number; sleeping: number; points: number };
};

/**
 * دادهٔ صفحهٔ گزارش‌ها. تعداد کوئری‌ها ثابت و کم است (مناسب محدودیت
 * ۵۰ کوئری در هر فراخوانی Worker در پلن رایگان).
 */
export async function getReportsData(
  db: D1Database,
  settings: AppSettings,
  timeZone = DEFAULT_TIMEZONE
): Promise<ReportsData> {
  const month = jalaliMonthRangeAt(0, timeZone);
  const prevMonth = jalaliMonthRangeAt(1, timeZone);
  const r90 = zonedDayRange(timeZone, 89);

  const [
    thisRow,
    prevRow,
    thisCustomers,
    prevCustomers,
    staffRows,
    retentionRow,
    newThisRow,
    newPrevRow,
    itemRows,
    totalsRow,
    pointsRow,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c
         FROM invoices WHERE voided_at IS NULL AND created_at >= ? AND created_at < ?`
      )
      .bind(month.start, month.end)
      .first<{ s: number; c: number }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c
         FROM invoices WHERE voided_at IS NULL AND created_at >= ? AND created_at < ?`
      )
      .bind(prevMonth.start, prevMonth.end)
      .first<{ s: number; c: number }>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) AS c FROM invoices
         WHERE voided_at IS NULL AND created_at >= ? AND created_at < ?`
      )
      .bind(month.start, month.end)
      .first<{ c: number }>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) AS c FROM invoices
         WHERE voided_at IS NULL AND created_at >= ? AND created_at < ?`
      )
      .bind(prevMonth.start, prevMonth.end)
      .first<{ c: number }>(),
    db
      .prepare(
        `SELECT i.registered_by AS staff_id,
                COALESCE(u.name, 'ثبت سیستمی') AS staff_name,
                COUNT(*) AS invoices,
                COALESCE(SUM(i.amount), 0) AS amount,
                COALESCE(SUM(i.points_earned), 0) AS points
         FROM invoices i LEFT JOIN users u ON u.id = i.registered_by
         WHERE i.voided_at IS NULL AND i.created_at >= ? AND i.created_at < ?
         GROUP BY i.registered_by
         ORDER BY amount DESC`
      )
      .bind(month.start, month.end)
      .all<StaffSalesRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS buyers,
                SUM(CASE WHEN visits >= 2 THEN 1 ELSE 0 END) AS repeat_buyers
         FROM (
           SELECT user_id, COUNT(*) AS visits
           FROM invoices
           WHERE voided_at IS NULL AND created_at >= ?
           GROUP BY user_id
         )`
      )
      .bind(r90.start)
      .first<{ buyers: number; repeat_buyers: number | null }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM users
         WHERE role = 'customer' AND created_at >= ? AND created_at < ?`
      )
      .bind(month.start, month.end)
      .first<{ c: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM users
         WHERE role = 'customer' AND created_at >= ? AND created_at < ?`
      )
      .bind(prevMonth.start, prevMonth.end)
      .first<{ c: number }>(),
    db
      .prepare(
        `SELECT items FROM invoices
         WHERE voided_at IS NULL AND created_at >= ?
         ORDER BY id DESC LIMIT 2000`
      )
      .bind(r90.start)
      .all<{ items: string }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS all_customers,
                SUM(CASE WHEN last_visit_date IS NOT NULL
                          AND last_visit_date >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS active
         FROM users WHERE role = 'customer'`
      )
      .first<{ all_customers: number; active: number }>(),
    db
      .prepare(`SELECT COALESCE(SUM(points), 0) AS p FROM users WHERE role = 'customer'`)
      .first<{ p: number }>(),
  ]);

  // فاکتورهای ۶ ماه اخیر (۶ کوئری شمارشی) — با Promise.all موازی اجرا می‌شوند
  const monthRanges = [0, 1, 2, 3, 4, 5].map((offset) => jalaliMonthRangeAt(offset, timeZone));
  const monthRows = await Promise.all(
    monthRanges.map((range) =>
      db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c
           FROM invoices WHERE voided_at IS NULL AND created_at >= ? AND created_at < ?`
        )
        .bind(range.start, range.end)
        .first<{ s: number; c: number }>()
    )
  );

  // جمع‌بندی آیتم‌های منو در ۹۰ روز اخیر
  const itemMap = new Map<string, MenuItemSalesRow>();
  for (const row of itemRows.results ?? []) {
    const parsed = safeJsonParse<Array<{ name?: unknown; qty?: unknown; price?: unknown }>>(
      row.items,
      []
    );
    if (!Array.isArray(parsed)) continue;
    for (const item of parsed) {
      const name = String(item?.name ?? '').trim().slice(0, 60);
      if (!name) continue;
      const qty = Math.max(0, Math.floor(Number(item?.qty) || 0));
      const price = Math.max(0, Math.floor(Number(item?.price) || 0));
      const current = itemMap.get(name) ?? { name, qty: 0, amount: 0 };
      current.qty += qty;
      current.amount += qty * price;
      itemMap.set(name, current);
    }
  }

  const topItems = Array.from(itemMap.values())
    .sort((a, b) => b.qty - a.qty || b.amount - a.amount)
    .slice(0, 10);

  const thisSales = thisRow?.s ?? 0;
  const prevSales = prevRow?.s ?? 0;
  const thisCount = thisRow?.c ?? 0;
  const prevCount = prevRow?.c ?? 0;

  const pct = (current: number, previous: number): number | null => {
    if (!previous) return current > 0 ? 100 : null;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  };

  const buyers = retentionRow?.buyers ?? 0;
  const repeatBuyers = retentionRow?.repeat_buyers ?? 0;

  const sleepingRow = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM users u
       WHERE u.role = 'customer' AND u.last_visit_date IS NOT NULL
         AND julianday('now') - julianday(u.last_visit_date) >
             (CASE WHEN (SELECT COUNT(*) FROM invoices i
                          WHERE i.user_id = u.id AND i.voided_at IS NULL) >= ?
                     AND u.avg_visit_interval > 0
                   THEN u.avg_visit_interval ELSE ? END) + ?`
    )
    .bind(settings.churn_min_visits, CHURN_DEFAULT_INTERVAL, settings.churn_grace_days)
    .first<{ c: number }>();

  return {
    thisMonth: {
      label: month.label,
      sales: thisSales,
      invoices: thisCount,
      customers: thisCustomers?.c ?? 0,
      avgBasket: thisCount > 0 ? Math.round(thisSales / thisCount) : 0,
    },
    lastMonth: {
      label: prevMonth.label,
      sales: prevSales,
      invoices: prevCount,
      customers: prevCustomers?.c ?? 0,
      avgBasket: prevCount > 0 ? Math.round(prevSales / prevCount) : 0,
    },
    growth: { salesPct: pct(thisSales, prevSales), invoicesPct: pct(thisCount, prevCount) },
    staff: staffRows.results ?? [],
    retention: {
      buyers,
      repeatBuyers,
      rate: buyers > 0 ? Math.round((repeatBuyers / buyers) * 1000) / 10 : null,
      newThisMonth: newThisRow?.c ?? 0,
      newLastMonth: newPrevRow?.c ?? 0,
    },
    topItems,
    months: monthRanges.map((range, index) => ({
      label: range.label,
      amount: monthRows[index]?.s ?? 0,
      invoices: monthRows[index]?.c ?? 0,
    })),
    totals: {
      customers: totalsRow?.all_customers ?? 0,
      active: totalsRow?.active ?? 0,
      sleeping: sleepingRow?.c ?? 0,
      points: pointsRow?.p ?? 0,
    },
  };
}
