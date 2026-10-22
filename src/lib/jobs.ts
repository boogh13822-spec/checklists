/**
 * ----------------------------------------------------------------------------
 *  جاب‌های خودکار (Cron Triggers)
 * ----------------------------------------------------------------------------
 *  ۱) churn      : پیش‌بینی ریزش — «دلمان برایت تنگ شده»
 *  ۲) birthday   : تبریک تولد + کد تخفیف اختصاصی
 *  ۳) weather    : پیامک وضعیت آب‌وهوا از OpenWeather
 *  ۴) maintenance: بازمحاسبه میانگین خرید، پاک‌سازی لاگ‌ها، انقضای کدها
 *  ۵) monthly    : گزارش ماهانه برای ادمین‌ها
 *
 *  ⚠️ محدودیت: هر اجرا حداکثر ۵۰ پیامک می‌فرستد تا از سقف Subrequest
 *  ورکرها (۵۰ در پلن رایگان) عبور نکنیم. بقیه در اجرای بعدی ارسال می‌شوند.
 */
import type { AppSettings, Bindings, CouponRow, UserRow } from '../types';
import {
  daysSince,
  formatNumberFa,
  formatJalali,
  sqliteToMs,
  todayISO,
  todayJalali,
  toGregorian,
  toJalali,
  toPersianDigits,
  utcStamp,
} from './utils';
import { renderSms, sendSms, fetchWeather } from './sms';
import { createCoupon, getDashboardStats, recomputeAvgInterval, tierLabel } from './db';
import { CHURN_DEFAULT_INTERVAL, getRawSetting, saveSetting } from './settings';

const MAX_SMS_PER_RUN = 50;
const CHURN_COOLDOWN_DAYS = 30;
/*
 * CHURN_DEFAULT_INTERVAL از settings.ts می‌آید تا داشبورد، فیلتر مشتریان و
 * جاب ریزش دقیقاً یک قاعده را دنبال کنند.
 */

export type JobResult = {
  job: string;
  ok: boolean;
  sent: number;
  skipped: number;
  failed: number;
  message: string;
  details?: Record<string, unknown>;
};

/* ==========================================================================
 *  ابزارهای داخلی
 * ========================================================================== */

const JOB_RUN_PREFIX = 'job_last_run:';

/** بررسی این‌که جاب امروز اجرا شده است یا نه */
async function alreadyRanToday(env: Bindings, job: string, todayISO: string): Promise<boolean> {
  const raw = await getRawSetting(env, `${JOB_RUN_PREFIX}${job}`);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { date?: string };
    return parsed.date === todayISO;
  } catch {
    return false;
  }
}

async function markRan(env: Bindings, job: string, dateISO: string): Promise<void> {
  await saveSetting(env, `${JOB_RUN_PREFIX}${job}`, {
    date: dateISO,
    at: new Date().toISOString(),
  });
}

/** خواندن آخرین اجرای جاب‌ها برای نمایش در داشبورد */
export async function getJobRuns(
  env: Bindings
): Promise<Record<string, { date: string; at: string } | null>> {
  const jobs = ['churn', 'birthday', 'weather', 'maintenance', 'monthly'];
  const out: Record<string, { date: string; at: string } | null> = {};
  for (const job of jobs) {
    const raw = await getRawSetting(env, `${JOB_RUN_PREFIX}${job}`);
    if (!raw) {
      out[job] = null;
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as { date?: string; at?: string };
      out[job] = { date: parsed.date ?? '', at: parsed.at ?? '' };
    } catch {
      out[job] = null;
    }
  }
  return out;
}

/* ==========================================================================
 * ۱) پیش‌بینی ریزش
 * ========================================================================== */

type ChurnCandidate = {
  id: number;
  name: string;
  phone: string;
  last_visit_date: string;
  avg_visit_interval: number;
  last_churn_sms_at: string | null;
  tier: string;
  visits: number;
};

export async function runChurnJob(
  env: Bindings,
  settings: AppSettings,
  force = false
): Promise<JobResult> {
  const dateKey = todayISO();

  if (!force && (await alreadyRanToday(env, 'churn', dateKey))) {
    return {
      job: 'churn',
      ok: true,
      sent: 0,
      skipped: 0,
      failed: 0,
      message: 'این جاب امروز قبلاً اجرا شده است.',
    };
  }

  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.phone, u.last_visit_date, u.avg_visit_interval, u.last_churn_sms_at, u.tier,
            (SELECT COUNT(*) FROM invoices i WHERE i.user_id = u.id) AS visits
     FROM users u
     WHERE u.role = 'customer' AND u.is_active = 1
       AND u.last_visit_date IS NOT NULL
     LIMIT 3000`
  ).all<ChurnCandidate>();

  const candidates = (results ?? []).filter((row) => {
    const days = daysSince(row.last_visit_date);
    // میانگین فقط وقتی معتبر است که تعداد خرید به حداقل تنظیم‌شده برسد؛
    // در غیر این صورت (مثلاً مشتری تک‌خرید) مبنای پیش‌فرض ۳۰ روزه استفاده می‌شود.
    const hasReliableAverage =
      row.visits >= settings.churn_min_visits && row.avg_visit_interval > 0;
    const baseline = hasReliableAverage ? row.avg_visit_interval : CHURN_DEFAULT_INTERVAL;
    const threshold = baseline + settings.churn_grace_days;
    if (days <= threshold) return false;
    if (row.last_churn_sms_at) {
      const lastMs = sqliteToMs(row.last_churn_sms_at);
      if (lastMs !== null && Date.now() - lastMs < CHURN_COOLDOWN_DAYS * 86_400_000) {
        return false;
      }
    }
    return true;
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of candidates) {
    if (sent >= MAX_SMS_PER_RUN) break;
    const days = daysSince(row.last_visit_date);
    const message = renderSms(settings, 'churn', {
      name: row.name,
      last_visit: toPersianDigits(days),
      days: toPersianDigits(days),
      avg: toPersianDigits(
        Math.round(
          row.visits >= settings.churn_min_visits && row.avg_visit_interval > 0
            ? row.avg_visit_interval
            : CHURN_DEFAULT_INTERVAL
        )
      ),
      tier: tierLabel(row.tier),
      cafe: settings.cafe_name,
    });

    const result = await sendSms(env, settings, {
      userId: row.id,
      phone: row.phone,
      type: 'churn',
      message,
    });

    if (result.status === 'sent') {
      sent += 1;
      await env.DB.prepare('UPDATE users SET last_churn_sms_at = ? WHERE id = ?')
        .bind(new Date().toISOString().slice(0, 19).replace('T', ' '), row.id)
        .run();
    } else if (result.status === 'failed') {
      failed += 1;
    } else {
      skipped += 1;
    }
  }

  await markRan(env, 'churn', dateKey);
  console.log(`[job:churn] candidates=${candidates.length} sent=${sent} failed=${failed}`);

  return {
    job: 'churn',
    ok: true,
    sent,
    skipped,
    failed,
    message: `${toPersianDigits(candidates.length)} مشتری در معرض ریزش شناسایی شد؛ ${toPersianDigits(sent)} پیامک ارسال شد.`,
    details: { candidates: candidates.length },
  };
}

/* ==========================================================================
 * ۲) تولد
 * ========================================================================== */

export async function runBirthdayJob(
  env: Bindings,
  settings: AppSettings,
  force = false
): Promise<JobResult> {
  const dateKey = todayISO();
  if (!force && (await alreadyRanToday(env, 'birthday', dateKey))) {
    return {
      job: 'birthday',
      ok: true,
      sent: 0,
      skipped: 0,
      failed: 0,
      message: 'این جاب امروز قبلاً اجرا شده است.',
    };
  }

  const today = todayJalali();
  const { results } = await env.DB.prepare(
    `SELECT * FROM users
     WHERE role = 'customer' AND is_active = 1 AND birth_date IS NOT NULL
     LIMIT 5000`
  ).all<UserRow>();

  const birthdays = (results ?? []).filter((user) => {
    const iso = String(user.birth_date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const [gy, gm, gd] = iso.split('-').map((n) => parseInt(n, 10));
    const jalali = toJalali(gy, gm, gd);
    return jalali.jm === today.jm && jalali.jd === today.jd;
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // شروع سال شمسی جاری (برای جلوگیری از صدور کد تکراری)
  const yearStartG = toGregorian(today.jy, 1, 1);
  const yearStart = utcStamp(Date.UTC(yearStartG.gy, yearStartG.gm - 1, yearStartG.gd) - 3.5 * 3_600_000);

  for (const user of birthdays) {
    if (sent >= MAX_SMS_PER_RUN) break;

    const existing = await env.DB.prepare(
      `SELECT id FROM coupons WHERE user_id = ? AND reason = 'birthday' AND created_at >= ? LIMIT 1`
    )
      .bind(user.id, yearStart)
      .first<{ id: number }>();

    let coupon: CouponRow | null = null;
    if (existing) {
      skipped += 1;
      continue;
    }

    coupon = await createCoupon(env.DB, {
      userId: user.id,
      kind: 'percent',
      value: settings.birthday_coupon_percent,
      reason: 'birthday',
      expiresAt: utcStamp(Date.now() + 14 * 86_400_000),
      maxUses: 1,
    });

    if (!coupon) {
      failed += 1;
      continue;
    }

    const result = await sendSms(env, settings, {
      userId: user.id,
      phone: user.phone,
      type: 'birthday',
      message: renderSms(settings, 'birthday', {
        name: user.name,
        coupon: coupon.code,
        percent: toPersianDigits(settings.birthday_coupon_percent),
      }),
    });

    if (result.status === 'sent') sent += 1;
    else if (result.status === 'failed') failed += 1;
    else skipped += 1;
  }

  await markRan(env, 'birthday', dateKey);
  console.log(`[job:birthday] found=${birthdays.length} sent=${sent} failed=${failed}`);

  return {
    job: 'birthday',
    ok: true,
    sent,
    skipped,
    failed,
    message: `${toPersianDigits(birthdays.length)} تولد امروز؛ ${toPersianDigits(sent)} پیامک و کد تخفیف ارسال شد.`,
    details: { birthdays: birthdays.length },
  };
}

/* ==========================================================================
 * ۳) آب‌وهوا
 * ========================================================================== */

export async function runWeatherJob(
  env: Bindings,
  settings: AppSettings,
  force = false
): Promise<JobResult> {
  const dateKey = todayISO();
  if (!force && (await alreadyRanToday(env, 'weather', dateKey))) {
    return {
      job: 'weather',
      ok: true,
      sent: 0,
      skipped: 0,
      failed: 0,
      message: 'این جاب امروز قبلاً اجرا شده است.',
    };
  }

  const weather = await fetchWeather(env, settings);
  if (!weather.ok) {
    await markRan(env, 'weather', dateKey);
    return {
      job: 'weather',
      ok: false,
      sent: 0,
      skipped: 0,
      failed: 0,
      message: `دریافت آب‌وهوا ناموفق بود: ${weather.error ?? 'خطای نامشخص'}`,
    };
  }

  // مشتریان فعال ۳۰ روز گذشته
  const { results } = await env.DB.prepare(
    `SELECT id, name, phone, tier FROM users
     WHERE role = 'customer' AND is_active = 1
       AND (last_visit_date >= datetime('now', '-30 days') OR created_at >= datetime('now', '-30 days'))
     ORDER BY last_visit_date DESC
     LIMIT ?`
  )
    .bind(MAX_SMS_PER_RUN)
    .all<{ id: number; name: string; phone: string; tier: string }>();

  let sent = 0;
  let failed = 0;

  for (const user of results ?? []) {
    const result = await sendSms(env, settings, {
      userId: user.id,
      phone: user.phone,
      type: 'weather',
      message: renderSms(settings, 'weather', {
        name: user.name,
        city: weather.city,
        weather: `${weather.label} ${weather.emoji}`.trim(),
        temp: toPersianDigits(weather.temp),
        advice: weather.advice,
        tier: tierLabel(user.tier),
      }),
    });
    if (result.status === 'sent') sent += 1;
    else if (result.status === 'failed') failed += 1;
  }

  await markRan(env, 'weather', dateKey);
  console.log(`[job:weather] ${weather.label} ${weather.temp}C sent=${sent}`);

  return {
    job: 'weather',
    ok: true,
    sent,
    skipped: 0,
    failed,
    message: `هوا: ${weather.label} ${toPersianDigits(weather.temp)}°C — ${toPersianDigits(sent)} پیامک ارسال شد.`,
    details: { weather: weather.label, temp: weather.temp },
  };
}

/* ==========================================================================
 * ۴) نگهداری
 * ========================================================================== */

export async function runMaintenanceJob(env: Bindings): Promise<JobResult> {
  const { results: users } = await env.DB.prepare(
    `SELECT id FROM users
     WHERE last_visit_date IS NOT NULL
     ORDER BY last_visit_date DESC
     LIMIT 200`
  ).all<{ id: number }>();

  for (const user of users ?? []) {
    await recomputeAvgInterval(env.DB, user.id);
  }

  const expiredCoupons = await env.DB.prepare(
    `UPDATE coupons SET is_active = 0
     WHERE is_active = 1 AND expires_at IS NOT NULL AND expires_at < datetime('now')`
  ).run();

  const oldLogs = await env.DB.prepare(
    `DELETE FROM sms_logs WHERE sent_at < datetime('now', '-180 days')`
  ).run();

  await markRan(env, 'maintenance', todayISO());

  return {
    job: 'maintenance',
    ok: true,
    sent: 0,
    skipped: 0,
    failed: 0,
    message: `میانگین ${toPersianDigits(users?.length ?? 0)} مشتری بازمحاسبه شد؛ ${toPersianDigits(
      expiredCoupons.meta?.changes ?? 0
    )} کد منقضی و ${toPersianDigits(oldLogs.meta?.changes ?? 0)} لاگ قدیمی پاک شد.`,
  };
}

/* ==========================================================================
 * ۵) گزارش ماهانه
 * ========================================================================== */

export async function runMonthlyReport(
  env: Bindings,
  settings: AppSettings,
  force = false
): Promise<JobResult> {
  const dateKey = new Date().toISOString().slice(0, 8); // YYYY-MM
  if (!force && (await alreadyRanToday(env, 'monthly', dateKey))) {
    return {
      job: 'monthly',
      ok: true,
      sent: 0,
      skipped: 0,
      failed: 0,
      message: 'گزارش این ماه قبلاً ارسال شده است.',
    };
  }

  const today = todayJalali();
  const startG = toGregorian(today.jy, today.jm, 1);
  const offset = 3.5 * 3_600_000;
  const monthStart = utcStamp(Date.UTC(startG.gy, startG.gm - 1, startG.gd) - offset);

  const stats = await getDashboardStats(
    env.DB,
    settings,
    utcStamp(Date.now() - offset),
    utcStamp(Date.now() - offset + 86_400_000),
    monthStart,
    utcStamp(Date.now() - 30 * 86_400_000)
  );

  const { results: admins } = await env.DB.prepare(
    `SELECT id, name, phone FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 10`
  ).all<{ id: number; name: string; phone: string }>();

  const message =
    `گزارش ${formatJalali(new Date().toISOString().slice(0, 10))}\n` +
    `مشتریان: ${toPersianDigits(stats.totalCustomers)}\n` +
    `فروش امروز: ${formatNumberFa(stats.todaySales)} تومان\n` +
    `فروش ماه: ${formatNumberFa(stats.monthSales)} تومان\n` +
    `در خطر ریزش: ${toPersianDigits(stats.sleepingCustomers)}\n` +
    `${settings.cafe_name}`;

  let sent = 0;
  for (const admin of admins ?? []) {
    const result = await sendSms(env, settings, {
      userId: admin.id,
      phone: admin.phone,
      type: 'admin',
      message,
    });
    if (result.status === 'sent') sent += 1;
  }

  await markRan(env, 'monthly', dateKey);

  return {
    job: 'monthly',
    ok: true,
    sent,
    skipped: 0,
    failed: 0,
    message: `گزارش ماهانه برای ${toPersianDigits(sent)} ادمین ارسال شد.`,
  };
}

/* ==========================================================================
 *  اجرای دستی و Cron
 * ========================================================================== */

export type JobName = 'churn' | 'birthday' | 'weather' | 'maintenance' | 'monthly';

export function isJobName(value: string): value is JobName {
  return ['churn', 'birthday', 'weather', 'maintenance', 'monthly'].includes(value);
}

/** اجرای یک جاب با نام (برای دکمه «اجرای دستی» در پنل ادمین) */
export async function runJobByName(
  env: Bindings,
  settings: AppSettings,
  name: JobName,
  force = true
): Promise<JobResult> {
  switch (name) {
    case 'churn':
      return runChurnJob(env, settings, force);
    case 'birthday':
      return runBirthdayJob(env, settings, force);
    case 'weather':
      return runWeatherJob(env, settings, force);
    case 'maintenance':
      return runMaintenanceJob(env);
    case 'monthly':
      return runMonthlyReport(env, settings, force);
  }
}

/**
 * انتخاب جاب مناسب بر اساس عبارت cron.
 * اگر عبارت ناشناخته باشد، همه‌ی جاب‌های روزانه اجرا می‌شوند (هر کدام یک‌بار در روز).
 */
export async function dispatchCron(
  env: Bindings,
  settings: AppSettings,
  cron: string
): Promise<JobResult[]> {
  const normalized = cron.trim().replace(/\s+/g, ' ');

  // زمان تهران (UTC+3:30) — پاییز و زمستان و تابستان ایران بدون تغییر ساعت
  if (normalized === '30 19 * * *') {
    return [await runChurnJob(env, settings)];
  }
  if (normalized === '30 4 * * *') {
    return [await runBirthdayJob(env, settings)];
  }
  if (normalized === '0 5 * * *') {
    return [await runWeatherJob(env, settings)];
  }
  if (normalized === '0 * * * *') {
    return [await runMaintenanceJob(env)];
  }
  if (normalized === '0 20 1 * *') {
    return [await runMonthlyReport(env, settings)];
  }

  // fallback: اجرای همه‌ی جاب‌های روزانه با محافظ «یک‌بار در روز»
  const results: JobResult[] = [];
  results.push(await runBirthdayJob(env, settings));
  results.push(await runWeatherJob(env, settings));
  results.push(await runChurnJob(env, settings));
  results.push(await runMaintenanceJob(env));
  if (new Date().getUTCDate() <= 2) {
    results.push(await runMonthlyReport(env, settings));
  }
  return results;
}
