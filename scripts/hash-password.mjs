// ابزار کمکی برای ساخت هش PBKDF2-SHA256 سازگار با اپلیکیشن (Cloudflare Workers WebCrypto)
// استفاده: node scripts/hash-password.mjs 'YourPassword'
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const password = process.argv[2] || 'Admin@12345';
// ۲۵٬۰۰۰ دور برای سازگاری با محدودیت CPU پلن رایگان Workers انتخاب شده است.
// در پلن Paid می‌توانید مقدار را افزایش دهید (هش‌های قبلی همچنان معتبرند).
const iterations = 25000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
const out = `pbkdf2$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
console.log(out);
