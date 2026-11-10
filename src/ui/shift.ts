/**
 * ----------------------------------------------------------------------------
 *  صندوق / شیفت: باز کردن، دریافت و پرداخت نقدی، بستن و گزارش شیفت
 * ----------------------------------------------------------------------------
 */
import type { AppSettings } from '../types';
import type { CashMovementRow, ShiftRow } from '../types';
import { PAYMENT_LABELS } from '../lib/db';
import type { ShiftSummary, ShiftListItem } from '../lib/shifts';
import { formatJalaliDateTime, formatNumberFa, toPersianDigits, escapeHtml } from '../lib/utils';
import { appShell, emptyState, icon, pageHeader } from './layout';

function money(value: number): string {
  return formatNumberFa(Math.max(0, Math.floor(value)) || 0);
}

function summaryRow(label: string, value: string, options: { tone?: string; strong?: boolean } = {}): string {
  return `<div class="flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-0">
    <span class="text-[11.5px] text-cream/50">${label}</span>
    <span class="text-[12.5px] ${options.strong ? 'font-extrabold' : 'font-bold'} ${options.tone ?? 'text-cream'}">${value}</span>
  </div>`;
}

/* ==========================================================================
 * ۱) صفحهٔ صندوق برای کارمند
 * ========================================================================== */

export function staffShiftPage(input: {
  settings: AppSettings;
  userName: string;
  role: 'staff' | 'admin';
  openShift: ShiftRow | null;
  summary: ShiftSummary | null;
  history: ShiftListItem[];
  canViewAll: boolean;
}): string {
  const { settings, userName, role, openShift, summary, history, canViewAll } = input;

  const openCard = openShift
    ? `<div class="glass rounded-3xl p-4 sm:p-5 border border-emerald-500/25">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div>
            <div class="flex items-center gap-2">
              <span class="badge tone-success">${icon('lock', 'w-3 h-3')} باز</span>
              <span class="text-[11px] text-cream/40">شیفت #${toPersianDigits(openShift.id)}</span>
            </div>
            <h2 class="font-bold text-[15px] mt-2">صندوق باز است</h2>
            <p class="text-[10.5px] text-cream/35 mt-1">شروع: ${formatJalaliDateTime(openShift.opened_at)}</p>
          </div>
          <button type="button" id="close-shift" class="btn btn-danger btn-sm whitespace-nowrap">${icon('lock', 'w-3.5 h-3.5')} بستن صندوق</button>
        </div>

        <div class="grid grid-cols-2 gap-2 mb-3">
          <div class="rounded-2xl bg-black/25 border border-white/10 p-3">
            <div class="text-[10px] text-cream/40 mb-1">موجودی اولیه</div>
            <div class="text-[15px] font-extrabold">${money(openShift.opening_cash)}<span class="text-[9.5px] font-normal text-cream/35 ms-1">تومان</span></div>
          </div>
          <div class="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-3">
            <div class="text-[10px] text-emerald-200/70 mb-1">نقدِ موجود (پیش‌بینی)</div>
            <div class="text-[15px] font-extrabold text-emerald-300">${money(summary?.expectedCash ?? openShift.opening_cash)}<span class="text-[9.5px] font-normal text-emerald-200/50 ms-1">تومان</span></div>
          </div>
        </div>

        <div class="rounded-2xl bg-black/25 border border-white/10 px-3.5 py-2">
          ${summaryRow('فروش نقدی', money(summary?.cashSales ?? 0) + ' تومان', { tone: 'text-emerald-300' })}
          ${summaryRow('فروش کارت', money(summary?.cardSales ?? 0) + ' تومان')}
          ${summaryRow('فروش آنلاین', money(summary?.onlineSales ?? 0) + ' تومان')}
          ${summaryRow('تعداد فاکتور', formatNumberFa(summary?.invoiceCount ?? 0))}
          ${summaryRow('ورود نقد', '+' + money(summary?.movementsIn ?? 0))}
          ${summaryRow('خروج نقد', '−' + money(summary?.movementsOut ?? 0))}
          ${summaryRow('ابطال‌شده در این شیفت', formatNumberFa(summary?.voidCount ?? 0) + ' فاکتور', {
            tone: 'text-rose-300',
          })}
        </div>

        <div class="grid sm:grid-cols-2 gap-2 mt-3">
          <button type="button" data-move="in" class="btn btn-ghost btn-sm">${icon('plus', 'w-3.5 h-3.5')} ورود نقد</button>
          <button type="button" data-move="out" class="btn btn-ghost btn-sm">${icon('close', 'w-3.5 h-3.5')} خروج نقد</button>
        </div>
      </div>`
    : `<div class="glass rounded-3xl p-4 sm:p-5 border border-amber-500/25">
        <div class="flex items-center gap-2 mb-2">
          <span class="badge tone-warning">${icon('lock', 'w-3 h-3')} بسته</span>
          <span class="text-[11px] text-cream/40">صندوق بسته است</span>
        </div>
        <h2 class="font-bold text-[15px]">باز کردن صندوق</h2>
        <p class="text-[10.5px] text-cream/35 mt-1 mb-3">موجودی نقدی ابتدای شیفت را وارد کنید. مبلغ اولیه صفر هم مجاز است.</p>

        <label class="label" for="opening-cash">موجودی اولیه صندوق (تومان)</label>
        <div class="relative">
          <input id="opening-cash" type="text" inputmode="numeric" dir="ltr" class="field text-left !pl-16 font-bold" placeholder="0" />
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-cream/40">تومان</span>
        </div>
        <div class="flex flex-wrap gap-1.5 mt-2">
          ${[0, 200000, 500000, 1000000]
            .map(
              (amount) =>
                `<button type="button" data-opening="${amount}" class="badge tone-muted hover:!text-gold">${
                  amount === 0 ? 'صفر' : money(amount)
                }</button>`
            )
            .join('')}
        </div>
        <button type="button" id="open-shift" class="btn btn-primary w-full mt-3">${icon('lock', 'w-4 h-4')} باز کردن صندوق</button>
        ${
          settings.require_shift === 1
            ? `<p class="text-[10px] text-amber-200/70 mt-2 leading-5">تا وقتی صندوق بسته است، ثبت پرداخت نقدی ممکن نیست.</p>`
            : `<p class="text-[10px] text-cream/30 mt-2 leading-5">صندوق برای تفکیک گزارش‌ها و کنترل نقد استفاده می‌شود؛ اختیاری است.</p>`
        }
      </div>`;

  const historyRows = history.length
    ? history
        .map((shift) => {
          const diff =
            shift.counted_cash === null || shift.counted_cash === undefined ? null : shift.counted_cash - shift.expected_live;
          return `<tr>
            <td class="text-[11px] text-cream/35">${toPersianDigits(shift.id)}</td>
            <td class="whitespace-nowrap">${
              shift.status === 'open'
                ? '<span class="badge tone-success">باز</span>'
                : '<span class="badge tone-muted">بسته</span>'
            }</td>
            <td class="text-[10.5px] text-cream/45 whitespace-nowrap">${formatJalaliDateTime(shift.opened_at)}</td>
            <td class="text-[10.5px] text-cream/45 whitespace-nowrap">${shift.closed_at ? formatJalaliDateTime(shift.closed_at) : '—'}</td>
            <td class="text-[11.5px] whitespace-nowrap">${money(shift.opening_cash)}</td>
            <td class="text-[11.5px] font-bold whitespace-nowrap">${money(shift.expected_live)}</td>
            <td class="text-[11.5px] whitespace-nowrap">${shift.counted_cash === null ? '—' : money(shift.counted_cash)}</td>
            <td class="whitespace-nowrap">${
              diff === null
                ? '—'
                : `<span class="${diff === 0 ? 'text-cream/50' : diff > 0 ? 'text-sky-300' : 'text-rose-300'} font-bold text-[11.5px]">${
                    diff > 0 ? '+' : ''
                  }${money(diff)}</span>`
            }</td>
          </tr>`;
        })
        .join('')
    : '';

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
    ${pageHeader({
      title: 'صندوق و شیفت',
      subtitle: 'کنترل نقد، دریافت و پرداخت و بستن صندوق',
      iconName: 'wallet',
      actions: `<a href="/staff" class="btn btn-ghost btn-sm">${icon('receipt', 'w-4 h-4')} ثبت فاکتور</a>`,
    })}

    <div class="grid lg:grid-cols-[1fr_1.15fr] gap-4 items-start">
      ${openCard}

      <div class="glass rounded-3xl p-4 sm:p-5">
        <div class="flex items-center justify-between gap-2 mb-3">
          <h2 class="font-bold text-[14px]">${canViewAll ? 'شیفت‌های اخیر (همهٔ کارکنان)' : 'شیفت‌های اخیر من'}</h2>
          ${canViewAll ? `<a href="/admin/shifts" class="text-[11px] text-gold/80 hover:underline">گزارش کامل</a>` : ''}
        </div>
        ${
          history.length === 0
            ? emptyState({ title: 'شیفتی ثبت نشده', message: 'با باز کردن صندوق، اولین شیفت شما ساخته می‌شود.', iconName: 'wallet' })
            : `<div class="table-wrap">
                <table class="data">
                  <thead><tr><th>#</th><th>وضعیت</th><th>شروع</th><th>پایان</th><th>اولیه</th><th>نقد مورد انتظار</th><th>شمارش‌شده</th><th>اختلاف</th></tr></thead>
                  <tbody>${historyRows}</tbody>
                </table>
              </div>`
        }
      </div>
    </div>
  </div>

  <!-- پنجرهٔ دریافت/پرداخت نقد -->
  <div id="move-modal" class="hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
    <div class="glass rounded-3xl max-w-sm mx-auto mt-20 p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-[15px]" id="move-title">ورود نقد</h3>
        <button type="button" id="move-cancel" class="btn btn-ghost btn-sm">${icon('close', 'w-4 h-4')}</button>
      </div>
      <label class="label" for="move-amount">مبلغ (تومان)</label>
      <input id="move-amount" type="text" inputmode="numeric" dir="ltr" class="field text-left font-bold" placeholder="0" />
      <label class="label mt-2" for="move-note">توضیح</label>
      <input id="move-note" type="text" class="field" maxlength="80" placeholder="مثلاً: خرید یخ، واریز به صندوق" />
      <div class="flex gap-2 mt-4">
        <button type="button" id="move-confirm" class="btn btn-primary flex-1">ثبت</button>
        <button type="button" id="move-close" class="btn btn-ghost flex-1">انصراف</button>
      </div>
    </div>
  </div>

  <!-- پنجرهٔ بستن صندوق -->
  <div id="close-modal" class="hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
    <div class="glass rounded-3xl max-w-md mx-auto mt-16 p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-[15px]">بستن صندوق</h3>
        <button type="button" id="close-cancel" class="btn btn-ghost btn-sm">${icon('close', 'w-4 h-4')}</button>
      </div>

      <div class="rounded-2xl bg-black/25 border border-white/10 p-3 mb-3">
        ${summaryRow('موجودی اولیه', money(openShift?.opening_cash ?? 0))}
        ${summaryRow('فروش نقدی', money(summary?.cashSales ?? 0))}
        ${summaryRow('ورود نقد', '+' + money(summary?.movementsIn ?? 0))}
        ${summaryRow('خروج نقد', '−' + money(summary?.movementsOut ?? 0))}
        ${summaryRow('نقد مورد انتظار', money(summary?.expectedCash ?? 0) + ' تومان', { tone: 'text-emerald-300', strong: true })}
      </div>

      <label class="label" for="counted-cash">نقد شمارش‌شده در صندوق (تومان)</label>
      <input id="counted-cash" type="text" inputmode="numeric" dir="ltr" class="field text-left font-bold" placeholder="0" />

      <div class="mt-2 flex items-center justify-between rounded-xl border border-white/10 bg-black/25 px-3 py-2">
        <span class="text-[11px] text-cream/50">اختلاف</span>
        <span id="diff-preview" class="text-[12.5px] font-bold text-cream/40">—</span>
      </div>

      <label class="label mt-2" for="close-note">توضیح (اختیاری)</label>
      <textarea id="close-note" class="field min-h-[64px] text-[12px]" maxlength="200" placeholder="دلیل اختلاف، توضیح تحویل صندوق…"></textarea>

      <div class="flex gap-2 mt-4">
        <button type="button" id="close-confirm" class="btn btn-danger flex-1">${icon('lock', 'w-4 h-4')} بستن و ثبت</button>
        <button type="button" id="close-close" class="btn btn-ghost flex-1">انصراف</button>
      </div>
      <p class="text-[10px] text-cream/30 mt-2 leading-5">پس از بستن، این شیفت قابل بازگشایی نیست و فاکتورهای نقدی جدید در شیفت بعدی ثبت می‌شوند.</p>
    </div>
  </div>
  `;

  const scripts = `
    var OPEN_SHIFT_ID = ${openShift ? String(openShift.id) : 'null'};
    var EXPECTED = ${summary ? String(summary.expectedCash) : '0'};
    var moveKind = 'in';

    var moveModal = $('#move-modal');
    var closeModal = $('#close-modal');

    function openMove(kind) {
      moveKind = kind;
      $('#move-title').textContent = kind === 'in' ? 'ورود نقد به صندوق' : 'خروج نقد از صندوق';
      $('#move-amount').value = '';
      $('#move-note').value = '';
      moveModal.classList.remove('hidden');
      $('#move-amount').focus();
    }

    document.querySelectorAll('[data-move]').forEach(function (button) {
      button.addEventListener('click', function () { openMove(button.getAttribute('data-move')); });
    });

    $('#move-cancel').addEventListener('click', function () { moveModal.classList.add('hidden'); });
    $('#move-close').addEventListener('click', function () { moveModal.classList.add('hidden'); });
    moveModal.addEventListener('click', function (event) { if (event.target === moveModal) moveModal.classList.add('hidden'); });

    $('#move-amount').addEventListener('input', function () {
      var digits = this.value.replace(/[^0-9]/g, '');
      this.value = digits ? money(digits) : '';
    });

    $('#move-confirm').addEventListener('click', async function () {
      if (!OPEN_SHIFT_ID) return;
      var amount = Number($('#move-amount').value.replace(/[^0-9]/g, '')) || 0;
      if (amount <= 0) { toast('مبلغ را وارد کنید.', 'error'); return; }

      var button = this;
      setLoading(button, true, 'در حال ثبت…');
      try {
        var result = await api('/api/staff/shift/movements', {
          method: 'POST',
          body: { kind: moveKind, amount: amount, note: $('#move-note').value.trim() }
        });
        toast(moveKind === 'in' ? 'ورود نقد ثبت شد.' : 'خروج نقد ثبت شد.', 'success');
        setTimeout(function () { location.reload(); }, 600);
      } catch (error) {
        toast(error.message, 'error');
        setLoading(button, false);
      }
    });

    // --- باز کردن صندوق ---
    var opening = $('#opening-cash');
    if (opening) {
      opening.addEventListener('input', function () {
        var digits = this.value.replace(/[^0-9]/g, '');
        this.value = digits ? money(digits) : '';
      });
      document.querySelectorAll('[data-opening]').forEach(function (chip) {
        chip.addEventListener('click', function () {
          var value = chip.getAttribute('data-opening');
          opening.value = Number(value) === 0 ? '' : money(Number(value));
        });
      });
      $('#open-shift').addEventListener('click', async function () {
        var amount = Number(opening.value.replace(/[^0-9]/g, '')) || 0;
        var button = this;
        setLoading(button, true, 'در حال باز کردن…');
        try {
          await api('/api/staff/shift/open', { method: 'POST', body: { openingCash: amount } });
          toast('صندوق باز شد.', 'success');
          setTimeout(function () { location.reload(); }, 500);
        } catch (error) {
          toast(error.message, 'error');
          setLoading(button, false);
        }
      });
    }

    // --- بستن صندوق ---
    if (OPEN_SHIFT_ID) {
      $('#close-shift').addEventListener('click', function () {
        $('#counted-cash').value = EXPECTED ? money(EXPECTED) : '';
        updateDiff();
        closeModal.classList.remove('hidden');
        $('#counted-cash').focus();
        $('#counted-cash').select();
      });

      $('#close-cancel').addEventListener('click', function () { closeModal.classList.add('hidden'); });
      $('#close-close').addEventListener('click', function () { closeModal.classList.add('hidden'); });
      closeModal.addEventListener('click', function (event) { if (event.target === closeModal) closeModal.classList.add('hidden'); });

      function updateDiff() {
        var counted = Number($('#counted-cash').value.replace(/[^0-9]/g, '')) || 0;
        var diff = counted - EXPECTED;
        var el = $('#diff-preview');
        el.textContent = (diff > 0 ? '+' : '') + money(diff) + ' تومان';
        el.className = 'text-[12.5px] font-bold ' +
          (diff === 0 ? 'text-emerald-300' : diff > 0 ? 'text-sky-300' : 'text-rose-300');
      }

      $('#counted-cash').addEventListener('input', function () {
        var digits = this.value.replace(/[^0-9]/g, '');
        this.value = digits ? money(digits) : '';
        updateDiff();
      });

      $('#close-confirm').addEventListener('click', async function () {
        var counted = Number($('#counted-cash').value.replace(/[^0-9]/g, '')) || 0;
        var button = this;
        setLoading(button, true, 'در حال بستن…');
        try {
          await api('/api/staff/shift/close', {
            method: 'POST',
            body: { countedCash: counted, note: $('#close-note').value.trim() }
          });
          toast('صندوق بسته شد.', 'success');
          setTimeout(function () { location.reload(); }, 600);
        } catch (error) {
          toast(error.message, 'error');
          setLoading(button, false);
        }
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      moveModal.classList.add('hidden');
      closeModal.classList.add('hidden');
    });
  `;

  return appShell({
    title: 'صندوق',
    role: role === 'admin' ? 'admin' : 'staff',
    userName,
    active: 'shift',
    body,
    scripts,
    cafeName: settings.cafe_name,
  });
}

/* ==========================================================================
 * ۲) گزارش شیفت‌ها برای مدیر
 * ========================================================================== */

export function adminShiftsPage(input: {
  settings: AppSettings;
  userName: string;
  shifts: ShiftListItem[];
  total: number;
  page: number;
  pageSize: number;
  filters: { from: string; to: string; staffId: number | null; status: string };
  staffOptions: Array<{ id: number; name: string }>;
  openShifts: ShiftRow[];
}): string {
  const { settings, userName, shifts, total, page, pageSize, filters, staffOptions, openShifts } = input;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const totals = shifts.reduce(
    (acc, shift) => {
      acc.expected += shift.expected_live;
      acc.counted += shift.counted_cash ?? 0;
      acc.diff += shift.counted_cash === null ? 0 : shift.counted_cash - shift.expected_live;
      return acc;
    },
    { expected: 0, counted: 0, diff: 0 }
  );

  const pageLink = (target: number): string => {
    const search = new URLSearchParams();
    if (filters.from) search.set('from', filters.from);
    if (filters.to) search.set('to', filters.to);
    if (filters.staffId) search.set('staff', String(filters.staffId));
    if (filters.status && filters.status !== 'all') search.set('status', filters.status);
    search.set('page', String(target));
    return `/admin/shifts?${search.toString()}`;
  };

  const rows = shifts
    .map((shift) => {
      const difference =
        shift.counted_cash === null || shift.counted_cash === undefined ? null : shift.counted_cash - shift.expected_live;
      return `<tr>
        <td class="text-[11px] text-cream/35">${toPersianDigits(shift.id)}</td>
        <td class="text-[12px] whitespace-nowrap">${escapeHtml(shift.staff_name)}</td>
        <td class="whitespace-nowrap">${
          shift.status === 'open' ? '<span class="badge tone-success">باز</span>' : '<span class="badge tone-muted">بسته</span>'
        }</td>
        <td class="text-[10.5px] text-cream/45 whitespace-nowrap">${formatJalaliDateTime(shift.opened_at)}</td>
        <td class="text-[10.5px] text-cream/45 whitespace-nowrap">${shift.closed_at ? formatJalaliDateTime(shift.closed_at) : '—'}</td>
        <td class="text-[11.5px] whitespace-nowrap">${money(shift.opening_cash)}</td>
        <td class="text-[11.5px] whitespace-nowrap">${formatNumberFa(shift.invoice_count)}</td>
        <td class="text-[11.5px] whitespace-nowrap">${money(shift.total_sales ?? 0)}</td>
        <td class="text-[11.5px] font-bold whitespace-nowrap">${money(shift.expected_live)}</td>
        <td class="text-[11.5px] whitespace-nowrap">${shift.counted_cash === null ? '—' : money(shift.counted_cash)}</td>
        <td class="whitespace-nowrap">${
          difference === null
            ? '—'
            : `<span class="${difference === 0 ? 'text-cream/50' : difference > 0 ? 'text-sky-300' : 'text-rose-300'} font-bold text-[11.5px]">${
                difference > 0 ? '+' : ''
              }${money(difference)}</span>`
        }</td>
        <td class="text-left"><a href="/admin/shifts/${shift.id}" class="btn btn-ghost btn-sm">${icon('eye', 'w-3.5 h-3.5')} جزئیات</a></td>
      </tr>`;
    })
    .join('');

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
    ${pageHeader({
      title: 'صندوق‌ها و شیفت‌ها',
      subtitle: 'کنترل نقد، اختلاف شمارش و عملکرد هر شیفت',
      iconName: 'wallet',
      actions: `<a href="/staff/shift" class="btn btn-primary btn-sm">${icon('plus', 'w-4 h-4')} صندوق من</a>`,
    })}

    ${
      openShifts.length > 0
        ? `<div class="glass rounded-2xl p-3.5 mb-4 border border-emerald-500/25">
            <div class="flex items-center gap-2 mb-2">
              <span class="badge tone-success">${icon('lock', 'w-3 h-3')} ${formatNumberFa(openShifts.length)} صندوق باز</span>
              <span class="text-[10.5px] text-cream/40">در حال حاضر</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${openShifts
                .map(
                  (shift) =>
                    `<a href="/admin/shifts/${shift.id}" class="badge tone-muted hover:!text-gold">${escapeHtml(shift.staff_name)} · از ${formatJalaliDateTime(shift.opened_at)}</a>`
                )
                .join('')}
            </div>
          </div>`
        : ''
    }

    <div class="grid grid-cols-3 gap-3 mb-4">
      <div class="glass rounded-2xl p-4">
        <div class="text-[10.5px] text-cream/45 mb-1">نقد مورد انتظار (این صفحه)</div>
        <div class="text-[15px] font-extrabold text-emerald-300">${money(totals.expected)}</div>
      </div>
      <div class="glass rounded-2xl p-4">
        <div class="text-[10.5px] text-cream/45 mb-1">شمارش‌شده</div>
        <div class="text-[15px] font-extrabold">${money(totals.counted)}</div>
      </div>
      <div class="glass rounded-2xl p-4">
        <div class="text-[10.5px] text-cream/45 mb-1">اختلاف کل</div>
        <div class="text-[15px] font-extrabold ${totals.diff === 0 ? 'text-cream/60' : totals.diff > 0 ? 'text-sky-300' : 'text-rose-300'}">
          ${totals.diff > 0 ? '+' : ''}${money(totals.diff)}
        </div>
      </div>
    </div>

    <form method="get" action="/admin/shifts" class="glass rounded-2xl p-4 mb-4">
      <div class="grid sm:grid-cols-4 gap-2.5">
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] text-cream/35 shrink-0">از</span>
          <select id="from-day" class="field !w-auto !px-2 !py-1.5 text-[11px]"></select>
          <select id="from-month" class="field !w-auto !px-2 !py-1.5 text-[11px]"></select>
          <select id="from-year" class="field !w-auto !px-2 !py-1.5 text-[11px]"></select>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] text-cream/35 shrink-0">تا</span>
          <select id="to-day" class="field !w-auto !px-2 !py-1.5 text-[11px]"></select>
          <select id="to-month" class="field !w-auto !px-2 !py-1.5 text-[11px]"></select>
          <select id="to-year" class="field !w-auto !px-2 !py-1.5 text-[11px]"></select>
        </div>
        <select name="staff" class="field !py-2 text-[12px]">
          <option value="">همهٔ کارکنان</option>
          ${staffOptions
            .map(
              (member) =>
                `<option value="${member.id}" ${filters.staffId === member.id ? 'selected' : ''}>${escapeHtml(member.name)}</option>`
            )
            .join('')}
        </select>
        <div class="flex gap-2">
          <select name="status" class="field !py-2 text-[12px] flex-1">
            <option value="all" ${filters.status === 'all' ? 'selected' : ''}>همه</option>
            <option value="open" ${filters.status === 'open' ? 'selected' : ''}>باز</option>
            <option value="closed" ${filters.status === 'closed' ? 'selected' : ''}>بسته</option>
          </select>
          <button type="submit" class="btn btn-primary btn-sm">${icon('filter', 'w-4 h-4')} فیلتر</button>
        </div>
      </div>
      <input type="hidden" name="from" id="from-iso" value="${escapeHtml(filters.from)}" />
      <input type="hidden" name="to" id="to-iso" value="${escapeHtml(filters.to)}" />
    </form>

    <div class="glass rounded-3xl overflow-hidden">
      ${
        shifts.length === 0
          ? emptyState({ title: 'شیفتی یافت نشد', message: 'با تغییر فیلترها دوباره تلاش کنید.', iconName: 'wallet' })
          : `<div class="table-wrap">
              <table class="data">
                <thead><tr><th>#</th><th>کارمند</th><th>وضعیت</th><th>شروع</th><th>پایان</th><th>اولیه</th><th>فاکتور</th><th>فروش</th><th>نقد مورد انتظار</th><th>شمارش</th><th>اختلاف</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            <div class="flex items-center justify-between gap-3 px-4 py-3 border-t border-white/10">
              <div class="text-[11px] text-cream/40">صفحه ${toPersianDigits(page)} از ${toPersianDigits(totalPages)} · ${formatNumberFa(total)} شیفت</div>
              <div class="flex items-center gap-1.5">
                <a href="${pageLink(Math.max(1, page - 1))}" class="btn btn-ghost btn-sm ${page <= 1 ? 'opacity-40 pointer-events-none' : ''}">${icon('right', 'w-3.5 h-3.5')} قبلی</a>
                <a href="${pageLink(Math.min(totalPages, page + 1))}" class="btn btn-ghost btn-sm ${page >= totalPages ? 'opacity-40 pointer-events-none' : ''}">بعدی ${icon('left', 'w-3.5 h-3.5')}</a>
              </div>
            </div>`
      }
    </div>
  </div>
  `;

  const scripts = `
    initJalaliRange($('#from-day'), $('#from-month'), $('#from-year'), ${JSON.stringify(filters.from)}, 8);
    initJalaliRange($('#to-day'), $('#to-month'), $('#to-year'), ${JSON.stringify(filters.to)}, 8);
    document.querySelector('form').addEventListener('submit', function () {
      var from = readJalaliRange($('#from-day'), $('#from-month'), $('#from-year'));
      var to = readJalaliRange($('#to-day'), $('#to-month'), $('#to-year'));
      $('#from-iso').value = from.iso || '';
      $('#to-iso').value = to.iso || '';
    });
  `;

  return appShell({
    title: 'صندوق‌ها',
    role: 'admin' as const,
    userName,
    active: 'shifts',
    body,
    scripts,
    cafeName: settings.cafe_name,
  });
}

/* ==========================================================================
 * ۳) جزئیات یک شیفت (مدیر)
 * ========================================================================== */

export function adminShiftDetailPage(input: {
  settings: AppSettings;
  userName: string;
  shift: ShiftRow;
  summary: ShiftSummary;
  movements: CashMovementRow[];
  invoices: Array<{
    id: number;
    amount: number;
    payment_method: string | null;
    created_at: string;
    voided_at: string | null;
    customer_name: string;
    customer_phone: string;
  }>;
}): string {
  const { settings, userName, shift, summary, movements, invoices } = input;
  const difference = summary.difference;
  const isOpen = shift.status === 'open';

  const movementRows = movements.length
    ? movements
        .map(
          (movement) => `<tr>
            <td class="text-[10.5px] text-cream/45 whitespace-nowrap">${formatJalaliDateTime(movement.created_at)}</td>
            <td>${
              movement.kind === 'in'
                ? '<span class="badge tone-success">ورود</span>'
                : '<span class="badge tone-danger">خروج</span>'
            }</td>
            <td class="text-[11.5px] font-bold whitespace-nowrap ${movement.kind === 'in' ? 'text-emerald-300' : 'text-rose-300'}">${
              movement.kind === 'in' ? '+' : '−'
            }${money(movement.amount)}</td>
            <td class="text-[11px] text-cream/50">${escapeHtml(movement.reason ?? '—')}</td>
            <td class="text-[10.5px] text-cream/35">${movement.created_by ? '#' + toPersianDigits(movement.created_by) : '—'}</td>
          </tr>`
        )
        .join('')
    : '';

  const invoiceRows = invoices.length
    ? invoices
        .map(
          (invoice) => `<tr class="${invoice.voided_at ? 'opacity-45' : ''}">
            <td class="text-[11px] text-cream/35">${toPersianDigits(invoice.id)}</td>
            <td class="text-[12px] whitespace-nowrap">${escapeHtml(invoice.customer_name)}</td>
            <td class="text-[10.5px] text-cream/35 font-mono" dir="ltr">${escapeHtml(invoice.customer_phone)}</td>
            <td class="text-[10.5px] text-cream/45 whitespace-nowrap">${formatJalaliDateTime(invoice.created_at)}</td>
            <td class="text-[11.5px] font-bold whitespace-nowrap">${money(invoice.amount)}</td>
            <td class="text-[11px] whitespace-nowrap">${escapeHtml(PAYMENT_LABELS[invoice.payment_method ?? ''] ?? '—')}</td>
            <td>${
              invoice.voided_at
                ? '<span class="badge tone-danger">باطل</span>'
                : '<span class="badge tone-success">معتبر</span>'
            }</td>
          </tr>`
        )
        .join('')
    : '';

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
    ${pageHeader({
      title: `شیفت #${toPersianDigits(shift.id)}`,
      subtitle: `${shift.staff_name} · ${formatJalaliDateTime(shift.opened_at)}`,
      iconName: 'wallet',
      actions: `<a href="/admin/shifts" class="btn btn-ghost btn-sm">${icon('right', 'w-4 h-4')} بازگشت</a>`,
    })}

    <div class="grid lg:grid-cols-[1.1fr_1fr] gap-4 items-start mb-4">
      <div class="glass rounded-3xl p-4 sm:p-5">
        <div class="flex items-center gap-2 mb-3">
          ${
            isOpen
              ? `<span class="badge tone-success">${icon('lock', 'w-3 h-3')} باز</span>`
              : `<span class="badge tone-muted">بسته</span>`
          }
          <span class="text-[10.5px] text-cream/40">باز شده توسط ${escapeHtml(shift.staff_name)}</span>
        </div>

        <div class="grid grid-cols-2 gap-2 mb-3">
          <div class="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-3">
            <div class="text-[10px] text-emerald-200/70 mb-1">نقد مورد انتظار</div>
            <div class="text-[15px] font-extrabold text-emerald-300">${money(summary.expectedCash)}</div>
          </div>
          <div class="rounded-2xl bg-black/25 border border-white/10 p-3">
            <div class="text-[10px] text-cream/40 mb-1">نقد شمارش‌شده</div>
            <div class="text-[15px] font-extrabold">${shift.counted_cash === null ? '—' : money(shift.counted_cash)}</div>
          </div>
        </div>

        ${
          difference === null
            ? ''
            : `<div class="rounded-2xl border p-3 mb-3 ${
                difference === 0
                  ? 'border-white/10 bg-black/25'
                  : difference > 0
                    ? 'border-sky-400/30 bg-sky-500/10'
                    : 'border-rose-400/30 bg-rose-500/10'
              }">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] text-cream/55">اختلاف صندوق</span>
                  <span class="font-extrabold text-[14px] ${
                    difference === 0 ? 'text-cream/60' : difference > 0 ? 'text-sky-300' : 'text-rose-300'
                  }">${difference > 0 ? '+' : ''}${money(difference)} تومان</span>
                </div>
                <p class="text-[10px] text-cream/35 mt-1">${
                  difference === 0
                    ? 'صندوق کاملاً منطبق است.'
                    : difference > 0
                      ? 'نقد شمارش‌شده بیشتر از انتظار است (کم‌ثبتی فروش یا ورود نقد ثبت‌نشده).'
                      : 'کمبود نقد نسبت به انتظار (خروج نقد ثبت‌نشده یا خطا در بازگشت باقیمانده).'
                }</p>
              </div>`
        }

        ${summaryRow('موجودی اولیه', money(shift.opening_cash) + ' تومان')}
        ${summaryRow('فروش نقدی', money(summary.cashSales) + ' تومان')}
        ${summaryRow('فروش کارت', money(summary.cardSales) + ' تومان')}
        ${summaryRow('فروش آنلاین', money(summary.onlineSales) + ' تومان')}
        ${summaryRow('جمع فروش', money(summary.totalSales) + ' تومان', { tone: 'text-amber-200', strong: true })}
        ${summaryRow('تخفیف', money(summary.totalDiscount) + ' تومان', { tone: 'text-emerald-300' })}
        ${summaryRow('تعداد فاکتور', formatNumberFa(summary.invoiceCount))}
        ${summaryRow('ورود نقد', '+' + money(summary.movementsIn))}
        ${summaryRow('خروج نقد', '−' + money(summary.movementsOut))}
        ${summaryRow('ابطال‌شده', formatNumberFa(summary.voidCount) + ' فاکتور · ' + money(summary.voidAmount) + ' تومان', {
          tone: 'text-rose-300',
        })}
        ${shift.notes ? `<div class="mt-3 rounded-xl bg-black/25 border border-white/10 p-3 text-[11px] text-cream/55">یادداشت: ${escapeHtml(shift.notes)}</div>` : ''}
        ${shift.closed_at ? `<p class="text-[10px] text-cream/30 mt-2">بسته‌شده در ${formatJalaliDateTime(shift.closed_at)}${shift.closed_by_name ? ' توسط ' + escapeHtml(shift.closed_by_name) : ''}</p>` : ''}
        ${
          shift.status === 'closed' && shift.expected_cash !== null && shift.expected_cash !== summary.expectedCash
            ? `<div class="mt-2 rounded-xl bg-amber-500/10 border border-amber-400/25 p-2.5 text-[10.5px] text-amber-200/85 leading-5">
                در زمان بستن، نقد مورد انتظار ${money(shift.expected_cash)} تومان ثبت شده بود؛ پس از آن ${
                  summary.voidCount
                } فاکتور باطل شده و نقد مورد انتظار اکنون ${money(summary.expectedCash)} تومان است. اختلاف نمایش‌داده‌شده با مقدار فعلی محاسبه شده است.
              </div>`
            : ''
        }
      </div>

      <div class="glass rounded-3xl p-4 sm:p-5">
        <h2 class="font-bold text-[14px] mb-3">گردش نقد</h2>
        ${
          movements.length === 0
            ? emptyState({ title: 'گردشی ثبت نشده', message: 'در این شیفت ورود یا خروج نقدی ثبت نشده است.', iconName: 'wallet' })
            : `<div class="table-wrap"><table class="data">
                <thead><tr><th>زمان</th><th>نوع</th><th>مبلغ</th><th>توضیح</th><th>ثبت‌کننده</th></tr></thead>
                <tbody>${movementRows}</tbody>
              </table></div>`
        }
      </div>
    </div>

    <div class="glass rounded-3xl overflow-hidden">
      <div class="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <h2 class="font-bold text-[14px]">فاکتورهای این شیفت</h2>
        <span class="text-[10.5px] text-cream/35">${formatNumberFa(invoices.length)} مورد</span>
      </div>
      ${
        invoices.length === 0
          ? emptyState({ title: 'فاکتوری ثبت نشده', message: 'در این شیفت فاکتوری صادر نشده است.', iconName: 'receipt' })
          : `<div class="table-wrap"><table class="data">
              <thead><tr><th>#</th><th>مشتری</th><th>موبایل</th><th>زمان</th><th>مبلغ</th><th>پرداخت</th><th>وضعیت</th></tr></thead>
              <tbody>${invoiceRows}</tbody>
            </table></div>`
      }
    </div>
  </div>
  `;

  return appShell({
    title: 'جزئیات شیفت',
    role: 'admin' as const,
    userName,
    active: 'shifts',
    body,
    scripts: '',
    cafeName: settings.cafe_name,
  });
}
