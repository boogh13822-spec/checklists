/**
 * ----------------------------------------------------------------------------
 *  پنل کارمند: ثبت فاکتور، جستجوی مشتری و تاریخچه
 * ----------------------------------------------------------------------------
 */
import type { AppSettings, InvoiceRow, UserRow } from '../types';
import type { MenuItem } from '../lib/settings';
import {
  describeItems,
  tierLabel,
} from '../lib/db';
import {
  escapeHtml,
  formatJalali,
  formatJalaliDateTime,
  formatMoney,
  formatNumberFa,
  safeJsonParse,
  toPersianDigits,
} from '../lib/utils';
import { appShell, icon, jsonForScript, pageHeader, emptyState } from './layout';

/* ==========================================================================
 *  صفحه‌ی ثبت فاکتور
 * ========================================================================== */

export function staffPage(
  settings: AppSettings,
  user: { name: string },
  menu: MenuItem[],
  todayStats: { count: number; total: number },
  todayInvoices: Array<{ id: number; amount: number; created_at: string; customer_name: string }>,
  isAdmin = false
): string {
  const categories = Array.from(new Set(menu.map((item) => item.category ?? 'سایر')));

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
    ${pageHeader({
      title: 'ثبت فاکتور',
      subtitle: 'شماره مشتری را جستجو کنید، آیتم‌ها را انتخاب و فاکتور را ثبت کنید.',
      iconName: 'receipt',
      actions: `<div class="flex items-center gap-2">
        ${isAdmin ? `<a href="/admin" class="btn btn-ghost btn-sm">${icon('left', 'w-4 h-4')} داشبورد</a>` : ''}
        <div class="glass rounded-2xl px-4 py-2.5 flex items-center gap-4">
        <div class="text-center">
          <div class="text-[10px] text-cream/40">فاکتورهای امروز</div>
          <div class="text-sm font-bold" id="today-count">${toPersianDigits(todayStats.count)}</div>
        </div>
        <div class="w-px h-8 bg-white/10"></div>
        <div class="text-center">
          <div class="text-[10px] text-cream/40">فروش امروز</div>
          <div class="text-sm font-bold gold-text" id="today-total">${formatNumberFa(todayStats.total)}</div>
        </div>
        </div>
      </div>`,
    })}

    <div class="grid xl:grid-cols-[1.6fr_1fr] gap-5 items-start">

      <!-- RIGHT: customer + items -->
      <div class="space-y-5">

        <!-- Customer search -->
        <section class="glass rounded-3xl overflow-hidden">
          <div class="px-5 py-4 border-b border-white/10 flex items-center gap-2">
            <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon('search', 'w-4 h-4')}</span>
            <h2 class="font-bold text-sm">جستجوی مشتری</h2>
            <span class="badge tone-muted me-auto">با شماره موبایل</span>
          </div>

          <div class="p-5">
            <div class="flex gap-2">
              <div class="relative flex-1">
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-cream/30">${icon('phone', 'w-4 h-4')}</span>
                <input id="phone-input" type="tel" inputmode="numeric" dir="ltr" maxlength="13"
                  class="field !pr-10 !py-3 text-left tracking-[.18em] text-base"
                  placeholder="09123456789" autocomplete="off" />
              </div>
              <button type="button" id="search-btn" class="btn btn-primary !px-5">
                ${icon('search', 'w-5 h-5')}
                <span class="hidden sm:inline">جستجو</span>
              </button>
            </div>

            <div id="search-state" class="mt-4"></div>

            <div id="customer-card" class="hidden mt-4">
              <div class="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
                <div class="flex items-start gap-3">
                  <div id="c-avatar" class="w-12 h-12 rounded-2xl gold-bg text-coffee-950 font-extrabold text-lg flex items-center justify-center shrink-0">؟</div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <h3 id="c-name" class="font-bold text-sm">—</h3>
                      <span id="c-tier" class="badge tone-warning">—</span>
                      <span id="c-status" class="badge tone-success">فعال</span>
                    </div>
                    <div id="c-phone" class="text-[11px] text-cream/45 font-mono mt-1" dir="ltr">—</div>

                    <div class="grid grid-cols-3 gap-2 mt-3">
                      <div class="rounded-xl bg-black/20 border border-white/5 px-2.5 py-2">
                        <div class="text-[9.5px] text-cream/40">امتیاز</div>
                        <div id="c-points" class="text-sm font-bold gold-text">۰</div>
                      </div>
                      <div class="rounded-xl bg-black/20 border border-white/5 px-2.5 py-2">
                        <div class="text-[9.5px] text-cream/40">آخرین خرید</div>
                        <div id="c-last" class="text-[11px] font-semibold">—</div>
                      </div>
                      <div class="rounded-xl bg-black/20 border border-white/5 px-2.5 py-2">
                        <div class="text-[9.5px] text-cream/40">میانگین خرید</div>
                        <div id="c-avg" class="text-[11px] font-semibold">—</div>
                      </div>
                    </div>

                    <div id="c-coupons" class="hidden mt-3 flex flex-wrap gap-1.5"></div>
                  </div>
                  <button type="button" id="clear-customer" class="w-8 h-8 rounded-lg text-cream/40 hover:text-rose-300 hover:bg-rose-500/10 flex items-center justify-center shrink-0" title="حذف انتخاب">
                    ${icon('close', 'w-4 h-4')}
                  </button>
                </div>
              </div>
            </div>

            <div id="not-found" class="hidden mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
              <div class="flex items-start gap-3">
                <span class="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-300 flex items-center justify-center shrink-0">${icon('warning', 'w-4 h-4')}</span>
                <div class="flex-1">
                  <div class="text-sm font-semibold mb-0.5">مشتری یافت نشد</div>
                  <p class="text-[11px] text-cream/50 leading-6">این شماره در باشگاه ثبت نشده است. می‌توانید همین حالا عضو کنید.</p>
                </div>
                <button type="button" id="go-register" class="btn btn-primary btn-sm self-center">${icon('plus', 'w-4 h-4')} ثبت‌نام</button>
              </div>
            </div>
          </div>
        </section>

        <!-- Items -->
        <section class="glass rounded-3xl overflow-hidden">
          <div class="px-5 py-4 border-b border-white/10 flex items-center gap-2">
            <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon('coffee', 'w-4 h-4')}</span>
            <h2 class="font-bold text-sm">انتخاب آیتم‌ها</h2>
            <button type="button" id="clear-items" class="me-auto text-[11px] text-cream/40 hover:text-rose-300 transition">پاک کردن</button>
          </div>

          <div class="p-5 space-y-4">
            <div class="flex gap-1.5 overflow-x-auto no-scrollbar pb-1" id="category-tabs">
              <button type="button" data-cat="__all__" class="cat-tab btn btn-sm btn-primary shrink-0">همه</button>
              ${categories
                .map(
                  (cat) =>
                    `<button type="button" data-cat="${escapeHtml(cat)}" class="cat-tab btn btn-sm btn-ghost shrink-0">${escapeHtml(cat)}</button>`
                )
                .join('')}
            </div>

            <div id="menu-grid" class="grid grid-cols-2 sm:grid-cols-3 gap-2.5"></div>

            <div>
              <div class="flex items-center justify-between mb-2">
                <h3 class="text-[12px] font-semibold text-cream/60">آیتم‌های انتخاب‌شده</h3>
                <span id="selected-count" class="text-[11px] text-cream/40">۰ آیتم</span>
              </div>
              <div id="selected-list" class="space-y-2"></div>
              <p id="selected-empty" class="text-[11px] text-cream/35 text-center py-4 border border-dashed border-white/10 rounded-xl">
                هنوز آیتمی انتخاب نشده — یا مبلغ را مستقیم وارد کنید.
              </p>
            </div>
          </div>
        </section>
      </div>

      <!-- LEFT: summary -->
      <div class="xl:sticky xl:top-6 space-y-4">
        <section class="glass rounded-3xl overflow-hidden">
          <div class="px-5 py-4 border-b border-white/10 flex items-center gap-2">
            <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon('wallet', 'w-4 h-4')}</span>
            <h2 class="font-bold text-sm">خلاصه فاکتور</h2>
          </div>

          <div class="p-5 space-y-4">
            <div>
              <label class="label" for="manual-amount">مبلغ دستی <span class="text-cream/30">(اگر آیتم انتخاب نکردید)</span></label>
              <div class="relative">
                <input id="manual-amount" type="text" inputmode="numeric" dir="ltr"
                  class="field text-left !pl-16 font-bold text-lg tracking-wide" placeholder="0" />
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-cream/40">تومان</span>
              </div>
              <p class="hint">با انتخاب آیتم، مبلغ به‌صورت خودکار محاسبه می‌شود.</p>
            </div>

            <div>
              <label class="label" for="coupon-input">کد تخفیف <span class="text-cream/30">(اختیاری)</span></label>
              <div class="flex gap-2">
                <input id="coupon-input" type="text" dir="ltr" class="field text-left tracking-widest uppercase !py-2.5" placeholder="CAFE-XXXXXX" maxlength="30" />
                <button type="button" id="apply-coupon" class="btn btn-ghost btn-sm shrink-0">بررسی</button>
              </div>
              <div id="coupon-result" class="hidden mt-2 text-[11px]"></div>
            </div>

            <div class="rounded-2xl bg-black/25 border border-white/10 p-4 space-y-2.5 text-[12.5px]">
              <div class="flex items-center justify-between text-cream/60">
                <span>جمع اقلام</span>
                <span id="sum-subtotal" class="font-semibold text-cream/90">۰ تومان</span>
              </div>
              <div class="flex items-center justify-between text-emerald-300/80">
                <span>تخفیف</span>
                <span id="sum-discount" class="font-semibold">۰ تومان</span>
              </div>
              <div class="border-t border-white/10 pt-2.5 flex items-center justify-between">
                <span class="font-semibold">مبلغ قابل پرداخت</span>
                <span id="sum-total" class="font-extrabold text-lg gold-text">۰ تومان</span>
              </div>
              <div class="flex items-center justify-between text-[11px] text-cream/40 pt-1">
                <span>امتیاز این فاکتور</span>
                <span id="sum-points" class="font-semibold text-amber-300">+۰</span>
              </div>
            </div>

            <button type="button" id="submit-invoice" class="btn btn-primary w-full !py-3">
              ${icon('check', 'w-5 h-5')}
              <span>ثبت فاکتور</span>
            </button>

            <p class="text-[10.5px] text-cream/35 text-center leading-5">
              امتیاز طبق تنظیمات باشگاه محاسبه و پیامک تأیید برای مشتری ارسال می‌شود.
            </p>
          </div>
        </section>

        <!-- Recent -->
        <section class="glass rounded-3xl overflow-hidden">
          <div class="px-5 py-4 border-b border-white/10 flex items-center gap-2">
            <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon('clock', 'w-4 h-4')}</span>
            <h2 class="font-bold text-sm">آخرین فاکتورهای شما</h2>
          </div>
          <div id="recent-list" class="divide-y divide-white/5">
            ${
              todayInvoices.length === 0
                ? `<p class="text-[11px] text-cream/35 text-center py-6">امروز فاکتوری ثبت نکرده‌اید.</p>`
                : todayInvoices
                    .map(
                      (invoice) => `<div class="px-4 py-3 flex items-center justify-between gap-2">
                        <div class="min-w-0">
                          <div class="text-[12px] font-medium truncate">${escapeHtml(invoice.customer_name)}</div>
                          <div class="text-[10px] text-cream/35">${formatJalaliDateTime(invoice.created_at)}</div>
                        </div>
                        <div class="text-[12px] font-bold text-amber-200 whitespace-nowrap">${formatNumberFa(invoice.amount)}</div>
                      </div>`
                    )
                    .join('')
            }
          </div>
        </section>
      </div>
    </div>
  </div>

  <!-- Receipt modal -->
  <div id="receipt-modal" class="hidden modal-backdrop">
    <div class="modal-panel glass-strong rounded-3xl max-w-sm w-full p-6 text-center relative overflow-hidden">
      <div class="absolute -top-20 left-1/2 -translate-x-1/2 w-56 h-56 rounded-full bg-emerald-500/10 blur-3xl"></div>
      <div class="relative">
        <div class="w-16 h-16 mx-auto rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-400 flex items-center justify-center mb-4">
          ${icon('check', 'w-7 h-7')}
        </div>
        <h2 class="text-lg font-extrabold mb-1">فاکتور ثبت شد</h2>
        <p id="r-customer" class="text-xs text-cream/50 mb-5">—</p>

        <div class="rounded-2xl border border-white/10 bg-black/25 p-4 space-y-2 text-[12.5px] text-right">
          <div class="flex items-center justify-between"><span class="text-cream/50">مبلغ فاکتور</span><span id="r-amount" class="font-bold">—</span></div>
          <div class="flex items-center justify-between"><span class="text-cream/50">امتیاز کسب‌شده</span><span id="r-points" class="font-bold text-emerald-300">—</span></div>
          <div class="flex items-center justify-between"><span class="text-cream/50">موجودی امتیاز</span><span id="r-total" class="font-bold text-amber-300">—</span></div>
          <div class="flex items-center justify-between"><span class="text-cream/50">سطح مشتری</span><span id="r-tier" class="font-bold">—</span></div>
          <div id="r-discount-row" class="hidden flex items-center justify-between"><span class="text-cream/50">تخفیف اعمال‌شده</span><span id="r-discount" class="font-bold text-emerald-300">—</span></div>
        </div>

        <button type="button" id="new-invoice" class="btn btn-primary w-full mt-5">${icon('plus', 'w-4 h-4')} فاکتور بعدی</button>
      </div>
    </div>
  </div>
  `;

  const scripts = `
  (function () {
    var MENU = ${jsonForScript(menu)};
    var POINTS_UNIT = ${Number(settings.currency_unit) || 1000};
    var POINTS_RATIO = ${Number(settings.points_per_currency) || 1};
    var TIER_LABELS = { bronze: 'برنزی', silver: 'نقره‌ای', gold: 'طلایی', vip: 'الماسی' };
    var TIER_CLASSES = { bronze: 'tone-warning', silver: 'tone-muted', gold: 'tone-warning', vip: 'tone-info' };

    var customer = null;
    var selected = {};
    var activeCategory = '__all__';
    var appliedCoupon = null;
    var appliedDiscount = 0;

    var phoneInput = $('#phone-input');
    var menuGrid = $('#menu-grid');
    var selectedList = $('#selected-list');
    var manualInput = $('#manual-amount');

    function normalizePhone(value) {
      var v = String(value || '').replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); });
      v = v.replace(/[\\s\\-()]/g, '');
      if (v.indexOf('+98') === 0) v = '0' + v.slice(3);
      else if (v.indexOf('0098') === 0) v = '0' + v.slice(4);
      else if (v.indexOf('98') === 0 && v.length === 12) v = '0' + v.slice(2);
      else if (v.indexOf('9') === 0 && v.length === 10) v = '0' + v;
      return v;
    }

    function parseAmount(value) {
      var digits = String(value || '').replace(/[^0-9]/g, '');
      return Number(digits) || 0;
    }

    function subtotal() {
      var total = 0;
      Object.keys(selected).forEach(function (name) {
        var item = MENU.find(function (m) { return m.name === name; });
        if (item) total += item.price * selected[name];
      });
      return total;
    }

    function itemCount() {
      return Object.keys(selected).reduce(function (sum, key) { return sum + selected[key]; }, 0);
    }

    function renderMenu() {
      menuGrid.innerHTML = MENU.filter(function (item) {
        return activeCategory === '__all__' || (item.category || 'سایر') === activeCategory;
      }).map(function (item) {
        var qty = selected[item.name] || 0;
        return '<button type="button" data-item="' + escapeHtml(item.name) + '" class="relative text-right rounded-2xl border p-3 transition ' +
          (qty > 0 ? 'border-gold/50 bg-gold/10' : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]') + '">' +
          (qty > 0 ? '<span class="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full gold-bg text-coffee-950 text-[10px] font-extrabold flex items-center justify-center">' + fa(qty) + '</span>' : '') +
          '<div class="text-[12.5px] font-semibold mb-1.5">' + escapeHtml(item.name) + '</div>' +
          '<div class="text-[11px] text-cream/45">' + moneyFa(item.price) + ' تومان</div>' +
        '</button>';
      }).join('');
    }

    function renderSelected() {
      var keys = Object.keys(selected);
      $('#selected-empty').classList.toggle('hidden', keys.length > 0);
      $('#selected-count').textContent = fa(itemCount()) + ' آیتم';

      selectedList.innerHTML = keys.map(function (name) {
        var item = MENU.find(function (m) { return m.name === name; });
        if (!item) return '';
        return '<div class="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">' +
          '<div class="flex-1 min-w-0"><div class="text-[12px] font-medium truncate">' + escapeHtml(name) + '</div>' +
          '<div class="text-[10px] text-cream/40">' + moneyFa(item.price) + ' × ' + fa(selected[name]) + '</div></div>' +
          '<div class="flex items-center gap-1">' +
            '<button type="button" data-dec="' + escapeHtml(name) + '" class="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-cream/70 flex items-center justify-center text-sm">−</button>' +
            '<span class="w-8 text-center text-[12px] font-bold">' + fa(selected[name]) + '</span>' +
            '<button type="button" data-inc="' + escapeHtml(name) + '" class="w-7 h-7 rounded-lg bg-gold/15 hover:bg-gold/25 text-gold flex items-center justify-center text-sm">+</button>' +
          '</div>' +
          '<button type="button" data-rm="' + escapeHtml(name) + '" class="w-7 h-7 rounded-lg text-cream/30 hover:text-rose-300 hover:bg-rose-500/10 flex items-center justify-center">×</button>' +
        '</div>';
      }).join('');
    }

    function refreshTotals() {
      var sub = subtotal();
      var manual = parseAmount(manualInput.value);
      var base = sub > 0 ? sub : manual;
      var discount = 0;

      if (appliedCoupon && appliedCoupon.code) {
        // اگر کد اعمال‌شده با مبلغ جدید همخوان نیست، دوباره بررسی نمی‌کنیم؛ فقط سقف تخفیف را رعایت می‌کنیم
        discount = appliedDiscount;
        if (discount > base) discount = base;
      }

      var total = Math.max(0, base - discount);
      var points = Math.floor(total / POINTS_UNIT) * POINTS_RATIO;

      $('#sum-subtotal').textContent = moneyFa(base) + ' تومان';
      $('#sum-discount').textContent = moneyFa(discount) + ' تومان';
      $('#sum-total').textContent = moneyFa(total) + ' تومان';
      $('#sum-points').textContent = '+' + fa(points);
      manualInput.disabled = sub > 0;
      if (sub > 0) manualInput.value = '';

      return { base: base, discount: discount, total: total, points: points };
    }

    function setCustomer(data) {
      customer = data;
      $('#not-found').classList.add('hidden');
      $('#customer-card').classList.remove('hidden');
      $('#c-avatar').textContent = (data.name || '؟').slice(0, 1);
      $('#c-name').textContent = data.name;
      $('#c-phone').textContent = fa(data.phone);
      $('#c-points').textContent = fa(data.points);
      $('#c-last').textContent = data.last_visit_date ? formatJalaliClient(data.last_visit_date) : 'بدون خرید';
      $('#c-avg').textContent = data.avg_visit_interval > 0 ? fa(Math.round(data.avg_visit_interval)) + ' روز' : '—';
      var tierBadge = $('#c-tier');
      tierBadge.textContent = TIER_LABELS[data.tier] || 'برنزی';
      tierBadge.className = 'badge ' + (TIER_CLASSES[data.tier] || 'tone-muted');
      var status = $('#c-status');
      status.textContent = data.status_label || 'فعال';
      status.className = 'badge ' + (data.status_tone === 'danger' ? 'tone-danger' : data.status_tone === 'warning' ? 'tone-warning' : data.status_tone === 'muted' ? 'tone-muted' : 'tone-success');

      var couponHost = $('#c-coupons');
      if (data.coupons && data.coupons.length > 0) {
        couponHost.classList.remove('hidden');
        couponHost.innerHTML = data.coupons.map(function (c) {
          return '<button type="button" data-coupon="' + escapeHtml(c.code) + '" class="badge tone-info hover:brightness-125 transition" title="اعمال این کد">' +
            '${icon('gift', 'w-3 h-3')}<span class="font-mono" dir="ltr">' + escapeHtml(c.code) + '</span></button>';
        }).join('');
      } else {
        couponHost.classList.add('hidden');
        couponHost.innerHTML = '';
      }
    }

    function clearCustomer() {
      customer = null;
      $('#customer-card').classList.add('hidden');
      $('#not-found').classList.add('hidden');
      $('#search-state').innerHTML = '';
      phoneInput.value = '';
      phoneInput.focus();
    }

    async function searchCustomer() {
      var phone = normalizePhone(phoneInput.value);
      if (!/^09\\d{9}$/.test(phone)) {
        toast('شماره موبایل معتبر وارد کنید (۰۹xxxxxxxxx).', 'error');
        phoneInput.focus();
        return;
      }
      phoneInput.value = phone;
      $('#search-state').innerHTML =
        '<div class="flex items-center gap-2 text-[11px] text-cream/40"><span class="w-4 h-4 rounded-full border-2 border-gold border-t-transparent spin"></span> در حال جستجو…</div>';
      try {
        var data = await api('/api/staff/customer?phone=' + encodeURIComponent(phone));
        $('#search-state').innerHTML = '';
        if (data.found) {
          setCustomer(data.customer);
        } else {
          customer = null;
          $('#customer-card').classList.add('hidden');
          $('#not-found').classList.remove('hidden');
        }
      } catch (error) {
        $('#search-state').innerHTML = '';
        toast(error.message, 'error');
      }
    }

    function resetForm() {
      selected = {};
      appliedCoupon = null;
      appliedDiscount = 0;
      $('#coupon-input').value = '';
      $('#coupon-result').classList.add('hidden');
      manualInput.value = '';
      renderMenu();
      renderSelected();
      refreshTotals();
    }

    // Events
    $('#search-btn').addEventListener('click', searchCustomer);
    phoneInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); searchCustomer(); }
    });
    phoneInput.addEventListener('input', function () {
      var clean = phoneInput.value.replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); });
      if (clean !== phoneInput.value) phoneInput.value = clean;
    });
    $('#clear-customer').addEventListener('click', clearCustomer);
    $('#go-register').addEventListener('click', function () {
      var phone = normalizePhone(phoneInput.value);
      window.location.href = '/register' + (/^09\\d{9}$/.test(phone) ? '?phone=' + encodeURIComponent(phone) : '');
    });

    $('#category-tabs').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-cat]');
      if (!btn) return;
      activeCategory = btn.dataset.cat;
      $$('.cat-tab').forEach(function (tab) {
        tab.className = 'cat-tab btn btn-sm shrink-0 ' + (tab.dataset.cat === activeCategory ? 'btn-primary' : 'btn-ghost');
      });
      renderMenu();
    });

    menuGrid.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-item]');
      if (!btn) return;
      var name = btn.dataset.item;
      selected[name] = (selected[name] || 0) + 1;
      appliedCoupon = null;
      appliedDiscount = 0;
      renderMenu();
      renderSelected();
      refreshTotals();
    });

    selectedList.addEventListener('click', function (event) {
      var inc = event.target.closest('[data-inc]');
      var dec = event.target.closest('[data-dec]');
      var rm = event.target.closest('[data-rm]');
      if (inc) { selected[inc.dataset.inc] += 1; }
      else if (dec) {
        var name = dec.dataset.dec;
        selected[name] -= 1;
        if (selected[name] <= 0) delete selected[name];
      } else if (rm) {
        delete selected[rm.dataset.rm];
      } else return;
      appliedCoupon = null;
      appliedDiscount = 0;
      renderMenu();
      renderSelected();
      refreshTotals();
    });

    $('#clear-items').addEventListener('click', function () {
      selected = {};
      appliedCoupon = null;
      appliedDiscount = 0;
      renderMenu();
      renderSelected();
      refreshTotals();
    });

    manualInput.addEventListener('input', function () {
      var digits = manualInput.value.replace(/[^0-9]/g, '');
      manualInput.value = digits ? money(digits) : '';
      refreshTotals();
    });

    $('#apply-coupon').addEventListener('click', async function () {
      if (!customer) { toast('اول مشتری را جستجو کنید.', 'error'); return; }
      var code = $('#coupon-input').value.trim();
      if (!code) { toast('کد تخفیف را وارد کنید.', 'error'); return; }
      var base = subtotal() || parseAmount(manualInput.value);
      if (base <= 0) { toast('اول مبلغ یا آیتم‌ها را مشخص کنید.', 'error'); return; }

      var btn = $('#apply-coupon');
      setLoading(btn, true, '');
      try {
        var data = await api('/api/staff/coupons/check?code=' + encodeURIComponent(code) +
          '&userId=' + customer.id + '&subtotal=' + base);
        if (!data.valid) {
          appliedCoupon = null;
          appliedDiscount = 0;
          $('#coupon-result').className = 'mt-2 text-[11px] text-rose-300';
          $('#coupon-result').textContent = data.error || 'کد نامعتبر است.';
          $('#coupon-result').classList.remove('hidden');
        } else {
          appliedCoupon = { code: code.toUpperCase() };
          appliedDiscount = data.discount;
          $('#coupon-result').className = 'mt-2 text-[11px] text-emerald-300';
          $('#coupon-result').textContent = 'کد اعمال شد — تخفیف ' + moneyFa(data.discount) + ' تومان';
          $('#coupon-result').classList.remove('hidden');
        }
        refreshTotals();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setLoading(btn, false);
      }
    });

    $('#c-coupons').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-coupon]');
      if (!btn) return;
      $('#coupon-input').value = btn.dataset.coupon;
      $('#apply-coupon').click();
    });

    $('#submit-invoice').addEventListener('click', async function () {
      if (!customer) { toast('ابتدا مشتری را جستجو و انتخاب کنید.', 'error'); phoneInput.focus(); return; }
      var totals = refreshTotals();
      if (totals.base <= 0) { toast('مبلغ فاکتور باید بیشتر از صفر باشد.', 'error'); return; }

      var items = Object.keys(selected).map(function (name) {
        var item = MENU.find(function (m) { return m.name === name; });
        return { name: name, qty: selected[name], price: item ? item.price : 0 };
      });
      var btn = $('#submit-invoice');
      setLoading(btn, true, 'در حال ثبت…');
      try {
        var result = await api('/api/staff/invoices', {
          method: 'POST',
          body: {
            userId: customer.id,
            items: items,
            amount: items.length ? null : totals.base,
            couponCode: appliedCoupon ? appliedCoupon.code : null
          }
        });
        $('#r-customer').textContent = result.customerName;
        $('#r-amount').textContent = moneyFa(result.amount) + ' تومان';
        $('#r-points').textContent = '+' + fa(result.pointsEarned) + ' امتیاز';
        $('#r-total').textContent = fa(result.totalPoints) + ' امتیاز';
        $('#r-tier').textContent = TIER_LABELS[result.tier] || result.tier;
        if (result.discount > 0) {
          $('#r-discount-row').classList.remove('hidden');
          $('#r-discount').textContent = moneyFa(result.discount) + ' تومان';
        } else {
          $('#r-discount-row').classList.add('hidden');
        }
        $('#receipt-modal').classList.remove('hidden');
        toast('فاکتور با موفقیت ثبت شد.', 'success');

        // به‌روزرسانی آمار امروز
        var countEl = $('#today-count');
        var totalEl = $('#today-total');
        countEl.textContent = fa(Number(countEl.textContent.replace(/[^۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); })) + 1);
        var currentTotal = Number(totalEl.textContent.replace(/[^۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); }).replace(/,/g, '')) || 0;
        totalEl.textContent = moneyFa(currentTotal + result.amount);

        var list = $('#recent-list');
        if (list.querySelector('p')) list.innerHTML = '';
        var row = document.createElement('div');
        row.className = 'px-4 py-3 flex items-center justify-between gap-2';
        row.innerHTML = '<div class="min-w-0"><div class="text-[12px] font-medium truncate">' + escapeHtml(result.customerName) + '</div>' +
          '<div class="text-[10px] text-cream/35">همین حالا</div></div>' +
          '<div class="text-[12px] font-bold text-amber-200 whitespace-nowrap">' + moneyFa(result.amount) + '</div>';
        list.prepend(row);
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setLoading(btn, false);
      }
    });

    $('#new-invoice').addEventListener('click', function () {
      $('#receipt-modal').classList.add('hidden');
      resetForm();
      clearCustomer();
    });

    // init
    renderMenu();
    refreshTotals();
    phoneInput.focus();
  })();
  `;

  return appShell({
    title: 'ثبت فاکتور',
    role: 'staff',
    userName: user.name,
    active: 'invoice',
    body,
    scripts,
    cafeName: settings.cafe_name,
  });
}

/* ==========================================================================
 *  صفحه‌ی تاریخچه‌ی فاکتورهای کارمند
 * ========================================================================== */

export function staffHistoryPage(
  settings: AppSettings,
  user: { name: string },
  invoices: Array<
    InvoiceRow & { customer_name: string; customer_phone: string; registered_name: string | null }
  >,
  summary: { count: number; total: number }
): string {
  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
    ${pageHeader({
      title: 'فاکتورهای من',
      subtitle: 'آخرین فاکتورهایی که ثبت کرده‌اید.',
      iconName: 'clock',
      actions: `<a href="/staff" class="btn btn-primary btn-sm">${icon('plus', 'w-4 h-4')} فاکتور جدید</a>`,
    })}

    <div class="grid grid-cols-2 gap-4 mb-6">
      <div class="glass rounded-2xl p-5">
        <div class="flex items-center gap-2 text-[11px] text-cream/45 mb-2">${icon('receipt', 'w-4 h-4 text-gold')} تعداد فاکتورها</div>
        <div class="text-2xl font-extrabold">${toPersianDigits(summary.count)}</div>
      </div>
      <div class="glass rounded-2xl p-5">
        <div class="flex items-center gap-2 text-[11px] text-cream/45 mb-2">${icon('wallet', 'w-4 h-4 text-gold')} مجموع فروش</div>
        <div class="text-2xl font-extrabold gold-text">${formatNumberFa(summary.total)} <span class="text-xs text-cream/40 font-normal">تومان</span></div>
      </div>
    </div>

    <div class="glass rounded-3xl overflow-hidden">
      <div class="px-5 py-4 border-b border-white/10 flex items-center gap-2">
        <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon('receipt', 'w-4 h-4')}</span>
        <h2 class="font-bold text-sm">لیست فاکتورها</h2>
        <span class="badge tone-muted me-auto">${toPersianDigits(invoices.length)} مورد</span>
      </div>
      ${
        invoices.length === 0
          ? emptyState({
              title: 'هنوز فاکتوری ثبت نکرده‌اید',
              message: 'با مراجعه به صفحه ثبت فاکتور می‌توانید اولین فاکتور را ثبت کنید.',
              iconName: 'receipt',
              action: `<a href="/staff" class="btn btn-primary btn-sm">${icon('plus', 'w-4 h-4')} ثبت فاکتور</a>`,
            })
          : `<div class="table-wrap">
              <table class="data">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>مشتری</th>
                    <th>آیتم‌ها</th>
                    <th>مبلغ</th>
                    <th>امتیاز</th>
                    <th>تاریخ</th>
                  </tr>
                </thead>
                <tbody>
                  ${invoices
                    .map(
                      (invoice) => `<tr>
                        <td class="text-cream/35 text-xs">${toPersianDigits(invoice.id)}</td>
                        <td>
                          <div class="font-medium text-[12.5px]">${escapeHtml(invoice.customer_name)}</div>
                          <div class="text-[10.5px] text-cream/35 font-mono" dir="ltr">${escapeHtml(invoice.customer_phone)}</div>
                        </td>
                        <td class="text-[11.5px] text-cream/50 max-w-[220px]">${escapeHtml(describeItems(invoice.items))}</td>
                        <td class="font-bold text-amber-200 whitespace-nowrap text-[12.5px]">${formatNumberFa(invoice.amount)}</td>
                        <td class="text-emerald-300/80 text-[12px]">+${toPersianDigits(invoice.points_earned)}</td>
                        <td class="text-[11px] text-cream/45 whitespace-nowrap">${formatJalaliDateTime(invoice.created_at)}</td>
                      </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
      }
    </div>
  </div>
  `;

  return appShell({
    title: 'فاکتورهای من',
    role: 'staff',
    userName: user.name,
    active: 'history',
    body,
    cafeName: settings.cafe_name,
  });
}

/* ==========================================================================
 *  کمکی: نمایش خلاصه‌ی مشتری (برای API)
 * ========================================================================== */

export function customerSummaryForApi(
  user: UserRow,
  status: { label: string; tone: string },
  coupons: Array<{ code: string; kind: string; value: number }>
): Record<string, unknown> {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    points: user.points,
    tier: user.tier,
    last_visit_date: user.last_visit_date,
    avg_visit_interval: user.avg_visit_interval,
    status_label: status.label,
    status_tone: status.tone,
    tier_label: tierLabel(user.tier),
    coupons: coupons.map((c) => ({
      code: c.code,
      label: c.kind === 'percent' ? `${c.value}٪` : `${formatMoney(c.value)} تومان`,
    })),
  };
}

/** خواندن امن آیتم‌های فاکتور برای نمایش */
export function invoiceItemsSummary(raw: string): string {
  const items = safeJsonParse<Array<{ name: string; qty: number }>>(raw, []);
  if (!Array.isArray(items) || items.length === 0) return '—';
  return items.map((i) => `${i.name} ×${i.qty}`).join('، ');
}

/** تاریخ خوانا برای عنوان صفحه */
export function readableToday(): string {
  return formatJalali(new Date().toISOString().slice(0, 10));
}
