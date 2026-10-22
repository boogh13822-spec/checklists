/**
 * ----------------------------------------------------------------------------
 *  ورود مشتری با رمز یک‌بارمصرف پیامکی (OTP)
 * ----------------------------------------------------------------------------
 *  - کد ۶ رقمی، اعتبار ۲ دقیقه، حداکثر ۵ تلاش
 *  - کد به‌صورت هش SHA-256 ذخیره می‌شود (خودِ کد هیچ‌جا ذخیره نمی‌شود)
 *  - محدودسازی نرخ در دیتابیس (مشترک بین همه ایزوله‌ها)
 */
import type { AppSettings, Bindings } from '../types';
import { findUserByPhone } from './db';
import { sendSms } from './sms';
import { utcStamp } from './utils';

export const OTP_TTL_SECONDS = 120;
export const OTP_MAX_ATTEMPTS = 5;

/** محدودسازی نرخ مشترک (D1) — در صورت خطا null برمی‌گردد تا فراخوان از حافظه استفاده کند */
export async function dbRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfter: number } | null> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO rate_limits (key, count, reset_at)
         VALUES (?, 1, datetime('now', ?))
         ON CONFLICT(key) DO UPDATE SET
           count = CASE WHEN reset_at <= datetime('now') THEN 1 ELSE count + 1 END,
           reset_at = CASE WHEN reset_at <= datetime('now') THEN datetime('now', ?) ELSE reset_at END
         RETURNING count, reset_at`
      )
      .bind(key, `+${Math.max(1, Math.floor(windowSeconds))} seconds`, `+${Math.max(1, Math.floor(windowSeconds))} seconds`)
      .first<{ count: number; reset_at: string }>();

    if (!row) return null;

    const resetMs = Date.parse(`${String(row.reset_at).replace(' ', 'T')}Z`);
    const retryAfter = Number.isFinite(resetMs)
      ? Math.max(1, Math.ceil((resetMs - Date.now()) / 1000))
      : windowSeconds;

    return { allowed: row.count <= limit, retryAfter };
  } catch (error) {
    console.error('dbRateLimit failed:', error);
    return null;
  }
}

/** پاک‌سازی رکوردهای قدیمی محدودسازی نرخ (در جاب نگهداری صدا زده می‌شود) */
export async function pruneRateLimits(db: D1Database): Promise<void> {
  try {
    await db.prepare("DELETE FROM rate_limits WHERE reset_at < datetime('now', '-1 day')").run();
  } catch (error) {
    console.error('pruneRateLimits failed:', error);
  }
}

/** کد ۶ رقمی تصادفی امن */
export function generateOtpCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const value =
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(value % 1_000_000).padStart(6, '0');
}

/** هش کد با نمک (شماره + کلید سرور) */
export async function hashOtp(code: string, phone: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(`otp:${phone}:${code}:${secret}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type OtpRequestResult =
  | { ok: true; ttl: number; sent: boolean }
  | { ok: false; error: string; code: string; retryAfter?: number };

/** درخواست کد ورود برای یک شماره */
export async function requestOtpCode(
  env: Bindings,
  settings: AppSettings,
  phone: string,
  clientIp: string
): Promise<OtpRequestResult> {
  if (settings.otp_login_enabled !== 1) {
    return { ok: false, error: 'ورود پیامکی غیرفعال است؛ با پرسنل کافه تماس بگیرید.', code: 'OTP_DISABLED' };
  }

  // سقف درخواست از هر دستگاه، مستقل از وجود شماره
  const perIp = await dbRateLimit(env.DB, `otp:ip:${clientIp}`, 15, 3600);
  if (perIp && !perIp.allowed) {
    return {
      ok: false,
      error: 'تعداد درخواست‌ها از این دستگاه زیاد است؛ کمی بعد تلاش کنید.',
      code: 'RATE_LIMITED',
      retryAfter: perIp.retryAfter,
    };
  }

  const user = await findUserByPhone(env.DB, phone);
  if (!user || user.role !== 'customer' || user.is_active !== 1) {
    // پیام یکسان برای همه؛ وجود/عدم وجود شماره افشا نمی‌شود
    return { ok: true, ttl: 0, sent: false };
  }

  const perPhone = await dbRateLimit(env.DB, `otp:phone:${phone}`, 3, 600);
  if (perPhone && !perPhone.allowed) {
    return {
      ok: false,
      error: 'کد ورود اخیراً چند بار ارسال شده است؛ چند دقیقه بعد دوباره تلاش کنید.',
      code: 'RATE_LIMITED',
      retryAfter: perPhone.retryAfter,
    };
  }

  const perHour = await dbRateLimit(env.DB, `otp:hour:${phone}`, 8, 3600);
  if (perHour && !perHour.allowed) {
    return {
      ok: false,
      error: 'تعداد درخواست‌های امروز زیاد است؛ کمی بعد تلاش کنید.',
      code: 'RATE_LIMITED',
      retryAfter: perHour.retryAfter,
    };
  }

  // کدهای قبلی همین شماره باطل می‌شوند تا فقط آخرین کد معتبر باشد
  await env.DB.prepare('UPDATE otp_codes SET used_at = ? WHERE phone = ? AND used_at IS NULL')
    .bind(utcStamp(Date.now()), phone)
    .run();

  const code = generateOtpCode();
  const secret = env.JWT_SECRET ?? 'otp-secret';
  const codeHash = await hashOtp(code, phone, secret);
  const expiresAt = utcStamp(Date.now() + OTP_TTL_SECONDS * 1000);

  await env.DB.prepare(
    `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES (?, ?, ?)`
  )
    .bind(phone, codeHash, expiresAt)
    .run();

  await sendSms(env, settings, {
    userId: user.id,
    phone,
    type: 'otp',
    message: `کد ورود شما به باشگاه ${settings.cafe_name}: ${code}\nاین کد فقط ۲ دقیقه اعتبار دارد؛ آن را با کسی به اشتراک نگذارید.`,
  });

  return { ok: true, ttl: OTP_TTL_SECONDS, sent: true };
}

export type OtpVerifyResult =
  | { ok: true; userId: number }
  | { ok: false; error: string; code: string };

/** بررسی کد و برگرداندن شناسهٔ مشتری */
export async function verifyOtpCode(
  env: Bindings,
  phone: string,
  code: string
): Promise<OtpVerifyResult> {
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: 'کد ورود باید ۶ رقم باشد.', code: 'INVALID_CODE' };
  }

  const row = await env.DB.prepare(
    `SELECT id, code_hash, expires_at, attempts
     FROM otp_codes
     WHERE phone = ? AND used_at IS NULL
     ORDER BY id DESC LIMIT 1`
  )
    .bind(phone)
    .first<{ id: number; code_hash: string; expires_at: string; attempts: number }>();

  if (!row) {
    return {
      ok: false,
      error: 'کد معتبری برای این شماره صادر نشده است؛ دوباره درخواست کنید.',
      code: 'NO_CODE',
    };
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return {
      ok: false,
      error: 'تعداد تلاش‌های اشتباه زیاد است؛ یک کد جدید بگیرید.',
      code: 'TOO_MANY_ATTEMPTS',
    };
  }

  const expiresMs = Date.parse(`${String(row.expires_at).replace(' ', 'T')}Z`);
  if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
    return { ok: false, error: 'کد منقضی شده است؛ کد جدید بگیرید.', code: 'EXPIRED' };
  }

  await env.DB.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?')
    .bind(row.id)
    .run();

  const secret = env.JWT_SECRET ?? 'otp-secret';
  const expected = await hashOtp(code, phone, secret);

  if (!safeEqual(expected, row.code_hash)) {
    return { ok: false, error: 'کد وارد شده صحیح نیست.', code: 'WRONG_CODE' };
  }

  const user = await findUserByPhone(env.DB, phone);
  if (!user || user.role !== 'customer' || user.is_active !== 1) {
    return { ok: false, error: 'این حساب در دسترس نیست.', code: 'ACCOUNT_DISABLED' };
  }

  await env.DB.prepare('UPDATE otp_codes SET used_at = ? WHERE id = ?')
    .bind(utcStamp(Date.now()), row.id)
    .run();

  return { ok: true, userId: user.id };
}
