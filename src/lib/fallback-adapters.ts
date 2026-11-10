/** Bot API adapters — no user-controlled URLs, redirects or raw upstream errors. */
export type FallbackChannel = 'telegram' | 'bale';
export type AdapterResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string; retryAfter?: number };
export interface MessengerAdapter {
  send(token: string, chatId: string, text: string): Promise<AdapterResult>;
}

/** Telegram and Bale expose the same sendMessage JSON contract. */
class BotApiAdapter implements MessengerAdapter {
  constructor(private readonly origin: string) {}
  async send(token: string, chatId: string, text: string): Promise<AdapterResult> {
    try {
      const response = await fetch(`${this.origin}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Plain text: customer content can never inject HTML/Markdown.
        body: JSON.stringify({ chat_id: chatId, text }),
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
      });
      const data = await response.json().catch(() => null) as {
        ok?: boolean; error_code?: number;
        result?: { message_id?: number | string };
        parameters?: { retry_after?: number };
      } | null;
      const code = data?.error_code ?? response.status;
      if (response.ok && data?.ok === true && data.result?.message_id !== undefined) {
        return { ok: true, messageId: String(data.result.message_id) };
      }
      if (code === 429) {
        const delay = Number(data?.parameters?.retry_after ?? response.headers.get('Retry-After'));
        return { ok: false, error: 'RATE_LIMITED: محدودیت نرخ پیام‌رسان؛ تلاش مجدد زمان‌بندی شد.',
          retryAfter: Number.isFinite(delay) && delay > 0 ? Math.min(86400, Math.ceil(delay)) : 60 };
      }
      const error = code === 401 || code === 404
        ? 'INVALID_TOKEN: توکن بات نامعتبر است.'
        : code === 403
          ? 'FORBIDDEN: بات مسدود است یا مجوز ارسال به مقصد ندارد.'
          : code === 400
            ? 'INVALID_CHAT: شناسه مقصد یا دسترسی بات را بررسی کنید؛ کاربر باید بات را Start کند.'
            : `PROVIDER_ERROR: پاسخ ناموفق پیام‌رسان (${response.status}). احتمال تحویل نامشخص؛ ارسال خودکار تکرار نشد.`;
      return { ok: false, error };
    } catch {
      // fetch errors can contain token-bearing URLs: never persist their messages.
      return { ok: false, error: 'NETWORK_UNKNOWN: اتصال قطع/منقضی شد؛ احتمال تحویل نامشخص است. برای جلوگیری از تکرار، ارسال مجدد خودکار انجام نشد.' };
    }
  }
}

export const adapters: Record<FallbackChannel, MessengerAdapter> = {
  telegram: new BotApiAdapter('https://api.telegram.org'),
  bale: new BotApiAdapter('https://tapi.bale.ai'),
};

export function validChatId(value: string): boolean {
  return /^-?[1-9]\d{0,19}$/.test(value) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value);
}
export function validBotToken(value: string): boolean {
  // Both providers use bot-id:secret. Excludes slashes, whitespace and URL injection.
  return /^\d{1,20}:[A-Za-z0-9_-]{20,200}$/.test(value);
}
