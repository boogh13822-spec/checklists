# فایل کامل برای کپی و انتشار

**[worker-complete.txt](worker-complete.txt)** کل ماژول قابل انتشار Cloudflare Worker است، نه خلاصه یا بخش‌هایی از کد. پسوند `.txt` فقط برای راحت باز کردن و کپی کردن است.

## دریافت بدون پیوست چت

۱. فایل بالا را در GitHub باز کنید.
۲. روی **Raw** یا آیکن **Download raw file** بزنید تا متن کامل را بگیرید؛ اگر پیش‌نمایش کد کوتاه/بسته بود، همان پیش‌نمایش را کپی نکنید.
۳. فایل را با Notepad باز کنید و با `Ctrl+A` و `Ctrl+C` تمام محتوا را کپی کنید.
۴. در ویرایشگر همان Worker فعلی، تمام کد فایل ورودی را جایگزین و Deploy کنید. نام Worker، Binding دیتابیس و Secretها را حفظ کنید.

این فایل نسخهٔ **`auth-native-v3`** است: فرم مستقیم مرورگر، تأیید سمت سرور و سازگاری نشست با دیتابیس قدیمی. در `/api/health` باید `data.build` همین مقدار باشد. انتشار روی حساب واقعی کاربر از این محیط انجام نشده است. فایل، Binding/Secret/جدول/Cron را به‌تنهایی ایجاد نمی‌کند. راهنما: [LOGIN-FA.md](../LOGIN-FA.md) و [DEPLOY-FA.md](../DEPLOY-FA.md).

نسخهٔ تازه در صورت نبودن `users.token_version`، فقط همان ستون امنیتی را بعد از احراز هویت به‌صورت افزایشی اضافه می‌کند؛ هیچ دادهٔ کاربری یا مالی بازنشانی نمی‌شود. جزئیات و مرز ارتقای کامل DB در [LOGIN-FA.md](../LOGIN-FA.md) آمده است. پیش از انتشار، بکاپ/Time Travel را بررسی کنید؛ Secret و Binding فعلی را تغییر ندهید.

## مشخصات نسخهٔ تحویلی

- اندازه: **861543 بایت**
- خطوط: **15702**
- SHA-256: `7a9a326dd3831b9abc82b1d9cf28399aa4b3069c0e7c89050e098eafa5dd697f`
- بررسی TypeScript و `node --check` موفق؛ فایل متنی با `single-file/worker.js` بایت‌به‌بایت یکسان است.

معمولاً خروجی generated در Git قرار نمی‌گیرد. این فایل یک استثنای تحویلیِ صریح است چون کاربر به پیوست‌های چت دسترسی ندارد؛ `single-file/` همچنان نادیده گرفته می‌شود. هیچ Secret واقعی یا تنظیمات محلی از `.dev.vars` وارد این خروجی نمی‌شود.

برای توسعه‌دهنده: فایل generated را دستی ویرایش نکنید؛ بعد از تغییر سورس، نسخهٔ تحویلی و مشخصات بالا را به‌روزرسانی کنید:

```bash
npm ci
npm run typecheck
npm run build:single
node --check single-file/worker.js
cp single-file/worker.js deliverables/worker-complete.txt
sha256sum deliverables/worker-complete.txt
```
