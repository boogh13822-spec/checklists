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
  /** طول عمر نشست ورود به ساعت (پیش‌فرض ۱۲، حداکثر ۱۶۸) */
  SESSION_HOURS?: string;
  /** طول عمر نشست مشتری به روز (پیش‌فرض ۳۰، حداکثر ۹۰) */
  CUSTOMER_SESSION_DAYS?: string;
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
  /** مجموع امتیازهای کسب‌شده در طول عمر — مبنای سطح‌بندی */
  lifetime_points: number;
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
  /** رضایت دریافت پیامک تبلیغاتی (۰/۱) */
  sms_opt_in: number;
  /** نسخهٔ نشست — با تغییر رمز افزایش می‌یابد */
  token_version: number;
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
  /** روزی که امتیاز «هر روز یک‌بار» برایش ثبت شده (NULL یعنی امتیاز روزانه ندارد) */
  visit_day: string | null;
  client_request_id: string | null;
  /** زمان ابطال — NULL یعنی فاکتور معتبر است */
  voided_at: string | null;
  voided_by: number | null;
  /** دلیل ابطال (برای حسابرسی) */
  void_reason: string | null;
  /** روش پرداخت — NULL یعنی فاکتور قدیمی (پیش از افزودن پرداخت) */
  payment_method: PaymentMethod | null;
  /** مبلغ نقد مؤثر در صندوق (بعد از کسر باقیمانده) */
  paid_cash: number;
  paid_card: number;
  paid_online: number;
  /** باقیمانده‌ای که به مشتری برگشت */
  change_amount: number;
  /** شیفت صندوقی که فاکتور در آن ثبت شده */
  shift_id: number | null;
  /** اگر این فاکتور، اصلاح فاکتور قبلی باشد */
  replaces_invoice_id: number | null;
  created_at: string;
  registered_by: number | null;
};

/** روش‌های پرداخت پشتیبانی‌شده */
export type PaymentMethod = 'cash' | 'card' | 'online' | 'mixed';

/** ورودی پرداخت برای ثبت فاکتور (همه مبالغ تومان) */
export type PaymentInput = {
  cash?: number;
  card?: number;
  online?: number;
};

/** شیفت صندوق */
export type ShiftRow = {
  id: number;
  staff_id: number | null;
  staff_name: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  counted_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
  status: 'open' | 'closed';
  closed_by: number | null;
  closed_by_name: string | null;
  notes: string | null;
  invoice_count: number;
  cash_sales: number;
  card_sales: number;
  online_sales: number;
  total_sales: number;
  void_count: number;
};

export type CashMovementRow = {
  id: number;
  shift_id: number;
  kind: 'in' | 'out';
  amount: number;
  reason: string | null;
  created_at: string;
  created_by: number | null;
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
  otp: string;
  redeem: string;
};

/** آستانه‌های سطح‌بندی مشتری (بر اساس امتیاز) */
export type TierThresholds = {
  silver: number;
  gold: number;
  vip: number;
};

/** تنظیمات کامل برنامه (از جدول settings واکشی می‌شود) */
export type PointsMode = 'amount' | 'visit';

export type AppSettings = {
  sms_templates: SmsTemplates;
  /** روش امتیازدهی: بر اساس مبلغ خرید یا بر اساس هر روز حضور */
  points_mode: PointsMode;
  points_per_currency: number;
  currency_unit: number;
  /** امتیاز ثابت برای هر روز خرید (حالت visit) */
  visit_points: number;
  /** حداقل مبلغ فاکتور برای احتساب امتیاز روزانه (حالت visit) */
  visit_min_amount: number;
  /** تبدیل امتیاز به کد تخفیف */
  redeem_enabled: number;
  redeem_points: number;
  redeem_value: number;
  redeem_expiry_days: number;
  /** ورود مشتری با رمز یک‌بارمصرف پیامکی */
  otp_login_enabled: number;
  /** الزام باز بودن صندوق برای ثبت پرداخت نقدی */
  require_shift: number;
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
  /** نسخهٔ نشست (برای ابطال توکن‌های قدیمی) */
  tv?: number;
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
    /** کوکی نشست وجود داشت ولی معتبر نبود (برای پیام دقیق «نشست منقضی») */
    sessionInvalid?: boolean;
  };
};

/** پاسخ استاندارد API */
export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string; code?: string };
