/**
 * ----------------------------------------------------------------------------
 *  صفحات مشتری: ورود با کد پیامکی + باشگاه من
 * ----------------------------------------------------------------------------
 */
import type { AppSettings } from '../types';
import type { CustomerPanelData } from '../lib/db';
import { tierLabel } from '../lib/db';
import {
  escapeHtml,
  formatJalali,
  formatJalaliDateTime,
  formatNumberFa,
  toPersianDigits,
} from '../lib/utils';
import { appShell, emptyState, icon, publicShell } from './layout';

const TIER_EMOJI: Record<string, string> = {
  bronze: '🥉',
  silver: '🥈',
  gold: '🥇',
  vip: '💎',
};

/* ==========================================================================
 *  ورود مشتری (OTP)
 * ========================================================================== */

export function customerLoginPage(
  settings: AppSettings,
  opts: { expired?: boolean; disabled?: boolean } = {}
): string {
  const expired = opts.expired === true;
  const disabled = opts.disabled === true;

  const body = `
  <div class="max-w-md mx-auto px-4 sm:px-6 py-10">
    <div class="glass rounded-3xl p-6 sm:p-7 relative overflow-hidden">
      <div class="absolute -top-16 -left-10 w-40 h-40 rounded-full bg-amber-500/10 blur-3xl pointer-events-none"></div>

      <div class="text-center mb-6 relative">
        <div class="w-14 h-14 mx-auto rounded-2xl gold-bg text-coffee-950 flex items-center justify-center shadow-lg shadow-gold/20 mb-3">
          ${icon('gift', 'w-7 h-7')}
        </div>
        <h1 class="text-xl font-extrabold">باشگاه من</h1>
        <p class="text-[12px] text-cream/50 mt-1.5 leading-6">
          با شماره‌ای که در ${escapeHtml(settings.cafe_name)} ثبت شده وارد شوید؛
          کد ورود برایتان پیامک می‌شود.
        </p>
      </div>

      ${
        expired
          ? '<div class="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-200 text-[11.5px] px-3 py-2.5">نشست شما منقضی شد؛ دوباره وارد شوید.</div>'
          : ''
      }
      ${
        disabled
          ? '<div class="mb-4 rounded-xl border border-rose-500/25 bg-rose-500/10 text-rose-200 text-[11.5px] px-3 py-2.5">ورود پیامکی موقتاً غیرفعال است. لطفاً با پرسنل کافه تماس بگیرید.</div>'
          : ''
      }

      <form id="otp-form" novalidate>
        <div id="step-phone">
          <label class="label" for="phone">شماره موبایل</label>
          <div class="relative">
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-cream/25">${icon('phone', 'w-4 h-4')}</span>
            <input id="phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel"
              class="field !pr-10 text-center tracking-[.12em]" placeholder="۰۹۱۲۳۴۵۶۷۸۹" maxlength="13" />
          </div>
          <button type="submit" id="send-code" class="btn btn-primary w-full mt-4">
            ${icon('send', 'w-4 h-4')}
            <span>دریافت کد ورود</span>
          </button>
        </div>

        <div id="step-code" class="hidden">
          <div class="flex items-center justify-between mb-1.5">
            <label class="label !mb-0" for="code">کد ۶ رقمی پیامک‌شده</label>
            <button type="button" id="change-phone" class="text-[10.5px] text-cream/40 hover:text-gold transition">تغییر شماره</button>
          </div>
          <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"
            class="field text-center tracking-[.5em] !text-[18px] font-bold" placeholder="······" maxlength="6" />
          <button type="submit" id="verify-code" class="btn btn-primary w-full mt-4">
            ${icon('check', 'w-4 h-4')}
            <span>ورود به باشگاه</span>
          </button>
          <div class="flex items-center justify-center gap-1.5 mt-3 text-[11px] text-cream/40">
            <span>کد را دریافت نکردید؟</span>
            <button type="button" id="resend" class="text-gold/80 hover:text-gold transition" disabled>
              ارسال دوباره <span id="resend-timer" class="hidden">(<span id="timer-value">۶۰</span>)</span>
            </button>
          </div>
        </div>

        <p id="otp-message" class="hidden mt-3 text-[11.5px] leading-6 rounded-xl px-3 py-2.5"></p>
      </form>

      <div class="mt-6 pt-4 border-t border-white/10 text-center text-[11px] text-cream/35 leading-6">
        هنوز عضو نیستید؟
        <a href="/register" class="text-gold/80 hover:text-gold">ثبت‌نام در باشگاه</a>
        <span class="mx-1.5 text-cream/20">|</span>
        <a href="/login" class="hover:text-gold transition">ورود پرسنل</a>
      </div>
    </div>
  </div>`;

  const scripts = `
  (function () {
    var phoneInput = $('#phone');
    var codeInput = $('#code');
    var stepPhone = $('#step-phone');
    var stepCode = $('#step-code');
    var msg = $('#otp-message');
    var sendBtn = $('#send-code');
    var verifyBtn = $('#verify-code');
    var resendBtn = $('#resend');
    var resendTimer = $('#resend-timer');
    var timerValue = $('#timer-value');
    var countdown = null;
    var secondsLeft = 0;
    var currentPhone = '';
    var form = $('#otp-form');

    function showMessage(text, tone) {
      msg.textContent = text;
      msg.className = 'mt-3 text-[11.5px] leading-6 rounded-xl px-3 py-2.5 ' +
        (tone === 'error'
          ? 'border border-rose-500/25 bg-rose-500/10 text-rose-200'
          : 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-200');
    }

    function normalizePhone(value) {
      var v = String(value || '').replace(/[۰-۹]/g, function (d) {
        return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
      });
      v = v.replace(/[^0-9+]/g, '');
      if (v.indexOf('+98') === 0) v = '0' + v.slice(3);
      else if (v.indexOf('0098') === 0) v = '0' + v.slice(4);
      else if (v.indexOf('98') === 0 && v.length === 12) v = '0' + v.slice(2);
      else if (v.length === 10 && v.charAt(0) === '9') v = '0' + v;
      return v;
    }

    function startTimer(seconds) {
      secondsLeft = seconds;
      resendBtn.disabled = true;
      resendTimer.classList.remove('hidden');
      timerValue.textContent = fa(secondsLeft);
      if (countdown) clearInterval(countdown);
      countdown = setInterval(function () {
        secondsLeft -= 1;
        if (secondsLeft <= 0) {
          clearInterval(countdown);
          resendBtn.disabled = false;
          resendTimer.classList.add('hidden');
          return;
        }
        timerValue.textContent = fa(secondsLeft);
      }, 1000);
    }

    async function sendCode() {
      var phone = normalizePhone(phoneInput.value);
      if (!/^09\\d{9}$/.test(phone)) {
        showMessage('شماره موبایل باید با ۰۹ شروع شود و ۱۱ رقم باشد.', 'error');
        phoneInput.focus();
        return;
      }
      currentPhone = phone;
      setLoading(sendBtn, true, 'در حال ارسال…');
      try {
        var data = await api('/api/auth/otp/request', { method: 'POST', body: { phone: phone } });
        stepPhone.classList.add('hidden');
        stepCode.classList.remove('hidden');
        codeInput.value = '';
        codeInput.focus();
        showMessage(
          data && data.sent
            ? 'کد ورود پیامک شد. اگر پیامک را نمی‌بینید، پوشه پیامک‌های تبلیغاتی را هم ببینید.'
            : 'اگر این شماره در باشگاه ثبت شده باشد، کد ورود برایتان پیامک می‌شود.'
        );
        startTimer(60);
      } catch (error) {
        showMessage(error.message, 'error');
      } finally {
        setLoading(sendBtn, false);
      }
    }

    async function verifyCode() {
      var code = String(codeInput.value || '').replace(/[۰-۹]/g, function (d) {
        return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
      }).replace(/[^0-9]/g, '');
      if (code.length !== 6) {
        showMessage('کد ۶ رقمی را کامل وارد کنید.', 'error');
        return;
      }
      setLoading(verifyBtn, true, 'در حال بررسی…');
      try {
        await api('/api/auth/otp/verify', {
          method: 'POST',
          body: { phone: currentPhone, code: code }
        });
        toast('خوش آمدید ☕', 'success');
        window.location.href = '/me';
      } catch (error) {
        showMessage(error.message, 'error');
        setLoading(verifyBtn, false);
      }
    }

    phoneInput.addEventListener('input', function () {
      var v = normalizePhone(phoneInput.value);
      phoneInput.value = v ? fa(v) : '';
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (stepCode.classList.contains('hidden')) sendCode();
      else verifyCode();
    });

    resendBtn.addEventListener('click', sendCode);

    $('#change-phone').addEventListener('click', function () {
      stepCode.classList.add('hidden');
      stepPhone.classList.remove('hidden');
      msg.classList.add('hidden');
      if (countdown) clearInterval(countdown);
      phoneInput.focus();
    });
  })();`;

  return publicShell({
    title: 'ورود به باشگاه من',
    body,
    scripts,
    cafeName: settings.cafe_name,
  });
}

/* ==========================================================================
 *  باشگاه من
 * ========================================================================== */

export function customerPanelPage(
  settings: AppSettings,
  data: CustomerPanelData,
  opts: { justRedeemed?: string } = {}
): string {
  const { user } = data;
  const percent = data.nextTier
    ? Math.max(4, Math.min(100, Math.round((data.nextTier.current / data.nextTier.target) * 100)))
    : 100;

  const couponCards = data.activeCoupons
    .map((coupon) => {
      const value =
        coupon.kind === 'percent'
          ? `${toPersianDigits(coupon.value)}٪ تخفیف`
          : `${formatNumberFa(coupon.value)} تومان تخفیف`;
      return `<div class="rounded-2xl border border-gold/20 bg-gold/[0.06] p-4 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="font-mono text-[14px] font-bold tracking-wider text-amber-100" dir="ltr">${escapeHtml(coupon.code)}</div>
          <div class="text-[11px] text-cream/50 mt-1">${value}${coupon.expires_at ? ` — تا ${formatJalali(coupon.expires_at)}` : ''}</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm shrink-0" data-copy="${escapeHtml(coupon.code)}">
          ${icon('copy', 'w-4 h-4')}
          <span>کپی</span>
        </button>
      </div>`;
    })
    .join('');

  const usedCoupons = data.coupons
    .filter((coupon) => !data.activeCoupons.some((active) => active.id === coupon.id))
    .slice(0, 5)
    .map((coupon) => {
      const value =
        coupon.kind === 'percent'
          ? `${toPersianDigits(coupon.value)}٪`
          : `${formatNumberFa(coupon.value)} تومان`;
      const reason =
        coupon.used_count >= coupon.max_uses
          ? 'استفاده‌شده'
          : coupon.is_active !== 1
            ? 'غیرفعال'
            : 'منقضی';
      return `<div class="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/5 last:border-0">
        <span class="font-mono text-[11px] text-cream/35 line-through" dir="ltr">${escapeHtml(coupon.code)}</span>
        <span class="text-[10.5px] text-cream/30">${value} — ${reason}</span>
      </div>`;
    })
    .join('');

  const history = data.invoices
    .map(
      (invoice) => `<div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5 last:border-0">
        <div class="min-w-0">
          <div class="text-[12px] font-medium">${formatNumberFa(invoice.amount)} تومان</div>
          <div class="text-[10px] text-cream/35 mt-0.5">${formatJalaliDateTime(invoice.created_at)}</div>
        </div>
        <div class="text-end shrink-0">
          ${
            invoice.points_earned > 0
              ? `<span class="badge tone-success">+${toPersianDigits(invoice.points_earned)} امتیاز</span>`
              : '<span class="text-[10px] text-cream/25">بدون امتیاز</span>'
          }
          ${
            invoice.discount > 0
              ? `<div class="text-[9.5px] text-emerald-300/60 mt-1">${formatNumberFa(invoice.discount)} تومان تخفیف</div>`
              : ''
          }
        </div>
      </div>`
    )
    .join('');

  const redeemBox =
    settings.redeem_enabled === 1
      ? `<div class="glass rounded-3xl p-5 sm:p-6">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center shrink-0">
              ${icon('gift', 'w-5 h-5')}
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-bold">امتیازت را خرج کن</div>
              <p class="text-[11px] text-cream/45 mt-1 leading-6">
                ${toPersianDigits(settings.redeem_points)} امتیاز را به یک کد تخفیف
                ${formatNumberFa(settings.redeem_value)} تومانی تبدیل کن
                (اعتبار ${toPersianDigits(settings.redeem_expiry_days)} روز).
              </p>
              <button type="button" id="redeem-btn"
                class="btn btn-primary btn-sm mt-3"
                ${user.points < settings.redeem_points ? 'disabled' : ''}>
                ${icon('gift', 'w-4 h-4')}
                <span>${user.points < settings.redeem_points ? `${toPersianDigits(settings.redeem_points - user.points)} امتیاز دیگر لازم داری` : 'دریافت کد تخفیف'}</span>
              </button>
              ${
                opts.justRedeemed
                  ? `<div class="mt-3 text-[11px] text-emerald-300">کد تخفیف ساخته شد: <span class="font-mono" dir="ltr">${escapeHtml(opts.justRedeemed)}</span></div>`
                  : ''
              }
            </div>
          </div>
        </div>`
      : '';

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
    <div class="glass rounded-3xl p-5 sm:p-7 relative overflow-hidden mb-4">
      <div class="absolute -top-20 -left-16 w-56 h-56 rounded-full bg-amber-500/10 blur-3xl pointer-events-none"></div>
      <div class="relative flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div class="text-[11px] text-cream/40">خوش آمدی</div>
          <div class="text-lg font-extrabold mt-0.5">${escapeHtml(user.name)}</div>
          <div class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10.5px] text-cream/60">
            <span>${TIER_EMOJI[user.tier] ?? '🥉'}</span>
            <span>سطح ${tierLabel(user.tier)}</span>
          </div>
        </div>
        <div class="text-end">
          <div class="text-[11px] text-cream/40">موجودی امتیاز</div>
          <div class="text-3xl font-extrabold gold-text leading-tight mt-1">${formatNumberFa(user.points)}</div>
          <div class="text-[10.5px] text-cream/35 mt-1">از مجموع ${formatNumberFa(user.lifetime_points)} امتیاز کسب‌شده</div>
        </div>
      </div>

      ${
        data.nextTier
          ? `<div class="relative mt-5">
              <div class="flex items-center justify-between text-[10.5px] text-cream/45 mb-1.5">
                <span>تا سطح ${data.nextTier.label}</span>
                <span>${formatNumberFa(data.nextTier.need)} امتیاز مانده</span>
              </div>
              <div class="h-2 rounded-full bg-white/10 overflow-hidden">
                <div class="h-full rounded-full gold-bg" style="width:${percent}%"></div>
              </div>
            </div>`
          : '<div class="relative mt-5 text-[11px] text-amber-200/80">🏆 شما در بالاترین سطح باشگاه هستید.</div>'
      }

      <div class="relative grid grid-cols-3 gap-2 mt-5">
        <div class="rounded-2xl bg-black/25 border border-white/5 p-3 text-center">
          <div class="text-[10px] text-cream/35">خریدها</div>
          <div class="text-[15px] font-bold mt-0.5">${formatNumberFa(data.visits)}</div>
        </div>
        <div class="rounded-2xl bg-black/25 border border-white/5 p-3 text-center">
          <div class="text-[10px] text-cream/35">مجموع خرید</div>
          <div class="text-[13px] font-bold mt-0.5">${formatNumberFa(data.totalSpent)}</div>
        </div>
        <div class="rounded-2xl bg-black/25 border border-white/5 p-3 text-center">
          <div class="text-[10px] text-cream/35">دعوت‌شده‌ها</div>
          <div class="text-[15px] font-bold mt-0.5">${formatNumberFa(data.referrals)}</div>
        </div>
      </div>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      ${redeemBox}

      <div class="glass rounded-3xl p-5 sm:p-6" id="referral">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-gold flex items-center justify-center shrink-0">
            ${icon('users', 'w-5 h-5')}
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[13px] font-bold">دعوت دوستان</div>
            <p class="text-[11px] text-cream/45 mt-1 leading-6">
              کد معرفت را به دوستانت بده؛ با اولین خریدشان
              ${toPersianDigits(settings.referral_reward_points)} امتیاز هدیه می‌گیری.
            </p>
            <div class="mt-3 flex items-center gap-2">
              <code class="flex-1 rounded-xl border border-white/10 bg-black/25 px-3 py-2 font-mono text-[12.5px] tracking-wider text-amber-100 text-center" dir="ltr">${escapeHtml(user.referral_code ?? '—')}</code>
              <button type="button" class="btn btn-ghost btn-sm" data-copy="${escapeHtml(user.referral_code ?? '')}">
                ${icon('copy', 'w-4 h-4')}
                <span>کپی</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <section class="mt-4 glass rounded-3xl overflow-hidden" id="coupons">
      <div class="px-5 py-3.5 border-b border-white/10 flex items-center gap-2">
        ${icon('gift', 'w-4 h-4 text-gold')}
        <span class="text-[12.5px] font-bold">کدهای تخفیف من</span>
        <span class="badge tone-muted ms-auto">${formatNumberFa(data.activeCoupons.length)} فعال</span>
      </div>
      <div class="p-4 space-y-2.5">
        ${couponCards || '<p class="text-[11.5px] text-cream/35 text-center py-4">هنوز کد تخفیف فعالی نداری. با امتیازت یکی بساز.</p>'}
        ${usedCoupons ? `<div class="mt-2 rounded-2xl border border-white/5 overflow-hidden">${usedCoupons}</div>` : ''}
      </div>
    </section>

    <section class="mt-4 glass rounded-3xl overflow-hidden" id="history">
      <div class="px-5 py-3.5 border-b border-white/10 flex items-center gap-2">
        ${icon('receipt', 'w-4 h-4 text-gold')}
        <span class="text-[12.5px] font-bold">خریدهای من</span>
      </div>
      ${history || emptyState({ title: 'هنوز خریدی ثبت نشده', message: 'اولین خریدت را انجام بده تا امتیاز بگیری.', iconName: 'receipt' })}
    </section>

    <section class="mt-4 glass rounded-3xl p-5" id="settings">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2.5">
          ${icon('chat', 'w-4 h-4 text-gold')}
          <div>
            <div class="text-[12.5px] font-bold">پیامک‌های تبلیغاتی</div>
            <div class="text-[10.5px] text-cream/40 mt-0.5">پیشنهادهای ویژه، تولد و دلتنگی</div>
          </div>
        </div>
        <label class="inline-flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" id="sms-opt-in" class="w-4 h-4 accent-amber-500" ${user.sms_opt_in === 1 ? 'checked' : ''} />
          <span class="text-[11.5px] text-cream/60">دریافت کنم</span>
        </label>
      </div>
      <p class="text-[10px] text-cream/25 mt-3 leading-5">
        پیامک رسید خرید و کد ورود همیشه ارسال می‌شود؛ این گزینه فقط مربوط به پیامک‌های تبلیغاتی است.
      </p>
    </section>

    <div class="text-center mt-6">
      <button type="button" onclick="logout()" class="text-[11px] text-rose-300/70 hover:text-rose-200 transition">
        خروج از حساب
      </button>
    </div>
  </div>`;

  const scripts = `
  (function () {
    var redeemBtn = $('#redeem-btn');
    if (redeemBtn) {
      redeemBtn.addEventListener('click', async function () {
        if (!confirm('با تبدیل امتیاز، یک کد تخفیف ساخته می‌شود. ادامه می‌دهی؟')) return;
        setLoading(redeemBtn, true, 'در حال ساخت کد…');
        try {
          var data = await api('/api/me/redeem', { method: 'POST' });
          toast('کد تخفیف ساخته شد: ' + data.code, 'success');
          setTimeout(function () { window.location.reload(); }, 1200);
        } catch (error) {
          toast(error.message, 'error');
          setLoading(redeemBtn, false);
        }
      });
    }

    document.querySelectorAll('[data-copy]').forEach(function (button) {
      button.addEventListener('click', function () {
        var code = button.getAttribute('data-copy');
        if (!code) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(function () {
            toast('کپی شد: ' + code, 'success');
          }).catch(function () {
            toast('کپی نشد؛ دستی انتخاب کنید.', 'error');
          });
        } else {
          toast('مرورگر از کپی پشتیبانی نمی‌کند.', 'error');
        }
      });
    });

    var optIn = $('#sms-opt-in');
    if (optIn) {
      optIn.addEventListener('change', async function () {
        var value = optIn.checked ? 1 : 0;
        try {
          await api('/api/me/sms-opt-in', { method: 'POST', body: { optIn: value } });
          toast(value ? 'از این پس پیامک تبلیغاتی می‌گیری.' : 'پیامک تبلیغاتی دیگر ارسال نمی‌شود.', 'success');
        } catch (error) {
          optIn.checked = !optIn.checked;
          toast(error.message, 'error');
        }
      });
    }
  })();`;

  return appShell({
    title: 'باشگاه من',
    role: 'customer',
    userName: user.name,
    active: 'home',
    body,
    scripts,
    cafeName: settings.cafe_name,
  });
}
