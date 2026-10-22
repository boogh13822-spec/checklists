/**
 * ----------------------------------------------------------------------------
 *  پنل ادمین: تنظیمات، مدیریت کارمندان، لاگ پیامک و کدهای تخفیف
 * ----------------------------------------------------------------------------
 */
import type { AppSettings, CouponRow, Role } from '../types';
import type { CouponListItem, SmsLogListItem, StaffListItem } from '../lib/db';
import type { MenuItem } from '../lib/settings';
import {
  escapeHtml,
  formatJalali,
  formatJalaliDateTime,
  formatNumberFa,
  toPersianDigits,
} from '../lib/utils';
import { appShell, emptyState, icon, jsonForScript, pageHeader } from './layout';

/* ==========================================================================
 * ۱) تنظیمات
 * ========================================================================== */

const TEMPLATE_META: Array<{
  key: keyof AppSettings['sms_templates'];
  title: string;
  iconName: string;
  description: string;
  vars: string[];
  sample: Record<string, string>;
}> = [
  {
    key: 'welcome',
    title: 'پیامک خوش‌آمدگویی',
    iconName: 'sparkles',
    description: 'بلافاصله پس از ثبت‌نام مشتری ارسال می‌شود.',
    vars: ['name', 'cafe', 'referral_code'],
    sample: { name: 'سارا', cafe: 'کافه ملت', referral_code: 'REF-A1B2C3' },
  },
  {
    key: 'invoice',
    title: 'تأیید فاکتور',
    iconName: 'receipt',
    description: 'پس از ثبت هر فاکتور برای مشتری ارسال می‌شود.',
    vars: ['name', 'amount', 'points', 'total_points', 'tier', 'discount', 'code', 'cafe'],
    sample: {
      name: 'سارا',
      amount: '۲۵۰,۰۰۰',
      points: '۲۵۰',
      total_points: '۱,۲۵۰',
      tier: 'نقره‌ای',
      discount: '۰',
      code: '',
      cafe: 'کافه ملت',
    },
  },
  {
    key: 'birthday',
    title: 'تبریک تولد',
    iconName: 'gift',
    description: 'صبح روز تولد مشتری همراه با کد تخفیف اختصاصی.',
    vars: ['name', 'coupon', 'percent', 'cafe'],
    sample: { name: 'سارا', coupon: 'CAFE-7K3M9Q', percent: '۱۵', cafe: 'کافه ملت' },
  },
  {
    key: 'churn',
    title: 'دلتنگی (ریزش)',
    iconName: 'trending',
    description: 'برای مشتریانی که بیش از حد معمول نیامده‌اند.',
    vars: ['name', 'last_visit', 'days', 'avg', 'tier', 'cafe'],
    sample: { name: 'سارا', last_visit: '۲۱', days: '۲۱', avg: '۹', tier: 'نقره‌ای', cafe: 'کافه ملت' },
  },
  {
    key: 'weather',
    title: 'وضعیت آب‌وهوا',
    iconName: 'sun',
    description: 'هر صبح برای مشتریان فعال ارسال می‌شود.',
    vars: ['name', 'city', 'weather', 'temp', 'advice', 'cafe'],
    sample: {
      name: 'سارا',
      city: 'تهران',
      weather: 'آفتابی ☀️',
      temp: '۲۶',
      advice: 'بهترین فرصت برای یک قهوه در تراس',
      cafe: 'کافه ملت',
    },
  },
  {
    key: 'otp',
    title: 'کد ورود مشتری',
    iconName: 'key',
    description: 'با هر درخواست ورود به باشگاه برای مشتری ارسال می‌شود.',
    vars: ['name', 'code', 'minutes', 'cafe'],
    sample: { name: 'سارا', code: '481920', minutes: '۲', cafe: 'کافه ملت' },
  },
  {
    key: 'redeem',
    title: 'تبدیل امتیاز به کد تخفیف',
    iconName: 'gift',
    description: 'بعد از تبدیل امتیاز، کد تخفیف و مهلت استفاده ارسال می‌شود.',
    vars: ['name', 'code', 'value', 'points', 'days', 'cafe'],
    sample: {
      name: 'سارا',
      code: 'CAFE-8Q2M4L',
      value: '۲۰,۰۰۰',
      points: '۲۰۰',
      days: '۳۰',
      cafe: 'کافه ملت',
    },
  },
];

export function adminSettingsPage(input: {
  settings: AppSettings;
  userName: string;
  menu: MenuItem[];
  smsToday: { sent: number; failed: number };
}): string {
  const { settings, userName, menu, smsToday } = input;
  const hasSmsKey = settings.sms_api_key.trim().length > 0;
  const hasWeatherKey = settings.weather_api_key.trim().length > 0;
  const smsProviderLabel =
    settings.sms_provider === 'smsir'
      ? 'sms.ir'
      : settings.sms_provider === 'kavenegar'
        ? 'کاوه‌نگار'
        : 'حالت آزمایشی';

  const templateCards = TEMPLATE_META.map((meta) => {
    const value = settings.sms_templates[meta.key];
    return `<div class="glass rounded-2xl overflow-hidden" data-template-card="${meta.key}">
      <div class="px-4 py-3 border-b border-white/10 flex items-center gap-2 flex-wrap">
        <span class="w-7 h-7 rounded-lg bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon(meta.iconName, 'w-3.5 h-3.5')}</span>
        <div class="min-w-0">
          <div class="text-[12.5px] font-semibold">${meta.title}</div>
          <div class="text-[10px] text-cream/35">${meta.description}</div>
        </div>
        <div class="me-auto flex items-center gap-1.5">
          <span class="badge tone-muted" data-count-for="${meta.key}">۰ کاراکتر</span>
          <span class="badge tone-info" data-parts-for="${meta.key}">۱ بخش</span>
        </div>
      </div>
      <div class="p-4">
        <div class="flex flex-wrap gap-1.5 mb-2.5">
          ${meta.vars
            .map(
              (variable) =>
                `<button type="button" data-var="{${variable}}" data-target="tpl-${meta.key}" class="badge tone-muted hover:!text-gold hover:border-gold/40 transition font-mono !text-[10px]" dir="ltr">{${variable}}</button>`
            )
            .join('')}
        </div>
        <textarea id="tpl-${meta.key}" rows="4" maxlength="1000" class="field text-[12.5px] leading-8" spellcheck="false">${escapeHtml(value)}</textarea>
        <div class="mt-2 rounded-xl bg-black/25 border border-white/5 p-3">
          <div class="text-[9.5px] text-cream/30 mb-1">پیش‌نمایش</div>
          <div class="text-[11px] text-cream/60 leading-6 whitespace-pre-line" data-preview-for="${meta.key}"></div>
        </div>
      </div>
    </div>`;
  }).join('');

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
    ${pageHeader({
      title: 'تنظیمات باشگاه',
      subtitle: 'متن پیامک‌ها، نسبت امتیازدهی، منو و اتصال سرویس‌ها',
      iconName: 'settings',
      actions: `<button type="button" id="save-settings" class="btn btn-primary btn-sm">${icon('check', 'w-4 h-4')} ذخیره تغییرات</button>`,
    })}

    <div class="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 mb-5">
      ${[
        { href: '#general', label: 'اطلاعات کافه', iconName: 'coffee' },
        { href: '#points', label: 'امتیاز و سطح', iconName: 'star' },
        { href: '#rewards', label: 'باشگاه مشتری', iconName: 'gift' },
        { href: '#templates', label: 'قالب پیامک', iconName: 'chat' },
        { href: '#automation', label: 'جاب‌های خودکار', iconName: 'refresh' },
        { href: '#integrations', label: 'اتصال سرویس‌ها', iconName: 'key' },
        { href: '#menu', label: 'منوی کافه', iconName: 'receipt' },
      ]
        .map(
          (item) =>
            `<a href="${item.href}" class="btn btn-ghost btn-sm shrink-0">${icon(item.iconName, 'w-3.5 h-3.5')} ${item.label}</a>`
        )
        .join('')}
    </div>

    <div class="space-y-5">

      <!-- General -->
      <section id="general" class="glass rounded-3xl overflow-hidden scroll-mt-24">
        <div class="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon('coffee', 'w-4 h-4')}</span>
          <h2 class="font-bold text-sm">اطلاعات کافه</h2>
        </div>
        <div class="p-5 grid sm:grid-cols-2 gap-4">
          <div>
            <label class="label" for="cafe_name">نام کافه</label>
            <input id="cafe_name" type="text" class="field" maxlength="60" value="${escapeHtml(settings.cafe_name)}" />
            <p class="hint">در پیامک‌ها با متغیر {cafe} استفاده می‌شود.</p>
          </div>
          <div>
            <label class="label" for="cafe_city">شهر (برای آب‌وهوا)</label>
            <input id="cafe_city" type="text" class="field" maxlength="60" value="${escapeHtml(settings.cafe_city)}" />
            <p class="hint">برای OpenWeather بهتر است نام انگلیسی شهر هم قابل قبول باشد.</p>
          </div>
        </div>
      </section>

      <!-- Points -->
      <section id="points" class="glass rounded-3xl overflow-hidden scroll-mt-24">
        <div class="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon('star', 'w-4 h-4')}</span>
          <h2 class="font-bold text-sm">امتیازدهی و سطح‌بندی</h2>
        </div>

        <div class="p-5 space-y-4">
          <div>
            <div class="label">روش امتیازدهی</div>
            <div class="grid sm:grid-cols-2 gap-2">
              <label class="mode-card" data-mode-card="amount">
                <input type="radio" name="points_mode" value="amount" class="accent-amber-500 mt-0.5" ${settings.points_mode === 'amount' ? 'checked' : ''} />
                <span>
                  <span class="block text-[12.5px] font-semibold">بر اساس مبلغ خرید</span>
                  <span class="block text-[10.5px] text-cream/40 leading-5 mt-1">هر مبلغی که خرید کند، به نسبت مبلغ امتیاز می‌گیرد.</span>
                </span>
              </label>
              <label class="mode-card" data-mode-card="visit">
                <input type="radio" name="points_mode" value="visit" class="accent-amber-500 mt-0.5" ${settings.points_mode === 'visit' ? 'checked' : ''} />
                <span>
                  <span class="block text-[12.5px] font-semibold">امتیاز ثابت برای هر روز حضور</span>
                  <span class="block text-[10.5px] text-cream/40 leading-5 mt-1">اولین خرید هر روز امتیاز ثابت می‌گیرد؛ خریدهای بعدی همان روز امتیاز ندارند.</span>
                </span>
              </label>
            </div>
          </div>

          <div id="mode-amount" class="grid sm:grid-cols-2 gap-4">
            <div>
              <label class="label" for="currency_unit">واحد مبلغ (تومان)</label>
              <input id="currency_unit" type="number" min="1" max="10000000" class="field text-left" dir="ltr" value="${settings.currency_unit}" />
              <p class="hint">مثلاً ۱۰۰۰ یعنی هر هزار تومان.</p>
            </div>
            <div>
              <label class="label" for="points_per_currency">امتیاز هر واحد</label>
              <input id="points_per_currency" type="number" min="1" max="1000" class="field text-left" dir="ltr" value="${settings.points_per_currency}" />
              <p class="hint">مثلاً ۱ یعنی ۱ امتیاز برای هر ۱۰۰۰ تومان.</p>
            </div>
          </div>

          <div id="mode-visit" class="grid sm:grid-cols-2 gap-4">
            <div>
              <label class="label" for="visit_points">امتیاز هر روز خرید</label>
              <input id="visit_points" type="number" min="1" max="100000" class="field text-left" dir="ltr" value="${settings.visit_points}" />
              <p class="hint">فقط اولین فاکتور هر روز این امتیاز را می‌دهد.</p>
            </div>
            <div>
              <label class="label" for="visit_min_amount">حداقل مبلغ فاکتور (تومان)</label>
              <input id="visit_min_amount" type="number" min="0" max="100000000" class="field text-left" dir="ltr" value="${settings.visit_min_amount}" />
              <p class="hint">خریدهای کمتر از این مبلغ امتیاز حضور نمی‌گیرند.</p>
            </div>
          </div>

          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <label class="label" for="referral_reward_points">پاداش معرفی (امتیاز)</label>
              <input id="referral_reward_points" type="number" min="0" max="1000000" class="field text-left" dir="ltr" value="${settings.referral_reward_points}" />
              <p class="hint">پس از اولین خرید مشتری معرفی‌شده.</p>
            </div>
          </div>

          <div>
            <div class="label">آستانه‌های سطح (بر اساس مجموع امتیاز کسب‌شده)</div>
            <div class="grid grid-cols-3 gap-4">
              <div>
                <label class="label !text-[10.5px]" for="tier_silver">نقره‌ای</label>
                <input id="tier_silver" type="number" min="1" class="field text-left" dir="ltr" value="${settings.tiers.silver}" />
              </div>
              <div>
                <label class="label !text-[10.5px]" for="tier_gold">طلایی</label>
                <input id="tier_gold" type="number" min="2" class="field text-left" dir="ltr" value="${settings.tiers.gold}" />
              </div>
              <div>
                <label class="label !text-[10.5px]" for="tier_vip">الماسی</label>
                <input id="tier_vip" type="number" min="3" class="field text-left" dir="ltr" value="${settings.tiers.vip}" />
              </div>
            </div>
          </div>
        </div>

        <div class="px-5 py-3 border-t border-white/5 bg-white/[0.02] flex flex-wrap items-center gap-2">
          <span class="text-[10.5px] text-cream/40">پیش‌نمایش:</span>
          <span class="badge tone-muted" id="points-preview">—</span>
        </div>
      </section>

      <!-- Redemption & customer login -->
      <section id="rewards" class="glass rounded-3xl overflow-hidden scroll-mt-24">
        <div class="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon('gift', 'w-4 h-4')}</span>
          <h2 class="font-bold text-sm">باشگاه مشتری و تبدیل امتیاز</h2>
        </div>
        <div class="p-5 space-y-4">
          <label class="flex items-start gap-2.5 text-[12px] text-cream/70 leading-6 cursor-pointer select-none">
            <input id="otp_login_enabled" type="checkbox" class="mt-1 accent-amber-500 w-4 h-4" ${settings.otp_login_enabled === 1 ? 'checked' : ''} />
            <span>ورود مشتری با کد پیامکی فعال باشد <span class="text-cream/35">(صفحه‌ی «باشگاه من»)</span></span>
          </label>

          <label class="flex items-start gap-2.5 text-[12px] text-cream/70 leading-6 cursor-pointer select-none">
            <input id="redeem_enabled" type="checkbox" class="mt-1 accent-amber-500 w-4 h-4" ${settings.redeem_enabled === 1 ? 'checked' : ''} />
            <span>مشتری بتواند امتیاز را به کد تخفیف تبدیل کند</span>
          </label>

          <div id="redeem-fields" class="grid sm:grid-cols-3 gap-4">
            <div>
              <label class="label" for="redeem_points">امتیاز لازم</label>
              <input id="redeem_points" type="number" min="1" max="10000000" class="field text-left" dir="ltr" value="${settings.redeem_points}" />
            </div>
            <div>
              <label class="label" for="redeem_value">مبلغ کد تخفیف (تومان)</label>
              <input id="redeem_value" type="number" min="1000" max="100000000" class="field text-left" dir="ltr" value="${settings.redeem_value}" />
            </div>
            <div>
              <label class="label" for="redeem_expiry_days">مهلت استفاده (روز)</label>
              <input id="redeem_expiry_days" type="number" min="1" max="365" class="field text-left" dir="ltr" value="${settings.redeem_expiry_days}" />
            </div>
          </div>
          <p class="hint">کد تخفیف فقط یک‌بار و فقط برای فاکتورهای بالای مبلغ کد قابل استفاده است.</p>
        </div>
        <div class="px-5 py-3 border-t border-white/5 bg-white/[0.02] flex flex-wrap items-center gap-2">
          <span class="text-[10.5px] text-cream/40">پیش‌نمایش:</span>
          <span class="badge tone-muted" id="redeem-preview">—</span>
        </div>
      </section>

      <!-- Templates -->
      <section id="templates" class="space-y-3 scroll-mt-24">
        <div class="glass rounded-3xl px-5 py-4 flex items-center gap-2">
          <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon('chat', 'w-4 h-4')}</span>
          <h2 class="font-bold text-sm">قالب‌های پیامک</h2>
          <span class="badge tone-muted me-auto">${toPersianDigits(smsToday.sent)} ارسال موفق امروز</span>
        </div>
        <div class="grid lg:grid-cols-2 gap-3">
          ${templateCards}
        </div>
      </section>

      <!-- Automation -->
      <section id="automation" class="glass rounded-3xl overflow-hidden scroll-mt-24">
        <div class="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon('refresh', 'w-4 h-4')}</span>
          <h2 class="font-bold text-sm">تنظیمات جاب‌های خودکار</h2>
        </div>
        <div class="p-5 grid sm:grid-cols-3 gap-4">
          <div>
            <label class="label" for="churn_grace_days">مهلت اضافه ریزش (روز)</label>
            <input id="churn_grace_days" type="number" min="0" max="60" class="field text-left" dir="ltr" value="${settings.churn_grace_days}" />
            <p class="hint">اگر بیش از «میانگین + این عدد» نیامد، پیامک می‌گیرد.</p>
          </div>
          <div>
            <label class="label" for="churn_min_visits">حداقل خرید برای میانگین</label>
            <input id="churn_min_visits" type="number" min="1" max="100" class="field text-left" dir="ltr" value="${settings.churn_min_visits}" />
            <p class="hint">کمتر از این تعداد خرید، مبنای سنجش ۳۰ روز است (مشتری تک‌خرید هم پیامک می‌گیرد).</p>
          </div>
          <div>
            <label class="label" for="birthday_coupon_percent">درصد تخفیف تولد</label>
            <input id="birthday_coupon_percent" type="number" min="1" max="100" class="field text-left" dir="ltr" value="${settings.birthday_coupon_percent}" />
            <p class="hint">کد به مدت ۱۴ روز اعتبار دارد.</p>
          </div>
        </div>
      </section>

      <!-- Integrations -->
      <section id="integrations" class="glass rounded-3xl overflow-hidden scroll-mt-24">
        <div class="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon('key', 'w-4 h-4')}</span>
          <h2 class="font-bold text-sm">اتصال سرویس‌ها</h2>
        </div>
        <div class="p-5 grid sm:grid-cols-2 gap-4">
          <div>
            <label class="label" for="sms_provider">سرویس‌دهنده پیامک</label>
            <select id="sms_provider" class="field">
              <option value="smsir" ${settings.sms_provider === 'smsir' ? 'selected' : ''}>sms.ir (پیشنهادی)</option>
              <option value="kavenegar" ${settings.sms_provider === 'kavenegar' ? 'selected' : ''}>کاوه‌نگار</option>
              <option value="console" ${settings.sms_provider === 'console' ? 'selected' : ''}>حالت آزمایشی (فقط لاگ)</option>
            </select>
            <p class="hint">
              وضعیت فعلی: <span class="text-gold font-semibold">${smsProviderLabel}</span> —
              در حالت آزمایشی پیامک واقعی ارسال نمی‌شود.
            </p>
          </div>
          <div>
            <label class="label" for="sms_sender">شماره خط فرستنده (LineNumber)</label>
            <input id="sms_sender" type="text" dir="ltr" inputmode="numeric" class="field text-left font-mono" maxlength="30" value="${escapeHtml(settings.sms_sender)}" placeholder="3000xxxxxx" />
            <p class="hint">در sms.ir همان «شماره خط» پنل است و باید فقط عدد باشد.</p>
          </div>
          <div class="sm:col-span-2">
            <label class="label" for="sms_api_key">کلید API پیامک</label>
            <div class="flex gap-2">
              <input id="sms_api_key" type="password" dir="ltr" class="field text-left font-mono" value="" autocomplete="off"
                placeholder="${hasSmsKey ? 'کلید ذخیره شده است — برای تغییر، مقدار جدید را وارد کنید' : 'کلید API را وارد کنید'}" />
              <button type="button" data-reveal="sms_api_key" class="btn btn-ghost btn-sm shrink-0">${icon('search', 'w-4 h-4')}</button>
            </div>
            <div class="flex items-center justify-between gap-2 mt-2">
              <p class="hint !mt-0">
                ${hasSmsKey ? 'کلید فعلی ذخیره شده و دیگر در صفحه نمایش داده نمی‌شود.' : 'کلید API را از پنل سرویس پیامک بگیرید.'}
              </p>
              ${
                hasSmsKey
                  ? `<label class="flex items-center gap-1.5 text-[10.5px] text-rose-300/80 cursor-pointer whitespace-nowrap">
                       <input id="clear-sms-key" type="checkbox" class="accent-rose-500 w-3.5 h-3.5" />
                       حذف کلید
                     </label>`
                  : ''
              }
            </div>
          </div>
          <div class="sm:col-span-2">
            <label class="label" for="weather_api_key">کلید API هواشناسی (OpenWeather)</label>
            <div class="flex gap-2">
              <input id="weather_api_key" type="password" dir="ltr" class="field text-left font-mono" value="" autocomplete="off"
                placeholder="${hasWeatherKey ? 'کلید ذخیره شده است — برای تغییر، مقدار جدید را وارد کنید' : 'کلید API را وارد کنید'}" />
              <button type="button" data-reveal="weather_api_key" class="btn btn-ghost btn-sm shrink-0">${icon('search', 'w-4 h-4')}</button>
            </div>
            <div class="flex items-center justify-between gap-2 mt-2">
              <p class="hint !mt-0">دریافت کلید از openweathermap.org — پلن رایگان کافی است.</p>
              ${
                hasWeatherKey
                  ? `<label class="flex items-center gap-1.5 text-[10.5px] text-rose-300/80 cursor-pointer whitespace-nowrap">
                       <input id="clear-weather-key" type="checkbox" class="accent-rose-500 w-3.5 h-3.5" />
                       حذف کلید
                     </label>`
                  : ''
              }
            </div>
          </div>
          <div class="sm:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-3.5">
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" id="test-sms" class="btn btn-ghost btn-sm">${icon('send', 'w-4 h-4')} پیامک آزمایشی به خودم</button>
              <button type="button" id="sms-credit" class="btn btn-ghost btn-sm">${icon('wallet', 'w-4 h-4')} اعتبار sms.ir</button>
              <button type="button" id="test-weather" class="btn btn-ghost btn-sm">${icon('sun', 'w-4 h-4')} تست آب‌وهوا</button>
            </div>
            <p class="text-[10.5px] text-cream/35 leading-6 mt-2">
              راهنمای sms.ir: پنل → «وب‌سرویس» → دریافت کلید API؛ سپس شماره خط را در فیلد بالا وارد و ذخیره کنید.
            </p>
          </div>
        </div>
      </section>

      <!-- Menu -->
      <section id="menu" class="glass rounded-3xl overflow-hidden scroll-mt-24">
        <div class="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon('receipt', 'w-4 h-4')}</span>
          <h2 class="font-bold text-sm">منوی کافه (آیتم‌های فاکتور)</h2>
          <button type="button" id="add-menu-row" class="btn btn-ghost btn-sm me-auto">${icon('plus', 'w-4 h-4')} افزودن آیتم</button>
        </div>
        <div class="p-5">
          <div id="menu-rows" class="space-y-2"></div>
          <p class="hint">این آیتم‌ها در صفحه ثبت فاکتور کارمند نمایش داده می‌شوند.</p>
        </div>
      </section>

      <div class="flex items-center justify-between gap-3 glass rounded-2xl p-4">
        <p class="text-[10.5px] text-cream/40 leading-5">تغییرات بلافاصله پس از ذخیره روی صفحه ثبت فاکتور و پیامک‌های بعدی اعمال می‌شود.</p>
        <button type="button" id="save-settings-bottom" class="btn btn-primary btn-sm shrink-0">${icon('check', 'w-4 h-4')} ذخیره</button>
      </div>
    </div>
  </div>
  `;

  const scripts = `
  (function () {
    var TEMPLATE_KEYS = ['welcome', 'invoice', 'birthday', 'churn', 'weather'];
    var SAMPLES = ${jsonForScript(
      TEMPLATE_META.reduce<Record<string, Record<string, string>>>((acc, meta) => {
        acc[meta.key] = meta.sample;
        return acc;
      }, {})
    )};
    var menuItems = ${jsonForScript(menu)};

    function smsParts(text) {
      var len = text.length;
      var persian = /[\\u0600-\\u06FF]/.test(text);
      var per = persian ? 70 : 160;
      return Math.max(1, Math.ceil(len / per));
    }

    function renderTemplateStats(key) {
      var area = document.getElementById('tpl-' + key);
      var value = area.value;
      var countEl = document.querySelector('[data-count-for="' + key + '"]');
      var partsEl = document.querySelector('[data-parts-for="' + key + '"]');
      if (countEl) countEl.textContent = fa(value.length) + ' کاراکتر';
      if (partsEl) {
        var parts = smsParts(value);
        partsEl.textContent = fa(parts) + ' بخش';
        partsEl.className = 'badge ' + (parts > 2 ? 'tone-warning' : 'tone-info');
      }
      var preview = value.replace(/\\{(\\w+)\\}/g, function (match, name) {
        var sample = SAMPLES[key] || {};
        return sample[name] !== undefined ? sample[name] : match;
      });
      var host = document.querySelector('[data-preview-for="' + key + '"]');
      if (host) host.textContent = preview || '—';
    }

    TEMPLATE_KEYS.forEach(function (key) {
      var area = document.getElementById('tpl-' + key);
      renderTemplateStats(key);
      area.addEventListener('input', function () { renderTemplateStats(key); });
    });

    document.addEventListener('click', function (event) {
      var chip = event.target.closest('[data-var]');
      if (!chip) return;
      var target = document.getElementById(chip.dataset.target);
      if (!target) return;
      var start = target.selectionStart || 0;
      var end = target.selectionEnd || 0;
      var value = target.value;
      target.value = value.slice(0, start) + chip.dataset.var + value.slice(end);
      target.focus();
      var pos = start + chip.dataset.var.length;
      try { target.setSelectionRange(pos, pos); } catch (e) {}
      renderTemplateStats(chip.dataset.target.replace('tpl-', ''));
    });

    document.querySelectorAll('[data-reveal]').forEach(function (button) {
      button.addEventListener('click', function () {
        var input = document.getElementById(button.dataset.reveal);
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    });

    // Menu editor
    function renderMenuRows() {
      var host = $('#menu-rows');
      if (menuItems.length === 0) {
        host.innerHTML = '<p class="text-[11px] text-cream/35 text-center py-4">آیتمی وجود ندارد. یکی اضافه کنید.</p>';
        return;
      }
      host.innerHTML = menuItems.map(function (item, index) {
        return '<div class="grid grid-cols-[1fr_110px_90px_34px] gap-2 items-center">' +
          '<input data-menu-name="' + index + '" class="field !py-2 !text-[12px]" value="' + escapeHtml(item.name) + '" placeholder="نام آیتم" />' +
          '<input data-menu-price="' + index + '" type="number" dir="ltr" class="field !py-2 !text-[12px] text-left" value="' + Number(item.price || 0) + '" placeholder="قیمت" />' +
          '<input data-menu-cat="' + index + '" class="field !py-2 !text-[12px]" value="' + escapeHtml(item.category || '') + '" placeholder="دسته" />' +
          '<button type="button" data-menu-remove="' + index + '" class="w-[34px] h-[34px] rounded-lg text-cream/35 hover:text-rose-300 hover:bg-rose-500/10 flex items-center justify-center" title="حذف">' +
            '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
          '</button>' +
        '</div>';
      }).join('');
    }
    renderMenuRows();

    $('#add-menu-row').addEventListener('click', function () {
      menuItems.push({ name: '', price: 0, category: '' });
      renderMenuRows();
    });

    $('#menu-rows').addEventListener('input', function (event) {
      var target = event.target;
      if (target.dataset.menuName !== undefined) menuItems[Number(target.dataset.menuName)].name = target.value;
      if (target.dataset.menuPrice !== undefined) menuItems[Number(target.dataset.menuPrice)].price = Number(target.value) || 0;
      if (target.dataset.menuCat !== undefined) menuItems[Number(target.dataset.menuCat)].category = target.value;
    });

    $('#menu-rows').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-menu-remove]');
      if (!btn) return;
      menuItems.splice(Number(btn.dataset.menuRemove), 1);
      renderMenuRows();
    });

    // Points preview + mode switch
    function currentMode() {
      var checked = document.querySelector('input[name="points_mode"]:checked');
      return checked ? checked.value : 'amount';
    }

    function updatePointsPreview() {
      var mode = currentMode();
      document.querySelectorAll('[data-mode-card]').forEach(function (card) {
        card.classList.toggle('is-active', card.getAttribute('data-mode-card') === mode);
      });

      var amountBox = document.getElementById('mode-amount');
      var visitBox = document.getElementById('mode-visit');
      if (amountBox) amountBox.style.display = mode === 'amount' ? '' : 'none';
      if (visitBox) visitBox.style.display = mode === 'visit' ? '' : 'none';

      var unit = Number($('#currency_unit').value) || 1000;
      var ratio = Number($('#points_per_currency').value) || 1;
      var visitPoints = Number($('#visit_points').value) || 0;
      var visitMin = Number($('#visit_min_amount').value) || 0;
      var preview = mode === 'visit'
        ? 'اولین خرید هر روز بالای ' + moneyFa(visitMin) + ' تومان = ' + fa(visitPoints) + ' امتیاز'
        : 'هر ' + moneyFa(unit) + ' تومان = ' + fa(ratio) + ' امتیاز';
      $('#points-preview').textContent = preview;

      var redeemEnabled = document.getElementById('redeem_enabled');
      var redeemFields = document.getElementById('redeem-fields');
      var redeemBadge = document.getElementById('redeem-preview');
      if (redeemEnabled && redeemFields && redeemBadge) {
        var on = redeemEnabled.checked;
        redeemFields.style.opacity = on ? '1' : '.45';
        redeemFields.style.pointerEvents = on ? '' : 'none';
        redeemBadge.textContent = on
          ? fa(Number($('#redeem_points').value) || 0) + ' امتیاز = کد تخفیف ' + moneyFa(Number($('#redeem_value').value) || 0) + ' تومان (' + fa(Number($('#redeem_expiry_days').value) || 0) + ' روز)'
          : 'غیرفعال';
      }
    }

    document.querySelectorAll('input[name="points_mode"]').forEach(function (input) {
      input.addEventListener('change', updatePointsPreview);
    });
    ['currency_unit', 'points_per_currency', 'visit_points', 'visit_min_amount', 'redeem_points', 'redeem_value', 'redeem_expiry_days'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', updatePointsPreview);
    });
    var redeemToggle = document.getElementById('redeem_enabled');
    if (redeemToggle) redeemToggle.addEventListener('change', updatePointsPreview);
    updatePointsPreview();

    async function saveSettings() {
      var buttons = ['save-settings', 'save-settings-bottom'];
      buttons.forEach(function (id) { setLoading(document.getElementById(id), true, ''); });
      var payload = {
        cafe_name: $('#cafe_name').value.trim(),
        cafe_city: $('#cafe_city').value.trim(),
        points_mode: currentMode(),
        currency_unit: Number($('#currency_unit').value),
        points_per_currency: Number($('#points_per_currency').value),
        visit_points: Number($('#visit_points').value),
        visit_min_amount: Number($('#visit_min_amount').value),
        redeem_enabled: document.getElementById('redeem_enabled').checked ? 1 : 0,
        redeem_points: Number($('#redeem_points').value),
        redeem_value: Number($('#redeem_value').value),
        redeem_expiry_days: Number($('#redeem_expiry_days').value),
        otp_login_enabled: document.getElementById('otp_login_enabled').checked ? 1 : 0,
        referral_reward_points: Number($('#referral_reward_points').value),
        tiers: {
          silver: Number($('#tier_silver').value),
          gold: Number($('#tier_gold').value),
          vip: Number($('#tier_vip').value)
        },
        churn_grace_days: Number($('#churn_grace_days').value),
        churn_min_visits: Number($('#churn_min_visits').value),
        birthday_coupon_percent: Number($('#birthday_coupon_percent').value),
        sms_provider: $('#sms_provider').value,
        sms_api_key: $('#sms_api_key').value.trim(),
        sms_sender: $('#sms_sender').value.trim(),
        weather_api_key: $('#weather_api_key').value.trim(),
        clear_sms_api_key: !!(document.getElementById('clear-sms-key') && document.getElementById('clear-sms-key').checked),
        clear_weather_api_key: !!(document.getElementById('clear-weather-key') && document.getElementById('clear-weather-key').checked),
        sms_templates: {
          welcome: document.getElementById('tpl-welcome').value,
          invoice: document.getElementById('tpl-invoice').value,
          birthday: document.getElementById('tpl-birthday').value,
          churn: document.getElementById('tpl-churn').value,
          weather: document.getElementById('tpl-weather').value,
          otp: document.getElementById('tpl-otp') ? document.getElementById('tpl-otp').value : undefined,
          redeem: document.getElementById('tpl-redeem') ? document.getElementById('tpl-redeem').value : undefined
        },
        menu_items: menuItems.filter(function (item) { return item.name.trim(); }).map(function (item) {
          return { name: item.name.trim(), price: Number(item.price) || 0, category: (item.category || '').trim() };
        })
      };
      try {
        await api('/api/admin/settings', { method: 'PUT', body: payload });
        // بعد از ذخیره، مقدار کلید از صفحه پاک می‌شود تا دوباره در HTML قرار نگیرد
        ['sms_api_key', 'weather_api_key'].forEach(function (id) {
          var input = document.getElementById(id);
          if (input && input.value.trim()) {
            input.value = '';
            input.placeholder = 'کلید ذخیره شده است — برای تغییر، مقدار جدید را وارد کنید';
          }
        });
        toast('تنظیمات با موفقیت ذخیره شد.', 'success');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        buttons.forEach(function (id) { setLoading(document.getElementById(id), false); });
      }
    }

    $('#save-settings').addEventListener('click', saveSettings);
    $('#save-settings-bottom').addEventListener('click', saveSettings);

    $('#test-sms').addEventListener('click', async function () {
      var btn = $('#test-sms');
      setLoading(btn, true, 'در حال ارسال…');
      try {
        var result = await api('/api/admin/test-sms', { method: 'POST' });
        toast(result.message, result.status === 'sent' ? 'success' : 'error');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setLoading(btn, false);
      }
    });

    var creditBtn = $('#sms-credit');
    if (creditBtn) {
      creditBtn.addEventListener('click', async function () {
        setLoading(creditBtn, true, 'در حال بررسی…');
        try {
          var result = await api('/api/admin/sms/credit');
          toast(result.message, result.ok ? 'success' : 'error');
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          setLoading(creditBtn, false);
        }
      });
    }

    $('#test-weather').addEventListener('click', async function () {
      var btn = $('#test-weather');
      setLoading(btn, true, 'در حال دریافت…');
      try {
        var result = await api('/api/admin/weather');
        toast(result.message, result.ok ? 'success' : 'error');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setLoading(btn, false);
      }
    });
  })();
  `;

  return appShell({
    title: 'تنظیمات',
    role: 'admin' as Role,
    userName,
    active: 'settings',
    body,
    scripts,
    cafeName: settings.cafe_name,
  });
}

/* ==========================================================================
 * ۲) مدیریت کارمندان
 * ========================================================================== */

export function adminStaffPage(input: {
  settings: AppSettings;
  userName: string;
  currentUserId: number;
  staff: StaffListItem[];
}): string {
  const { settings, userName, currentUserId, staff } = input;

  const rows = staff
    .map((member) => {
      const isSelf = member.id === currentUserId;
      const roleLabel = member.role === 'admin' ? 'ادمین' : 'کارمند';
      return `<tr>
        <td>
          <div class="flex items-center gap-2.5">
            <span class="w-9 h-9 rounded-full ${member.role === 'admin' ? 'bg-gradient-to-br from-fuchsia-400 to-purple-800' : 'bg-gradient-to-br from-amber-300 to-amber-800'} text-coffee-950 text-[12px] font-bold flex items-center justify-center">${escapeHtml(member.name.slice(0, 1))}</span>
            <div>
              <div class="text-[12.5px] font-medium flex items-center gap-1.5">
                ${escapeHtml(member.name)}
                ${isSelf ? '<span class="badge tone-info !text-[9px]">شما</span>' : ''}
              </div>
              <div class="text-[10.5px] text-cream/35 font-mono" dir="ltr">${escapeHtml(member.phone)}</div>
            </div>
          </div>
        </td>
        <td><span class="badge ${member.role === 'admin' ? 'tone-info' : 'tone-muted'}">${roleLabel}</span></td>
        <td class="text-[12px]">${formatNumberFa(member.invoices_count)}</td>
        <td class="text-[11px] text-cream/45">${formatJalali(member.created_at)}</td>
        <td><span class="badge ${member.is_active ? 'tone-success' : 'tone-danger'}">${member.is_active ? 'فعال' : 'غیرفعال'}</span></td>
        <td>
          <div class="flex items-center gap-1">
            <button type="button" data-reset="${member.id}" data-name="${escapeHtml(member.name)}" class="btn btn-ghost btn-sm !px-2" title="تغییر رمز">${icon('key', 'w-3.5 h-3.5')}</button>
            ${
              isSelf
                ? ''
                : `<button type="button" data-toggle="${member.id}" data-active="${member.is_active}" class="btn btn-ghost btn-sm !px-2" title="${member.is_active ? 'غیرفعال کردن' : 'فعال کردن'}">
                    ${icon(member.is_active ? 'close' : 'check', 'w-3.5 h-3.5')}
                  </button>
                  <button type="button" data-delete="${member.id}" data-name="${escapeHtml(member.name)}" class="btn btn-danger btn-sm !px-2" title="حذف">
                    ${icon('trash', 'w-3.5 h-3.5')}
                  </button>`
            }
          </div>
        </td>
      </tr>`;
    })
    .join('');

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
    ${pageHeader({
      title: 'کارمندان و ادمین‌ها',
      subtitle: 'مدیریت دسترسی‌ها و رمز عبور',
      iconName: 'shield',
      actions: `<button type="button" id="open-add-staff" class="btn btn-primary btn-sm">${icon('plus', 'w-4 h-4')} کارمند جدید</button>`,
    })}

    <div class="glass rounded-3xl overflow-hidden mb-5">
      <div class="px-5 py-4 border-b border-white/10 flex items-center gap-2">
        <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon('users', 'w-4 h-4')}</span>
        <h2 class="font-bold text-sm">لیست کاربران</h2>
        <span class="badge tone-muted me-auto">${toPersianDigits(staff.length)} نفر</span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>کاربر</th><th>نقش</th><th>فاکتورها</th><th>تاریخ ایجاد</th><th>وضعیت</th><th>عملیات</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>

    <div class="glass rounded-3xl overflow-hidden">
      <div class="px-5 py-4 border-b border-white/10 flex items-center gap-2">
        <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon('key', 'w-4 h-4')}</span>
        <h2 class="font-bold text-sm">تغییر رمز عبور خودم</h2>
      </div>
      <form id="my-password-form" class="p-5 grid sm:grid-cols-3 gap-3">
        <input id="cur-pass" type="password" class="field" placeholder="رمز فعلی" autocomplete="current-password" />
        <input id="new-pass" type="password" class="field" placeholder="رمز جدید (حداقل ۸ کاراکتر)" autocomplete="new-password" />
        <button type="submit" id="my-pass-btn" class="btn btn-primary">${icon('check', 'w-4 h-4')} تغییر رمز</button>
      </form>
    </div>
  </div>

  <!-- Add staff modal -->
  <div id="staff-modal" class="hidden modal-backdrop">
    <div class="modal-panel glass-strong rounded-3xl max-w-md w-full p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold">کارمند جدید</h2>
        <button type="button" id="close-staff" class="w-8 h-8 rounded-lg text-cream/40 hover:text-cream hover:bg-white/5 flex items-center justify-center">${icon('close', 'w-4 h-4')}</button>
      </div>
      <form id="staff-form" class="space-y-4">
        <div>
          <label class="label">نام</label>
          <input id="s-name" type="text" class="field" maxlength="60" required />
        </div>
        <div>
          <label class="label">شماره موبایل</label>
          <input id="s-phone" type="tel" dir="ltr" class="field text-left tracking-wider" maxlength="13" placeholder="09xxxxxxxxx" required />
        </div>
        <div>
          <label class="label">نقش</label>
          <select id="s-role" class="field">
            <option value="staff">کارمند (فقط ثبت فاکتور)</option>
            <option value="admin">ادمین (دسترسی کامل)</option>
          </select>
        </div>
        <div>
          <label class="label">رمز عبور</label>
          <div class="flex gap-2">
            <input id="s-password" type="text" dir="ltr" class="field text-left font-mono" minlength="8" maxlength="72" required />
            <button type="button" id="gen-pass" class="btn btn-ghost btn-sm shrink-0">${icon('refresh', 'w-4 h-4')}</button>
          </div>
          <p class="hint">رمز را به کارمند اطلاع دهید؛ بعداً می‌تواند تغییر دهد.</p>
        </div>
        <div class="flex gap-2 pt-1">
          <button type="button" id="cancel-staff" class="btn btn-ghost flex-1">انصراف</button>
          <button type="submit" id="staff-submit" class="btn btn-primary flex-1">${icon('plus', 'w-4 h-4')} ایجاد</button>
        </div>
      </form>
    </div>
  </div>
  `;

  const scripts = `
  (function () {
    var modal = $('#staff-modal');

    function randomPassword() {
      var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#';
      var out = '';
      var bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      for (var i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
      return out;
    }

    $('#open-add-staff').addEventListener('click', function () {
      modal.classList.remove('hidden');
      $('#s-password').value = randomPassword();
      $('#s-name').focus();
    });
    $('#close-staff').addEventListener('click', function () { modal.classList.add('hidden'); });
    $('#cancel-staff').addEventListener('click', function () { modal.classList.add('hidden'); });
    modal.addEventListener('click', function (event) { if (event.target === modal) modal.classList.add('hidden'); });
    $('#gen-pass').addEventListener('click', function () { $('#s-password').value = randomPassword(); });

    $('#staff-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var name = $('#s-name').value.trim();
      var phone = $('#s-phone').value.trim().replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); });
      var role = $('#s-role').value;
      var password = $('#s-password').value;
      if (name.length < 2) { toast('نام را کامل وارد کنید.', 'error'); return; }
      if (!/^09\\d{9}$/.test(phone)) { toast('شماره موبایل معتبر نیست.', 'error'); return; }
      if (password.length < 8) { toast('رمز عبور باید حداقل ۸ کاراکتر باشد.', 'error'); return; }

      var btn = $('#staff-submit');
      setLoading(btn, true, 'در حال ایجاد…');
      try {
        await api('/api/admin/staff', { method: 'POST', body: { name: name, phone: phone, role: role, password: password } });
        toast('کارمند ایجاد شد. رمز: ' + password, 'success');
        setTimeout(function () { window.location.reload(); }, 1600);
      } catch (error) {
        toast(error.message, 'error');
        setLoading(btn, false);
      }
    });

    function bindAction(selector, handler) {
      document.querySelectorAll(selector).forEach(function (button) {
        button.addEventListener('click', function () { handler(button); });
      });
    }

    bindAction('[data-reset]', async function (button) {
      var ok = await confirmAction({
        title: 'تغییر رمز عبور',
        message: 'رمز جدید برای «' + button.dataset.name + '» ساخته شود؟ رمز فعلی دیگر کار نمی‌کند.',
        confirmText: 'بساز'
      });
      if (!ok) return;
      try {
        var result = await api('/api/admin/staff/' + button.dataset.reset + '/password', { method: 'POST' });
        await confirmAction({ title: 'رمز جدید', message: 'رمز جدید: ' + result.password + ' — حتماً کپی و به کارمند اطلاع دهید.', confirmText: 'متوجه شدم' });
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    bindAction('[data-toggle]', async function (button) {
      var active = button.dataset.active === '1';
      var ok = await confirmAction({
        title: active ? 'غیرفعال کردن کاربر' : 'فعال کردن کاربر',
        message: active ? 'این کاربر دیگر نمی‌تواند وارد شود.' : 'این کاربر دوباره می‌تواند وارد شود.',
        confirmText: active ? 'غیرفعال کن' : 'فعال کن',
        danger: active
      });
      if (!ok) return;
      try {
        await api('/api/admin/staff/' + button.dataset.toggle, { method: 'PUT', body: { is_active: active ? 0 : 1 } });
        toast('وضعیت کاربر به‌روزرسانی شد.', 'success');
        setTimeout(function () { window.location.reload(); }, 700);
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    bindAction('[data-delete]', async function (button) {
      var ok = await confirmAction({
        title: 'حذف کاربر',
        message: 'کاربر «' + button.dataset.name + '» حذف شود؟ این عملیات قابل بازگشت نیست.',
        confirmText: 'حذف',
        danger: true
      });
      if (!ok) return;
      try {
        await api('/api/admin/staff/' + button.dataset.delete, { method: 'DELETE' });
        toast('کاربر حذف شد.', 'success');
        setTimeout(function () { window.location.reload(); }, 700);
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    $('#my-password-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var current = $('#cur-pass').value;
      var next = $('#new-pass').value;
      if (!current || next.length < 8) { toast('رمز فعلی و رمز جدید (حداقل ۸ کاراکتر) را وارد کنید.', 'error'); return; }
      var btn = $('#my-pass-btn');
      setLoading(btn, true, 'در حال تغییر…');
      try {
        await api('/api/admin/me/password', { method: 'POST', body: { current: current, next: next } });
        toast('رمز عبور تغییر کرد. لطفاً دوباره وارد شوید.', 'success');
        setTimeout(function () { window.location.href = '/api/auth/logout'; }, 1200);
      } catch (error) {
        toast(error.message, 'error');
        setLoading(btn, false);
      }
    });
  })();
  `;

  return appShell({
    title: 'کارمندان',
    role: 'admin' as Role,
    userName,
    active: 'staff',
    body,
    scripts,
    cafeName: settings.cafe_name,
  });
}

/* ==========================================================================
 * ۳) لاگ پیامک‌ها
 * ========================================================================== */

const SMS_TYPE_LABELS: Record<string, string> = {
  welcome: 'خوش‌آمد',
  invoice: 'فاکتور',
  birthday: 'تولد',
  churn: 'دلتنگی',
  weather: 'آب‌وهوا',
  referral: 'معرفی',
  admin: 'مدیریتی',
};

export function adminSmsPage(input: {
  settings: AppSettings;
  userName: string;
  logs: SmsLogListItem[];
  total: number;
  page: number;
  pageSize: number;
  filters: { type?: string; status?: string };
  stats: { sentToday: number; failedToday: number };
}): string {
  const { settings, userName, logs, total, page, pageSize, filters, stats } = input;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageLink = (newPage: number): string => {
    const search = new URLSearchParams();
    if (filters.type) search.set('type', filters.type);
    if (filters.status) search.set('status', filters.status);
    search.set('page', String(newPage));
    return `/admin/sms?${search.toString()}`;
  };

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
    ${pageHeader({
      title: 'پیامک‌ها',
      subtitle: 'تاریخچه ارسال‌ها و وضعیت تحویل',
      iconName: 'chat',
      actions: `<a href="/admin/settings#templates" class="btn btn-ghost btn-sm">${icon('edit', 'w-4 h-4')} ویرایش قالب‌ها</a>`,
    })}

    <div class="grid grid-cols-3 gap-3 mb-4">
      <div class="glass rounded-2xl p-4">
        <div class="text-[10.5px] text-cream/40 mb-1.5">ارسال موفق امروز</div>
        <div class="text-xl font-extrabold text-emerald-300">${formatNumberFa(stats.sentToday)}</div>
      </div>
      <div class="glass rounded-2xl p-4">
        <div class="text-[10.5px] text-cream/40 mb-1.5">ناموفق امروز</div>
        <div class="text-xl font-extrabold text-rose-300">${formatNumberFa(stats.failedToday)}</div>
      </div>
      <div class="glass rounded-2xl p-4">
        <div class="text-[10.5px] text-cream/40 mb-1.5">کل لاگ‌ها</div>
        <div class="text-xl font-extrabold">${formatNumberFa(total)}</div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 mb-4">
      <a href="/admin/sms" class="btn btn-sm ${!filters.type && !filters.status ? 'btn-primary' : 'btn-ghost'}">همه</a>
      ${Object.entries(SMS_TYPE_LABELS)
        .map(
          ([key, label]) =>
            `<a href="/admin/sms?type=${key}" class="btn btn-sm ${filters.type === key ? 'btn-primary' : 'btn-ghost'}">${label}</a>`
        )
        .join('')}
      <span class="w-px h-6 bg-white/10 mx-1"></span>
      <a href="/admin/sms?status=failed" class="btn btn-sm ${filters.status === 'failed' ? 'btn-primary' : 'btn-ghost'}">ناموفق</a>
    </div>

    <div class="glass rounded-3xl overflow-hidden">
      ${
        logs.length === 0
          ? emptyState({ title: 'پیامکی ثبت نشده', message: 'با ثبت‌نام مشتری یا ثبت فاکتور، پیامک‌ها اینجا نمایش داده می‌شوند.', iconName: 'chat' })
          : `<div class="table-wrap">
              <table class="data">
                <thead><tr><th>گیرنده</th><th>نوع</th><th>متن</th><th>وضعیت</th><th>زمان</th></tr></thead>
                <tbody>
                  ${logs
                    .map((log) => {
                      const statusLabel =
                        log.status === 'sent' ? 'ارسال شد' : log.status === 'failed' ? 'ناموفق' : 'رد شد';
                      const tone =
                        log.status === 'sent' ? 'success' : log.status === 'failed' ? 'danger' : 'muted';
                      return `<tr>
                        <td>
                          <div class="text-[12px]">${escapeHtml(log.user_name ?? '—')}</div>
                          <div class="text-[10px] text-cream/30 font-mono" dir="ltr">${escapeHtml(log.user_phone ?? '—')}</div>
                        </td>
                        <td><span class="badge tone-muted">${SMS_TYPE_LABELS[log.type] ?? escapeHtml(log.type)}</span></td>
                        <td class="max-w-[280px]">
                          <div class="text-[11px] text-cream/55 truncate" title="${escapeHtml(log.message ?? '')}">${escapeHtml((log.message ?? '').slice(0, 80)) || '—'}</div>
                        </td>
                        <td>
                          <span class="badge tone-${tone}">${statusLabel}</span>
                          ${log.error ? `<div class="text-[9.5px] text-rose-300/60 mt-1 truncate max-w-[120px]" title="${escapeHtml(log.error)}">${escapeHtml(log.error)}</div>` : ''}
                        </td>
                        <td class="text-[10.5px] text-cream/40 whitespace-nowrap">${formatJalaliDateTime(log.sent_at)}</td>
                      </tr>`;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>
            <div class="flex items-center justify-between gap-3 px-4 py-3 border-t border-white/10">
              <div class="text-[11px] text-cream/40">صفحه ${toPersianDigits(page)} از ${toPersianDigits(totalPages)}</div>
              <div class="flex items-center gap-1.5">
                <a href="${pageLink(Math.max(1, page - 1))}" class="btn btn-ghost btn-sm ${page <= 1 ? 'opacity-40 pointer-events-none' : ''}">${icon('right', 'w-3.5 h-3.5')} قبلی</a>
                <a href="${pageLink(Math.min(totalPages, page + 1))}" class="btn btn-ghost btn-sm ${page >= totalPages ? 'opacity-40 pointer-events-none' : ''}">بعدی ${icon('left', 'w-3.5 h-3.5')}</a>
              </div>
            </div>`
      }
    </div>
  </div>
  `;

  return appShell({
    title: 'پیامک‌ها',
    role: 'admin' as Role,
    userName,
    active: 'sms',
    body,
    cafeName: settings.cafe_name,
  });
}

/* ==========================================================================
 * ۴) کدهای تخفیف
 * ========================================================================== */

export function adminCouponsPage(input: {
  settings: AppSettings;
  userName: string;
  coupons: CouponListItem[];
  total: number;
  page: number;
  pageSize: number;
  status?: string;
}): string {
  const { settings, userName, coupons, total, page, pageSize, status } = input;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageLink = (newPage: number): string => {
    const search = new URLSearchParams();
    if (status) search.set('status', status);
    search.set('page', String(newPage));
    return `/admin/coupons?${search.toString()}`;
  };

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
    ${pageHeader({
      title: 'کدهای تخفیف',
      subtitle: 'کدهای تولد، دستی و کمپین‌ها',
      iconName: 'gift',
      actions: `<button type="button" id="open-coupon" class="btn btn-primary btn-sm">${icon('plus', 'w-4 h-4')} کد جدید</button>`,
    })}

    <div class="flex flex-wrap items-center gap-2 mb-4">
      <a href="/admin/coupons" class="btn btn-sm ${!status ? 'btn-primary' : 'btn-ghost'}">همه</a>
      <a href="/admin/coupons?status=active" class="btn btn-sm ${status === 'active' ? 'btn-primary' : 'btn-ghost'}">فعال</a>
      <a href="/admin/coupons?status=used" class="btn btn-sm ${status === 'used' ? 'btn-primary' : 'btn-ghost'}">استفاده‌شده</a>
      <a href="/admin/coupons?status=expired" class="btn btn-sm ${status === 'expired' ? 'btn-primary' : 'btn-ghost'}">منقضی</a>
    </div>

    <div class="glass rounded-3xl overflow-hidden">
      ${
        coupons.length === 0
          ? emptyState({ title: 'کدی وجود ندارد', message: 'اولین کد تخفیف را بسازید.', iconName: 'gift' })
          : `<div class="table-wrap">
              <table class="data">
                <thead><tr><th>کد</th><th>مشتری</th><th>مقدار</th><th>دلیل</th><th>استفاده</th><th>انقضا</th><th>وضعیت</th><th></th></tr></thead>
                <tbody>
                  ${coupons
                    .map((coupon) => {
                      const expired = coupon.expires_at
                        ? Date.parse(coupon.expires_at.replace(' ', 'T') + 'Z') < Date.now()
                        : false;
                      const usedUp = coupon.used_count >= coupon.max_uses;
                      const inactive = coupon.is_active === 0 || expired || usedUp;
                      const stateLabel = coupon.is_active === 0 ? 'غیرفعال' : usedUp ? 'استفاده‌شده' : expired ? 'منقضی' : 'فعال';
                      const tone = coupon.is_active === 0 ? 'muted' : usedUp ? 'info' : expired ? 'danger' : 'success';
                      return `<tr>
                        <td><code class="font-mono text-[11.5px] tracking-wider" dir="ltr">${escapeHtml(coupon.code)}</code></td>
                        <td class="text-[11.5px]">${coupon.user_name ? `<a href="/admin/customers/${coupon.user_id}" class="hover:text-gold">${escapeHtml(coupon.user_name)}</a>` : '<span class="text-cream/30">عمومی</span>'}</td>
                        <td class="text-[12px] font-semibold text-amber-200">${coupon.kind === 'percent' ? `${toPersianDigits(coupon.value)}٪` : `${formatNumberFa(coupon.value)} ت`}</td>
                        <td class="text-[11px] text-cream/45">${coupon.reason === 'birthday' ? 'تولد' : coupon.reason === 'manual' ? 'دستی' : escapeHtml(coupon.reason)}</td>
                        <td class="text-[11px]">${toPersianDigits(coupon.used_count)}/${toPersianDigits(coupon.max_uses)}</td>
                        <td class="text-[10.5px] text-cream/40">${coupon.expires_at ? formatJalali(coupon.expires_at) : '—'}</td>
                        <td><span class="badge tone-${tone}">${stateLabel}</span></td>
                        <td>
                          ${inactive ? '' : `<button type="button" data-deactivate="${coupon.id}" class="btn btn-ghost btn-sm !px-2" title="غیرفعال کردن">${icon('close', 'w-3.5 h-3.5')}</button>`}
                        </td>
                      </tr>`;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>
            <div class="flex items-center justify-between gap-3 px-4 py-3 border-t border-white/10">
              <div class="text-[11px] text-cream/40">صفحه ${toPersianDigits(page)} از ${toPersianDigits(totalPages)} — ${formatNumberFa(total)} کد</div>
              <div class="flex items-center gap-1.5">
                <a href="${pageLink(Math.max(1, page - 1))}" class="btn btn-ghost btn-sm ${page <= 1 ? 'opacity-40 pointer-events-none' : ''}">${icon('right', 'w-3.5 h-3.5')} قبلی</a>
                <a href="${pageLink(Math.min(totalPages, page + 1))}" class="btn btn-ghost btn-sm ${page >= totalPages ? 'opacity-40 pointer-events-none' : ''}">بعدی ${icon('left', 'w-3.5 h-3.5')}</a>
              </div>
            </div>`
      }
    </div>
  </div>

  <!-- Create coupon -->
  <div id="coupon-modal" class="hidden modal-backdrop">
    <div class="modal-panel glass-strong rounded-3xl max-w-sm w-full p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-base font-bold">کد تخفیف جدید</h2>
        <button type="button" id="close-coupon" class="w-8 h-8 rounded-lg text-cream/40 hover:text-cream hover:bg-white/5 flex items-center justify-center">${icon('close', 'w-4 h-4')}</button>
      </div>
      <div class="space-y-4">
        <div>
          <label class="label">نوع</label>
          <select id="cp-kind" class="field">
            <option value="percent">درصدی</option>
            <option value="amount">مبلغ ثابت (تومان)</option>
          </select>
        </div>
        <div>
          <label class="label">مقدار</label>
          <input id="cp-value" type="number" class="field text-left" dir="ltr" value="10" min="1" />
        </div>
        <div>
          <label class="label">اعتبار (روز)</label>
          <input id="cp-days" type="number" class="field text-left" dir="ltr" value="30" min="1" max="365" />
        </div>
        <div>
          <label class="label">حداکثر استفاده</label>
          <input id="cp-max" type="number" class="field text-left" dir="ltr" value="1" min="1" max="1000" />
        </div>
        <p class="hint">این کد عمومی است و همه مشتریان می‌توانند از آن استفاده کنند.</p>
        <button type="button" id="create-coupon" class="btn btn-primary w-full">${icon('gift', 'w-4 h-4')} ساخت کد</button>
      </div>
    </div>
  </div>
  `;

  const scripts = `
  (function () {
    var modal = $('#coupon-modal');
    $('#open-coupon').addEventListener('click', function () { modal.classList.remove('hidden'); });
    $('#close-coupon').addEventListener('click', function () { modal.classList.add('hidden'); });
    modal.addEventListener('click', function (event) { if (event.target === modal) modal.classList.add('hidden'); });

    $('#create-coupon').addEventListener('click', async function () {
      var btn = $('#create-coupon');
      setLoading(btn, true, 'در حال ساخت…');
      try {
        var result = await api('/api/admin/coupons', {
          method: 'POST',
          body: {
            userId: null,
            kind: $('#cp-kind').value,
            value: Number($('#cp-value').value),
            days: Number($('#cp-days').value),
            maxUses: Number($('#cp-max').value),
            reason: 'manual'
          }
        });
        toast('کد ' + result.code + ' ساخته شد.', 'success');
        setTimeout(function () { window.location.reload(); }, 1000);
      } catch (error) {
        toast(error.message, 'error');
        setLoading(btn, false);
      }
    });

    document.querySelectorAll('[data-deactivate]').forEach(function (button) {
      button.addEventListener('click', async function () {
        var ok = await confirmAction({ title: 'غیرفعال کردن کد', message: 'این کد دیگر قابل استفاده نخواهد بود.', confirmText: 'غیرفعال کن', danger: true });
        if (!ok) return;
        try {
          await api('/api/admin/coupons/' + button.dataset.deactivate, { method: 'DELETE' });
          toast('کد غیرفعال شد.', 'success');
          setTimeout(function () { window.location.reload(); }, 700);
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });
  })();
  `;

  return appShell({
    title: 'کدهای تخفیف',
    role: 'admin' as Role,
    userName,
    active: 'coupons',
    body,
    scripts,
    cafeName: settings.cafe_name,
  });
}

/* ==========================================================================
 * ۵) کمکی
 * ========================================================================== */

export function couponStateLabel(coupon: CouponRow): string {
  if (coupon.is_active === 0) return 'غیرفعال';
  if (coupon.used_count >= coupon.max_uses) return 'استفاده‌شده';
  return 'فعال';
}
