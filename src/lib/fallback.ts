/**
 * صف پایدار ارسال جایگزین: D1 outbox + lease اتمیک + waitUntil / Cron.
 * «sent» در این جدول یعنی تحویل به ادمین، نه تحویل پیامک به مشترک.
 */
import type { AppSettings, Bindings } from '../types';
import { base64ToBytes, bytesToBase64, sha256Hex } from './crypto';
import { adapters, validBotToken, validChatId, type FallbackChannel } from './fallback-adapters';
import { formatJalaliDateTime, normalizePhone } from './utils';

export type ChannelConfig = { channel: FallbackChannel; chatId: string; token: string };
export type FallbackConfig = { enabled: boolean; channels: ChannelConfig[]; notifyEnabled?: boolean; notifyInvoices?: boolean; notifyActions?: boolean; configured?: true };
export type FallbackPayload = { phone: string; message: string; requestedAt: string; userId: number | null; title?: string };
export type FallbackJob = {
  id: string; channel: FallbackChannel; chat_id: string; user_id: number | null;
  type: string; payload: string; reason: string; status: string; attempts: number;
  next_at: number; expires_at: number; created_at: string; error: string | null;
  provider_id: string | null; completed_at: string | null;
};
const CONFIG_KEY = 'sms_fallback_config';

async function encryptionKey(env: Bindings): Promise<CryptoKey> {
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(env.FALLBACK_ENCRYPTION_KEY ?? ''); }
  catch { throw new Error('FALLBACK_KEY_MISSING: کلید رمزنگاری Fallback معتبر نیست.'); }
  if (bytes.length !== 32) throw new Error('FALLBACK_KEY_MISSING: ابتدا Secret با نام FALLBACK_ENCRYPTION_KEY (۳۲ بایت Base64) را تنظیم کنید.');
  return crypto.subtle.importKey('raw', bytes as unknown as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env: Bindings, value: unknown, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
    additionalData: new TextEncoder().encode(context) }, await encryptionKey(env), new TextEncoder().encode(JSON.stringify(value)));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}
export async function unseal<T>(env: Bindings, value: string, context: string): Promise<T> {
  const [version, iv, ciphertext] = value.split('.');
  if (version !== 'v1') throw new Error('INVALID_CIPHERTEXT');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) as unknown as BufferSource,
    additionalData: new TextEncoder().encode(context) }, await encryptionKey(env), base64ToBytes(ciphertext) as unknown as BufferSource);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
export async function loadFallbackConfig(env: Bindings): Promise<FallbackConfig> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(CONFIG_KEY).first<{ value: string }>();
  if (!row) return { enabled: false, channels: [] };
  return { ...JSON.parse(row.value), configured: true } as FallbackConfig;
}
async function channelToken(env: Bindings, config: ChannelConfig): Promise<string> {
  const fromEnv = config.channel === 'telegram' ? env.TELEGRAM_BOT_TOKEN : env.BALE_BOT_TOKEN;
  if (fromEnv) return fromEnv;
  return config.token ? unseal<string>(env, config.token, `token:${config.channel}`) : '';
}
export function safeFallbackConfig(env: Bindings, config: FallbackConfig) {
  let encryptionKeyConfigured = false;
  try { encryptionKeyConfigured = base64ToBytes(env.FALLBACK_ENCRYPTION_KEY ?? '').length === 32; } catch { /* invalid key */ }
  return { enabled: config.enabled, notifyEnabled: config.notifyEnabled === true,
    notifyInvoices: config.notifyInvoices !== false, notifyActions: config.notifyActions !== false, encryptionKeyConfigured,
    channels: config.channels.map(c => ({ channel: c.channel, chatId: c.chatId,
      hasToken: !!c.token || !!(c.channel === 'telegram' ? env.TELEGRAM_BOT_TOKEN : env.BALE_BOT_TOKEN),
      tokenSource: (c.channel === 'telegram' ? env.TELEGRAM_BOT_TOKEN : env.BALE_BOT_TOKEN) ? 'env' : c.token ? 'database' : 'none' })) };
}
export async function saveFallbackConfig(env: Bindings, body: unknown): Promise<void> {
  if (!body || typeof body !== 'object') throw new Error('تنظیمات نامعتبر است.');
  const input = body as Record<string, unknown>;
  if (typeof input.enabled !== 'boolean' || !Array.isArray(input.channels) || input.channels.length > 2) throw new Error('سوئیچ و فهرست مقصدها نامعتبر است.');
  const previous = await loadFallbackConfig(env);
  for (const key of ['notifyEnabled','notifyInvoices','notifyActions']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('سوئیچ گزارش مدیریت نامعتبر است.');
  }
  const notifyEnabled = input.notifyEnabled === undefined ? previous.notifyEnabled === true : input.notifyEnabled === true;
  const notifyInvoices = input.notifyInvoices === undefined ? previous.notifyInvoices !== false : input.notifyInvoices === true;
  const notifyActions = input.notifyActions === undefined ? previous.notifyActions !== false : input.notifyActions === true;
  if (notifyEnabled && !notifyInvoices && !notifyActions) throw new Error('حداقل یک نوع گزارش مدیریت را انتخاب کنید.');
  const channels: ChannelConfig[] = [];
  for (const item of input.channels) {
    if (!item || typeof item !== 'object') throw new Error('مقصد نامعتبر است.');
    const c = item as Record<string, unknown>;
    if (c.channel !== 'telegram' && c.channel !== 'bale') throw new Error('فقط تلگرام و بله پشتیبانی می‌شوند.');
    if (channels.some(x => x.channel === c.channel)) throw new Error('کانال تکراری است.');
    if (typeof c.chatId !== 'string' || !validChatId(c.chatId.trim())) throw new Error('Chat ID باید عدد معتبر یا نام کانال با @ باشد.');
    if (c.token !== undefined && typeof c.token !== 'string') throw new Error('توکن نامعتبر است.');
    const token = String(c.token ?? '').trim();
    if (token && (c.channel === 'telegram' ? env.TELEGRAM_BOT_TOKEN : env.BALE_BOT_TOKEN)) throw new Error('توکن از Secret ورکر خوانده می‌شود؛ تغییر آن را از همان بخش انجام دهید.');
    if (token && !validBotToken(token)) throw new Error('قالب توکن نامعتبر است.');
    const old = previous.channels.find(x => x.channel === c.channel);
    const encrypted = c.clearToken === true ? '' : token ? await seal(env, token, `token:${c.channel}`) : old?.token ?? '';
    const candidate: ChannelConfig = { channel: c.channel, chatId: c.chatId.trim(), token: encrypted };
    if ((input.enabled || notifyEnabled) && !validBotToken(await channelToken(env, candidate))) throw new Error('برای هر مقصد انتخاب‌شده یک توکن معتبر لازم است.');
    channels.push(candidate);
  }
  if (input.enabled || notifyEnabled) {
    await encryptionKey(env);
    if (!channels.length) throw new Error('حداقل یک مقصد انتخاب کنید.');
  }
  // Single atomic setting write: validation errors never partially update the config.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .bind(CONFIG_KEY, JSON.stringify({ enabled: input.enabled, channels, notifyEnabled, notifyInvoices, notifyActions })),
    // Pending work for removed destinations must not be sent or kept indefinitely.
    env.DB.prepare(`UPDATE fallback_jobs SET status='skipped',error='CONFIG_CHANGED: مقصد حذف یا مسیر خاموش شد.',
      payload=CASE WHEN type='otp' THEN '' ELSE payload END,completed_at=datetime('now')
      WHERE status='pending' AND (
        NOT EXISTS (SELECT 1 FROM json_each(?) WHERE json_extract(value,'$.channel')=fallback_jobs.channel AND json_extract(value,'$.chatId')=fallback_jobs.chat_id)
        OR (reason NOT IN ('test','event') AND ?=0)
        OR (reason='event' AND (?=0 OR (type='report_invoice' AND ?=0) OR (type='report_action' AND ?=0))))`)
      .bind(JSON.stringify(channels), input.enabled ? 1 : 0, notifyEnabled ? 1 : 0, notifyInvoices ? 1 : 0, notifyActions ? 1 : 0),
  ]);
}

export function smsPanelActive(env: Bindings, settings: AppSettings): boolean {
  if (settings.sms_enabled === 0 || settings.sms_provider === 'console') return false;
  const key = settings.sms_provider === 'smsir' ? env.SMSIR_API_KEY : env.KAVENEGAR_API_KEY;
  return !!(key || settings.sms_api_key).trim() && (settings.sms_provider !== 'smsir' || !!(env.SMS_SENDER || settings.sms_sender).trim());
}

export async function enqueueFallback(env: Bindings, params: { phone: string; message: string; userId: number | null; type: string; expiresAt?: number; eventKey?: string; title?: string },
  reason: 'inactive' | 'primary_failed' | 'test' | 'event', testChannel?: FallbackChannel): Promise<string[]> {
  const config = await loadFallbackConfig(env);
  if (reason === 'event' ? (!config.notifyEnabled || (params.type === 'report_invoice' ? config.notifyInvoices === false : config.notifyActions === false)) : (!config.enabled && reason !== 'test')) return [];
  const phone = normalizePhone(params.phone);
  if ((reason !== 'event' && !/^09\d{9}$/.test(phone)) || (phone && !/^09\d{9}$/.test(phone)) || !params.message.trim()) throw new Error('INVALID_FALLBACK_MESSAGE');
  if (params.message.length > 2000) throw new Error('MESSAGE_TOO_LONG');
  const selected = config.channels.filter(c => !testChannel || c.channel === testChannel);
  if (!selected.length) throw new Error('هیچ مقصد ذخیره‌شده‌ای انتخاب نشده است.');
  const now = Date.now();
  const ids: string[] = [];
  const bindings: (string | number | null)[] = [];
  const rows: string[] = [];
  // Encrypt payload too: OTP and customer content must not be plaintext in D1.
  for (const c of selected) {
    if (!validChatId(c.chatId) || !validBotToken(await channelToken(env, c))) throw new Error('تنظیمات مقصد کامل نیست.');
    const id = params.eventKey ? 'event-' + await sha256Hex(params.eventKey + ':' + c.channel + ':' + c.chatId) : crypto.randomUUID();
    const payload = await seal(env, { phone, message: params.message, requestedAt: new Date(now).toISOString(), userId: params.userId, title: params.title }, `job:${id}`);
    rows.push('SELECT ? AS id,? AS channel,? AS chat_id,? AS user_id,? AS type,? AS payload,? AS reason,? AS next_at,? AS expires_at');
    bindings.push(id, c.channel, c.chatId, params.userId, params.type, payload, reason, now, Math.min(now + (params.type === 'otp' ? 110_000 : 86_400_000), params.expiresAt ?? Infinity));
    ids.push(id);
  }
  // One SQL statement admits all selected channels or none, even under concurrency.
  const insert = env.DB.prepare(`INSERT OR IGNORE INTO fallback_jobs(id,channel,chat_id,user_id,type,payload,reason,next_at,expires_at)
    SELECT * FROM (${rows.join(' UNION ALL ')}) WHERE (SELECT COUNT(*) FROM fallback_jobs WHERE status IN ('pending','processing')) <= ?`)
    .bind(...bindings, 1000 - ids.length);
  const inserted = params.type === 'otp' && params.userId !== null
    ? (await env.DB.batch([
      env.DB.prepare(`UPDATE fallback_jobs SET status='skipped',error='SUPERSEDED: کد جدید درخواست شد.',payload='',completed_at=datetime('now')
        WHERE type='otp' AND user_id=? AND status='pending'`).bind(params.userId), insert,
    ]))[1]
    : await insert.run();
  if (inserted.meta.changes !== ids.length) {
    if (!params.eventKey) throw new Error('QUEUE_FULL');
    // Distinguish a deduplicated event from a full queue: never silently lose a new report.
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM fallback_jobs WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).first<{ n: number }>();
    if (count?.n !== ids.length) throw new Error('QUEUE_FULL');
  }
  return ids;
}

export function formatFallbackMessage(p: FallbackPayload, type: string): string {
  if (type.startsWith('report_')) return [p.title || 'گزارش مدیریت', `زمان: ${formatJalaliDateTime(p.requestedAt)}`, p.phone ? `شماره مشتری:\n${p.phone}` : '', p.message].filter(Boolean).join('\n\n');
  return ['ارسال دستی پیامک — این پیام فقط به ادمین رسیده است',
    `شماره مشترک:\n${p.phone}`, `زمان درخواست: ${formatJalaliDateTime(p.requestedAt)}`,
    `نوع: ${{welcome:'خوش‌آمد',invoice:'رسید خرید',birthday:'تولد',churn:'یادآوری حضور',weather:'آب‌وهوا',referral:'معرفی',otp:'کد ورود',redeem:'تبدیل امتیاز',admin:'تست اتصال'}[type] || type}`, p.userId !== null ? `شناسه کاربر: ${p.userId}` : '',
    type === 'otp' ? '⚠️ کد ورود محرمانه است؛ حداکثر تا ۲ دقیقه پس از درخواست معتبر است. در کانال عمومی نفرستید.' : '',
    `متن کامل پیام:\n${p.message}`].filter(Boolean).join('\n\n');
}

/** One job per invocation; global lease prevents parallel sends and limits to <=20/min. */
export async function processFallbackQueue(env: Bindings, maintenance = false): Promise<boolean> {
  const now = Date.now();
  const owner = crypto.randomUUID();
  const config = await loadFallbackConfig(env);
  // No background D1 writes for installations not using this feature.
  if (!config.configured) return false;
  // Request wake-ups must not burn the D1 write quota when there is no due work.
  // Cron still performs expiry/stale-lease/retention maintenance without pending jobs.
  if (!maintenance) {
    const due = await env.DB.prepare("SELECT id FROM fallback_jobs WHERE status='pending' AND next_at<=? LIMIT 1").bind(now).first();
    if (!due) return false;
  }
  const lease = await env.DB.prepare('UPDATE fallback_dispatch SET until_ms=?,owner=? WHERE id=1 AND until_ms<=? RETURNING id')
    .bind(now + 45_000, owner, now).first();
  if (!lease) return false;
  try {
    await env.DB.prepare(`DELETE FROM fallback_jobs WHERE status NOT IN ('pending','processing') AND created_at<datetime('now','-30 days')`).run();
    await env.DB.prepare(`UPDATE fallback_jobs SET payload='' WHERE type='otp' AND payload!='' AND expires_at<=?`).bind(now).run();
    await env.DB.prepare(`UPDATE fallback_jobs SET status='failed',error='DELIVERY_UNKNOWN: پردازش قبلی متوقف شد؛ احتمال تحویل نامشخص است.',completed_at=datetime('now')
      WHERE status='processing' AND locked_at<?`).bind(now - 45_000).run();
    await env.DB.prepare(`UPDATE fallback_jobs SET status='expired',error='EXPIRED: مهلت ارسال تمام شد.',payload=CASE WHEN type='otp' THEN '' ELSE payload END,completed_at=datetime('now')
      WHERE status='pending' AND expires_at<=?`).bind(now).run();
    const job = await env.DB.prepare(`UPDATE fallback_jobs SET status='processing',locked_at=?,attempts=attempts+1
      WHERE id=(SELECT id FROM fallback_jobs WHERE status='pending' AND next_at<=? AND channel NOT IN (SELECT channel FROM fallback_channel_limits WHERE until_ms>?) ORDER BY CASE WHEN type='otp' THEN 0 WHEN reason='test' THEN 1 WHEN reason='event' THEN 3 ELSE 2 END,next_at,rowid LIMIT 1)
      AND status='pending' RETURNING *`).bind(now, now, now).first<FallbackJob>();
    if (!job) return false;
    let status = 'failed', error: string | null = null, providerId: string | null = null;
    let nextAt = now;
    try {
      const channel = config.channels.find(c => c.channel === job.channel && c.chatId === job.chat_id);
      const { loadSettings } = await import('./settings');
      const settings = job.reason === 'inactive' ? await loadSettings(env, true) : null;
      if (!channel || (job.reason === 'event' ? (!config.notifyEnabled || (job.type === 'report_invoice' ? config.notifyInvoices === false : config.notifyActions === false)) : (!config.enabled && job.reason !== 'test')) || (job.reason === 'inactive' && settings && smsPanelActive(env, settings))) {
        status = 'skipped'; error = 'CONFIG_CHANGED: مسیر جایگزین خاموش یا مقصد/پنل اصلی تغییر کرده است.';
      } else if (job.expires_at <= Date.now() + 12_000) {
        status = 'expired'; error = 'EXPIRED';
      } else {
        const token = await channelToken(env, channel);
        if (!validBotToken(token)) throw new Error('INVALID_TOKEN');
        const payload = await unseal<FallbackPayload>(env, job.payload, `job:${job.id}`);
        const result = await adapters[job.channel].send(token, job.chat_id, formatFallbackMessage(payload, job.type));
        if (result.ok) { status = 'sent'; providerId = result.messageId; }
        else {
          error = result.error;
          if (result.retryAfter) {
            nextAt = Date.now() + Math.max(3000, result.retryAfter * 1000);
            await env.DB.prepare('UPDATE fallback_channel_limits SET until_ms=? WHERE channel=?').bind(nextAt, job.channel).run();
            if (job.attempts < 3 && nextAt < job.expires_at - 12_000) status = 'pending';
            else error = 'RATE_LIMITED: سقف تلاش یا مهلت ارسال تمام شد؛ پیام ارسال نشد.';
          }
        }
      }
    } catch {
      error = 'CONFIG_OR_KEY_ERROR: توکن یا کلید رمزنگاری در دسترس/معتبر نیست.';
    }
    await env.DB.prepare(`UPDATE fallback_jobs SET status=?,error=?,provider_id=?,next_at=?,
      payload=CASE WHEN type='otp' AND ?!='pending' THEN '' ELSE payload END,
      completed_at=CASE WHEN ?='pending' THEN NULL ELSE datetime('now') END WHERE id=? AND status='processing'`)
      .bind(status, error, providerId, nextAt, status, status, job.id).run();
    // OTP body never appears in history, even while pending.
    return true;
  } finally {
    await env.DB.prepare('UPDATE fallback_dispatch SET until_ms=?,owner=NULL WHERE id=1 AND owner=?')
      .bind(Date.now() + 3000, owner).run();
  }
}
export async function fallbackHistory(env: Bindings, page = 1, status = '', channel = '') {
  page = Math.max(1, Math.min(10000, Math.floor(page) || 1));
  const where: string[] = ['1=1']; const binds: string[] = [];
  if (['pending','processing','sent','failed','skipped','expired'].includes(status)) { where.push('status=?'); binds.push(status); }
  if (['telegram','bale'].includes(channel)) { where.push('channel=?'); binds.push(channel); }
  const filter = where.join(' AND ');
  const { results } = await env.DB.prepare(`SELECT * FROM fallback_jobs WHERE ${filter} ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET ?`)
    .bind(...binds, (page - 1) * 30).all<FallbackJob>();
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM fallback_jobs WHERE ${filter}`).bind(...binds).first<{ n: number }>();
  const items = await Promise.all((results ?? []).map(async job => {
    let content: FallbackPayload | null = null;
    if (job.type !== 'otp' && job.payload) {
      try { content = await unseal<FallbackPayload>(env, job.payload, `job:${job.id}`); } catch { /* key unavailable */ }
    }
    const { payload, ...safe } = job;
    return { ...safe, content };
  }));
  const { results: counts } = await env.DB.prepare('SELECT status,COUNT(*) AS n FROM fallback_jobs GROUP BY status').all<{ status: string; n: number }>();
  const stats = Object.fromEntries((counts ?? []).map(c => [c.status, c.n]));
  return { items, total: count?.n ?? 0, page, stats };
}

/** Bounded idle recovery: two sends per minute, while hour-boundary maintenance retains its budget. */
export async function drainFallbackQueue(env: Bindings): Promise<void> {
  if (await processFallbackQueue(env, true)) {
    await new Promise(resolve => setTimeout(resolve, 3100));
    await processFallbackQueue(env);
  }
}

/** Explicit admin retry; uncertain delivery always requires separate consent. OTP is never replayed. */
export async function retryFallbackJob(env: Bindings, id: string, confirmDuplicateRisk = false): Promise<{ previousAttempts: number; previousError: string | null }> {
  const job = await env.DB.prepare('SELECT * FROM fallback_jobs WHERE id=?').bind(id).first<FallbackJob>();
  if (!job) throw new Error('NOT_FOUND');
  if (job.type === 'otp') throw new Error('OTP_NO_REPLAY');
  if (job.status !== 'failed' || job.expires_at <= Date.now() + 12_000) throw new Error('NOT_RETRYABLE');
  const certain = /^(INVALID_TOKEN|INVALID_CHAT|FORBIDDEN|CONFIG_OR_KEY_ERROR|RATE_LIMITED):/.test(job.error ?? '');
  if (!certain && !confirmDuplicateRisk) throw new Error('CONFIRM_DUPLICATE_RISK');
  const config = await loadFallbackConfig(env);
  const channel = config.channels.find(c => c.channel === job.channel && c.chatId === job.chat_id);
  if (!channel || (job.reason === 'event' ? (!config.notifyEnabled || (job.type === 'report_invoice' ? config.notifyInvoices === false : config.notifyActions === false)) : (!config.enabled && job.reason !== 'test')))
    throw new Error('CONFIG_CHANGED');
  if (!validBotToken(await channelToken(env, channel))) throw new Error('INVALID_TOKEN');
  await unseal<FallbackPayload>(env, job.payload, `job:${job.id}`);
  const changed = await env.DB.prepare(`UPDATE fallback_jobs SET status='pending',attempts=0,next_at=?,locked_at=NULL,error=NULL,completed_at=NULL
    WHERE id=? AND status='failed' AND expires_at>? RETURNING id`).bind(Date.now(), id, Date.now() + 12_000).first();
  if (!changed) throw new Error('NOT_RETRYABLE');
  return { previousAttempts: job.attempts, previousError: job.error };
}
