/**
 * ----------------------------------------------------------------------------
 *  پنل ادمین: گزارش‌های تحلیلی و گزارش اقدامات مدیران
 * ----------------------------------------------------------------------------
 */
import type { AppSettings, Role } from '../types';
import type { AdminLogRow, ReportsData } from '../lib/db';
import {
  escapeHtml,
  formatJalaliDateTime,
  formatNumberFa,
  toPersianDigits,
} from '../lib/utils';
import { appShell, emptyState, icon, pageHeader } from './layout';

/** برچسب فارسی نوع اقدام‌ها */
const ACTION_LABELS: Record<string, { label: string; tone: string; iconName: string }> = {
  invoice_void: { label: 'ابطال فاکتور', tone: 'danger', iconName: 'close' },
  customer_delete: { label: 'حذف مشتری', tone: 'danger', iconName: 'trash' },
  customer_update: { label: 'ویرایش مشتری', tone: 'info', iconName: 'users' },
  customer_create: { label: 'افزودن مشتری', tone: 'success', iconName: 'users' },
  points_adjust: { label: 'تغییر امتیاز', tone: 'warning', iconName: 'star' },
  settings_update: { label: 'تغییر تنظیمات', tone: 'info', iconName: 'settings' },
  staff_create: { label: 'افزودن کارمند', tone: 'success', iconName: 'shield' },
  staff_update: { label: 'ویرایش کارمند', tone: 'info', iconName: 'shield' },
  staff_delete: { label: 'حذف کارمند', tone: 'danger', iconName: 'trash' },
  coupon_create: { label: 'ساخت کد تخفیف', tone: 'warning', iconName: 'gift' },
  sms_test: { label: 'پیامک آزمایشی', tone: 'muted', iconName: 'chat' },
};

function actionMeta(action: string): { label: string; tone: string; iconName: string } {
  return ACTION_LABELS[action] ?? { label: action, tone: 'muted', iconName: 'clock' };
}

function statCard(options: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  iconName: string;
  accent?: 'gold' | 'emerald' | 'rose' | 'sky';
}): string {
  const accents: Record<string, string> = {
    gold: 'bg-gold/10 border-gold/25 text-gold',
    emerald: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300',
    rose: 'bg-rose-500/10 border-rose-500/25 text-rose-300',
    sky: 'bg-sky-500/10 border-sky-500/25 text-sky-300',
  };
  return `<div class="glass rounded-2xl p-4 sm:p-5 card-hover">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[11px] text-cream/45 mb-1.5">${escapeHtml(options.label)}</div>
        <div class="text-xl sm:text-2xl font-extrabold tracking-tight">
          ${options.value}
          ${options.unit ? `<span class="text-[10px] font-normal text-cream/40 ms-1">${escapeHtml(options.unit)}</span>` : ''}
        </div>
        ${options.hint ? `<div class="text-[10px] text-cream/35 mt-1.5">${options.hint}</div>` : ''}
      </div>
      <div class="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${accents[options.accent ?? 'gold']}">
        ${icon(options.iconName, 'w-5 h-5')}
      </div>
    </div>
  </div>`;
}

function panel(options: {
  title: string;
  iconName: string;
  actions?: string;
  body: string;
  className?: string;
}): string {
  return `<section class="glass rounded-3xl overflow-hidden ${options.className ?? ''}">
    <div class="px-5 py-4 border-b border-white/10 flex items-center gap-2">
      <span class="w-8 h-8 rounded-xl bg-gold/10 border border-gold/20 text-gold flex items-center justify-center">${icon(options.iconName, 'w-4 h-4')}</span>
      <h2 class="font-bold text-sm">${escapeHtml(options.title)}</h2>
      ${options.actions ? `<div class="me-auto flex items-center gap-2">${options.actions}</div>` : ''}
    </div>
    ${options.body}
  </section>`;
}

function growthBadge(pct: number | null, label: string): string {
  if (pct === null) return `<span class="badge tone-muted">${escapeHtml(label)}: −</span>`;
  const tone = pct > 0 ? 'success' : pct < 0 ? 'danger' : 'muted';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '•';
  return `<span class="badge tone-${tone}">${arrow} ${toPersianDigits(Math.abs(pct))}٪ ${escapeHtml(label)}</span>`;
}

/* ==========================================================================
 * ۱) صفحهٔ گزارش‌ها
 * ========================================================================== */

export function adminReportsPage(input: {
  settings: AppSettings;
  userName: string;
  data: ReportsData;
}): string {
  const { settings, userName, data } = input;
  const maxMonth = Math.max(1, ...data.months.map((m) => m.amount));

  const monthBars = data.months
    .slice()
    .reverse()
    .map((m) => {
      const height = Math.max(4, Math.round((m.amount / maxMonth) * 100));
      return `<div class="flex-1 flex flex-col items-center gap-2 min-w-0">
        <div class="text-[9.5px] text-cream/45 whitespace-nowrap">${formatNumberFa(m.amount)}</div>
        <div class="w-full h-32 flex items-end">
          <div class="w-full rounded-t-lg bg-gradient-to-t from-amber-700/40 to-gold/80" style="height:${height}%"></div>
        </div>
        <div class="text-[9.5px] text-cream/40 text-center leading-4">${escapeHtml(m.label.split(' ')[0])}</div>
      </div>`;
    })
    .join('');

  const staffRows = data.staff
    .map(
      (row) => `<tr>
        <td class="text-[12.5px]">${escapeHtml(row.staff_name)}</td>
        <td class="text-[11.5px] text-cream/60">${toPersianDigits(row.invoices)}</td>
        <td class="font-bold text-amber-200 text-[12px] whitespace-nowrap">${formatNumberFa(row.amount)}</td>
        <td class="text-[11px] text-emerald-300/80">${formatNumberFa(row.points)}</td>
        <td class="text-[11px] text-cream/45">${formatNumberFa(row.invoices > 0 ? Math.round(row.amount / row.invoices) : 0)}</td>
      </tr>`
    )
    .join('');

  const itemRows = data.topItems
    .map(
      (row, index) => `<tr>
        <td class="text-[11px] text-cream/35">${toPersianDigits(index + 1)}</td>
        <td class="text-[12.5px]">${escapeHtml(row.name)}</td>
        <td class="text-[11.5px] text-cream/60">${toPersianDigits(row.qty)}</td>
        <td class="text-[11.5px] text-amber-200/80 whitespace-nowrap">${formatNumberFa(row.amount)}</td>
      </tr>`
    )
    .join('');

  // نمودار ۳۰ روزه
  const maxDay = Math.max(1, ...data.daily.map((day) => day.amount));
  const dayBars = data.daily
    .map((day) => {
      const height = Math.max(2, Math.round((day.amount / maxDay) * 100));
      return `<div class="flex-1 flex flex-col items-center justify-end gap-1 min-w-0 group" title="${escapeHtml(day.label)} — ${formatNumberFa(day.amount)} تومان (${formatNumberFa(day.invoices)} فاکتور)">
        <div class="w-full rounded-t bg-gradient-to-t from-amber-700/40 to-gold/80 group-hover:to-gold transition" style="height:${height}%"></div>
      </div>`;
    })
    .join('');

  // مقایسه‌های دوره‌ای از همان سری روزانه (بدون کوئری اضافه)
  const days = data.daily;
  const sumRange = (from: number, to: number) =>
    days.slice(from, to).reduce((sum, day) => sum + day.amount, 0);
  const countRange = (from: number, to: number) =>
    days.slice(from, to).reduce((sum, day) => sum + day.invoices, 0);

  const todayAmount = sumRange(days.length - 1, days.length);
  const yesterdayAmount = sumRange(days.length - 2, days.length - 1);
  const last7 = sumRange(days.length - 7, days.length);
  const prev7 = sumRange(days.length - 14, days.length - 7);
  const last7Count = countRange(days.length - 7, days.length);
  const prev7Count = countRange(days.length - 14, days.length - 7);

  const pctChange = (current: number, previous: number): number | null => {
    if (!previous) return current > 0 ? 100 : null;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  };
  const deltaBadge = (current: number, previous: number, label: string): string => {
    const pct = pctChange(current, previous);
    if (pct === null) {
      return `<span class="badge tone-muted">${label}: دادهٔ کافی نیست</span>`;
    }
    const tone = pct > 0 ? 'tone-success' : pct < 0 ? 'tone-danger' : 'tone-muted';
    const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '■';
    return `<span class="badge ${tone}">${arrow} ${label} ${toPersianDigits(Math.abs(pct))}٪</span>`;
  };

  // پرفروش بر اساس مبلغ (از همان دادهٔ آیتم‌ها)
  const topByRevenue = data.topItems.slice().sort((a, b) => b.amount - a.amount).slice(0, 5);
  const revenueRows = topByRevenue
    .map(
      (item, index) => `<tr>
        <td class="text-[11px] text-cream/30">${toPersianDigits(index + 1)}</td>
        <td class="text-[12px]">${escapeHtml(item.name)}</td>
        <td class="text-[11.5px] text-cream/60">${formatNumberFa(item.qty)}</td>
        <td class="font-bold text-amber-200 text-[12px] whitespace-nowrap">${formatNumberFa(item.amount)}</td>
      </tr>`
    )
    .join('');

  // تفکیک پرداخت
  const paymentTotal = Math.max(1, data.paymentSplit.total);
  const paymentRows = [
    { key: 'cash', label: 'نقدی', value: data.paymentSplit.cash, tone: 'bg-emerald-400', text: 'text-emerald-300' },
    { key: 'card', label: 'کارت‌خوان', value: data.paymentSplit.card, tone: 'bg-sky-400', text: 'text-sky-300' },
    { key: 'online', label: 'آنلاین', value: data.paymentSplit.online, tone: 'bg-amber-400', text: 'text-amber-200' },
    { key: 'unknown', label: 'ثبت‌نشده (قدیمی)', value: data.paymentSplit.unknown, tone: 'bg-cream/25', text: 'text-cream/50' },
  ]
    .filter((row) => row.value > 0)
    .map((row) => {
      const share = Math.round((row.value / paymentTotal) * 1000) / 10;
      return `<div class="mb-3">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[11.5px] text-cream/55">${row.label}</span>
          <span class="text-[11.5px] font-bold ${row.text}">${formatNumberFa(row.value)} <span class="text-[9.5px] font-normal text-cream/35">(${toPersianDigits(share)}٪)</span></span>
        </div>
        <div class="h-2 rounded-full bg-white/5 overflow-hidden">
          <div class="h-full rounded-full ${row.tone}" style="width:${Math.min(100, share)}%"></div>
        </div>
      </div>`;
    })
    .join('');

  const weeklyRows = data.weekly
    .map(
      (week) => `<tr>
        <td class="text-[11px] text-cream/55 whitespace-nowrap">${escapeHtml(week.label)}</td>
        <td class="text-[11.5px] text-cream/60">${formatNumberFa(week.invoices)}</td>
        <td class="font-bold text-amber-200 text-[12px] whitespace-nowrap">${formatNumberFa(week.amount)}</td>
        <td class="text-[11px] text-cream/45 whitespace-nowrap">${formatNumberFa(week.invoices > 0 ? Math.round(week.amount / week.invoices) : 0)}</td>
      </tr>`
    )
    .join('');

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
    ${pageHeader({
      title: 'گزارش‌ها',
      subtitle: `تحلیل فروش، عملکرد کارمندان و ماندگاری مشتریان — ${data.thisMonth.label}`,
      iconName: 'chart',
      actions: `<a href="/admin/reports/export.csv" class="btn btn-ghost btn-sm">${icon('download', 'w-4 h-4')} خروجی CSV</a>`,
    })}

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
      ${statCard({
        label: 'فروش امروز',
        value: formatNumberFa(data.todayTotals.sales),
        unit: 'تومان',
        hint: `دیروز: ${formatNumberFa(yesterdayAmount)} تومان`,
        iconName: 'bolt',
        accent: 'emerald',
      })}
      ${statCard({
        label: 'میانگین فاکتور امروز',
        value: formatNumberFa(
          data.todayTotals.invoices > 0 ? Math.round(data.todayTotals.sales / data.todayTotals.invoices) : 0
        ),
        unit: 'تومان',
        iconName: 'chart',
        accent: 'sky',
      })}
      ${statCard({
        label: 'ابطال‌شده این ماه',
        value: formatNumberFa(data.voids.count),
        unit: 'فاکتور',
        hint: `${formatNumberFa(data.voids.amount)} تومان`,
        iconName: 'close',
        accent: 'rose',
      })}
      ${statCard({
        label: 'نقد این ماه',
        value: formatNumberFa(data.paymentSplit.cash),
        unit: 'تومان',
        hint: 'برای تطبیق با صندوق',
        iconName: 'banknote',
        accent: 'gold',
      })}
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      ${statCard({
        label: `فروش ${data.thisMonth.label}`,
        value: formatNumberFa(data.thisMonth.sales),
        unit: 'تومان',
        iconName: 'wallet',
        accent: 'gold',
      })}
      ${statCard({
        label: 'تعداد فاکتور',
        value: formatNumberFa(data.thisMonth.invoices),
        iconName: 'receipt',
        accent: 'sky',
      })}
      ${statCard({
        label: 'میانگین سبد خرید',
        value: formatNumberFa(data.thisMonth.avgBasket),
        unit: 'تومان',
        iconName: 'chart',
        accent: 'emerald',
      })}
      ${statCard({
        label: 'مشتریان خریدار',
        value: formatNumberFa(data.thisMonth.customers),
        iconName: 'users',
        accent: 'rose',
      })}
    </div>

    <div class="flex flex-wrap items-center gap-2 mb-4">
      ${deltaBadge(todayAmount, yesterdayAmount, 'امروز نسبت به دیروز')}
      ${deltaBadge(last7, prev7, '۷ روز اخیر نسبت به ۷ روز قبل')}
      ${deltaBadge(last7Count, prev7Count, 'تعداد فاکتور هفته')}
    </div>

    <div class="flex flex-wrap items-center gap-2 mb-5">
      ${growthBadge(data.growth.salesPct, `فروش نسبت به ${data.lastMonth.label}`)}
      ${growthBadge(data.growth.invoicesPct, 'تعداد فاکتور')}
      <span class="badge tone-muted">مشتری تازه این ماه: ${toPersianDigits(data.retention.newThisMonth)}</span>
      <span class="badge tone-muted">مشتری تازه ماه قبل: ${toPersianDigits(data.retention.newLastMonth)}</span>
    </div>

    <div class="grid lg:grid-cols-2 gap-4 mb-4">
      ${panel({
        title: 'روند فروش ۶ ماه اخیر',
        iconName: 'chart',
        body: `<div class="p-5 flex items-end gap-2 sm:gap-3">${monthBars}</div>`,
      })}
      ${panel({
        title: 'ماندگاری مشتری (۹۰ روز اخیر)',
        iconName: 'refresh',
        body: `<div class="p-5 space-y-4">
          <div class="flex items-end gap-3">
            <div class="text-3xl font-extrabold gold-text">${
              data.retention.rate === null ? '—' : toPersianDigits(data.retention.rate) + '٪'
            }</div>
            <div class="text-[11px] text-cream/45 leading-5 pb-1">مشتریانی که بیش از یک‌بار خرید کرده‌اند</div>
          </div>
          <div class="h-2.5 rounded-full bg-white/5 overflow-hidden">
            <div class="h-full rounded-full bg-gradient-to-r from-emerald-500/70 to-emerald-400" style="width:${Math.min(100, data.retention.rate ?? 0)}%"></div>
          </div>
          <div class="grid grid-cols-2 gap-3 text-[11px]">
            <div class="rounded-xl bg-black/20 border border-white/5 px-3 py-2">
              <div class="text-cream/40 mb-0.5">کل خریداران</div>
              <div class="font-bold">${toPersianDigits(data.retention.buyers)}</div>
            </div>
            <div class="rounded-xl bg-black/20 border border-white/5 px-3 py-2">
              <div class="text-cream/40 mb-0.5">خریدار بازگشتی</div>
              <div class="font-bold text-emerald-300">${toPersianDigits(data.retention.repeatBuyers)}</div>
            </div>
            <div class="rounded-xl bg-black/20 border border-white/5 px-3 py-2">
              <div class="text-cream/40 mb-0.5">کل مشتریان</div>
              <div class="font-bold">${formatNumberFa(data.totals.customers)}</div>
            </div>
            <div class="rounded-xl bg-black/20 border border-white/5 px-3 py-2">
              <div class="text-cream/40 mb-0.5">خوابیده‌ها</div>
              <div class="font-bold text-rose-300">${formatNumberFa(data.totals.sleeping)}</div>
            </div>
          </div>
          <div class="text-[10.5px] text-cream/35 leading-6">
            امتیاز در گردش مشتریان: ${formatNumberFa(data.totals.points)} امتیاز ·
            واحد امتیاز: هر ${formatNumberFa(settings.currency_unit)} تومان = ${toPersianDigits(settings.points_per_currency)} امتیاز
          </div>
        </div>`,
      })}
    </div>

    ${panel({
      title: 'فروش ۳۰ روز اخیر',
      iconName: 'chart',
      actions: `<span class="text-[10px] text-cream/35">بیشترین روز: ${formatNumberFa(maxDay)} تومان</span>`,
      body: `<div class="p-5">
        <div class="h-36 flex items-end gap-[3px]">${dayBars}</div>
        <div class="flex items-center justify-between mt-2 text-[9.5px] text-cream/30">
          <span>${escapeHtml(data.daily[0]?.label ?? '')}</span>
          <span>${escapeHtml(data.daily[data.daily.length - 1]?.label ?? '')}</span>
        </div>
      </div>`,
    })}

    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      ${panel({
        title: 'تفکیک فروش بر اساس روش پرداخت (ماه جاری)',
        iconName: 'wallet',
        body:
          data.paymentSplit.total === 0
            ? emptyState({ title: 'پرداختی ثبت نشده', message: 'با ثبت فاکتورهای دارای روش پرداخت، این بخش پر می‌شود.', iconName: 'wallet' })
            : `<div class="p-5">
                ${paymentRows}
                <div class="border-t border-white/10 pt-3 flex items-center justify-between">
                  <span class="text-[11.5px] text-cream/55">جمع فروش</span>
                  <span class="font-extrabold text-[13px] text-amber-200">${formatNumberFa(data.paymentSplit.total)} تومان</span>
                </div>
                <p class="text-[10px] text-cream/30 mt-2 leading-5">فقط فاکتورهای معتبر؛ مبالغ ابطال‌شده در هیچ‌کدام از ستون‌ها حساب نمی‌شوند.</p>
              </div>`,
      })}
      ${panel({
        title: 'فروش هفتگی (۸ هفته اخیر)',
        iconName: 'calendar',
        body:
          data.weekly.length === 0
            ? emptyState({ title: 'داده‌ای موجود نیست', message: 'پس از ثبت فاکتورها این جدول پر می‌شود.', iconName: 'calendar' })
            : `<div class="table-wrap">
                <table class="data">
                  <thead><tr><th>بازه</th><th>فاکتور</th><th>فروش</th><th>میانگین</th></tr></thead>
                  <tbody>${weeklyRows}</tbody>
                </table>
              </div>`,
      })}
    </div>

    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      ${panel({
        title: 'عملکرد کارمندان (ماه جاری)',
        iconName: 'shield',
        body:
          data.staff.length === 0
            ? emptyState({
                title: 'فاکتوری در این ماه ثبت نشده',
                message: 'به‌محض ثبت اولین فاکتور، عملکرد کارمندان اینجا نمایش داده می‌شود.',
                iconName: 'receipt',
              })
            : `<div class="table-wrap">
                <table class="data">
                  <thead><tr><th>کارمند</th><th>فاکتور</th><th>فروش</th><th>امتیاز</th><th>میانگین</th></tr></thead>
                  <tbody>${staffRows}</tbody>
                </table>
              </div>`,
      })}
      ${panel({
        title: 'پرفروش‌ترین بر اساس مبلغ (۹۰ روز)',
        iconName: 'trending',
        body:
          topByRevenue.length === 0
            ? emptyState({
                title: 'آیتمی ثبت نشده',
                message: 'برای دیدن این گزارش، فاکتورها را با انتخاب آیتم‌های منو ثبت کنید.',
                iconName: 'trending',
              })
            : `<div class="table-wrap">
                <table class="data">
                  <thead><tr><th>#</th><th>آیتم</th><th>تعداد</th><th>درآمد</th></tr></thead>
                  <tbody>${revenueRows}</tbody>
                </table>
              </div>`,
      })}
      ${panel({
        title: 'پرفروش‌ترین آیتم‌ها (۹۰ روز)',
        iconName: 'coffee',
        body:
          data.topItems.length === 0
            ? emptyState({
                title: 'آیتمی ثبت نشده',
                message: 'برای دیدن این گزارش، فاکتورها را با انتخاب آیتم‌های منو ثبت کنید.',
                iconName: 'coffee',
              })
            : `<div class="table-wrap">
                <table class="data">
                  <thead><tr><th>#</th><th>آیتم</th><th>تعداد</th><th>مبلغ</th></tr></thead>
                  <tbody>${itemRows}</tbody>
                </table>
              </div>`,
      })}
    </div>
  </div>
  `;

  return appShell({
    title: 'گزارش‌ها',
    role: 'admin' as Role,
    userName,
    active: 'reports',
    body,
    cafeName: settings.cafe_name,
  });
}

/* ==========================================================================
 * ۲) صفحهٔ گزارش اقدامات مدیران
 * ========================================================================== */

export function adminLogsPage(input: {
  settings: AppSettings;
  userName: string;
  logs: AdminLogRow[];
  total: number;
  page: number;
  pageSize: number;
  action: string;
  q: string;
}): string {
  const { settings, userName, logs, total, page, pageSize, action, q } = input;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageLink = (newPage: number): string => {
    const search = new URLSearchParams();
    if (action) search.set('action', action);
    if (q) search.set('q', q);
    search.set('page', String(newPage));
    return `/admin/logs?${search.toString()}`;
  };

  const rows = logs
    .map((row) => {
      const meta = actionMeta(row.action);
      return `<tr>
        <td class="text-[10.5px] text-cream/35">${toPersianDigits(row.id)}</td>
        <td><span class="badge tone-${meta.tone}">${icon(meta.iconName, 'w-3 h-3')} ${escapeHtml(meta.label)}</span></td>
        <td class="text-[12px]">${escapeHtml(row.admin_name)}</td>
        <td class="text-[11px] text-cream/55 max-w-[280px] leading-6">${escapeHtml(row.details ?? '—')}</td>
        <td class="text-[10.5px] text-cream/30 font-mono" dir="ltr">${escapeHtml(row.target_type ?? '—')}${
          row.target_id ? '#' + escapeHtml(row.target_id) : ''
        }</td>
        <td class="text-[10.5px] text-cream/40 whitespace-nowrap">${formatJalaliDateTime(row.created_at)}</td>
      </tr>`;
    })
    .join('');

  const actionOptions = Object.entries(ACTION_LABELS)
    .map(
      ([key, meta]) =>
        `<option value="${key}" ${action === key ? 'selected' : ''}>${escapeHtml(meta.label)}</option>`
    )
    .join('');

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
    ${pageHeader({
      title: 'گزارش اقدامات مدیران',
      subtitle: 'هر تغییر حساس (ابطال فاکتور، حذف مشتری، تغییر امتیاز و تنظیمات) اینجا ثبت می‌شود.',
      iconName: 'clock',
      actions: `<a href="/admin/logs/export.csv" class="btn btn-ghost btn-sm">${icon('download', 'w-4 h-4')} خروجی CSV</a>`,
    })}

    <form method="get" action="/admin/logs" class="glass rounded-2xl p-4 mb-4">
      <div class="grid sm:grid-cols-[1fr_1fr_auto] gap-2.5">
        <select name="action" class="field">
          <option value="">همهٔ اقدام‌ها</option>
          ${actionOptions}
        </select>
        <input type="search" name="q" value="${escapeHtml(q)}" class="field" placeholder="نام مدیر، توضیح یا شناسه…" />
        <button type="submit" class="btn btn-primary btn-sm">${icon('filter', 'w-4 h-4')} فیلتر</button>
      </div>
    </form>

    <div class="glass rounded-3xl overflow-hidden">
      ${
        logs.length === 0
          ? emptyState({
              title: 'اقدامی ثبت نشده',
              message: 'تا این لحظه هیچ اقدام مدیریتی حساسی انجام نشده است.',
              iconName: 'clock',
            })
          : `<div class="table-wrap">
              <table class="data">
                <thead><tr><th>#</th><th>اقدام</th><th>مدیر</th><th>توضیح</th><th>هدف</th><th>زمان</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            <div class="flex items-center justify-between gap-3 px-4 py-3 border-t border-white/10">
              <div class="text-[11px] text-cream/40">صفحه ${toPersianDigits(page)} از ${toPersianDigits(totalPages)} · ${formatNumberFa(total)} مورد</div>
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
    title: 'گزارش اقدامات',
    role: 'admin' as Role,
    userName,
    active: 'logs',
    body,
    cafeName: settings.cafe_name,
  });
}

/** خروجی CSV گزارش اقدامات */
export function adminLogsCsv(rows: AdminLogRow[]): string {
  const header = ['id', 'created_at', 'action', 'admin_name', 'target_type', 'target_id', 'details'];
  const escape = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        escape(row.created_at),
        escape(row.action),
        escape(row.admin_name),
        escape(row.target_type ?? ''),
        escape(row.target_id ?? ''),
        escape(row.details ?? ''),
      ].join(',')
    );
  }
  return '\uFEFF' + lines.join('\r\n');
}

/** خروجی CSV گزارش فروش (کارمندان + ماه‌ها) */
export function reportsCsv(data: ReportsData): string {
  const escape = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push('section,key,value,extra');

  lines.push(['summary', 'month', escape(data.thisMonth.label), ''].join(','));
  lines.push(['summary', 'sales', data.thisMonth.sales, ''].join(','));
  lines.push(['summary', 'invoices', data.thisMonth.invoices, ''].join(','));
  lines.push(['summary', 'avg_basket', data.thisMonth.avgBasket, ''].join(','));
  lines.push(['summary', 'buyers', data.thisMonth.customers, ''].join(','));
  lines.push(['summary', 'last_month_sales', data.lastMonth.sales, ''].join(','));
  lines.push(['summary', 'repeat_rate_percent', data.retention.rate ?? 0, ''].join(','));

  for (const month of data.months) {
    lines.push(['month', escape(month.label), month.amount, month.invoices].join(','));
  }
  for (const staff of data.staff) {
    lines.push(['staff', escape(staff.staff_name), staff.amount, `${staff.invoices} invoices / ${staff.points} points`].join(','));
  }
  for (const item of data.topItems) {
    lines.push(['item', escape(item.name), item.amount, `${item.qty} qty`].join(','));
  }

  return '\uFEFF' + lines.join('\r\n');
}
