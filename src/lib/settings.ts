/**
 * ----------------------------------------------------------------------------
 *  مدیریت تنظیمات (جدول settings — مقادیر JSON)
 * ----------------------------------------------------------------------------
 */
import type { AppSettings, Bindings } from '../types';
import { safeJsonParse, toIntInRange } from './utils';

/**
 * مبنای پیش‌فرض «دلتنگی» وقتی میانگین فاصله‌ی خرید معتبر نیست
 * (مثلاً مشتری تک‌خرید). هم در جاب ریزش، هم در داشبورد و هم در فیلترها استفاده می‌شود
 * تا همه‌جا یک عدد واحد دیده شود.
 */
export const CHURN_DEFAULT_INTERVAL = 30;

export type MenuItem = { name: string; price: number; category?: string };

export const DEFAULT_MENU_ITEMS: MenuItem[] = [
  { name: 'اسپرسو', price: 45000, category: 'قهوه' },
  { name: 'آمریکانو', price: 55000, category: 'قهوه' },
  { name: 'لاته', price: 75000, category: 'قهوه' },
  { name: 'کاپوچینو', price: 70000, category: 'قهوه' },
  { name: 'آیس لاته', price: 85000, category: 'سرد' },
  { name: 'چای', price: 35000, category: 'نوشیدنی' },
  { name: 'کیک شکلاتی', price: 90000, category: 'دسر' },
  { name: 'کروسان', price: 65000, category: 'دسر' },
];

export const TIER_META: Record<
  string,
  { label: string; color: string; badge: string; icon: string }
> = {
  bronze: {
    label: 'برنزی',
    color: 'text-amber-700',
    badge: 'bg-amber-900/40 text-amber-200 border-amber-700/40',
    icon: '🥉',
  },
  silver: {
    label: 'نقره‌ای',
    color: 'text-slate-300',
    badge: 'bg-slate-700/40 text-slate-200 border-slate-500/40',
    icon: '🥈',
  },
  gold: {
    label: 'طلایی',
    color: 'text-yellow-400',
    badge: 'bg-yellow-900/30 text-yellow-300 border-yellow-600/40',
    icon: '🥇',
  },
  vip: {
    label: 'الماسی',
    color: 'text-fuchsia-300',
    badge: 'bg-fuchsia-900/30 text-fuchsia-200 border-fuchsia-600/40',
    icon: '💎',
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  sms_templates: {
    welcome:
      'سلام {name} عزیز 🌟\nبه باشگاه مشتریان {cafe} خوش آمدید!\nبا هر خرید امتیاز جمع کنید و از تخفیف‌های ویژه بهره‌مند شوید.',
    invoice:
      '{name} عزیز، خرید شما به مبلغ {amount} تومان ثبت شد و {points} امتیاز به حساب شما اضافه شد. موجودی: {total_points} امتیاز. سطح: {tier} ☕',
    birthday:
      '{name} عزیز، تولدت مبارک 🎂\nبه مناسبت تولدت این کد تخفیف هدیه ما به توست: {coupon}\nمنتظر دیدارت هستیم.',
    churn:
      '{name} عزیز، دلمان برایت تنگ شده ☕\n{last_visit} روز از آخرین دیدارمان گذشته؛ با این پیامک ۱۰٪ تخفیف روی فاکتور بعدی مهمان ما باش.',
    weather:
      'سلام {name}، هوای امروز {city}: {weather} و {temp} درجه است. {advice} ☕',
    otp:
      'کد ورود شما به باشگاه {cafe}: {code}\nاین کد فقط ۲ دقیقه اعتبار دارد؛ آن را با کسی به اشتراک نگذارید.',
    redeem:
      '{name} عزیز، {points} امتیاز شما به کد تخفیف {coupon} به ارزش {value} تومان تبدیل شد.\nاعتبار تا {expiry}. ☕',
  },
  points_mode: 'amount',
  points_per_currency: 1,
  currency_unit: 1000,
  visit_points: 15,
  visit_min_amount: 30000,
  redeem_enabled: 1,
  redeem_points: 200,
  redeem_value: 20000,
  redeem_expiry_days: 30,
  otp_login_enabled: 1,
  tiers: { silver: 500, gold: 2000, vip: 5000 },
  cafe_name: 'کافه ملت',
  cafe_city: 'تهران',
  weather_api_key: '',
  sms_provider: 'console',
  sms_api_key: '',
  sms_sender: '',
  referral_reward_points: 50,
  churn_grace_days: 2,
  churn_min_visits: 3,
  birthday_coupon_percent: 15,
};

/** کلیدهای قابل ویرایش از داشبورد ادمین */
export const EDITABLE_SETTING_KEYS: Array<keyof AppSettings> = [
  'sms_templates',
  'points_mode',
  'points_per_currency',
  'visit_points',
  'visit_min_amount',
  'redeem_enabled',
  'redeem_points',
  'redeem_value',
  'redeem_expiry_days',
  'otp_login_enabled',
  'currency_unit',
  'tiers',
  'cafe_name',
  'cafe_city',
  'weather_api_key',
  'sms_provider',
  'sms_api_key',
  'sms_sender',
  'referral_reward_points',
  'churn_grace_days',
  'churn_min_visits',
  'birthday_coupon_percent',
];

/* -------------------------------------------------------------------------- */
/*  کش ساده در حافظه (هر ایزوله) — با هر به‌روزرسانی تنظیمات پاک می‌شود        */
/* -------------------------------------------------------------------------- */

let settingsCache: { value: AppSettings; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

export function invalidateSettingsCache(): void {
  settingsCache = null;
}

function coerceSettings(raw: Record<string, unknown>): AppSettings {
  const templates = (raw.sms_templates ?? {}) as Record<string, unknown>;
  const tiers = (raw.tiers ?? {}) as Record<string, unknown>;

  const templatesMerged = {
    welcome: str(templates.welcome, DEFAULT_SETTINGS.sms_templates.welcome),
    invoice: str(templates.invoice, DEFAULT_SETTINGS.sms_templates.invoice),
    birthday: str(templates.birthday, DEFAULT_SETTINGS.sms_templates.birthday),
    churn: str(templates.churn, DEFAULT_SETTINGS.sms_templates.churn),
    weather: str(templates.weather, DEFAULT_SETTINGS.sms_templates.weather),
    otp: str(templates.otp, DEFAULT_SETTINGS.sms_templates.otp),
    redeem: str(templates.redeem, DEFAULT_SETTINGS.sms_templates.redeem),
  };

  const provider = coerceSmsProvider(raw.sms_provider);

  return {
    sms_templates: templatesMerged,
    points_mode: raw.points_mode === 'visit' ? 'visit' : 'amount',
    points_per_currency: toIntInRange(raw.points_per_currency, 1, 1000, 1),
    visit_points: toIntInRange(raw.visit_points, 1, 100_000, 15),
    visit_min_amount: toIntInRange(raw.visit_min_amount, 0, 100_000_000, 30_000),
    redeem_enabled: toIntInRange(raw.redeem_enabled, 0, 1, 1),
    redeem_points: toIntInRange(raw.redeem_points, 1, 10_000_000, 200),
    redeem_value: toIntInRange(raw.redeem_value, 1000, 100_000_000, 20_000),
    redeem_expiry_days: toIntInRange(raw.redeem_expiry_days, 1, 365, 30),
    otp_login_enabled: toIntInRange(raw.otp_login_enabled, 0, 1, 1),
    currency_unit: toIntInRange(raw.currency_unit, 1, 10_000_000, 1000),
    tiers: {
      silver: toIntInRange(tiers.silver, 1, 100_000_000, 500),
      gold: toIntInRange(tiers.gold, 2, 100_000_000, 2000),
      vip: toIntInRange(tiers.vip, 3, 100_000_000, 5000),
    },
    cafe_name: str(raw.cafe_name, DEFAULT_SETTINGS.cafe_name).slice(0, 60),
    cafe_city: str(raw.cafe_city, DEFAULT_SETTINGS.cafe_city).slice(0, 60),
    weather_api_key: str(raw.weather_api_key, '').slice(0, 200),
    sms_provider: provider,
    sms_api_key: str(raw.sms_api_key, '').slice(0, 300),
    sms_sender: str(raw.sms_sender, '').slice(0, 30),
    referral_reward_points: toIntInRange(raw.referral_reward_points, 0, 1_000_000, 50),
    churn_grace_days: toIntInRange(raw.churn_grace_days, 0, 60, 2),
    churn_min_visits: toIntInRange(raw.churn_min_visits, 1, 100, 3),
    birthday_coupon_percent: toIntInRange(raw.birthday_coupon_percent, 1, 100, 15),
  };
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** فقط ارائه‌دهنده‌های پشتیبانی‌شده پذیرفته می‌شوند */
export function coerceSmsProvider(value: unknown): AppSettings['sms_provider'] {
  return value === 'smsir' || value === 'kavenegar' ? value : 'console';
}

/** بارگذاری تنظیمات از D1 */
export async function loadSettings(env: Bindings, force = false): Promise<AppSettings> {
  if (!force && settingsCache && Date.now() - settingsCache.at < CACHE_TTL_MS) {
    return settingsCache.value;
  }

  try {
    const { results } = await env.DB.prepare('SELECT key, value FROM settings').all<{
      key: string;
      value: string;
    }>();

    const raw: Record<string, unknown> = {};
    for (const row of results ?? []) {
      raw[row.key] = safeJsonParse<unknown>(row.value, row.value);
    }

    const merged = coerceSettings(raw);
    settingsCache = { value: merged, at: Date.now() };
    return merged;
  } catch (error) {
    console.error('loadSettings failed:', error);
    return DEFAULT_SETTINGS;
  }
}

/** ذخیره یک تنظیم */
export async function saveSetting(env: Bindings, key: string, value: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  )
    .bind(key, JSON.stringify(value ?? null))
    .run();
  invalidateSettingsCache();
}

/** حذف یک تنظیم */
export async function deleteSetting(env: Bindings, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
  invalidateSettingsCache();
}

/** خواندن مقدار خام یک تنظیم (برای کلیدهای داخلی مثل last_run) */
export async function getRawSetting(env: Bindings, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

/** بارگذاری آیتم‌های منو */
export async function loadMenuItems(env: Bindings): Promise<MenuItem[]> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind('menu_items')
    .first<{ value: string }>();

  const items = safeJsonParse<MenuItem[]>(row?.value ?? null, DEFAULT_MENU_ITEMS);
  if (!Array.isArray(items) || items.length === 0) return DEFAULT_MENU_ITEMS;

  return items
    .filter((item) => item && typeof item.name === 'string')
    .map((item) => ({
      name: String(item.name).slice(0, 60),
      price: Math.max(0, Math.floor(Number(item.price) || 0)),
      category: typeof item.category === 'string' ? item.category.slice(0, 30) : undefined,
    }))
    .slice(0, 100);
}
