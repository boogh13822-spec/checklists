/**
 * ----------------------------------------------------------------------------
 *  ابزارهای عمومی: تاریخ (شمسی/میلادی)، اعتبارسنجی، امنیت رشته‌ها، پاسخ API
 * ----------------------------------------------------------------------------
 */
import type { Context } from 'hono';
import type { AppEnv, ApiOk, ApiErr } from '../types';

/* ==========================================================================
 * ۱) پاسخ‌های استاندارد API
 * ========================================================================== */

export function ok<T>(c: Context<AppEnv>, data: T, status: number = 200) {
  return c.json<ApiOk<T>>({ ok: true, data }, status as never);
}

export function fail(
  c: Context<AppEnv>,
  message: string,
  status: number = 400,
  code?: string
) {
  return c.json<ApiErr>({ ok: false, error: message, code }, status as never);
}

/* ==========================================================================
 * ۲) JSON امن
 * ========================================================================== */

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function jsonStringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/* ==========================================================================
 * ۳) منطقه زمانی و تاریخ
 * ========================================================================== */

export type ZonedParts = {
  iso: string;        // YYYY-MM-DD
  time: string;       // HH:MM
  year: number;
  month: number;      // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: string;    // Mon, Tue, ...
  stamp: string;      // YYYY-MM-DD HH:MM:SS
};

/** اجزای تاریخ/ساعت را در منطقه زمانی مشخص برمی‌گرداند. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  let hour = parseInt(get('hour'), 10);
  if (!Number.isFinite(hour)) hour = 0;
  if (hour === 24) hour = 0;

  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);

  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
    day
  ).padStart(2, '0')}`;
  const time = `${String(hour).padStart(2, '0')}:${get('minute')}`;

  return {
    iso,
    time,
    year,
    month,
    day,
    hour,
    minute: parseInt(get('minute'), 10) || 0,
    weekday: get('weekday'),
    stamp: `${iso} ${time}:${get('second')}`,
  };
}

/** «اکنون» در منطقه زمانی داده‌شده. */
export function nowInZone(timeZone: string): ZonedParts {
  return zonedParts(new Date(), timeZone);
}

/** تاریخ امروز به شکل YYYY-MM-DD */
export function todayISO(timeZone: string = DEFAULT_TIMEZONE): string {
  return nowInZone(timeZone).iso;
}

/** تبدیل رشته تاریخ/زمان SQLite (UTC) به میلی‌ثانیه. */
export function sqliteToMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.includes('T')
    ? value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)
      ? value
      : `${value}Z`
    : `${value.replace(' ', 'T')}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/** اختلاف روز بین دو تاریخ YYYY-MM-DD (یا ISO) */
export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toISO.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** روزهای گذشته از یک تاریخ (UTC) */
export function daysSince(value: string | null | undefined): number {
  const ms = sqliteToMs(value);
  if (ms === null) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

/* ==========================================================================
 * ۴) تبدیل تاریخ میلادی ↔ شمسی (الگوریتم بورکوفسکی)
 * ========================================================================== */

// نکته: الگوریتم بورکوفسکی از تقسیم «کوتاه‌شده» (trunc) استفاده می‌کند، نه floor؛
// برای اعداد منفی این دو متفاوت‌اند و استفاده از floor تاریخ را جابه‌جا می‌کند.
const div = (a: number, b: number): number => Math.trunc(a / b);
const mod = (a: number, b: number): number => a - Math.trunc(a / b) * b;

const JALALI_BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192,
  2262, 2324, 2394, 2456, 3178,
];

type JalCal = { leap: number; gy: number; march: number };

function jalCal(jy: number): JalCal {
  const bl = JALALI_BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = JALALI_BREAKS[0];
  let jm = 0;
  let jump = 0;

  if (jy < jp || jy >= JALALI_BREAKS[bl - 1]) {
    return { leap: 0, gy, march: 20 };
  }

  for (let i = 1; i < bl; i += 1) {
    jm = JALALI_BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }

  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;

  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

export type JalaliDate = { jy: number; jm: number; jd: number };

export function toJalali(gy: number, gm: number, gd: number): JalaliDate {
  const jdn = g2d(gy, gm, gd);
  const gregorianYear = d2g(jdn).gy;
  let jy = gregorianYear - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gregorianYear, 3, r.march);

  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    }
    k -= 186;
  } else {
    // سال شمسی قبلی: وضعیت کبیسه‌ی همان سالی که از gy محاسبه شد ملاک است
    // (نه سال قبل از آن) — مطابق الگوریتم مرجع بورکوفسکی.
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

/** منطقه زمانی پیش‌فرض برنامه */
export const DEFAULT_TIMEZONE = 'Asia/Tehran';

/** تبدیل تاریخ شمسی به میلادی */
export function toGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  const r = jalCal(jy);
  const jdn = g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  return d2g(jdn);
}

/** تاریخ شمسی امروز */
export function todayJalali(timeZone = DEFAULT_TIMEZONE): JalaliDate {
  const p = nowInZone(timeZone);
  return toJalali(p.year, p.month, p.day);
}

/** رشته «YYYY-MM-DD HH:MM:SS» به وقت UTC (قالب ذخیره‌سازی SQLite) */
export function utcStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * بازه‌ی یک روز تقویمی (به وقت منطقه زمانی) در قالب UTC.
 * @param offsetDays 0 = امروز، 1 = دیروز، 2 = پریروز …
 */
export function zonedDayRange(
  timeZone = DEFAULT_TIMEZONE,
  offsetDays = 0
): { start: string; end: string; startMs: number; endMs: number; dateISO: string } {
  const now = new Date();
  const p = zonedParts(now, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
  const offset = asUTC - Math.floor(now.getTime() / 60_000) * 60_000;
  const startMs = Date.UTC(p.year, p.month - 1, p.day) - offset - offsetDays * 86_400_000;
  // تاریخ تقویمی همان روز در منطقه زمانی (نه تاریخ UTC لحظه‌ی شروع روز)
  const dateISO = new Date(
    Date.UTC(p.year, p.month - 1, p.day) - offsetDays * 86_400_000
  )
    .toISOString()
    .slice(0, 10);
  return {
    start: utcStamp(startMs),
    end: utcStamp(startMs + 86_400_000),
    startMs,
    endMs: startMs + 86_400_000,
    dateISO,
  };
}

/**
 * بازه‌ی N روز تقویمی آخر (به وقت منطقه زمانی)، از قدیمی به جدید.
 * برای نمودار فروش استفاده می‌شود تا مرز روزها با کارت «فروش امروز» یکی باشد.
 */
export function zonedDaySeries(
  timeZone = DEFAULT_TIMEZONE,
  count = 7
): Array<{ start: string; end: string; date: string }> {
  const out: Array<{ start: string; end: string; date: string }> = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const r = zonedDayRange(timeZone, i);
    out.push({ start: r.start, end: r.end, date: r.dateISO });
  }
  return out;
}

/**
 * لحظه‌ی UTC شروع یک «روز تقویمی» در منطقه‌ی زمانی داده‌شده (میلی‌ثانیه).
 * برای تبدیل تاریخ‌هایی که کاربر در فیلترها انتخاب می‌کند به بازه‌ی درست UTC.
 * @returns null اگر رشته تاریخ معتبر نباشد
 */
export function zonedDateStartMs(dateISO: string, timeZone = DEFAULT_TIMEZONE): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateISO).trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  let ms = guess;
  // دو تکرار برای پوشش تغییر ساعت (DST) کافی است
  for (let i = 0; i < 2; i += 1) {
    const p = zonedParts(new Date(ms), timeZone);
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
    const offset = asUTC - Math.floor(ms / 60_000) * 60_000;
    ms = guess - offset;
  }
  return ms;
}

/**
 * بازه‌ی ماه شمسی جاری (به وقت منطقه زمانی) در قالب UTC.
 */
export function jalaliMonthRange(
  timeZone = DEFAULT_TIMEZONE
): { start: string; end: string; startMs: number; endMs: number; label: string } {
  const { jy, jm } = todayJalali(timeZone);
  const startG = toGregorian(jy, jm, 1);

  let nextYear = jy;
  let nextMonth = jm + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const endG = toGregorian(nextYear, nextMonth, 1);

  const p = zonedParts(new Date(), timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
  const offset = asUTC - Math.floor(Date.now() / 60_000) * 60_000;

  const startMs = Date.UTC(startG.gy, startG.gm - 1, startG.gd) - offset;
  const endMs = Date.UTC(endG.gy, endG.gm - 1, endG.gd) - offset;

  return {
    start: utcStamp(startMs),
    end: utcStamp(endMs),
    startMs,
    endMs,
    label: `${JALALI_MONTHS[jm - 1]} ${toPersianDigits(jy)}`,
  };
}

const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

const WEEKDAYS_FA = [
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنجشنبه',
  'جمعه',
  'شنبه',
];

/** تبدیل ارقام لاتین به فارسی */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[parseInt(d, 10)]);
}

/** تبدیل ارقام فارسی/عربی به لاتین */
export function toLatinDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/**
 * قالب‌بندی تاریخ ISO (YYYY-MM-DD یا datetime) به شمسی.
 * @example formatJalali('2026-10-21') => '۲۹ مهر ۱۴۰۵'
 */
export function formatJalali(value: string | null | undefined, withYear = true): string {
  if (!value) return '—';
  const datePart = value.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return '—';
  const gy = parseInt(m[1], 10);
  const gm = parseInt(m[2], 10);
  const gd = parseInt(m[3], 10);
  const { jy, jm, jd } = toJalali(gy, gm, gd);
  const monthName = JALALI_MONTHS[jm - 1] ?? '';
  const base = `${toPersianDigits(jd)} ${monthName}`;
  return withYear ? `${base} ${toPersianDigits(jy)}` : base;
}

/**
 * قالب‌بندی تاریخ و ساعت شمسی در منطقه زمانی تهران.
 * (زمان ذخیره‌شده در D1 همیشه UTC است.)
 */
export function formatJalaliDateTime(
  value: string | null | undefined,
  timeZone = DEFAULT_TIMEZONE
): string {
  const ms = sqliteToMs(value);
  if (ms === null) return '—';
  const p = zonedParts(new Date(ms), timeZone);
  const j = formatJalali(p.iso);
  return `${j} — ${toPersianDigits(p.time)}`;
}

/** نام روز هفته فارسی از یک تاریخ ISO */
export function jalaliWeekday(value: string | null | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ms)) return '—';
  return WEEKDAYS_FA[new Date(ms).getUTCDay()] ?? '—';
}

/** قالب‌بندی مبلغ با جداکننده هزارگان */
export function formatMoney(amount: number): string {
  const n = Math.round(Number(amount) || 0);
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** قالب‌بندی عدد با ارقام فارسی و جداکننده */
export function formatNumberFa(amount: number): string {
  return toPersianDigits(formatMoney(amount));
}

/* ==========================================================================
 * ۵) اعتبارسنجی و نرمال‌سازی
 * ========================================================================== */

/** نرمال‌سازی شماره موبایل ایران به شکل 09xxxxxxxxx */
export function normalizePhone(raw: string): string {
  if (!raw) return '';
  let value = toLatinDigits(String(raw)).trim();
  value = value.replace(/[\s\-()]/g, '');
  if (value.startsWith('+98')) value = `0${value.slice(3)}`;
  else if (value.startsWith('0098')) value = `0${value.slice(4)}`;
  else if (value.startsWith('98') && value.length === 12) value = `0${value.slice(2)}`;
  else if (value.startsWith('9') && value.length === 10) value = `0${value}`;
  return value;
}

export function isValidPhone(raw: string): boolean {
  return /^09\d{9}$/.test(normalizePhone(raw));
}

/** اعتبارسنجی تاریخ تولد به شکل YYYY-MM-DD */
export function isValidBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms)) return false;
  const year = parseInt(value.slice(0, 4), 10);
  return year >= 1300 && year <= new Date().getUTCFullYear();
}

/** پاک‌سازی نام (حذف کاراکترهای کنترلی، محدودیت طول) */
export function sanitizeName(raw: string): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** اطمینان از عدد صحیح مثبت */
export function toPositiveInt(value: unknown, fallback = 0): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function toIntInRange(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* ==========================================================================
 * ۶) امنیت رشته‌ها
 * ========================================================================== */

/** فرار دادن کاراکترهای HTML برای جلوگیری از XSS */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** فرار دادن رشته برای استفاده در جاوااسکریپت داخل HTML */
export function escapeJs(value: unknown): string {
  return JSON.stringify(String(value ?? ''))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** تولید توکن تصادفی امن (hex) */
export function randomToken(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** مقایسه‌ی زمان‌ثابت دو رشته */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/* ==========================================================================
 * ۷) قالب پیامک
 * ========================================================================== */

/** جای‌گذاری متغیرها در قالب پیامک: {name} → مقدار */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return String(template ?? '').replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
}

/** شمارش کاراکترهای پیامک (فارسی: ۷۰ کاراکتر در هر بخش) */
export function smsPartsLength(message: string): number {
  const len = message.length;
  const isPersian = /[\u0600-\u06FF]/.test(message);
  const perPart = isPersian ? 70 : 160;
  return Math.max(1, Math.ceil(len / perPart));
}

/* ==========================================================================
 * ۸) خواب (برای محدودسازی نرخ درخواست)
 * ========================================================================== */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ==========================================================================
 * ۹) نام فایل CSV امن
 * ========================================================================== */

export function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
