/**
 * ----------------------------------------------------------------------------
 *  پنل ادمین: داشبورد، مشتریان، جزئیات مشتری و فاکتورها
 * ----------------------------------------------------------------------------
 */
import type { AppSettings, CouponRow, InvoiceRow, UserRow, Role } from '../types';
import type {
  CustomerListItem,
  DashboardStats,
  InvoiceListItem,
  ListCustomersParams,
} from '../lib/db';
import { customerActivityStatus, tierLabel } from '../lib/db';
import type { WeatherInfo } from '../lib/sms';
import { TIER_META } from '../lib/settings';
import {
  escapeHtml,
  formatJalali,
  formatJalaliDateTime,
  formatMoney,
  formatNumberFa,
  toPersianDigits,
} from '../lib/utils';
import { appShell, emptyState, icon, jsonForScript, pageHeader } from './layout';

/* ==========================================================================
 *  اجزای مشترک
 * ========================================================================== */

function tierBadge(tier: string): string {
  const meta = TIER_META[tier] ?? TIER_META.bronze;
  return `<span class="badge ${meta.badge}">${meta.icon} ${meta.label}</span>`;
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

/* ==========================================================================
 * ۱) داشبورد
 * ========================================================================== */

export type JobRunMap = Record<string, { date: string; at: string } | null>;

export function adminDashboardPage(input: {
  settings: AppSettings;
  userName: string;
  stats: DashboardStats;
  weather: WeatherInfo;
  jobRuns: JobRunMap;
  monthLabel: string;
  todayLabel: string;
  defaultPassword?: boolean;
}): string {
  const { settings, userName, stats, weather, jobRuns, monthLabel, todayLabel } = input;
  const defaultPassword = input.defaultPassword === true;

  const maxSale = Math.max(...stats.salesSeries.map((d) => d.total), 1);
  const bars = stats.salesSeries
    .map((point) => {
      const height = Math.max(3, Math.round((point.total / maxSale) * 100));
      return `<div class="bar-col">
        <div class="bar-fill" style="height:${height}%">
          <span class="bar-tip">${formatNumberFa(point.total)} تومان</span>
        </div>
        <span class="text-[9.5px] text-cream/35 whitespace-nowrap">${formatJalali(point.date, false)}</span>
      </div>`;
    })
    .join('');

  const jobs: Array<{ key: string; title: string; desc: string; iconName: string }> = [
    { key: 'churn', title: 'پیش‌بینی ریزش', desc: 'پیامک دلتنگی', iconName: 'trending' },
    { key: 'birthday', title: 'تبریک تولد', desc: 'کد تخفیف اختصاصی', iconName: 'gift' },
    { key: 'weather', title: 'آب‌وهوا', desc: 'پیامک روزانه', iconName: 'sun' },
    { key: 'maintenance', title: 'نگهداری', desc: 'بازمحاسبه و پاک‌سازی', iconName: 'refresh' },
    { key: 'monthly', title: 'گزارش ماهانه', desc: 'برای ادمین‌ها', iconName: 'chart' },
  ];

  const jobsHtml = jobs
    .map((job) => {
      const run = jobRuns[job.key];
      return `<div class="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0">
        <div class="w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-gold flex items-center justify-center shrink-0">
          ${icon(job.iconName, 'w-4 h-4')}
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-[12px] font-medium">${job.title}</div>
          <div class="text-[10px] text-cream/35">
            ${run && run.at ? `آخرین اجرا: ${formatJalaliDateTime(run.at)}` : job.desc}
          </div>
        </div>
        <button type="button" data-job="${job.key}" class="run-job btn btn-ghost btn-sm !px-2.5" title="اجرای دستی">
          ${icon('refresh', 'w-3.5 h-3.5')}
        </button>
      </div>`;
    })
    .join('');

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
    ${pageHeader({
      title: 'داشبورد',
      subtitle: `امروز ${todayLabel} — ${monthLabel}`,
      iconName: 'chart',
      actions: `<a href="/staff" class="btn btn-primary btn-sm">${icon('receipt', 'w-4 h-4')} ثبت فاکتور</a>
        <a href="/admin/settings" class="btn btn-ghost btn-sm">${icon('settings', 'w-4 h-4')} تنظیمات</a>`,
    })}

    ${
      defaultPassword
        ? `<div class="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <span class="w-9 h-9 shrink-0 rounded-xl bg-rose-500/15 text-rose-300 flex items-center justify-center">${icon('shield', 'w-4 h-4')}</span>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-bold text-rose-200">رمز عبور پیش‌فرض شما هنوز فعال است</div>
              <div class="text-[11px] text-rose-200/60 leading-6 mt-0.5">این رمز در مستندات پروژه عمومی است؛ لطفاً همین حالا آن را تغییر دهید.</div>
            </div>
            <a href="/admin/staff" class="btn btn-danger btn-sm shrink-0">تغییر رمز</a>
          </div>`
        : ''
    }

    <div class="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-4">
      ${statCard({
        label: 'کل مشتریان',
        value: formatNumberFa(stats.totalCustomers),
        hint: `${formatNumberFa(stats.newCustomers30d)} عضو جدید در ۳۰ روز`,
        iconName: 'users',
        accent: 'gold',
      })}
      ${statCard({
        label: 'فروش امروز',
        value: formatNumberFa(stats.todaySales),
        unit: 'تومان',
        hint: `${formatNumberFa(stats.todayInvoices)} فاکتور`,
        iconName: 'wallet',
        accent: 'emerald',
      })}
      ${statCard({
        label: 'مشتریان خوابیده',
        value: formatNumberFa(stats.sleepingCustomers),
        hint: 'نیازمند پیامک دلتنگی',
        iconName: 'trending',
        accent: 'rose',
      })}
      ${statCard({
        label: `فروش ${monthLabel}`,
        value: formatNumberFa(stats.monthSales),
        unit: 'تومان',
        hint: `${formatNumberFa(stats.pointsOutstanding)} امتیاز در گردش`,
        iconName: 'chart',
        accent: 'sky',
      })}
    </div>

    <div class="grid xl:grid-cols-3 gap-4 mb-4">
      ${panel({
        title: 'فروش هفت روز گذشته',
        iconName: 'chart',
        className: 'xl:col-span-2',
        actions: `<span class="badge tone-muted">${formatNumberFa(stats.salesSeries.reduce((sum, d) => sum + d.total, 0))} تومان</span>`,
        body: `<div class="p-5">
          <div class="bar-track">${bars}</div>
          <div class="mt-4 pt-4 border-t border-white/5 grid grid-cols-3 gap-3 text-center">
            <div>
              <div class="text-[10px] text-cream/35 mb-1">مشتریان فعال ۳۰ روز</div>
              <div class="text-sm font-bold">${formatNumberFa(stats.activeCustomers30d)}</div>
            </div>
            <div>
              <div class="text-[10px] text-cream/35 mb-1">پیامک امروز</div>
              <div class="text-sm font-bold">${formatNumberFa(stats.smsSentToday)}</div>
            </div>
            <div>
              <div class="text-[10px] text-cream/35 mb-1">کل فاکتورها</div>
              <div class="text-sm font-bold">${formatNumberFa(stats.totalInvoices)}</div>
            </div>
          </div>
        </div>`,
      })}

      ${panel({
        title: 'وضعیت آب‌وهوا',
        iconName: 'sun',
        actions: `<a href="/admin/settings#integrations" class="text-[10.5px] text-gold hover:underline">تنظیمات</a>`,
        body: `<div class="p-5">
          ${
            weather.ok
              ? `<div class="text-center py-2">
                  <div class="text-5xl mb-3">${weather.emoji}</div>
                  <div class="text-3xl font-extrabold gold-text mb-1">${toPersianDigits(weather.temp)}°</div>
                  <div class="text-[12px] text-cream/60 mb-1">${escapeHtml(weather.label)}</div>
                  <div class="text-[10.5px] text-cream/35">${escapeHtml(weather.city)}</div>
                  <div class="mt-4 text-[10.5px] text-cream/45 leading-6 bg-white/[0.03] border border-white/5 rounded-xl p-3">${escapeHtml(weather.advice)}</div>
                </div>`
              : `<div class="text-center py-6">
                  <div class="text-4xl mb-3 opacity-40">🌤️</div>
                  <div class="text-[12px] font-medium mb-1.5">آب‌وهوا فعال نیست</div>
                  <p class="text-[10.5px] text-cream/40 leading-6 mb-4">${escapeHtml(weather.error ?? 'کلید API را تنظیم کنید')}</p>
                  <a href="/admin/settings" class="btn btn-ghost btn-sm">${icon('settings', 'w-3.5 h-3.5')} پیکربندی</a>
                </div>`
          }
        </div>`,
      })}
    </div>

    <div class="grid xl:grid-cols-3 gap-4 mb-4">
      ${panel({
        title: 'آخرین فاکتورها',
        iconName: 'receipt',
        className: 'xl:col-span-2',
        actions: `<a href="/admin/invoices" class="text-[10.5px] text-gold hover:underline">همه فاکتورها</a>`,
        body:
          stats.recentInvoices.length === 0
            ? emptyState({ title: 'هنوز فاکتوری ثبت نشده', message: 'از پنل کارمند اولین فاکتور را ثبت کنید.', iconName: 'receipt' })
            : `<div class="table-wrap">
                <table class="data">
                  <thead><tr><th>مشتری</th><th>مبلغ</th><th>تاریخ</th></tr></thead>
                  <tbody>
                    ${stats.recentInvoices
                      .map(
                        (invoice) => `<tr>
                          <td><a href="/admin/customers/${invoice.customer_id}" class="hover:text-gold transition text-[12.5px]">${escapeHtml(invoice.customer_name)}</a></td>
                          <td class="font-bold text-amber-200 whitespace-nowrap text-[12.5px]">${formatNumberFa(invoice.amount)}</td>
                          <td class="text-[10.5px] text-cream/40 whitespace-nowrap">${formatJalaliDateTime(invoice.created_at)}</td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>`,
      })}

      ${panel({
        title: 'جاب‌های خودکار',
        iconName: 'refresh',
        body: `<div>${jobsHtml}</div>
          <div class="px-4 py-3 text-[9.5px] text-cream/30 leading-5 border-t border-white/5">
            جاب‌ها طبق زمان‌بندی Cron اجرا می‌شوند. اجرای دستی برای تست است و ممکن است پیامک تکراری ارسال نکند.
          </div>`,
      })}
    </div>

    ${panel({
      title: 'مشتریان برتر',
      iconName: 'star',
      body:
        stats.topCustomers.length === 0
          ? emptyState({ title: 'هنوز مشتری فعالی نیست', message: 'با ثبت فاکتور، امتیاز مشتریان شروع می‌شود.', iconName: 'users' })
          : `<div class="grid sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-white/5">
              ${stats.topCustomers
                .map(
                  (customer, index) => `<a href="/admin/customers/${customer.id}" class="p-4 flex items-center gap-3 hover:bg-white/[0.03] transition">
                    <div class="relative">
                      <div class="w-10 h-10 rounded-full bg-gradient-to-br from-amber-300 to-amber-800 text-coffee-950 font-bold flex items-center justify-center">
                        ${escapeHtml(customer.name.slice(0, 1))}
                      </div>
                      <span class="absolute -top-1 -right-1 w-4 h-4 rounded-full gold-bg text-coffee-950 text-[9px] font-extrabold flex items-center justify-center">${toPersianDigits(index + 1)}</span>
                    </div>
                    <div class="min-w-0">
                      <div class="text-[12px] font-medium truncate">${escapeHtml(customer.name)}</div>
                      <div class="text-[10px] text-cream/40">${formatNumberFa(customer.points)} امتیاز</div>
                    </div>
                  </a>`
                )
                .join('')}
            </div>`,
    })}
  </div>
  `;

  const scripts = `
  (function () {
    $$('.run-job').forEach(function (button) {
      button.addEventListener('click', async function () {
        var job = button.dataset.job;
        setLoading(button, true, '');
        try {
          var result = await api('/api/admin/jobs/' + encodeURIComponent(job), { method: 'POST' });
          toast(result.message, result.ok ? 'success' : 'error');
          setTimeout(function () { window.location.reload(); }, 1400);
        } catch (error) {
          toast(error.message, 'error');
          setLoading(button, false);
        }
      });
    });
  })();
  `;

  return appShell({
    title: 'داشبورد',
    role: 'admin' as Role,
    userName,
    active: 'dashboard',
    body,
    scripts,
    cafeName: settings.cafe_name,
  });
}

/* ==========================================================================
 * ۲) فهرست مشتریان
 * ========================================================================== */

export function adminCustomersPage(input: {
  settings: AppSettings;
  userName: string;
  customers: CustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
  params: ListCustomersParams;
}): string {
  const { settings, userName, customers, total, page, pageSize, params } = input;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const queryString = (newPage: number): string => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.tier) search.set('tier', params.tier);
    if (params.status) search.set('status', params.status);
    if (params.sort) search.set('sort', params.sort);
    search.set('page', String(newPage));
    return `/admin/customers?${search.toString()}`;
  };

  const rows = customers
    .map((customer) => {
      const status = customerActivityStatus(customer, settings.churn_grace_days);
      return `<tr>
        <td>
          <a href="/admin/customers/${customer.id}" class="flex items-center gap-2.5 group">
            <span class="w-8 h-8 rounded-full bg-gradient-to-br from-amber-300 to-amber-800 text-coffee-950 text-[12px] font-bold flex items-center justify-center shrink-0">${escapeHtml(customer.name.slice(0, 1))}</span>
            <span class="min-w-0">
              <span class="block text-[12.5px] font-medium group-hover:text-gold transition truncate">${escapeHtml(customer.name)}</span>
              <span class="block text-[10.5px] text-cream/35 font-mono" dir="ltr">${escapeHtml(customer.phone)}</span>
            </span>
          </a>
        </td>
        <td>${tierBadge(customer.tier)}</td>
        <td class="font-bold text-amber-200">${formatNumberFa(customer.points)}</td>
        <td class="text-[12px]">${formatNumberFa(customer.visits)}</td>
        <td class="text-[12px] text-cream/60">${formatNumberFa(customer.total_spent)}</td>
        <td class="text-[11px] text-cream/45 whitespace-nowrap">${customer.last_visit_date ? formatJalali(customer.last_visit_date) : '—'}</td>
        <td><span class="badge tone-${status.tone}">${status.label}</span></td>
        <td>
          <a href="/admin/customers/${customer.id}" class="btn btn-ghost btn-sm !px-2" title="جزئیات">
            ${icon('left', 'w-3.5 h-3.5')}
          </a>
        </td>
      </tr>`;
    })
    .join('');

  const cards = customers
    .map((customer) => {
      const status = customerActivityStatus(customer, settings.churn_grace_days);
      return `<a href="/admin/customers/${customer.id}" class="block glass rounded-2xl p-4 active:scale-[.99] transition">
        <div class="flex items-start gap-3">
          <span class="w-10 h-10 rounded-full bg-gradient-to-br from-amber-300 to-amber-800 text-coffee-950 font-bold flex items-center justify-center shrink-0">${escapeHtml(customer.name.slice(0, 1))}</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <div class="text-[13px] font-semibold truncate">${escapeHtml(customer.name)}</div>
              ${tierBadge(customer.tier)}
            </div>
            <div class="text-[11px] text-cream/40 font-mono mt-0.5" dir="ltr">${escapeHtml(customer.phone)}</div>
            <div class="flex items-center gap-3 mt-2.5 text-[10.5px] text-cream/45">
              <span>${formatNumberFa(customer.points)} امتیاز</span>
              <span>${formatNumberFa(customer.visits)} خرید</span>
              <span class="badge tone-${status.tone} !text-[9.5px] !py-0.5">${status.label}</span>
            </div>
          </div>
        </div>
      </a>`;
    })
    .join('');

  const pagination = `<div class="flex items-center justify-between gap-3 px-4 py-3 border-t border-white/10">
    <div class="text-[11px] text-cream/40">صفحه ${toPersianDigits(page)} از ${toPersianDigits(totalPages)} — ${formatNumberFa(total)} مشتری</div>
    <div class="flex items-center gap-1.5">
      <a href="${queryString(Math.max(1, page - 1))}" class="btn btn-ghost btn-sm ${page <= 1 ? 'opacity-40 pointer-events-none' : ''}">${icon('right', 'w-3.5 h-3.5')} قبلی</a>
      <a href="${queryString(Math.min(totalPages, page + 1))}" class="btn btn-ghost btn-sm ${page >= totalPages ? 'opacity-40 pointer-events-none' : ''}">بعدی ${icon('left', 'w-3.5 h-3.5')}</a>
    </div>
  </div>`;

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
    ${pageHeader({
      title: 'مشتریان',
      subtitle: 'جستجو، فیلتر و مدیریت اعضای باشگاه',
      iconName: 'users',
      actions: `<a href="/admin/export/customers.csv" class="btn btn-ghost btn-sm">${icon('download', 'w-4 h-4')} خروجی CSV</a>
        <button type="button" id="open-add" class="btn btn-primary btn-sm">${icon('plus', 'w-4 h-4')} مشتری جدید</button>`,
    })}

    <form method="get" action="/admin/customers" class="glass rounded-2xl p-4 mb-4">
      <div class="grid sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto] gap-2.5">
        <div class="relative">
          <span class="absolute right-3 top-1/2 -translate-y-1/2 text-cream/30">${icon('search', 'w-4 h-4')}</span>
          <input type="search" name="q" value="${escapeHtml(params.q ?? '')}" class="field !pr-10" placeholder="نام، شماره موبایل یا کد معرف…" />
        </div>
        <select name="tier" class="field sm:w-auto" onchange="this.form.submit()">
          <option value="">همه سطح‌ها</option>
          ${['bronze', 'silver', 'gold', 'vip']
            .map(
              (tier) =>
                `<option value="${tier}" ${params.tier === tier ? 'selected' : ''}>${TIER_META[tier].label}</option>`
            )
            .join('')}
        </select>
        <select name="status" class="field sm:w-auto" onchange="this.form.submit()">
          <option value="">همه وضعیت‌ها</option>
          <option value="active" ${params.status === 'active' ? 'selected' : ''}>فعال</option>
          <option value="sleeping" ${params.status === 'sleeping' ? 'selected' : ''}>در خطر ریزش</option>
          <option value="no_visit" ${params.status === 'no_visit' ? 'selected' : ''}>بدون خرید</option>
        </select>
        <select name="sort" class="field sm:w-auto" onchange="this.form.submit()">
          <option value="">آخرین خرید</option>
          <option value="points" ${params.sort === 'points' ? 'selected' : ''}>بیشترین امتیاز</option>
          <option value="created" ${params.sort === 'created' ? 'selected' : ''}>تازه‌ترین عضویت</option>
          <option value="name" ${params.sort === 'name' ? 'selected' : ''}>نام (الفبا)</option>
        </select>
        <button type="submit" class="btn btn-primary btn-sm">${icon('filter', 'w-4 h-4')} اعمال</button>
      </div>
    </form>

    <div class="hidden md:block glass rounded-3xl overflow-hidden">
      ${
        customers.length === 0
          ? emptyState({
              title: 'مشتری‌ای پیدا نشد',
              message: 'فیلترها را تغییر دهید یا مشتری جدید اضافه کنید.',
              iconName: 'users',
              action: `<button type="button" onclick="document.getElementById('open-add').click()" class="btn btn-primary btn-sm">${icon('plus', 'w-4 h-4')} مشتری جدید</button>`,
            })
          : `<div class="table-wrap">
              <table class="data">
                <thead><tr><th>مشتری</th><th>سطح</th><th>امتیاز</th><th>خریدها</th><th>مجموع خرید</th><th>آخرین خرید</th><th>وضعیت</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            ${pagination}`
      }
    </div>

    <div class="md:hidden space-y-2.5">
      ${customers.length === 0 ? `<div class="glass rounded-2xl py-10 text-center text-xs text-cream/40">مشتری‌ای پیدا نشد.</div>` : cards}
      ${customers.length === 0 ? '' : pagination}
    </div>
  </div>

  <!-- Add customer modal -->
  <div id="add-modal" class="hidden modal-backdrop">
    <div class="modal-panel glass-strong rounded-3xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold">مشتری جدید</h2>
        <button type="button" id="close-add" class="w-8 h-8 rounded-lg text-cream/40 hover:text-cream hover:bg-white/5 flex items-center justify-center">${icon('close', 'w-4 h-4')}</button>
      </div>
      <form id="add-form" class="space-y-4">
        <div>
          <label class="label">نام و نام خانوادگی</label>
          <input id="add-name" type="text" class="field" maxlength="60" placeholder="مثلاً علی رضایی" required />
        </div>
        <div>
          <label class="label">شماره موبایل</label>
          <input id="add-phone" type="tel" inputmode="numeric" dir="ltr" class="field text-left tracking-wider" placeholder="09xxxxxxxxx" maxlength="13" required />
        </div>
        <div>
          <label class="label">تاریخ تولد</label>
          <div class="grid grid-cols-3 gap-2">
            <select id="add-day" class="field"></select>
            <select id="add-month" class="field">
              ${['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
                .map((m, i) => `<option value="${i + 1}">${m}</option>`)
                .join('')}
            </select>
            <select id="add-year" class="field"></select>
          </div>
        </div>
        <div>
          <label class="label">کد معرف <span class="text-cream/30">(اختیاری)</span></label>
          <input id="add-referral" type="text" dir="ltr" class="field text-left tracking-wider" placeholder="REF-XXXXXX" maxlength="30" />
        </div>
        <div class="flex gap-2 pt-1">
          <button type="button" id="cancel-add" class="btn btn-ghost flex-1">انصراف</button>
          <button type="submit" id="add-submit" class="btn btn-primary flex-1">${icon('plus', 'w-4 h-4')} افزودن</button>
        </div>
      </form>
    </div>
  </div>
  `;

  const scripts = `
  (function () {
    var modal = $('#add-modal');
    initJalaliPickers($('#add-day'), $('#add-month'), $('#add-year'), '', 90);

    $('#open-add').addEventListener('click', function () { modal.classList.remove('hidden'); $('#add-name').focus(); });
    $('#close-add').addEventListener('click', function () { modal.classList.add('hidden'); });
    $('#cancel-add').addEventListener('click', function () { modal.classList.add('hidden'); });
    modal.addEventListener('click', function (event) { if (event.target === modal) modal.classList.add('hidden'); });

    function normalizePhone(value) {
      var v = String(value || '').replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); });
      v = v.replace(/[\\s\\-()]/g, '');
      if (v.indexOf('+98') === 0) v = '0' + v.slice(3);
      else if (v.indexOf('0098') === 0) v = '0' + v.slice(4);
      else if (v.indexOf('98') === 0 && v.length === 12) v = '0' + v.slice(2);
      else if (v.indexOf('9') === 0 && v.length === 10) v = '0' + v;
      return v;
    }

    $('#add-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var name = $('#add-name').value.trim();
      var phone = normalizePhone($('#add-phone').value);
      var birth = readJalaliPickers($('#add-day'), $('#add-month'), $('#add-year'));
      var referral = $('#add-referral').value.trim();
      if (name.length < 2) { toast('نام را کامل وارد کنید.', 'error'); return; }
      if (!/^09\\d{9}$/.test(phone)) { toast('شماره موبایل معتبر نیست.', 'error'); return; }

      var btn = $('#add-submit');
      setLoading(btn, true, 'در حال ثبت…');
      try {
        await api('/api/admin/customers', { method: 'POST', body: { name: name, phone: phone, birth_date: birth, referral: referral } });
        toast('مشتری با موفقیت اضافه شد.', 'success');
        modal.classList.add('hidden');
        setTimeout(function () { window.location.reload(); }, 900);
      } catch (error) {
        toast(error.message, 'error');
        setLoading(btn, false);
      }
    });
  })();
  `;

  return appShell({
    title: 'مشتریان',
    role: 'admin' as Role,
    userName,
    active: 'customers',
    body,
    scripts,
    cafeName: settings.cafe_name,
  });
}

/* ==========================================================================
 * ۳) جزئیات مشتری
 * ========================================================================== */

export function adminCustomerDetailPage(input: {
  settings: AppSettings;
  userName: string;
  user: UserRow;
  invoices: InvoiceRow[];
  coupons: CouponRow[];
  referrer: { id: number; name: string; phone: string } | null;
  referrals: Array<{ id: number; name: string; created_at: string; rewarded: boolean }>;
  totalSpent: number;
  visitCount: number;
}): string {
  const { settings, userName, user, invoices, coupons, referrer, referrals, totalSpent, visitCount } = input;
  const status = customerActivityStatus(user, settings.churn_grace_days);

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
    <a href="/admin/customers" class="inline-flex items-center gap-1.5 text-[11.5px] text-cream/45 hover:text-gold mb-4 transition">
      ${icon('right', 'w-3.5 h-3.5')} بازگشت به فهرست مشتریان
    </a>

    <div class="glass rounded-3xl p-5 sm:p-6 mb-4 relative overflow-hidden">
      <div class="absolute -top-24 -left-16 w-64 h-64 rounded-full bg-gold/10 blur-3xl"></div>
      <div class="relative flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-300 to-amber-800 text-coffee-950 text-2xl font-extrabold flex items-center justify-center shadow-lg shadow-amber-900/30">
          ${escapeHtml(user.name.slice(0, 1))}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="text-xl font-extrabold">${escapeHtml(user.name)}</h1>
            ${tierBadge(user.tier)}
            <span class="badge tone-${status.tone}">${status.label}</span>
            ${user.is_active === 0 ? '<span class="badge tone-danger">غیرفعال</span>' : ''}
          </div>
          <div class="flex items-center gap-4 mt-1.5 text-[11.5px] text-cream/45 flex-wrap">
            <span class="font-mono" dir="ltr">${escapeHtml(user.phone)}</span>
            <span>عضو از ${formatJalali(user.created_at)}</span>
            <span class="font-mono" dir="ltr">${escapeHtml(user.referral_code ?? '—')}</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" id="open-coupon" class="btn btn-ghost btn-sm">${icon('gift', 'w-4 h-4')} کد تخفیف</button>
          ${
            user.is_active === 1
              ? `<button type="button" id="deactivate" class="btn btn-danger btn-sm">${icon('close', 'w-4 h-4')} غیرفعال</button>`
              : `<button type="button" id="activate" class="btn btn-primary btn-sm">${icon('check', 'w-4 h-4')} فعال‌سازی</button>`
          }
        </div>
      </div>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      ${statCard({ label: 'امتیاز فعلی', value: formatNumberFa(user.points), iconName: 'star', accent: 'gold' })}
      ${statCard({ label: 'مجموع خرید', value: formatNumberFa(totalSpent), unit: 'تومان', iconName: 'wallet', accent: 'emerald' })}
      ${statCard({ label: 'تعداد خرید', value: formatNumberFa(visitCount), iconName: 'receipt', accent: 'sky' })}
      ${statCard({
        label: 'میانگین فاصله خرید',
        value: user.avg_visit_interval > 0 ? `${toPersianDigits(user.avg_visit_interval)}` : '—',
        unit: user.avg_visit_interval > 0 ? 'روز' : undefined,
        iconName: 'clock',
        accent: 'rose',
      })}
    </div>

    <div class="grid lg:grid-cols-[1.1fr_.9fr] gap-4 mb-4">
      ${panel({
        title: 'ویرایش اطلاعات',
        iconName: 'edit',
        body: `<form id="edit-form" class="p-5 space-y-4">
          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <label class="label">نام و نام خانوادگی</label>
              <input id="e-name" type="text" class="field" maxlength="60" value="${escapeHtml(user.name)}" />
            </div>
            <div>
              <label class="label">شماره موبایل</label>
              <input id="e-phone" type="tel" dir="ltr" class="field text-left tracking-wider" maxlength="13" value="${escapeHtml(user.phone)}" />
            </div>
          </div>
          <div>
            <label class="label">تاریخ تولد</label>
            <div class="grid grid-cols-3 gap-2">
              <select id="e-day" class="field"></select>
              <select id="e-month" class="field">
                ${['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
                  .map((m, i) => `<option value="${i + 1}">${m}</option>`)
                  .join('')}
              </select>
              <select id="e-year" class="field"></select>
            </div>
          </div>
          <div class="flex justify-end">
            <button type="submit" id="save-btn" class="btn btn-primary btn-sm">${icon('check', 'w-4 h-4')} ذخیره تغییرات</button>
          </div>
        </form>`,
      })}

      ${panel({
        title: 'تنظیم امتیاز',
        iconName: 'star',
        body: `<form id="points-form" class="p-5 space-y-4">
          <div>
            <label class="label">تغییر امتیاز</label>
            <div class="flex gap-2">
              <input id="p-delta" type="number" class="field text-left" dir="ltr" placeholder="مثلاً 100 یا -50" />
              <button type="submit" id="points-btn" class="btn btn-primary btn-sm shrink-0">اعمال</button>
            </div>
            <p class="hint">عدد مثبت برای افزودن و عدد منفی برای کسر امتیاز. امتیاز منفی اعمال نمی‌شود.</p>
          </div>
          <div class="rounded-xl bg-black/25 border border-white/10 p-3 text-[11px] text-cream/50 leading-6">
            سطح فعلی: <span class="text-cream font-semibold">${tierLabel(user.tier)}</span>
            — پس از تنظیم، سطح به‌صورت خودکار بازمحاسبه می‌شود.
          </div>
          <div class="text-[11px] text-cream/40 leading-6">
            ${referrer ? `معرف: <a href="/admin/customers/${referrer.id}" class="text-gold hover:underline">${escapeHtml(referrer.name)}</a>` : 'بدون معرف'}
          </div>
        </form>`,
      })}
    </div>

    ${panel({
      title: 'فاکتورها',
      iconName: 'receipt',
      actions: `<span class="badge tone-muted">${toPersianDigits(visitCount)} فاکتور</span>`,
      body:
        invoices.length === 0
          ? emptyState({ title: 'فاکتوری ثبت نشده', message: 'این مشتری هنوز خریدی ثبت نکرده است.', iconName: 'receipt' })
          : `<div class="table-wrap max-h-[420px] overflow-y-auto">
              <table class="data">
                <thead><tr><th>#</th><th>مبلغ</th><th>تخفیف</th><th>امتیاز</th><th>کد</th><th>تاریخ</th></tr></thead>
                <tbody>
                  ${invoices
                    .map(
                      (invoice) => `<tr>
                        <td class="text-cream/35 text-[11px]">${toPersianDigits(invoice.id)}</td>
                        <td class="font-bold text-amber-200 whitespace-nowrap">${formatNumberFa(invoice.amount)}</td>
                        <td class="text-[11px] text-emerald-300/70">${invoice.discount > 0 ? formatNumberFa(invoice.discount) : '—'}</td>
                        <td class="text-[11px]">+${toPersianDigits(invoice.points_earned)}</td>
                        <td class="text-[10.5px] text-cream/40 font-mono" dir="ltr">${escapeHtml(invoice.coupon_code ?? '—')}</td>
                        <td class="text-[10.5px] text-cream/40 whitespace-nowrap">${formatJalaliDateTime(invoice.created_at)}</td>
                      </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`,
    })}

    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      ${panel({
        title: 'کدهای تخفیف',
        iconName: 'gift',
        body:
          coupons.length === 0
            ? `<p class="text-[11px] text-cream/35 text-center py-6">کد تخفیفی ندارد.</p>`
            : `<div class="divide-y divide-white/5 max-h-[300px] overflow-y-auto">
                ${coupons
                  .map((coupon) => {
                    const expired = coupon.expires_at ? Date.parse(`${coupon.expires_at.replace(' ', 'T')}Z`) < Date.now() : false;
                    const inactive = coupon.is_active === 0 || expired || coupon.used_count >= coupon.max_uses;
                    return `<div class="px-4 py-3 flex items-center justify-between gap-2">
                      <div>
                        <div class="font-mono text-[11.5px] tracking-wider" dir="ltr">${escapeHtml(coupon.code)}</div>
                        <div class="text-[10px] text-cream/35 mt-0.5">
                          ${coupon.kind === 'percent' ? `${toPersianDigits(coupon.value)}٪ تخفیف` : `${formatNumberFa(coupon.value)} تومان`}
                          · ${toPersianDigits(coupon.used_count)}/${toPersianDigits(coupon.max_uses)} استفاده
                          ${coupon.expires_at ? ` · تا ${formatJalali(coupon.expires_at)}` : ''}
                        </div>
                      </div>
                      <span class="badge ${inactive ? 'tone-muted' : 'tone-success'}">${inactive ? 'استفاده‌شده' : 'فعال'}</span>
                    </div>`;
                  })
                  .join('')}
              </div>`,
      })}

      ${panel({
        title: 'معرفی‌ها',
        iconName: 'users',
        body:
          referrals.length === 0
            ? `<p class="text-[11px] text-cream/35 text-center py-6">هنوز کسی را معرفی نکرده است.</p>`
            : `<div class="divide-y divide-white/5">
                ${referrals
                  .map(
                    (referral) => `<a href="/admin/customers/${referral.id}" class="px-4 py-3 flex items-center justify-between gap-2 hover:bg-white/[0.03] transition">
                      <div class="text-[12px]">${escapeHtml(referral.name)}</div>
                      <div class="flex items-center gap-2">
                        <span class="badge ${referral.rewarded ? 'tone-success' : 'tone-muted'}">${referral.rewarded ? 'پاداش داده شد' : 'در انتظار خرید'}</span>
                        <span class="text-[10px] text-cream/30">${formatJalali(referral.created_at)}</span>
                      </div>
                    </a>`
                  )
                  .join('')}
              </div>`,
      })}
    </div>
  </div>

  <!-- Coupon modal -->
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
          <input id="cp-max" type="number" class="field text-left" dir="ltr" value="1" min="1" max="100" />
        </div>
        <button type="button" id="create-coupon" class="btn btn-primary w-full">${icon('gift', 'w-4 h-4')} ساخت کد</button>
      </div>
    </div>
  </div>
  `;

  const scripts = `
  (function () {
    var userId = ${user.id};
    initJalaliPickers($('#e-day'), $('#e-month'), $('#e-year'), ${jsonForScript(user.birth_date ?? '')}, 90);

    $('#edit-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var name = $('#e-name').value.trim();
      var phone = $('#e-phone').value.trim();
      var birth = readJalaliPickers($('#e-day'), $('#e-month'), $('#e-year'));
      if (name.length < 2) { toast('نام را کامل وارد کنید.', 'error'); return; }
      var btn = $('#save-btn');
      setLoading(btn, true, 'در حال ذخیره…');
      try {
        await api('/api/admin/customers/' + userId, { method: 'PUT', body: { name: name, phone: phone, birth_date: birth } });
        toast('اطلاعات ذخیره شد.', 'success');
        setTimeout(function () { window.location.reload(); }, 800);
      } catch (error) {
        toast(error.message, 'error');
        setLoading(btn, false);
      }
    });

    $('#points-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var delta = Number($('#p-delta').value);
      if (!delta) { toast('مقدار تغییر را وارد کنید.', 'error'); return; }
      var btn = $('#points-btn');
      setLoading(btn, true, '');
      try {
        var result = await api('/api/admin/customers/' + userId + '/points', { method: 'POST', body: { delta: delta } });
        toast('امتیاز جدید: ' + fa(result.points), 'success');
        setTimeout(function () { window.location.reload(); }, 800);
      } catch (error) {
        toast(error.message, 'error');
        setLoading(btn, false);
      }
    });

    function toggleActive(action) {
      return async function () {
        var ok = await confirmAction({
          title: action === 'deactivate' ? 'غیرفعال کردن مشتری' : 'فعال‌سازی مشتری',
          message: action === 'deactivate' ? 'این مشتری دیگر پیامک دریافت نمی‌کند و امتیازش حفظ می‌شود.' : 'مشتری دوباره فعال می‌شود.',
          confirmText: action === 'deactivate' ? 'غیرفعال کن' : 'فعال کن',
          danger: action === 'deactivate'
        });
        if (!ok) return;
        try {
          await api('/api/admin/customers/' + userId + '/' + action, { method: 'POST' });
          toast('وضعیت مشتری به‌روزرسانی شد.', 'success');
          setTimeout(function () { window.location.reload(); }, 700);
        } catch (error) {
          toast(error.message, 'error');
        }
      };
    }
    if ($('#deactivate')) $('#deactivate').addEventListener('click', toggleActive('deactivate'));
    if ($('#activate')) $('#activate').addEventListener('click', toggleActive('activate'));

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
            userId: userId,
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
  })();
  `;

  return appShell({
    title: user.name,
    role: 'admin' as Role,
    userName,
    active: 'customers',
    body,
    scripts,
    cafeName: settings.cafe_name,
  });
}

/* ==========================================================================
 * ۴) فهرست فاکتورها
 * ========================================================================== */

export function adminInvoicesPage(input: {
  settings: AppSettings;
  userName: string;
  invoices: InvoiceListItem[];
  total: number;
  sum: number;
  page: number;
  pageSize: number;
  filters: { q?: string; from?: string; to?: string };
}): string {
  const { settings, userName, invoices, total, sum, page, pageSize, filters } = input;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageLink = (newPage: number): string => {
    const search = new URLSearchParams();
    if (filters.q) search.set('q', filters.q);
    if (filters.from) search.set('from', filters.from);
    if (filters.to) search.set('to', filters.to);
    search.set('page', String(newPage));
    return `/admin/invoices?${search.toString()}`;
  };

  const body = `
  <div class="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
    ${pageHeader({
      title: 'فاکتورها',
      subtitle: 'تمام خریدهای ثبت‌شده در باشگاه',
      iconName: 'receipt',
      actions: `<a href="/staff" class="btn btn-primary btn-sm">${icon('plus', 'w-4 h-4')} ثبت فاکتور</a>`,
    })}

    <div class="grid grid-cols-2 gap-3 mb-4">
      ${statCard({ label: 'تعداد فاکتورها', value: formatNumberFa(total), iconName: 'receipt', accent: 'gold' })}
      ${statCard({ label: 'مجموع فروش', value: formatNumberFa(sum), unit: 'تومان', iconName: 'wallet', accent: 'emerald' })}
    </div>

    <form method="get" action="/admin/invoices" class="glass rounded-2xl p-4 mb-4">
      <div class="grid sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] gap-2.5">
        <input type="search" name="q" value="${escapeHtml(filters.q ?? '')}" class="field" placeholder="نام یا شماره مشتری…" />
        <div>
          <input type="date" name="from" value="${escapeHtml(filters.from ?? '')}" class="field" dir="ltr" title="از تاریخ (میلادی)" />
        </div>
        <div>
          <input type="date" name="to" value="${escapeHtml(filters.to ?? '')}" class="field" dir="ltr" title="تا تاریخ (میلادی)" />
        </div>
        <button type="submit" class="btn btn-primary btn-sm">${icon('filter', 'w-4 h-4')} فیلتر</button>
      </div>
      <p class="hint">بازه تاریخ را به میلادی انتخاب کنید؛ در جدول به شمسی نمایش داده می‌شود.</p>
    </form>

    <div class="glass rounded-3xl overflow-hidden">
      ${
        invoices.length === 0
          ? emptyState({ title: 'فاکتوری یافت نشد', message: 'با تغییر فیلترها دوباره تلاش کنید.', iconName: 'receipt' })
          : `<div class="table-wrap">
              <table class="data">
                <thead><tr><th>#</th><th>مشتری</th><th>آیتم‌ها</th><th>مبلغ</th><th>تخفیف</th><th>امتیاز</th><th>ثبت‌کننده</th><th>تاریخ</th></tr></thead>
                <tbody>
                  ${invoices
                    .map(
                      (invoice) => `<tr>
                        <td class="text-cream/30 text-[11px]">${toPersianDigits(invoice.id)}</td>
                        <td>
                          <a href="/admin/customers/${invoice.user_id}" class="text-[12.5px] hover:text-gold transition block">${escapeHtml(invoice.customer_name)}</a>
                          <span class="text-[10px] text-cream/30 font-mono" dir="ltr">${escapeHtml(invoice.customer_phone)}</span>
                        </td>
                        <td class="text-[11px] text-cream/45 max-w-[200px] truncate">${escapeHtml(invoiceItemNames(invoice.items))}</td>
                        <td class="font-bold text-amber-200 whitespace-nowrap text-[12.5px]">${formatNumberFa(invoice.amount)}</td>
                        <td class="text-[11px] text-emerald-300/70">${invoice.discount > 0 ? formatNumberFa(invoice.discount) : '—'}</td>
                        <td class="text-[11px] text-cream/60">+${toPersianDigits(invoice.points_earned)}</td>
                        <td class="text-[11px] text-cream/45">${escapeHtml(invoice.staff_name ?? '—')}</td>
                        <td class="text-[10.5px] text-cream/40 whitespace-nowrap">${formatJalaliDateTime(invoice.created_at)}</td>
                      </tr>`
                    )
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
    title: 'فاکتورها',
    role: 'admin' as Role,
    userName,
    active: 'invoices',
    body,
    cafeName: settings.cafe_name,
  });
}

function invoiceItemNames(raw: string): string {
  try {
    const items = JSON.parse(raw || '[]') as Array<{ name: string; qty: number }>;
    if (!Array.isArray(items) || items.length === 0) return '—';
    return items.map((item) => `${item.name} ×${item.qty}`).join('، ');
  } catch {
    return '—';
  }
}

/** خروجی CSV مشتریان */
export function customersCsv(rows: CustomerListItem[]): string {
  const header = [
    'id',
    'name',
    'phone',
    'tier',
    'points',
    'visits',
    'total_spent',
    'last_visit',
    'birth_date',
    'referral_code',
    'created_at',
  ];
  const lines = [header.join(',')];

  for (const row of rows) {
    lines.push(
      [
        row.id,
        csvCell(String(row.name)),
        csvCell(row.phone),
        row.tier,
        row.points,
        row.visits,
        row.total_spent,
        row.last_visit_date ?? '',
        row.birth_date ?? '',
        csvCell(row.referral_code ?? ''),
        row.created_at,
      ].join(',')
    );
  }
  return '\uFEFF' + lines.join('\r\n');
}

/**
 * امن‌سازی سلول CSV:
 *  - جلوگیری از CSV/Formula Injection در اکسل (=, +, -, @)
 *  - فرار دادن کوتیشن‌ها
 */
function csvCell(value: string): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/* ==========================================================================
 * ۵) صفحه‌ی خطای پنل
 * ========================================================================== */

export function adminErrorPage(settings: AppSettings, userName: string, message: string): string {
  return appShell({
    title: 'خطا',
    role: 'admin' as Role,
    userName,
    active: 'dashboard',
    cafeName: settings.cafe_name,
    body: `<div class="p-8">${emptyState({ title: 'خطا در بارگذاری', message, iconName: 'warning' })}</div>`,
  });
}

/** تاریخ شمسی کوتاه با سال */
export function jalaliWithYear(value: string | null | undefined): string {
  return formatJalali(value);
}

/** مبلغ با واحد */
export function amountWithUnit(value: number): string {
  return `${formatMoney(value)} تومان`;
}
