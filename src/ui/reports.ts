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

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
    ${pageHeader({
      title: 'گزارش‌ها',
      subtitle: `تحلیل فروش، عملکرد کارمندان و ماندگاری مشتریان — ${data.thisMonth.label}`,
      iconName: 'chart',
      actions: `<a href="/admin/reports/export.csv" class="btn btn-ghost btn-sm">${icon('download', 'w-4 h-4')} خروجی CSV</a>`,
    })}

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

    <div class="grid lg:grid-cols-2 gap-4">
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
