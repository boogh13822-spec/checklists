/**
 * ----------------------------------------------------------------------------
 *  صفحات عمومی: فرود، ثبت‌نام مشتری و ورود کارمندان/ادمین
 * ----------------------------------------------------------------------------
 */
import type { AppSettings } from '../types';
import {
  escapeHtml,
  formatNumberFa,
  toPersianDigits,
} from '../lib/utils';
import { icon, publicShell, jsonForScript } from './layout';

/* ==========================================================================
 *  صفحه‌ی فرود
 * ========================================================================== */

export function landingPage(settings: AppSettings): string {
  const cafe = escapeHtml(settings.cafe_name);
  const unit = formatNumberFa(settings.currency_unit);
  const ratio = toPersianDigits(settings.points_per_currency);
  const reward = toPersianDigits(settings.referral_reward_points);
  const birthday = toPersianDigits(settings.birthday_coupon_percent);

  const benefits = [
    {
      icon: 'star',
      title: 'با هر خرید امتیاز بگیر',
      desc: `هر ${unit} تومان خرید = ${ratio} امتیاز؛ امتیازها جمع می‌شوند و سطحت را بالا می‌برند.`,
    },
    {
      icon: 'gift',
      title: 'هدیه تولد',
      desc: `در روز تولدت یک کد تخفیف ${birthday} درصدی اختصاصی برایت پیامک می‌شود.`,
    },
    {
      icon: 'users',
      title: 'معرفی دوستان',
      desc: `دوستانت را دعوت کن؛ بعد از اولین خریدشان ${reward} امتیاز هدیه می‌گیری.`,
    },
  ];

  const steps = [
    { n: '۱', t: 'ثبت‌نام' },
    { n: '۲', t: 'خرید' },
    { n: '۳', t: 'امتیاز' },
  ];

  const body = `
  <section class="relative overflow-hidden">
    <div class="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-amber-500/10 blur-3xl pointer-events-none"></div>

    <div class="relative max-w-xl mx-auto px-4 sm:px-6 pt-10 pb-14 sm:pt-16 sm:pb-20">

      <!-- پیام اصلی -->
      <div class="text-center">
        <span class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-cream/50">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          باشگاه مشتریان ${cafe}
        </span>

        <h1 class="mt-6 text-[27px] sm:text-4xl font-black leading-[1.55]">
          هر خرید، <span class="gold-text">امتیاز</span> می‌شود
        </h1>

        <p class="mt-3 text-[13px] sm:text-sm text-cream/55 leading-7 max-w-sm mx-auto">
          عضو باشگاه شو، با هر فاکتور امتیاز بگیر و در روز تولدت هدیه بگیر.
        </p>

        <a href="/register" class="btn btn-primary w-full sm:w-auto !px-10 !py-3.5 mt-7 text-sm">
          ${icon('coffee', 'w-5 h-5')}
          <span>عضویت رایگان</span>
        </a>

        <p class="mt-3 text-[11px] text-cream/35">
          کمتر از یک دقیقه · فقط نام، شماره موبایل و تاریخ تولد
        </p>
      </div>

      <!-- سه مزیت اصلی -->
      <div class="mt-9 rounded-3xl border border-white/10 bg-white/[0.03] divide-y divide-white/10">
        ${benefits
          .map(
            (item) => `<div class="flex items-center gap-3.5 p-4 sm:p-5">
              <div class="w-10 h-10 shrink-0 rounded-2xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">
                ${icon(item.icon, 'w-5 h-5')}
              </div>
              <div class="min-w-0">
                <div class="text-[13px] font-semibold">${item.title}</div>
                <div class="text-[11.5px] text-cream/45 leading-6 mt-0.5">${item.desc}</div>
              </div>
            </div>`
          )
          .join('')}
      </div>

      <!-- سه قدم ساده -->
      <div class="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
        ${steps
          .map(
            (step) => `<div class="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
              <div class="w-7 h-7 mx-auto rounded-full bg-gold/10 text-gold text-[12px] font-bold flex items-center justify-center mb-1.5">${step.n}</div>
              <div class="text-[11.5px] text-cream/60">${step.t}</div>
            </div>`
          )
          .join('')}
      </div>

      <!-- ورود کارمندان -->
      <div class="mt-8 text-center">
        <a href="/login" class="inline-flex items-center gap-1.5 text-[11.5px] text-cream/35 hover:text-gold transition">
          ${icon('shield', 'w-3.5 h-3.5')}
          کارمند یا مدیر کافه هستید؟ ورود به پنل
        </a>
      </div>
    </div>
  </section>
  `;

  return publicShell({ title: 'باشگاه مشتریان', body, cafeName: settings.cafe_name });
}

/* ==========================================================================
 *  صفحه‌ی ثبت‌نام
 * ========================================================================== */

export function registerPage(
  settings: AppSettings,
  presetReferral: string,
  presetPhone: string = ''
): string {
  const cafe = escapeHtml(settings.cafe_name);

  const body = `
  <div class="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
    <div class="grid lg:grid-cols-[1.15fr_.85fr] gap-6 items-start">

      <!-- Form card -->
      <div class="glass rounded-3xl overflow-hidden">
        <div class="px-6 sm:px-8 pt-7 pb-6 border-b border-white/10 bg-gradient-to-l from-amber-900/15 to-transparent">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl gold-bg text-coffee-950 flex items-center justify-center">
              ${icon('userCheck', 'w-5 h-5')}
            </div>
            <div>
              <h1 class="text-lg font-extrabold">عضویت در باشگاه ${cafe}</h1>
              <p class="text-[11.5px] text-cream/45 mt-0.5">فرم زیر را تکمیل کنید؛ عضویت رایگان است.</p>
            </div>
          </div>
        </div>

        <form id="register-form" class="p-6 sm:p-8 space-y-5" novalidate>
          <div>
            <label class="label" for="name">نام و نام خانوادگی <span class="text-rose-400">*</span></label>
            <div class="relative">
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-cream/30">${icon('users', 'w-4 h-4')}</span>
              <input id="name" name="name" type="text" class="field !pr-10" placeholder="مثلاً سارا محمدی" maxlength="60" autocomplete="name" required />
            </div>
          </div>

          <div>
            <label class="label" for="phone">شماره موبایل <span class="text-rose-400">*</span></label>
            <div class="relative">
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-cream/30">${icon('phone', 'w-4 h-4')}</span>
              <input id="phone" name="phone" type="tel" inputmode="numeric" dir="ltr" class="field !pr-10 text-left tracking-wider" placeholder="09xxxxxxxxx" maxlength="13" autocomplete="tel" value="${escapeHtml(presetPhone)}" required />
            </div>
            <p class="hint">همین شماره، شناسه عضویت شما در کافه است.</p>
          </div>

          <div>
            <label class="label">تاریخ تولد <span class="text-rose-400">*</span></label>
            <div class="grid grid-cols-3 gap-2">
              <select id="birth-day" class="field" aria-label="روز"></select>
              <select id="birth-month" class="field" aria-label="ماه">
                ${[
                  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
                  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
                ]
                  .map((m, i) => `<option value="${i + 1}">${m}</option>`)
                  .join('')}
              </select>
              <select id="birth-year" class="field" aria-label="سال"></select>
            </div>
            <p class="hint">تاریخ شمسی — برای ارسال هدیه تولد استفاده می‌شود.</p>
          </div>

          <div>
            <label class="label" for="referral">کد معرف <span class="text-cream/30">(اختیاری)</span></label>
            <div class="relative">
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-cream/30">${icon('gift', 'w-4 h-4')}</span>
              <input id="referral" name="referral" type="text" dir="ltr" class="field !pr-10 text-left tracking-wider" placeholder="REF-XXXXXX" maxlength="30" value="${escapeHtml(presetReferral)}" />
            </div>
            <p class="hint">با وارد کردن کد معرف، او پس از اولین خرید شما ${toPersianDigits(settings.referral_reward_points)} امتیاز هدیه می‌گیرد.</p>
          </div>

          <label class="flex items-start gap-2.5 text-[11.5px] text-cream/50 leading-6 cursor-pointer select-none">
            <input id="terms" type="checkbox" class="mt-1 accent-amber-500 w-4 h-4" />
            <span>با عضویت در باشگاه مشتریان موافقم و می‌دانم اطلاعات شماره موبایل برای ارسال پیامک‌های باشگاه استفاده می‌شود.</span>
          </label>

          <button type="submit" id="submit-btn" class="btn btn-primary w-full !py-3">
            ${icon('sparkles', 'w-5 h-5')}
            <span>ثبت‌نام و دریافت کارت عضویت</span>
          </button>

          <p class="text-center text-[11.5px] text-cream/40">
            قبلاً عضو شده‌اید؟
            <a href="/login" class="text-gold hover:underline">ورود کارمندان</a>
          </p>
        </form>
      </div>

      <!-- Side panel -->
      <div class="space-y-4">
        <div class="glass rounded-3xl p-6">
          <h2 class="font-bold text-sm mb-4 flex items-center gap-2">
            ${icon('gift', 'w-4 h-4 text-gold')}
            با عضویت چه چیزی می‌گیرید؟
          </h2>
          <ul class="space-y-3.5">
            ${[
              `به ازای هر ${formatNumberFa(settings.currency_unit)} تومان خرید، ${toPersianDigits(settings.points_per_currency)} امتیاز`,
              `کد تخفیف ${toPersianDigits(settings.birthday_coupon_percent)} درصدی در روز تولد`,
              `${toPersianDigits(settings.referral_reward_points)} امتیاز پاداش برای هر معرفی موفق`,
              'پیامک وضعیت آب‌وهوا و پیشنهادهای ویژه',
              'ارتقای سطح و مزایای اختصاصی هر سطح',
            ]
              .map(
                (item) => `<li class="flex items-start gap-2.5 text-[12.5px] text-cream/60 leading-6">
                  <span class="w-4 h-4 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0 mt-1">${icon('check', 'w-3 h-3')}</span>
                  <span>${item}</span>
                </li>`
              )
              .join('')}
          </ul>
        </div>

        <div class="rounded-3xl border border-gold/20 bg-gradient-to-br from-amber-900/25 to-transparent p-6">
          <div class="text-3xl mb-3">☕</div>
          <h3 class="font-bold text-sm mb-2">سطح‌های عضویت</h3>
          <div class="space-y-2 text-[11.5px] text-cream/55">
            <div class="flex items-center justify-between"><span>🥉 برنزی</span><span>شروع</span></div>
            <div class="flex items-center justify-between"><span>🥈 نقره‌ای</span><span>${toPersianDigits(settings.tiers.silver)} امتیاز</span></div>
            <div class="flex items-center justify-between"><span>🥇 طلایی</span><span>${toPersianDigits(settings.tiers.gold)} امتیاز</span></div>
            <div class="flex items-center justify-between"><span>💎 الماسی</span><span>${toPersianDigits(settings.tiers.vip)} امتیاز</span></div>
          </div>
        </div>

        <div class="glass rounded-3xl p-5 flex gap-3 items-start">
          <span class="text-gold mt-0.5">${icon('shield', 'w-4 h-4')}</span>
          <p class="text-[11px] text-cream/40 leading-6">
            اطلاعات شما فقط برای مدیریت باشگاه استفاده می‌شود و در اختیار شخص سومی قرار نمی‌گیرد.
          </p>
        </div>
      </div>
    </div>
  </div>

  <!-- Success modal -->
  <div id="success-modal" class="hidden modal-backdrop">
    <div class="modal-panel glass-strong rounded-3xl max-w-md w-full p-6 sm:p-7 relative overflow-hidden">
      <div class="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-emerald-500/10 blur-3xl"></div>
      <div class="text-center relative">
        <div class="w-16 h-16 mx-auto rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-400 flex items-center justify-center mb-4">
          ${icon('check', 'w-7 h-7')}
        </div>
        <h2 class="text-xl font-extrabold mb-1">خوش آمدید! 🎉</h2>
        <p class="text-xs text-cream/50 mb-5">عضویت شما با موفقیت ثبت شد.</p>
      </div>

      <div class="rounded-2xl border border-gold/25 bg-gradient-to-br from-amber-800/25 via-coffee-800/30 to-black/30 p-5 relative overflow-hidden">
        <div class="absolute -right-8 -bottom-8 w-32 h-32 rounded-full bg-gold/10 blur-2xl"></div>
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-lg gold-bg text-coffee-950 flex items-center justify-center">${icon('coffee', 'w-4 h-4')}</div>
            <span class="text-[11px] font-semibold">${cafe}</span>
          </div>
          <span class="badge tone-warning">🥉 برنزی</span>
        </div>
        <div class="text-[10px] text-cream/40 mb-1">نام مشتری</div>
        <div id="s-name" class="font-bold text-sm mb-3">—</div>
        <div class="flex items-center justify-between">
          <div>
            <div class="text-[10px] text-cream/40 mb-1">شماره عضویت</div>
            <div id="s-phone" class="font-mono text-xs tracking-wider" dir="ltr">—</div>
          </div>
          <div class="text-left">
            <div class="text-[10px] text-cream/40 mb-1">امتیاز</div>
            <div id="s-points" class="font-extrabold gold-text text-lg">۰</div>
          </div>
        </div>
        <div class="mt-4 pt-4 border-t border-white/10">
          <div class="text-[10px] text-cream/40 mb-1.5">کد معرف اختصاصی شما</div>
          <div class="flex items-center gap-2">
            <code id="s-referral" class="flex-1 text-xs font-mono tracking-widest bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-center" dir="ltr">—</code>
            <button type="button" id="copy-ref" class="btn btn-ghost btn-sm" title="کپی کد معرف">${icon('copy', 'w-4 h-4')}</button>
          </div>
        </div>
      </div>

      <div class="mt-5 flex items-center gap-2">
        <button type="button" id="copy-link" class="btn btn-ghost flex-1 btn-sm">${icon('copy', 'w-4 h-4')} کپی لینک دعوت</button>
        <button type="button" id="register-again" class="btn btn-primary flex-1 btn-sm">${icon('plus', 'w-4 h-4')} ثبت‌نام بعدی</button>
      </div>
      <a href="/" class="block text-center text-[11px] text-cream/40 hover:text-gold mt-4">بازگشت به صفحه اصلی</a>
    </div>
  </div>
  `;

  const scripts = `
  (function () {
    var daySel = $('#birth-day');
    var monSel = $('#birth-month');
    var yearSel = $('#birth-year');
    var form = $('#register-form');
    var submitBtn = $('#submit-btn');
    var modal = $('#success-modal');
    var lastReferral = '';

    initJalaliPickers(daySel, monSel, yearSel, '', 90);

    function normalizePhone(value) {
      var v = String(value || '').replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); });
      v = v.replace(/[\\s\\-()]/g, '');
      if (v.indexOf('+98') === 0) v = '0' + v.slice(3);
      else if (v.indexOf('0098') === 0) v = '0' + v.slice(4);
      else if (v.indexOf('98') === 0 && v.length === 12) v = '0' + v.slice(2);
      else if (v.indexOf('9') === 0 && v.length === 10) v = '0' + v;
      return v;
    }

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var name = $('#name').value.trim();
      var phone = normalizePhone($('#phone').value);
      var referral = $('#referral').value.trim();
      var terms = $('#terms').checked;

      if (name.length < 2) { toast('نام را کامل وارد کنید.', 'error'); $('#name').focus(); return; }
      if (!/^09\\d{9}$/.test(phone)) { toast('شماره موبایل باید با ۰۹ شروع شده و ۱۱ رقم باشد.', 'error'); $('#phone').focus(); return; }
      if (!terms) { toast('برای ادامه، موافقت با قوانین باشگاه را تیک بزنید.', 'error'); return; }

      var birth = readJalaliPickers(daySel, monSel, yearSel);
      if (!birth) { toast('تاریخ تولد نامعتبر است.', 'error'); return; }

      setLoading(submitBtn, true, 'در حال ثبت…');
      try {
        var data = await api('/api/auth/register', {
          method: 'POST',
          body: { name: name, phone: phone, birth_date: birth, referral: referral }
        });
        lastReferral = data.referralCode;
        $('#s-name').textContent = data.name;
        $('#s-phone').textContent = data.phone;
        $('#s-points').textContent = fa(data.points);
        $('#s-referral').textContent = data.referralCode;
        modal.classList.remove('hidden');
        toast(data.referrerName ? ('ثبت‌نام موفق! معرف شما: ' + data.referrerName) : 'ثبت‌نام با موفقیت انجام شد.', 'success');
        form.reset();
        $('#referral').value = '';
        initJalaliPickers(daySel, monSel, yearSel, '', 90);
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setLoading(submitBtn, false);
      }
    });

    $('#copy-ref').addEventListener('click', function () {
      if (lastReferral) copyText(lastReferral, 'کد معرف کپی شد.');
    });
    $('#copy-link').addEventListener('click', function () {
      var link = window.location.origin + '/register?ref=' + encodeURIComponent(lastReferral);
      copyText(link, 'لینک دعوت کپی شد.');
    });
    $('#register-again').addEventListener('click', function () {
      modal.classList.add('hidden');
      $('#name').focus();
    });
    modal.addEventListener('click', function (event) {
      if (event.target === modal) modal.classList.add('hidden');
    });

    $('#phone').addEventListener('input', function (event) {
      var pos = event.target.selectionStart;
      var normalized = event.target.value.replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); });
      if (normalized !== event.target.value) {
        event.target.value = normalized;
        try { event.target.setSelectionRange(pos, pos); } catch (e) {}
      }
    });
  })();
  `;

  return publicShell({
    title: 'عضویت',
    body,
    scripts,
    cafeName: settings.cafe_name,
  });
}

/* ==========================================================================
 *  صفحه‌ی ورود
 * ========================================================================== */

export function loginPage(settings: AppSettings, next: string): string {
  const cafe = escapeHtml(settings.cafe_name);
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '';

  const body = `
  <div class="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-10">
    <div class="w-full max-w-4xl grid lg:grid-cols-2 rounded-3xl overflow-hidden glass">
      <!-- Art -->
      <div class="hidden lg:flex flex-col justify-between p-8 relative overflow-hidden bg-gradient-to-br from-amber-900/30 via-coffee-900/40 to-black/40 border-e border-white/10">
        <div class="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-gold/10 blur-3xl"></div>
        <div class="relative">
          <div class="w-12 h-12 rounded-2xl gold-bg text-coffee-950 flex items-center justify-center mb-6">
            ${icon('coffee', 'w-6 h-6')}
          </div>
          <h2 class="text-2xl font-extrabold leading-relaxed mb-3">پنل مدیریت<br /><span class="gold-text">باشگاه مشتریان</span></h2>
          <p class="text-xs text-cream/50 leading-7 max-w-xs">
            ثبت فاکتور، مدیریت امتیازها، پیامک‌های خودکار و گزارش‌های فروش — همه در یک جا.
          </p>
        </div>
        <div class="relative space-y-2.5 mt-10">
          ${[
            { icon: 'receipt', text: 'ثبت فاکتور در چند ثانیه' },
            { icon: 'users', text: 'مدیریت کامل مشتریان' },
            { icon: 'chart', text: 'گزارش فروش و ریزش' },
          ]
            .map(
              (item) => `<div class="flex items-center gap-2.5 text-[11.5px] text-cream/55">
                <span class="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-gold">${icon(item.icon, 'w-3.5 h-3.5')}</span>
                ${item.text}
              </div>`
            )
            .join('')}
        </div>
        <div class="relative text-[10px] text-cream/30 mt-8">${cafe} · نسخه ۱.۰</div>
      </div>

      <!-- Form -->
      <div class="p-6 sm:p-9">
        <div class="lg:hidden flex items-center gap-3 mb-7">
          <div class="w-10 h-10 rounded-xl gold-bg text-coffee-950 flex items-center justify-center">${icon('coffee', 'w-5 h-5')}</div>
          <div>
            <div class="font-bold text-sm gold-text">${cafe}</div>
            <div class="text-[10px] text-cream/40">باشگاه مشتریان</div>
          </div>
        </div>

        <div class="mb-7">
          <h1 class="text-xl font-extrabold mb-1.5">ورود به پنل</h1>
          <p class="text-[12px] text-cream/45">شماره موبایل و رمز عبور خود را وارد کنید.</p>
        </div>

        <form id="login-form" class="space-y-4" novalidate>
          <div>
            <label class="label" for="phone">شماره موبایل</label>
            <div class="relative">
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-cream/30">${icon('phone', 'w-4 h-4')}</span>
              <input id="phone" type="tel" inputmode="numeric" dir="ltr" class="field !pr-10 text-left tracking-wider" placeholder="09xxxxxxxxx" maxlength="13" autocomplete="username" required />
            </div>
          </div>
          <div>
            <label class="label" for="password">رمز عبور</label>
            <div class="relative">
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-cream/30">${icon('key', 'w-4 h-4')}</span>
              <input id="password" type="password" class="field !pr-10 !pl-11" placeholder="••••••••" autocomplete="current-password" required />
              <button type="button" id="toggle-pass" class="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-cream/40 hover:text-gold hover:bg-white/5 flex items-center justify-center" aria-label="نمایش رمز">
                ${icon('search', 'w-4 h-4')}
              </button>
            </div>
          </div>

          <button type="submit" id="login-btn" class="btn btn-primary w-full !py-3 mt-2">
            ${icon('logout', 'w-5 h-5')}
            <span>ورود به پنل</span>
          </button>
        </form>

        <div class="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 flex items-start gap-2.5">
          <span class="text-amber-300/80 mt-0.5">${icon('shield', 'w-3.5 h-3.5')}</span>
          <p class="text-[10.5px] text-cream/45 leading-6">
            این بخش مخصوص کارمندان و مدیران باشگاه است. در صورت فراموشی رمز، با مدیر اصلی تماس بگیرید.
          </p>
        </div>

        <p class="text-center text-[11.5px] text-cream/40 mt-6">
          هنوز عضو باشگاه نیستید؟
          <a href="/register" class="text-gold hover:underline">ثبت‌نام مشتری</a>
        </p>
      </div>
    </div>
  </div>
  `;

  const scripts = `
  (function () {
    var form = $('#login-form');
    var btn = $('#login-btn');
    var next = ${jsonForScript(safeNext)};

    $('#toggle-pass').addEventListener('click', function () {
      var input = $('#password');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var phone = $('#phone').value.trim().replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); });
      var password = $('#password').value;
      if (!phone || !password) { toast('شماره موبایل و رمز عبور را وارد کنید.', 'error'); return; }

      setLoading(btn, true, 'در حال ورود…');
      try {
        var data = await api('/api/auth/login', { method: 'POST', body: { phone: phone, password: password } });
        toast('خوش آمدید ' + data.name, 'success');
        var target = next && next.indexOf('/admin') === 0 && data.role === 'admin' ? next
                   : next && next.indexOf('/staff') === 0 && data.role === 'staff' ? next
                   : data.redirect;
        window.location.href = target;
      } catch (error) {
        toast(error.message, 'error');
        setLoading(btn, false);
      }
    });
  })();
  `;

  return publicShell({ title: 'ورود', body, scripts, cafeName: settings.cafe_name });
}
