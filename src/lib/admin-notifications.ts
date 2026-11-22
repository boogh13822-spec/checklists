/** گزارش‌های مدیریت مستقل از SMS، روی همان صف رمز‌شده و مقصدهای موجود. */
import type { Bindings, InvoiceItem } from '../types';
import { logAdminAction } from './db';
import { enqueueFallback, loadFallbackConfig } from './fallback';
import { formatJalaliDateTime, formatNumberFa, safeJsonParse } from './utils';

const ACTIONS: Record<string, string> = {
  invoice_void: 'ابطال فاکتور', invoice_correct: 'اصلاح فاکتور', points_adjust: 'تغییر دستی امتیاز',
  shift_open: 'باز شدن صندوق', shift_close: 'بستن صندوق', cash_in: 'ورود نقد به صندوق', cash_out: 'خروج نقد از صندوق',
  settings_update: 'تغییر تنظیمات و سیاست باشگاه', customer_update: 'تغییر وضعیت مشتری', customer_delete: 'حذف مشتری',
  staff_password_reset: 'بازنشانی رمز کارمند', staff_delete: 'حذف کارمند', password_change: 'تغییر رمز عبور',
};

/** Best-effort local trace, without recursively trying to deliver another report. */
async function reportFailure(env: Bindings, targetType: string, targetId: number, error: unknown) {
  console.error('ADMIN_REPORT_QUEUE_FAILED', targetType, targetId);
  await logAdminAction(env.DB, { adminId: null, adminName: 'سیستم', action: 'admin_report_failed', targetType, targetId,
    details: error instanceof Error && error.message === 'QUEUE_FULL'
      ? 'گزارش مدیریت در صف ثبت نشد: ظرفیت صف پر است. عملیات اصلی انجام شده است.'
      : 'گزارش مدیریت در صف ثبت نشد: تنظیمات، کلید رمزنگاری یا پایگاه داده بررسی شود. عملیات اصلی انجام شده است.' });
}

/** Failures never turn a committed financial operation into an HTTP failure. */
export async function notifyAdminAction(env: Bindings, log: {
  id: number; action: string; actor: string; targetId?: string | number | null; details?: string;
}): Promise<void> {
  const title = ACTIONS[log.action];
  if (!title) return; // Never forward raw auth payloads, secrets or arbitrary log categories.
  try {
    await enqueueFallback(env, { phone: '', userId: null,
      type: log.action.startsWith('invoice_') ? 'report_invoice' : 'report_action',
      title: `گزارش مدیریت | ${title}`, eventKey: `audit:${log.id}`,
      message: [`انجام‌دهنده: ${log.actor.slice(0,80)}`, log.targetId != null ? `شناسه مرتبط: ${log.targetId}` : '',
        (log.details ?? '').slice(0,700), `شناسه گزارش: ${log.id}`].filter(Boolean).join('\n'),
    }, 'event');
  } catch (error) { await reportFailure(env, 'audit', log.id, error); }
}

/** Build the report from persisted data, never trust the request's amount or items. */
export async function notifyAdminInvoice(env: Bindings, invoiceId: number): Promise<void> {
  try {
    const config = await loadFallbackConfig(env);
    if (!config.notifyEnabled || config.notifyInvoices === false) return;
    const row = await env.DB.prepare(`SELECT i.*,u.name AS customer_name,u.phone,s.name AS staff_name
      FROM invoices i JOIN users u ON u.id=i.user_id LEFT JOIN users s ON s.id=i.registered_by
      WHERE i.id=? AND i.voided_at IS NULL`).bind(invoiceId).first<{
        id: number; user_id: number; phone: string; customer_name: string; staff_name: string | null;
        amount: number; subtotal: number; discount: number; points_earned: number; items: string;
        paid_cash: number; paid_card: number; paid_online: number; change_amount: number;
        created_at: string; payment_method: string | null;
      }>();
    if (!row) return;
    const parsed = safeJsonParse<InvoiceItem[]>(row.items, []);
    const items = Array.isArray(parsed) ? parsed.filter(i => i && typeof i.name === 'string') : [];
    const lines = (Array.isArray(items) ? items : []).slice(0,10).map(i =>
      `• ${String(i.name).slice(0,60)} × ${i.qty} | ${formatNumberFa(i.price * i.qty)} تومان`);
    if (items.length > 10) lines.push(`و ${formatNumberFa(items.length - 10)} ردیف دیگر؛ جزئیات کامل در پنل.`);
    const message = [
      `فاکتور #${row.id} | مشتری: ${row.customer_name}`,
      `ثبت‌کننده: ${row.staff_name ?? 'کاربر حذف‌شده'}`,
      `زمان ثبت: ${formatJalaliDateTime(row.created_at)}`,
      `جمع اقلام: ${formatNumberFa(row.subtotal)} تومان`,
      `تخفیف: ${formatNumberFa(row.discount)} تومان`,
      `مبلغ نهایی: ${formatNumberFa(row.amount)} تومان`,
      row.payment_method
        ? `پرداخت مؤثر: نقد ${formatNumberFa(row.paid_cash)} | کارت ${formatNumberFa(row.paid_card)} | آنلاین ${formatNumberFa(row.paid_online)} تومان`
        : 'اطلاعات روش پرداخت ثبت نشده است.',
      row.change_amount ? `باقیمانده برگشتی: ${formatNumberFa(row.change_amount)} تومان (از نقد مؤثر کسر شده)` : '',
      `امتیاز این فاکتور: ${formatNumberFa(row.points_earned)}`,
      ...lines,
    ].filter(Boolean).join('\n');
    await enqueueFallback(env, { phone: row.phone, userId: row.user_id, type: 'report_invoice',
      title: 'گزارش مدیریت | فاکتور جدید', eventKey: `invoice:${row.id}`, message }, 'event');
  } catch (error) { await reportFailure(env, 'invoice', invoiceId, error); }
}
