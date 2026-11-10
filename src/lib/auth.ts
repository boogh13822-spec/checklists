/**
 * ----------------------------------------------------------------------------
 *  احراز هویت: JWT (hono/jwt) + کوکی امن + محدودسازی نرخ درخواست
 * ----------------------------------------------------------------------------
 */
import type { Context, MiddlewareHandler } from 'hono';
import { sign, verify } from 'hono/jwt';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, JwtPayload, Role, UserRow, Bindings } from '../types';
import { fail } from './utils';

export const SESSION_COOKIE = 'cc_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60; // ۱۲ ساعت (پیش‌فرض)

/**
 * طول عمر نشست مشتری (روز) — پیش‌فرض ۳۰ روز، حداکثر ۹۰.
 * مشتری‌ها با کد پیامکی وارد می‌شوند و نباید هر روز دوباره وارد شوند.
 */
export function customerSessionTtl(env: Bindings): number {
  const days = Number(env.CUSTOMER_SESSION_DAYS);
  const safe = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;
  return Math.min(90, Math.max(1, safe)) * 86_400;
}

/** طول عمر نشست بر اساس متغیر محیطی SESSION_HOURS (۱ تا ۱۶۸ ساعت) */
export function sessionTtl(env: Bindings): number {
  const hours = Number(env.SESSION_HOURS);
  if (!Number.isFinite(hours) || hours <= 0) return SESSION_TTL_SECONDS;
  return Math.min(168, Math.max(1, Math.floor(hours))) * 3600;
}

/** ساخت توکن JWT برای کاربر */
export async function createToken(
  secret: string,
  user: Pick<UserRow, 'id' | 'role' | 'name'> & { token_version?: number },
  ttlSeconds: number = SESSION_TTL_SECONDS
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: String(user.id),
    uid: user.id,
    role: user.role,
    name: user.name,
    tv: user.token_version ?? 0,
    iat: now,
    exp: now + ttlSeconds,
  };
  return sign(payload as unknown as Record<string, unknown>, secret, 'HS256');
}

/** تنظیم کوکی نشست (HttpOnly + SameSite=Lax + Secure در محیط ابری) */
export function setSessionCookie(
  c: Context<AppEnv>,
  token: string,
  isSecure: boolean,
  ttlSeconds: number = SESSION_TTL_SECONDS
): void {
  // اگر در همین پاسخ کوکی قبلی پاک شده باشد (مثلاً توکن منقضی)، هدر پاک‌سازی
  // می‌تواند بعد از کوکی جدید اعمال شود و کاربر را در حلقهٔ «نشست منقضی» بیندازد.
  // پس هر Set-Cookie قبلی مربوط به همین کوکی حذف می‌شود و فقط یکی می‌ماند.
  dropSessionCookieHeaders(c);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: ttlSeconds,
  });
}

/** حذف هدرهای Set-Cookie قبلیِ همین کوکی از پاسخ در حال ساخت */
function dropSessionCookieHeaders(c: Context<AppEnv>): void {
  try {
    const headers = c.res.headers;
    const existing = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : (headers.get('Set-Cookie') ?? '').split(/,(?=\s*[a-zA-Z0-9_-]+=)/);
    if (existing.length === 0) return;
    const keep = existing.filter((value) => !String(value).trim().startsWith(`${SESSION_COOKIE}=`));
    headers.delete('Set-Cookie');
    for (const value of keep) headers.append('Set-Cookie', value);
  } catch {
    /* اگر مرورگر/رانتایم پشتیبانی نکند، هدر دست‌نخورده می‌ماند */
  }
}

/** پاک کردن کوکی نشست */
export function clearSessionCookie(c: Context<AppEnv>, isSecure: boolean): void {
  deleteCookie(c, SESSION_COOKIE, {
    path: '/',
    secure: isSecure,
    sameSite: 'Lax',
  });
}

/** آیا درخواست روی HTTPS است؟ (برای Secure cookie) */
export function isSecureRequest(c: Context<AppEnv>): boolean {
  try {
    return new URL(c.req.url).protocol === 'https:';
  } catch {
    return true;
  }
}

/** خواندن و اعتبارسنجی توکن از کوکی */
export async function readSession(
  c: Context<AppEnv>,
  secret: string
): Promise<JwtPayload | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length > 2048) return null;

  try {
    const payload = (await verify(token, secret, 'HS256')) as Record<string, unknown>;
    const uid = Number(payload.uid ?? payload.sub);
    const role = payload.role;
    if (!Number.isFinite(uid) || uid <= 0) return null;
    if (role !== 'admin' && role !== 'staff' && role !== 'customer') return null;
    return {
      sub: String(payload.sub ?? uid),
      uid,
      role: role as Role,
      name: typeof payload.name === 'string' ? payload.name : '',
      tv: typeof payload.tv === 'number' ? payload.tv : 0,
      exp: typeof payload.exp === 'number' ? payload.exp : undefined,
      iat: typeof payload.iat === 'number' ? payload.iat : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * بارگذاری کاربر از دیتابیس و بررسی فعال بودن.
 * این کار باعث می‌شود غیرفعال‌سازی کارمند فوراً اعمال شود.
 */
export async function getActiveUser(
  db: D1Database,
  uid: number
): Promise<UserRow | null> {
  const user = await db
    .prepare(
      `SELECT id, name, phone, birth_date, points, lifetime_points, tier, referred_by,
              last_visit_date, avg_visit_interval, role, password_hash, is_active,
              first_purchase_at, referral_rewarded, last_churn_sms_at, sms_opt_in,
              token_version, created_at
       FROM users WHERE id = ? LIMIT 1`
    )
    .bind(uid)
    .first<UserRow>();
  if (!user || user.is_active !== 1) return null;
  return user;
}

/** Middleware: پر کردن c.set('user') از کوکی */
export const attachUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const secret = c.env.JWT_SECRET;
  if (!secret) {
    await next();
    return;
  }
  const payload = await readSession(c, secret);
  if (!payload) {
    // کوکی نامعتبر/منقضی باید پاک شود؛ وگرنه با هر درخواست دوباره پردازش می‌شود
    // و کاربر در چرخهٔ «نشست منقضی» گیر می‌کند.
    if (getCookie(c, SESSION_COOKIE)) {
      c.set('sessionInvalid', true);
      clearSessionCookie(c, isSecureRequest(c));
    }
    c.set('user', null);
    await next();
    return;
  }
  let user: UserRow | null = null;
  try {
    user = await getActiveUser(c.env.DB, payload.uid);
  } catch (error) {
    // خطای دیتابیس (مثلاً ستون تازه‌ای که مایگریشن نشده) نباید کل برنامه را
    // ۵۰۰ کند؛ کاربر مهمان در نظر گرفته می‌شود و خطا در کنسول می‌ماند.
    console.error('attachUser:getActiveUser failed:', error);
    c.set('sessionLookupFailed', true);
    c.set('user', null);
    await next();
    return;
  }

  // توکن‌هایی که قبل از تغییر رمز صادر شده‌اند باطل می‌شوند
  if (!user || (payload.tv ?? 0) !== (user.token_version ?? 0)) {
    c.set('sessionInvalid', true);
    clearSessionCookie(c, isSecureRequest(c));
    c.set('user', null);
    await next();
    return;
  }
  c.set('user', { ...payload, role: user.role, name: user.name });
  await next();
};

/** پاسخ ۴۰۱ JSON برای API */
function unauthorized(c: Context<AppEnv>) {
  return fail(c, 'لطفاً ابتدا وارد حساب خود شوید.', 401, 'UNAUTHORIZED');
}

function forbidden(c: Context<AppEnv>) {
  return fail(c, 'شما به این بخش دسترسی ندارید.', 403, 'FORBIDDEN');
}

/** Middleware: نیاز به ورود برای API */
export const requireApiAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user) return unauthorized(c);
  await next();
};

/** Middleware: نیاز به نقش مشخص برای API */
export function requireApiRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) return unauthorized(c);
    if (!roles.includes(user.role)) return forbidden(c);
    await next();
  };
}

/** Middleware: نیاز به ورود برای صفحات HTML */
export function requirePageRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    const url = new URL(c.req.url);
    if (!user) {
      // اگر کوکی وجود داشت ولی معتبر نبود، پیام «نشست منقضی» دقیق است؛
      // در ورود اول (بدون کوکی) نباید این پیام گمراه‌کننده نمایش داده شود.
      const expired = c.get('sessionInvalid') ? '&expired=1' : '';
      return c.redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}${expired}`, 302);
    }
    if (!roles.includes(user.role)) {
      return c.redirect(user.role === 'admin' ? '/admin' : '/staff', 302);
    }
    await next();
  };
}

/** مسیر پیش‌فرض بر اساس نقش */
export function homeForRole(role: Role): string {
  if (role === 'admin') return '/admin';
  if (role === 'staff') return '/staff';
  return '/me';
}

/* ==========================================================================
 *  محدودسازی نرخ درخواست (در حافظه — بهترین تلاش در لبه)
 * ========================================================================== */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let lastPrune = Date.now();

function pruneBuckets(now: number): void {
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** شناسه‌ی سمت کلاینت برای محدودسازی نرخ */
export function clientKey(c: Context<AppEnv>): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'local'
  );
}

/**
 * بررسی محدودیت نرخ.
 * @returns true اگر درخواست مجاز باشد، false اگر بیش از حد مجاز باشد.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  pruneBuckets(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/** پاک‌سازی دستی سطل‌ها (مثلاً پس از ورود موفق) */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * بررسی وجود Secret JWT و طول مناسب آن.
 * حداقل ۱۶ کاراکتر: اگر کسی قبلاً کلید کوتاه‌تری تنظیم کرده باشد، برنامه نباید
 * قفل شود (خطای «JWT تنظیم نشده» در حالی که کلید وجود دارد)؛ فقط هشدار می‌دهیم.
 */
export function assertJwtSecret(env: Bindings): string | null {
  const secret = env.JWT_SECRET;
  if (!secret || secret.length < 16) return null;
  if (secret.length < 32) {
    console.warn(
      'JWT_SECRET کوتاه است؛ یک کلید تصادفی ۳۲ کاراکتری یا بیشتر تنظیم کنید: wrangler secret put JWT_SECRET'
    );
  }
  return secret;
}

/** وضعیت نشست برای صفحهٔ ورود/تشخیص عیب */
export type SessionInfo = {
  authenticated: boolean;
  userId: number | null;
  role: Role | null;
  name: string | null;
  expiresAt: number | null;
};

export function sessionInfo(user: JwtPayload | null): SessionInfo {
  if (!user) return { authenticated: false, userId: null, role: null, name: null, expiresAt: null };
  return {
    authenticated: true,
    userId: user.uid,
    role: user.role,
    name: user.name,
    expiresAt: user.exp ? user.exp * 1000 : null,
  };
}
