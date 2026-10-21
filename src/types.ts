/**
 * ----------------------------------------------------------------------------
 *  انواع داده‌های مشترک برنامه
 * ----------------------------------------------------------------------------
 */

/** متغیرهای محیطی ورکر (binding ها و متغیرهای عمومی) */
export type Bindings = {
  DB: D1Database;
  /** کلید امضای JWT — باید به صورت Secret تنظیم شود */
  JWT_SECRET: string;
  /** منطقه زمانی (پیش‌فرض Asia/Tehran) */
  TZ_NAME?: string;
  /** کلید OpenWeather — در صورت تنظیم، بر مقدار ذخیره‌شده در تنظیمات اولویت دارد */
  OPENWEATHER_API_KEY?: string;
  /** کلید API کاوه‌نگار (اختیاری — بر مقدار ذخیره‌شده در تنظیمات اولویت دارد) */
  KAVENEGAR_API_KEY?: string;
  /** کلید API سامانه sms.ir (اختیاری — بر مقدار تنظیمات اولویت دارد) */
  SMSIR_API_KEY?: string;
  /** شماره فرستنده پیامک */
  SMS_SENDER?: string;
  /** آدرس عمومی برنامه برای ساخت لینک در پیامک‌ها */
  APP_URL?: string;
};

export type Role = 'customer' | 'staff' | 'admin';

/** رکورد جدول users */
export type UserRow = {
  id: number;
  name: string;
  phone: string;
  birth_date: string | null;
  points: number;
  tier: string;
  referred_by: number | null;
  referral_code: string | null;
  last_visit_date: string | null;
  avg_visit_interval: number;
  role: Role;
  password_hash: string | null;
  is_active: number;
  first_purchase_at: string | null;
  referral_rewarded: number;
  last_churn_sms_at: string | null;
  created_at: string;
};

/** رکورد جدول invoices */
export type InvoiceRow = {
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
};

export type InvoiceItem = {
  name: string;
  qty: number;
  price: number;
};

/** رکورد جدول sms_logs */
export type SmsLogRow = {
  id: number;
  user_id: number | null;
  type: string;
  status: 'sent' | 'failed' | 'skipped' | 'pending';
  message: string | null;
  provider_id: string | null;
  error: string | null;
  sent_at: string;
};

/** رکورد جدول coupons */
export type CouponRow = {
  id: number;
  code: string;
  user_id: number | null;
  kind: 'percent' | 'amount';
  value: number;
  reason: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: number;
  created_at: string;
};

/** قالب‌های پیامک — قابل ویرایش از داشبورد ادمین */
export type SmsTemplates = {
  welcome: string;
  invoice: string;
  birthday: string;
  churn: string;
  weather: string;
};

/** آستانه‌های سطح‌بندی مشتری (بر اساس امتیاز) */
export type TierThresholds = {
  silver: number;
  gold: number;
  vip: number;
};

/** تنظیمات کامل برنامه (از جدول settings واکشی می‌شود) */
export type AppSettings = {
  sms_templates: SmsTemplates;
  points_per_currency: number;
  currency_unit: number;
  tiers: TierThresholds;
  cafe_name: string;
  cafe_city: string;
  weather_api_key: string;
  sms_provider: 'console' | 'kavenegar' | 'smsir';
  sms_api_key: string;
  sms_sender: string;
  referral_reward_points: number;
  churn_grace_days: number;
  churn_min_visits: number;
  birthday_coupon_percent: number;
};

/** داده‌های توکن JWT */
export type JwtPayload = {
  sub: string;
  uid: number;
  role: Role;
  name: string;
  /** زمان انقضا (ثانیه) */
  exp?: number;
  /** زمان صدور (ثانیه) */
  iat?: number;
};

/** متغیرهای Context در Hono */
export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    user: JwtPayload | null;
    settings: AppSettings;
  };
};

/** پاسخ استاندارد API */
export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string; code?: string };
