/** Fixed-origin Bot API adapters. Never log token-bearing URLs, raw exceptions or provider bodies. */
export type FallbackChannel = 'telegram' | 'bale';
type Method = 'sendMessage' | 'getMe' | 'getChat';
export type RequestDiagnostic = {
  referenceId: string; channel: FallbackChannel; method: Method;
  phase: 'setup' | 'request' | 'body' | 'response'; code: string;
  elapsedMs: number; httpStatus?: number;
};
export type AdapterResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string; retryAfter?: number; diagnostic?: RequestDiagnostic };
export type ConnectionCheck = { stage: 'bot' | 'chat'; ok: boolean; code: string; message: string; diagnostic: RequestDiagnostic };
export type ConnectionReport = { channel: FallbackChannel; ready: boolean; checks: ConnectionCheck[]; messageSent: false };
export interface MessengerAdapter {
  send(token: string, chatId: string, text: string): Promise<AdapterResult>;
  diagnose(token: string, chatId: string): Promise<ConnectionReport>;
}
type BotReply = { ok?: boolean; error_code?: number; result?: Record<string, unknown>; parameters?: { retry_after?: number } };
type Outcome = { ok: true; data: BotReply; diagnostic: RequestDiagnostic }
  | { ok: false; error: string; retryAfter?: number; diagnostic: RequestDiagnostic };

const messages: Record<string, string> = {
  NETWORK_TIMEOUT: 'مهلت ارتباط با پیام‌رسان تمام شد.',
  DNS_FAILURE: 'نام میزبان پیام‌رسان در سرور قابل تبدیل به نشانی شبکه نبود.',
  TLS_FAILURE: 'برقراری اتصال امن TLS با پیام‌رسان ناموفق بود.',
  NETWORK_RESET: 'اتصال سرور با پیام‌رسان قطع یا رد شد.',
  FETCH_FAILED: 'اجرای درخواست از سرور به پیام‌رسان شکست خورد؛ نوع دقیق خطای شبکه از runtime مشخص نشد.',
  BODY_READ_FAILED: 'پاسخ آغاز شد ولی خواندن کامل آن شکست خورد.',
  RUNTIME_UNAVAILABLE: 'ابزار لازم برای اجرای درخواست یا لغو زمان‌دار آن در runtime در دسترس نیست.',
  REQUEST_SETUP_FAILED: 'درخواست پیش از شروع ارتباط آماده نشد.',
  REDIRECT_BLOCKED: 'پیام‌رسان پاسخ انتقال نشانی داد؛ برای حفاظت از توکن، انتقال دنبال نشد.',
  INVALID_RESPONSE: 'پاسخ دریافتی، پاسخ معتبر و مورد انتظار Bot API نبود.',
  INVALID_TOKEN: 'توکن ربات توسط API پذیرفته نشد.',
  INVALID_CHAT: 'API مقصد را نپذیرفت؛ شناسهٔ چت همان پیام‌رسان و شروع گفت‌وگو/دسترسی ربات را بررسی کنید.',
  FORBIDDEN: 'API دسترسی این عملیات را رد کرد؛ ممکن است ربات مسدود یا مجوز مقصد محدود باشد.',
  RATE_LIMITED: 'پیام‌رسان محدودیت نرخ اعلام کرد.',
  PROVIDER_ERROR: 'پیام‌رسان پاسخ ناموفق داد؛ وضعیت HTTP در جزئیات آمده است.',
};

/** Only exact, allowlisted runtime codes are inspected. Exception text/URLs are NEVER persisted. */
function networkCode(error: unknown): string {
  const e = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  const code = typeof e?.cause?.code === 'string' ? e.cause.code : typeof e?.code === 'string' ? e.code : '';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'DNS_FAILURE';
  if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_PROTOCOL_ERROR'].includes(code)) return 'TLS_FAILURE';
  if (['ECONNRESET', 'ECONNREFUSED', 'UND_ERR_SOCKET'].includes(code)) return 'NETWORK_RESET';
  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code) || e?.name === 'TimeoutError') return 'NETWORK_TIMEOUT';
  return 'FETCH_FAILED';
}
function identifier(value: unknown, signed = false): boolean {
  return (typeof value === 'number' && Number.isSafeInteger(value) && (signed || value >= 0)) ||
    (typeof value === 'string' && (signed ? /^-?\d{1,64}$/ : /^\d{1,64}$/).test(value));
}

class BotApiAdapter implements MessengerAdapter {
  constructor(private readonly channel: FallbackChannel, private readonly origin: string) {}

  private async request(token: string, method: Method, body: Record<string, unknown>, timeoutMs: number): Promise<Outcome> {
    const start = Date.now();
    const d: RequestDiagnostic = { referenceId: crypto.randomUUID(), channel: this.channel, method, phase: 'setup', code: '', elapsedMs: 0 };
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (code: string, retryAfter?: number): Outcome => {
      d.code = code; d.elapsedMs = Math.max(0, Date.now() - start);
      // These fields contain no token/chat/message/body/raw error, including nested error causes.
      console.warn('MESSENGER_REQUEST_FAILED', { ...d });
      const unknown = method === 'sendMessage' && !['INVALID_TOKEN', 'INVALID_CHAT', 'FORBIDDEN', 'RATE_LIMITED', 'RUNTIME_UNAVAILABLE', 'REQUEST_SETUP_FAILED'].includes(code);
      return { ok: false, error: code + ': ' + messages[code] +
        (d.httpStatus ? ' HTTP=' + d.httpStatus + '.' : '') +
        ' مرحله=' + d.phase + '؛ پیگیری=' + d.referenceId + '.' +
        (unknown ? ' نتیجهٔ ارسال نامشخص است؛ ارسال خودکار تکرار نشد.' : ''),
        diagnostic: { ...d }, ...(retryAfter === undefined ? {} : { retryAfter }) };
    };
    try {
      if (typeof fetch !== 'function' || typeof AbortController !== 'function') return fail('RUNTIME_UNAVAILABLE');
      // Avoid depending on AbortSignal.timeout(), which can throw before fetch in some runtimes.
      controller = new AbortController();
      timer = setTimeout(() => controller!.abort(), timeoutMs);
      d.phase = 'request';
      const response = await fetch(`${this.origin}/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body), redirect: 'manual', signal: controller.signal,
      });
      d.httpStatus = response.status;
      d.phase = 'response';
      if (response.status >= 300 && response.status < 400) return fail('REDIRECT_BLOCKED');
      d.phase = 'body';
      const text = await response.text();
      d.phase = 'response';
      let data: BotReply | null = null;
      if (text.length <= 65_536) {
        try { const value: unknown = JSON.parse(text); if (value && typeof value === 'object' && !Array.isArray(value)) data = value as BotReply; } catch { /* not a Bot API JSON reply */ }
      }
      const code = data?.ok === false && Number.isInteger(data.error_code) ? data.error_code! : response.status;
      // Retry only an explicit rejection for rate limiting, never timeouts/5xx/broken JSON.
      if (code === 429) {
        const delay = Number(data?.parameters?.retry_after ?? response.headers.get('Retry-After'));
        return fail('RATE_LIMITED', Number.isFinite(delay) && delay > 0 ? Math.min(86400, Math.ceil(delay)) : 60);
      }
      if (!data || typeof data.ok !== 'boolean') return fail('INVALID_RESPONSE');
      if (response.ok && data.ok) {
        if (!data.result || typeof data.result !== 'object' || Array.isArray(data.result)) return fail('INVALID_RESPONSE');
        const valid = method === 'sendMessage' ? identifier(data.result.message_id) : identifier(data.result.id, method === 'getChat');
        if (!valid) return fail('INVALID_RESPONSE');
        d.code = 'OK'; d.elapsedMs = Math.max(0, Date.now() - start);
        return { ok: true, data, diagnostic: { ...d } };
      }
      return fail(code === 401 || code === 404 ? 'INVALID_TOKEN'
        : code === 403 ? 'FORBIDDEN' : code === 400 && method !== 'getMe' ? 'INVALID_CHAT' : 'PROVIDER_ERROR');
    } catch (error) {
      return fail(controller?.signal.aborted ? 'NETWORK_TIMEOUT'
        : d.phase === 'setup' ? 'REQUEST_SETUP_FAILED'
        : d.phase === 'body' ? 'BODY_READ_FAILED' : networkCode(error));
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async send(token: string, chatId: string, text: string): Promise<AdapterResult> {
    const result = await this.request(token, 'sendMessage', { chat_id: chatId, text }, 12_000);
    if (!result.ok) return result;
    return { ok: true, messageId: String(result.data.result!.message_id) };
  }

  /** Read-only bot identity and chat lookup. Never getUpdates, setWebhook or sendMessage. */
  async diagnose(token: string, chatId: string): Promise<ConnectionReport> {
    const checks: ConnectionCheck[] = [];
    const bot = await this.request(token, 'getMe', {}, 6_000);
    checks.push({ stage: 'bot', ok: bot.ok, code: bot.ok ? 'BOT_REACHABLE' : bot.diagnostic.code,
      message: bot.ok ? 'ارتباط سرور با API و اعتبار توکن تأیید شد.' : messages[bot.diagnostic.code], diagnostic: bot.diagnostic });
    if (bot.ok) {
      const chat = await this.request(token, 'getChat', { chat_id: chatId }, 6_000);
      checks.push({ stage: 'chat', ok: chat.ok, code: chat.ok ? 'CHAT_REACHABLE' : chat.diagnostic.code,
        message: chat.ok ? 'API اطلاعات مقصد را برگرداند؛ این به‌تنهایی تضمین مجوز یا تحویل پیام نیست.' : messages[chat.diagnostic.code], diagnostic: chat.diagnostic });
    }
    return { channel: this.channel, ready: checks.length === 2 && checks.every(c => c.ok), checks, messageSent: false };
  }
}

export const adapters: Record<FallbackChannel, MessengerAdapter> = {
  telegram: new BotApiAdapter('telegram', 'https://api.telegram.org'),
  bale: new BotApiAdapter('bale', 'https://tapi.bale.ai'),
};
export function validChatId(value: string): boolean {
  return /^-?[1-9]\d{0,19}$/.test(value) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value);
}
export function validBotToken(value: string): boolean {
  return /^\d{1,20}:[A-Za-z0-9_-]{20,200}$/.test(value);
}
