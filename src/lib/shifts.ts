/**
 * ----------------------------------------------------------------------------
 *  مدیریت شیفت صندوق (Cash Register / Shift Management)
 * ----------------------------------------------------------------------------
 *  هر کارمند صندوق را با «مبلغ اولیه» باز می‌کند، در طول شیفت دریافت/پرداخت
 *  نقدی ثبت می‌کند و در پایان با «مبلغ شمارش‌شده» می‌بندد.
 *
 *  مبلغ مورد انتظار = مبلغ اولیه + فروش نقدی (فاکتورهای معتبر) + دریافت‌ها − پرداخت‌ها
 *  اختلاف = مبلغ شمارش‌شده − مبلغ مورد انتظار
 *
 *  نکتهٔ مهم: گزارش هر شیفت همیشه از روی فاکتورهای معتبر (voided_at IS NULL)
 *  و تراکنش‌های نقدی دوباره محاسبه می‌شود؛ عکس لحظهٔ بستن فقط برای حسابرسی است.
 * ----------------------------------------------------------------------------
 */
import type {
  Bindings,
  CashMovementRow,
  ShiftRow,
} from '../types';
import { formatNumberFa, toPersianDigits } from './utils';

/* ==========================================================================
 *  خواندن
 * ========================================================================== */

/** شیفت باز یک کارمند (یا null) */
export async function getOpenShift(db: D1Database, staffId: number): Promise<ShiftRow | null> {
  const row = await db
    .prepare(`SELECT * FROM shifts WHERE staff_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`)
    .bind(staffId)
    .first<ShiftRow>();
  return row ?? null;
}

/** شیفت باز هر کارمندی در کافه (برای هشدار مدیر) */
export async function listOpenShifts(db: D1Database): Promise<ShiftRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM shifts WHERE status = 'open' ORDER BY opened_at ASC`)
    .all<ShiftRow>();
  return results ?? [];
}

export type ShiftSummary = {
  invoiceCount: number;
  cashSales: number;
  cardSales: number;
  onlineSales: number;
  totalSales: number;
  totalDiscount: number;
  voidCount: number;
  voidAmount: number;
  movementsIn: number;
  movementsOut: number;
  expectedCash: number;
  difference: number | null;
};

/**
 * آمار زندهٔ یک شیفت از روی داده‌های واقعی.
 * سه کوئری ثابت (بدون وابستگی به تعداد فاکتورها).
 */
export async function getShiftSummary(db: D1Database, shift: ShiftRow): Promise<ShiftSummary> {
  const invoices = await db
    .prepare(
      `SELECT COUNT(*) AS c,
              COALESCE(SUM(amount), 0) AS total,
              COALESCE(SUM(discount), 0) AS discount,
              COALESCE(SUM(paid_cash), 0) AS cash,
              COALESCE(SUM(paid_card), 0) AS card,
              COALESCE(SUM(paid_online), 0) AS online
       FROM invoices
       WHERE shift_id = ? AND voided_at IS NULL`
    )
    .bind(shift.id)
    .first<{ c: number; total: number; discount: number; cash: number; card: number; online: number }>();

  const voided = await db
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS s
       FROM invoices WHERE shift_id = ? AND voided_at IS NOT NULL`
    )
    .bind(shift.id)
    .first<{ c: number; s: number }>();

  const movements = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'in'  THEN amount ELSE 0 END), 0) AS in_sum,
         COALESCE(SUM(CASE WHEN kind = 'out' THEN amount ELSE 0 END), 0) AS out_sum
       FROM cash_movements WHERE shift_id = ?`
    )
    .bind(shift.id)
    .first<{ in_sum: number; out_sum: number }>();

  const cashSales = invoices?.cash ?? 0;
  const movementsIn = movements?.in_sum ?? 0;
  const movementsOut = movements?.out_sum ?? 0;
  const expectedCash = shift.opening_cash + cashSales + movementsIn - movementsOut;
  const counted = shift.counted_cash;

  return {
    invoiceCount: invoices?.c ?? 0,
    cashSales,
    cardSales: invoices?.card ?? 0,
    onlineSales: invoices?.online ?? 0,
    totalSales: invoices?.total ?? 0,
    totalDiscount: invoices?.discount ?? 0,
    voidCount: voided?.c ?? 0,
    voidAmount: voided?.s ?? 0,
    movementsIn,
    movementsOut,
    expectedCash,
    difference: counted === null || counted === undefined ? null : counted - expectedCash,
  };
}

export type ShiftDetail = {
  shift: ShiftRow;
  summary: ShiftSummary;
  movements: CashMovementRow[];
  invoices: Array<{
    id: number;
    amount: number;
    discount: number;
    payment_method: string | null;
    paid_cash: number;
    paid_card: number;
    paid_online: number;
    change_amount: number;
    points_earned: number;
    created_at: string;
    voided_at: string | null;
    customer_name: string;
    customer_phone: string;
  }>;
};

/** جزئیات کامل یک شیفت برای صفحهٔ گزارش */
export async function getShiftDetail(db: D1Database, shiftId: number): Promise<ShiftDetail | null> {
  const shift = await db.prepare('SELECT * FROM shifts WHERE id = ?').bind(shiftId).first<ShiftRow>();
  if (!shift) return null;

  const [summary, movementsRes, invoicesRes] = await Promise.all([
    getShiftSummary(db, shift),
    db
      .prepare('SELECT * FROM cash_movements WHERE shift_id = ? ORDER BY id ASC')
      .bind(shiftId)
      .all<CashMovementRow>(),
    db
      .prepare(
        `SELECT i.id, i.amount, i.discount, i.payment_method, i.paid_cash, i.paid_card, i.paid_online,
                i.change_amount, i.points_earned, i.created_at, i.voided_at,
                u.name AS customer_name, u.phone AS customer_phone
         FROM invoices i
         JOIN users u ON u.id = i.user_id
         WHERE i.shift_id = ?
         ORDER BY i.id DESC
         LIMIT 300`
      )
      .bind(shiftId)
      .all<ShiftDetail['invoices'][number]>(),
  ]);

  return {
    shift,
    summary,
    movements: movementsRes.results ?? [],
    invoices: invoicesRes.results ?? [],
  };
}

export type ShiftListItem = ShiftRow & { expected_live: number };

/** فهرست صفحه‌بندی‌شدهٔ شیفت‌ها */
export async function listShifts(
  db: D1Database,
  params: {
    page?: number;
    pageSize?: number;
    status?: string;
    staffId?: number;
    from?: string;
    to?: string;
  } = {}
): Promise<{ items: ShiftListItem[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(5, Math.floor(params.pageSize ?? 20)));
  const offset = (page - 1) * pageSize;

  const where: string[] = ['1 = 1'];
  const binds: Array<string | number> = [];

  if (params.status === 'open' || params.status === 'closed') {
    where.push('s.status = ?');
    binds.push(params.status);
  }
  if (params.staffId) {
    where.push('s.staff_id = ?');
    binds.push(params.staffId);
  }
  if (params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from)) {
    where.push('s.opened_at >= ?');
    binds.push(`${params.from} 00:00:00`);
  }
  if (params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to)) {
    where.push('s.opened_at <= ?');
    binds.push(`${params.to} 23:59:59`);
  }

  const whereSql = where.join(' AND ');

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS c FROM shifts s WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ c: number }>();

  const { results } = await db
    .prepare(
      `SELECT s.*,
              (s.opening_cash
               + COALESCE((SELECT SUM(i.paid_cash) FROM invoices i
                           WHERE i.shift_id = s.id AND i.voided_at IS NULL), 0)
               + COALESCE((SELECT SUM(m.amount) FROM cash_movements m
                           WHERE m.shift_id = s.id AND m.kind = 'in'), 0)
               - COALESCE((SELECT SUM(m.amount) FROM cash_movements m
                           WHERE m.shift_id = s.id AND m.kind = 'out'), 0)
              ) AS expected_live
       FROM shifts s
       WHERE ${whereSql}
       ORDER BY s.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, pageSize, offset)
    .all<ShiftListItem>();

  return { items: results ?? [], total: totalRow?.c ?? 0, page, pageSize };
}

/* ==========================================================================
 *  نوشتن
 * ========================================================================== */

export type ShiftActionResult = { ok: true; shift: ShiftRow } | { ok: false; error: string; code: string };

/** باز کردن صندوق */
export async function openShift(
  env: Bindings,
  input: { staffId: number; staffName: string; openingCash: number }
): Promise<ShiftActionResult> {
  const openingCash = Math.max(0, Math.floor(Number(input.openingCash) || 0));
  if (!Number.isFinite(openingCash) || openingCash > 5_000_000_000) {
    return { ok: false, error: 'مبلغ اولیهٔ صندوق نامعتبر است.', code: 'INVALID_AMOUNT' };
  }

  const existing = await getOpenShift(env.DB, input.staffId);
  if (existing) {
    return {
      ok: false,
      error: `شما از قبل صندوق باز دارید (شیفت #${toPersianDigits(existing.id)}). اول آن را ببندید.`,
      code: 'ALREADY_OPEN',
    };
  }

  try {
    const result = await env.DB.prepare(
      `INSERT INTO shifts (staff_id, staff_name, opened_at, opening_cash, status)
       VALUES (?, ?, datetime('now'), ?, 'open')`
    )
      .bind(input.staffId, input.staffName.slice(0, 80), openingCash)
      .run();

    const id = Number(result.meta?.last_row_id ?? 0);
    const shift = await env.DB.prepare('SELECT * FROM shifts WHERE id = ?').bind(id).first<ShiftRow>();
    if (!shift) return { ok: false, error: 'خطا در باز کردن صندوق.', code: 'DB_ERROR' };
    return { ok: true, shift };
  } catch (error) {
    // مسابقه: دو درخواست هم‌زمان برای باز کردن
    if (String(error).includes('UNIQUE')) {
      return { ok: false, error: 'صندوق از قبل باز است.', code: 'ALREADY_OPEN' };
    }
    console.error('openShift failed:', error);
    return { ok: false, error: 'خطا در باز کردن صندوق.', code: 'DB_ERROR' };
  }
}

/** ثبت دریافت یا پرداخت نقدی در شیفت باز */
export async function addCashMovement(
  env: Bindings,
  input: {
    shiftId: number;
    kind: 'in' | 'out';
    amount: number;
    reason?: string | null;
    actorId: number;
  }
): Promise<{ ok: true; summary: ShiftSummary } | { ok: false; error: string; code: string }> {
  const amount = Math.floor(Number(input.amount) || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'مبلغ باید بزرگ‌تر از صفر باشد.', code: 'INVALID_AMOUNT' };
  }
  if (amount > 1_000_000_000) {
    return { ok: false, error: 'مبلغ بیش از حد مجاز است.', code: 'INVALID_AMOUNT' };
  }
  if (input.kind !== 'in' && input.kind !== 'out') {
    return { ok: false, error: 'نوع تراکنش نامعتبر است.', code: 'INVALID_KIND' };
  }

  const shift = await env.DB.prepare('SELECT * FROM shifts WHERE id = ?').bind(input.shiftId).first<ShiftRow>();
  if (!shift) return { ok: false, error: 'شیفت یافت نشد.', code: 'NOT_FOUND' };
  if (shift.status !== 'open') {
    return { ok: false, error: 'این شیفت بسته شده است؛ ثبت تراکنش ممکن نیست.', code: 'SHIFT_CLOSED' };
  }

  await env.DB.prepare(
    `INSERT INTO cash_movements (shift_id, kind, amount, reason, created_at, created_by)
     VALUES (?, ?, ?, ?, datetime('now'), ?)`
  )
    .bind(input.shiftId, input.kind, amount, String(input.reason ?? '').slice(0, 120) || null, input.actorId)
    .run();

  return { ok: true, summary: await getShiftSummary(env.DB, shift) };
}

/** بستن صندوق با مبلغ شمارش‌شده */
export async function closeShift(
  env: Bindings,
  input: {
    shiftId: number;
    countedCash: number;
    notes?: string | null;
    closedBy: number;
    closedByName: string;
    /** فقط مدیر می‌تواند صندوق کارمند دیگر را ببندد */
    allowOtherStaff?: boolean;
  }
): Promise<
  | { ok: true; shift: ShiftRow; summary: ShiftSummary }
  | { ok: false; error: string; code: string }
> {
  const counted = Math.floor(Number(input.countedCash));
  if (!Number.isFinite(counted) || counted < 0) {
    return { ok: false, error: 'مبلغ شمارش‌شده نامعتبر است.', code: 'INVALID_AMOUNT' };
  }
  if (counted > 5_000_000_000) {
    return { ok: false, error: 'مبلغ شمارش‌شده بیش از حد مجاز است.', code: 'INVALID_AMOUNT' };
  }

  const shift = await env.DB.prepare('SELECT * FROM shifts WHERE id = ?').bind(input.shiftId).first<ShiftRow>();
  if (!shift) return { ok: false, error: 'شیفت یافت نشد.', code: 'NOT_FOUND' };
  if (shift.status === 'closed') {
    return { ok: false, error: 'این شیفت قبلاً بسته شده است.', code: 'ALREADY_CLOSED' };
  }
  if (shift.staff_id !== input.closedBy && input.allowOtherStaff !== true) {
    return { ok: false, error: 'فقط صاحب صندوق یا مدیر می‌تواند آن را ببندد.', code: 'FORBIDDEN' };
  }

  const summary = await getShiftSummary(env.DB, shift);
  const difference = counted - summary.expectedCash;

  const claim = await env.DB.prepare(
    `UPDATE shifts
     SET status = 'closed',
         closed_at = datetime('now'),
         closed_by = ?,
         closed_by_name = ?,
         counted_cash = ?,
         expected_cash = ?,
         difference = ?,
         notes = ?,
         invoice_count = ?,
         cash_sales = ?,
         card_sales = ?,
         online_sales = ?,
         total_sales = ?,
         void_count = ?
     WHERE id = ? AND status = 'open'`
  )
    .bind(
      input.closedBy,
      input.closedByName.slice(0, 80),
      counted,
      summary.expectedCash,
      difference,
      String(input.notes ?? '').slice(0, 300) || null,
      summary.invoiceCount,
      summary.cashSales,
      summary.cardSales,
      summary.onlineSales,
      summary.totalSales,
      summary.voidCount,
      input.shiftId
    )
    .run();

  if (!claim.meta?.changes) {
    return { ok: false, error: 'این شیفت همین حالا بسته شد.', code: 'ALREADY_CLOSED' };
  }

  const updated = await env.DB.prepare('SELECT * FROM shifts WHERE id = ?')
    .bind(input.shiftId)
    .first<ShiftRow>();

  return {
    ok: true,
    shift: updated ?? shift,
    summary: { ...summary, difference },
  };
}

/* ==========================================================================
 *  گزارش متنی برای پیامک/خلاصه
 * ========================================================================== */

export function shiftSummaryText(shift: ShiftRow, summary: ShiftSummary): string {
  const diff = summary.difference ?? 0;
  const diffLabel =
    diff === 0
      ? 'مطابق است ✅'
      : diff > 0
        ? `${formatNumberFa(diff)} تومان اضافه`
        : `${formatNumberFa(Math.abs(diff))} تومان کسری`;

  return [
    `شیفت #${toPersianDigits(shift.id)} — ${shift.staff_name}`,
    `فروش کل: ${formatNumberFa(summary.totalSales)} تومان (${toPersianDigits(summary.invoiceCount)} فاکتور)`,
    `نقد: ${formatNumberFa(summary.cashSales)} · کارت: ${formatNumberFa(summary.cardSales)} · آنلاین: ${formatNumberFa(summary.onlineSales)}`,
    `صندوق: ${formatNumberFa(summary.expectedCash)} مورد انتظار · اختلاف: ${diffLabel}`,
  ].join('\n');
}
