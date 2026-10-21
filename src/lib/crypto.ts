/**
 * ----------------------------------------------------------------------------
 *  رمزنگاری: هش رمز عبور با PBKDF2-SHA256 و ابزارهای Base64
 * ----------------------------------------------------------------------------
 *  از WebCrypto استفاده می‌کند که در Cloudflare Workers بومی است.
 *  قالب ذخیره‌سازی: pbkdf2$<iterations>$<saltBase64>$<hashBase64>
 */

// ۲۵٬۰۰۰ دور: تعادل امنیت و محدودیت CPU پلن رایگان Cloudflare Workers.
// هش‌های قدیمی‌تر با تعداد دور ذخیره‌شده در خودشان اعتبارسنجی می‌شوند.
const PBKDF2_ITERATIONS = 25_000;
const KEY_LENGTH_BITS = 256;

/** رمزگذاری آرایه بایت به Base64 (سازگار با Workers) */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]
    );
  }
  return btoa(binary);
}

/** رمزگشایی Base64 به آرایه بایت */
export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
  bits: number
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    bits
  );
  return new Uint8Array(derived);
}

/** ساخت هش رمز عبور */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH_BITS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

/** بررسی رمز عبور در برابر هش ذخیره‌شده (مقایسه زمان‌ثابت) */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 10_000) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64ToBytes(parts[2]);
    expected = base64ToBytes(parts[3]);
  } catch {
    return false;
  }

  const actual = await pbkdf2(password, salt, iterations, expected.length * 8);
  if (actual.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= actual[i] ^ expected[i];
  }
  return diff === 0;
}

/** مقایسه زمان‌ثابت دو رشته (برای توکن‌ها و کدها) */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** تولید کد تخفیف خوانا و تصادفی؛ مثال: BDAY-7K3M9Q */
export function generateCouponCode(prefix = 'CAFE'): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < bytes.length; i += 1) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return `${prefix}-${code}`;
}

/** تولید شناسه تصادفی هگز */
export function randomHex(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** هش SHA-256 به صورت هگز (برای اثر انگشت داده‌های حساس در لاگ) */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
