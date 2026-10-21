/**
 * ----------------------------------------------------------------------------
 *  ارسال پیامک + دریافت وضعیت آب‌وهوا
 * ----------------------------------------------------------------------------
 *  ارائه‌دهنده پیش‌فرض «console» است (بدون هزینه؛ پیام‌ها در لاگ Worker و
 *  جدول sms_logs ذخیره می‌شوند).
 *
 *  ارائه‌دهنده‌های واقعی:
 *   - sms.ir   : متد POST https://api.sms.ir/v1/send/bulk با هدر X-API-KEY
 *   - kavenegar: متد GET  https://api.kavenegar.com/v1/{key}/sms/send.json
 *
 *  برای sms.ir علاوه بر کلید API، «شماره خط» (LineNumber) هم لازم است.
 */
import type { AppSettings, Bindings } from '../types';
import { renderTemplate, toPersianDigits, sqliteToMs } from './utils';

export type SmsType = 'welcome' | 'invoice' | 'birthday' | 'churn' | 'weather' | 'referral' | 'admin';

export type SendSmsParams = {
  userId: number | null;
  phone: string;
  message: string;
  type: SmsType;
};

export type SendSmsResult = {
  status: 'sent' | 'failed' | 'skipped';
  messageId?: string;
  error?: string;
};

const SMS_MAX_LENGTH = 480;

/** پاک‌سازی پیام: حذف کاراکترهای کنترلی و محدودسازی طول */
function sanitizeMessage(message: string): string {
  return String(message ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, SMS_MAX_LENGTH);
}

/** ثبت لاگ پیامک در دیتابیس */
async function logSms(
  env: Bindings,
  params: SendSmsParams,
  result: SendSmsResult
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO sms_logs (user_id, type, status, message, provider_id, error)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        params.userId,
        params.type,
        result.status,
        sanitizeMessage(params.message),
        result.messageId ?? null,
        result.error ?? null
      )
      .run();
  } catch (error) {
    console.error('sms_logs insert failed:', error);
  }
}

/** تبدیل شماره به شکل استاندارد 09xxxxxxxxx (ورودی سرویس‌ها) */
export function normalizeSmsMobile(raw: string): string {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('0098')) digits = digits.slice(4);
  else if (digits.startsWith('98') && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('9')) digits = `0${digits}`;
  return digits;
}

/** پیام خطای قابل‌فهم برای نبود تنظیمات هر ارائه‌دهنده */
function missingConfigMessage(provider: AppSettings['sms_provider']): string {
  if (provider === 'smsir') {
    return 'سرویس sms.ir انتخاب شده اما کلید API یا شماره خط تنظیم نشده است.';
  }
  if (provider === 'kavenegar') {
    return 'سرویس کاوه‌نگار انتخاب شده اما کلید API تنظیم نشده است.';
  }
  return 'ارائه‌دهنده پیامک تنظیم نشده است.';
}

/** ارسال از طریق سامانه sms.ir (REST v1 — متد ارسال گروهی) */
async function sendViaSmsIr(
  apiKey: string,
  sender: string,
  mobile: string,
  message: string
): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
  const lineNumber = Number(String(sender).replace(/\D/g, ''));

  if (!Number.isFinite(lineNumber) || lineNumber <= 0) {
    return {
      ok: false,
      error: 'شماره خط فرستنده (LineNumber) در sms.ir تنظیم نشده است.',
    };
  }

  let response: Response;
  try {
    response = await fetch('https://api.sms.ir/v1/send/bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify({
        lineNumber,
        messageText: message,
        mobiles: [mobile],
        sendDateTime: null,
      }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    return {
      ok: false,
      error: `اتصال به sms.ir برقرار نشد: ${
        error instanceof Error ? error.message : 'خطای شبکه'
      }`,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: 'کلید API سامانه sms.ir نامعتبر است.' };
  }
  if (!response.ok) {
    return { ok: false, error: `sms.ir پاسخ HTTP ${response.status} داد.` };
  }

  let payload: {
    status?: number;
    message?: string;
    data?: { packId?: string | number; messageIds?: number[]; cost?: number };
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return { ok: false, error: 'پاسخ sms.ir قابل خواندن نبود.' };
  }

  if (payload.status === 1) {
    const id = payload.data?.messageIds?.[0] ?? payload.data?.packId;
    return { ok: true, messageId: id !== undefined && id !== null ? String(id) : undefined };
  }

  return {
    ok: false,
    error: payload.message
      ? String(payload.message)
      : `sms.ir کد وضعیت ${payload.status ?? 'نامشخص'} را برگرداند.`,
  };
}

/** ارسال از طریق کاوه‌نگار (متد قدیمی send.json) */
async function sendViaKavenegar(
  apiKey: string,
  sender: string,
  mobile: string,
  message: string
): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
  const url = new URL(`https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/sms/send.json`);
  url.searchParams.set('receptor', mobile);
  if (sender) url.searchParams.set('sender', sender);
  url.searchParams.set('message', message);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      ok: false,
      error: `اتصال به کاوه‌نگار برقرار نشد: ${
        error instanceof Error ? error.message : 'خطای شبکه'
      }`,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: 'کلید API کاوه‌نگار نامعتبر است.' };
  }
  if (!response.ok) {
    return { ok: false, error: `کاوه‌نگار پاسخ HTTP ${response.status} داد.` };
  }

  let payload: {
    return?: { status?: number; message?: string };
    entries?: Array<{ messageid?: number; status?: number; statustext?: string }>;
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return { ok: false, error: 'پاسخ کاوه‌نگار قابل خواندن نبود.' };
  }

  const entry = payload.entries?.[0];
  const apiStatus = payload.return?.status ?? entry?.status ?? 0;
  if (apiStatus === 200) {
    return {
      ok: true,
      messageId: entry?.messageid ? String(entry.messageid) : undefined,
    };
  }

  return {
    ok: false,
    error: payload.return?.message || entry?.statustext || `کد وضعیت ${apiStatus}`,
  };
}

/** ارسال پیامک از طریق ارائه‌دهنده پیکربندی‌شده */
export async function sendSms(
  env: Bindings,
  settings: AppSettings,
  params: SendSmsParams
): Promise<SendSmsResult> {
  const message = sanitizeMessage(params.message);
  if (!message) {
    const result: SendSmsResult = { status: 'skipped', error: 'متن پیامک خالی است' };
    await logSms(env, params, result);
    return result;
  }

  const provider = settings.sms_provider;
  const mobile = normalizeSmsMobile(params.phone);
  if (!/^09\d{9}$/.test(mobile)) {
    const result: SendSmsResult = { status: 'failed', error: 'شماره موبایل گیرنده نامعتبر است.' };
    await logSms(env, params, result);
    return result;
  }

  // حالت نمایشی/توسعه: پیام فقط در لاگ ثبت می‌شود
  if (provider === 'console') {
    console.log(`[SMS:console] to=${mobile} type=${params.type} :: ${message}`);
    const result: SendSmsResult = { status: 'sent' };
    await logSms(env, params, result);
    return result;
  }

  const envKey = provider === 'smsir' ? env.SMSIR_API_KEY : env.KAVENEGAR_API_KEY;
  const apiKey = (envKey || settings.sms_api_key).trim();
  const sender = (env.SMS_SENDER || settings.sms_sender).trim();

  if (!apiKey) {
    const result: SendSmsResult = { status: 'failed', error: missingConfigMessage(provider) };
    await logSms(env, params, result);
    return result;
  }

  let outcome: { ok: true; messageId?: string } | { ok: false; error: string };
  if (provider === 'smsir') {
    if (!sender) {
      const result: SendSmsResult = {
        status: 'failed',
        error: 'شماره خط فرستنده (LineNumber) در sms.ir تنظیم نشده است.',
      };
      await logSms(env, params, result);
      return result;
    }
    outcome = await sendViaSmsIr(apiKey, sender, mobile, message);
  } else {
    outcome = await sendViaKavenegar(apiKey, sender, mobile, message);
  }

  const result: SendSmsResult = outcome.ok
    ? { status: 'sent', messageId: outcome.messageId }
    : { status: 'failed', error: outcome.error };

  await logSms(env, params, result);
  return result;
}

/**
 * دریافت اعتبار باقی‌مانده حساب sms.ir.
 * فقط برای ارائه‌دهنده sms.ir معنا دارد.
 */
export async function fetchSmsCredit(
  env: Bindings,
  settings: AppSettings
): Promise<{ ok: boolean; credit?: number; error?: string }> {
  const apiKey = (env.SMSIR_API_KEY || settings.sms_api_key).trim();
  if (settings.sms_provider !== 'smsir') {
    return { ok: false, error: 'برای دیدن اعتبار، سرویس پیامک را روی sms.ir بگذارید.' };
  }
  if (!apiKey) {
    return { ok: false, error: 'کلید API سامانه sms.ir تنظیم نشده است.' };
  }

  try {
    const response = await fetch('https://api.sms.ir/v1/credit', {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-API-KEY': apiKey },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: 'کلید API سامانه sms.ir نامعتبر است.' };
    }
    if (!response.ok) {
      return { ok: false, error: `sms.ir پاسخ HTTP ${response.status} داد.` };
    }

    const payload = (await response.json()) as { status?: number; data?: number; message?: string };
    if (payload.status === 1 && typeof payload.data === 'number') {
      return { ok: true, credit: payload.data };
    }
    return { ok: false, error: payload.message || 'دریافت اعتبار ناموفق بود.' };
  } catch (error) {
    return {
      ok: false,
      error: `اتصال به sms.ir برقرار نشد: ${error instanceof Error ? error.message : 'خطای شبکه'}`,
    };
  }
}

/** رندر قالب پیامک با متغیرهای داده‌شده */
export function renderSms(
  settings: AppSettings,
  type: keyof AppSettings['sms_templates'],
  vars: Record<string, string | number>
): string {
  const template = settings.sms_templates[type] ?? '';
  return renderTemplate(template, {
    cafe: settings.cafe_name,
    city: settings.cafe_city,
    ...vars,
  });
}

/** جلوگیری از ارسال پیامک تکراری در یک بازه زمانی مشخص */
export async function wasSmsSentRecently(
  env: Bindings,
  userId: number,
  type: SmsType,
  withinHours: number
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id FROM sms_logs
     WHERE user_id = ? AND type = ? AND status = 'sent'
       AND sent_at >= datetime('now', ?)
     LIMIT 1`
  )
    .bind(userId, type, `-${Math.max(1, Math.floor(withinHours))} hours`)
    .first<{ id: number }>();
  return !!row;
}

/* ==========================================================================
 *  آب‌وهوا — OpenWeather
 * ========================================================================== */

export type WeatherInfo = {
  ok: boolean;
  city: string;
  temp: number;
  conditionId: number;
  description: string;
  label: string;
  advice: string;
  emoji: string;
  error?: string;
};

type OpenWeatherResponse = {
  weather?: Array<{ id: number; description?: string }>;
  main?: { temp?: number; feels_like?: number };
  name?: string;
  cod?: number | string;
  message?: string;
};

/** دسته‌بندی وضعیت آب‌وهوا بر اساس کدهای OpenWeather */
export function classifyWeather(id: number, temp: number): {
  label: string;
  emoji: string;
  advice: string;
} {
  if (id >= 200 && id < 300) {
    return {
      label: 'رعد و برق',
      emoji: '⛈️',
      advice: 'هوای طوفانی است؛ اگر بیرون می‌آیی حواست باشد، یک قهوه گرم حالت را خوب می‌کند',
    };
  }
  if (id >= 300 && id < 400) {
    return {
      label: 'باران نم‌نم',
      emoji: '🌦️',
      advice: 'چتر یادت نره و یک نوشیدنی گرم مهمان ما باش',
    };
  }
  if (id >= 500 && id < 600) {
    return {
      label: 'بارانی',
      emoji: '🌧️',
      advice: 'چتر یادت نره و یک نوشیدنی گرم مهمان ما باش',
    };
  }
  if (id >= 600 && id < 700) {
    return {
      label: 'برفی',
      emoji: '❄️',
      advice: 'جاده‌ها لیز است؛ با احتیاط بیا و با یک قهوه داغ گرم شو',
    };
  }
  if (id >= 700 && id < 800) {
    return {
      label: 'مه‌آلود',
      emoji: '🌫️',
      advice: 'احتیاط کن، دید کم است؛ یک قهوه داغ همراهت باشد',
    };
  }
  if (id === 800) {
    if (temp >= 32) {
      return {
        label: 'آفتابی و گرم',
        emoji: '☀️',
        advice: 'یک آیس‌کافه خنک منتظرت است',
      };
    }
    if (temp <= 8) {
      return {
        label: 'آفتابی و سرد',
        emoji: '🌤️',
        advice: 'یک قهوه داغ حال دلت را خوب می‌کند',
      };
    }
    return {
      label: 'آفتابی',
      emoji: '☀️',
      advice: 'بهترین فرصت برای یک قهوه در تراس',
    };
  }
  if (id > 800 && id < 900) {
    return {
      label: 'نیمه‌ابری',
      emoji: '⛅',
      advice: 'هوای دلپذیری است؛ یک قهوه کنار پنجره بچسبد',
    };
  }
  if (temp >= 32) {
    return {
      label: 'گرم',
      emoji: '🔥',
      advice: 'یک آیس‌کافه خنک منتظرت است',
    };
  }
  return {
    label: 'معتدل',
    emoji: '🌤️',
    advice: 'روز خوبی برای یک فنجان قهوه است',
  };
}

/** دریافت وضعیت آب‌وهوا؛ در صورت نبود کلید یا خطا مقدار ok=false برمی‌گردد */
export async function fetchWeather(
  env: Bindings,
  settings: AppSettings
): Promise<WeatherInfo> {
  const apiKey = env.OPENWEATHER_API_KEY || settings.weather_api_key;
  const city = settings.cafe_city || 'Tehran';

  if (!apiKey) {
    return {
      ok: false,
      city,
      temp: 0,
      conditionId: 0,
      description: '',
      label: '',
      advice: '',
      emoji: '',
      error: 'کلید API هواشناسی تنظیم نشده است',
    };
  }

  try {
    const url = new URL('https://api.openweathermap.org/data/2.5/weather');
    url.searchParams.set('q', city);
    url.searchParams.set('appid', apiKey);
    url.searchParams.set('units', 'metric');
    url.searchParams.set('lang', 'fa');

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return {
        ok: false,
        city,
        temp: 0,
        conditionId: 0,
        description: '',
        label: '',
        advice: '',
        emoji: '',
        error: `OpenWeather HTTP ${response.status}`,
      };
    }

    const payload = (await response.json()) as OpenWeatherResponse;
    const weather = payload.weather?.[0];
    const conditionId = weather?.id ?? 800;
    const temp = Math.round(Number(payload.main?.temp) || 0);
    const info = classifyWeather(conditionId, temp);

    return {
      ok: true,
      city: payload.name || city,
      temp,
      conditionId,
      description: weather?.description ?? '',
      label: info.label,
      advice: info.advice,
      emoji: info.emoji,
    };
  } catch (error) {
    return {
      ok: false,
      city,
      temp: 0,
      conditionId: 0,
      description: '',
      label: '',
      advice: '',
      emoji: '',
      error: error instanceof Error ? error.message : 'خطای دریافت آب‌وهوا',
    };
  }
}

/** متن آماده‌ی آب‌وهوا برای نمایش در داشبورد */
export function weatherSummary(info: WeatherInfo): string {
  if (!info.ok) return info.error ?? 'نامشخص';
  return `${info.label}، ${toPersianDigits(info.temp)}°C`;
}

/** تاریخ آخرین اجرای یک جاب (برای نمایش در داشبورد) */
export function formatRunDate(value: string | null): string {
  const ms = sqliteToMs(value);
  if (ms === null) return '—';
  return new Date(ms).toISOString();
}
