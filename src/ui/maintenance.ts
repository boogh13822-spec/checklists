import type { AppSettings } from '../types';
import type { SchemaStatus } from '../lib/schema';
import { escapeHtml, toPersianDigits } from '../lib/utils';
import { publicShell } from './layout';

/** Recovery lives outside the dashboard, so old invoice/shift tables cannot break it. */
export function maintenancePage(settings: AppSettings, status: SchemaStatus): string {
  const blocked = status.blocked.length > 0;
  const body = `<main class="max-w-2xl mx-auto px-4 py-12">
    <h1 class="text-2xl font-bold mb-4">بررسی و ارتقای امن دیتابیس</h1>
    <p class="text-sm leading-7 mb-4">ورود شما معتبر است. ${status.ready ? 'ساختار مورد نیاز برنامه کامل است.' : 'ساختار دیتابیس با کد تازه کامل هم‌تراز نیست؛ این وضعیت می‌تواند صفحهٔ پنل را با خطای ۵۰۰ متوقف کند.'}</p>
    <p class="text-sm leading-7 mb-4">تغییرها فقط افزایشی‌اند؛ حساب، رمز، فاکتور، موجودی امتیاز یا تنظیمات قبلی حذف و بازنشانی نمی‌شود. تا تکمیل ساختار، ثبت عملیات و ارسال زمان‌بندی‌شده متوقف می‌ماند. از D1 Time Travel نیز یک نقطهٔ بازیابی نگه دارید.</p>
    <p class="text-xs leading-6 mb-4">فایل پشتیبان خصوصی شامل هش رمزها و تنظیمات محرمانهٔ ذخیره‌شده در DB است؛ آن را در چت یا برای دیگران نفرستید. Secretهای محیطی Worker داخل فایل نیستند. این خروجی جای بکاپ نقطه‌ای D1 را نمی‌گیرد.</p>
    <div class="glass rounded-2xl p-5 space-y-4">
      <p>تغییرهای لازم: <strong id="schema-count">${toPersianDigits(status.pending.length)}</strong></p>
      ${blocked ? '<p role="alert">بعضی اطلاعات پایه/ستون‌های تاریخی موجود نیستند و نمی‌توان امن حدسشان زد. عملیات خودکار متوقف است؛ Binding دیتابیس و نسخهٔ پشتیبان باید بررسی شوند.</p>' : ''}
      <details><summary>جزئیات ساختار</summary><ul class="text-xs leading-7" dir="ltr">${status.pending.map(s => '<li>' + escapeHtml(s.key) + '</li>').join('')}</ul></details>
      <button id="schema-backup" type="button" class="btn btn-ghost">۱. دریافت پشتیبان خصوصی دیتابیس</button>
      <label class="flex items-start gap-2 text-sm leading-7"><input id="schema-consent" type="checkbox" disabled />فایل پشتیبان را ذخیره کرده‌ام؛ با ارتقای افزایشی موافقم.</label>
      <button id="schema-upgrade" type="button" class="btn btn-primary" disabled>۲. تکمیل ساختار دیتابیس</button>
      <p id="schema-message" role="status" aria-live="polite" class="text-sm leading-7"></p>
      <a id="schema-dashboard" class="btn btn-ghost" href="/admin">رفتن به پنل</a>
      <a class="btn btn-ghost" href="/login">بازگشت به فرم ورود</a>
      <noscript><p>برای دریافت پشتیبان و ارتقا از این صفحه، JavaScript لازم است. ورود معمولی بدون JavaScript کار می‌کند. راه دیگر، بکاپ D1 و اجرای اسکریپت migrate پروژه توسط مدیر است.</p></noscript>
    </div>
  </main>`;
  const scripts = `(function(){
    var receipt = '', running = false, blocked = ${JSON.stringify(blocked)}, ready = ${JSON.stringify(status.ready)};
    var backup = document.getElementById('schema-backup'), consent = document.getElementById('schema-consent');
    var upgrade = document.getElementById('schema-upgrade'), message = document.getElementById('schema-message');
    function controls(){ upgrade.disabled = running || blocked || ready || !receipt || !consent.checked; backup.disabled = running; }
    consent.addEventListener('change', controls);
    backup.addEventListener('click', async function(){
      running = true; controls(); message.textContent = 'در حال ساخت پشتیبان…';
      try {
        var r = await fetch('/admin/export/backup.json?scope=upgrade', {credentials:'same-origin', cache:'no-store', redirect:'error'});
        if (!r.ok) { var error = await r.json(); throw new Error(error.error || 'دریافت پشتیبان ناموفق بود.'); }
        var token = r.headers.get('X-Upgrade-Receipt');
        if (!token) throw new Error('تأیید پشتیبان دریافت نشد.');
        var blob = await r.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = 'cafe-club-private-upgrade-backup.json'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function(){ URL.revokeObjectURL(url); }, 60000);
        receipt = token; consent.disabled = false;
        message.textContent = 'فایل را در محل امن ذخیره کنید؛ سپس تأیید کنید و دکمهٔ تکمیل ساختار را بزنید.';
      } catch(e) { message.textContent = e.message || 'ارتباط برقرار نشد؛ دوباره تلاش کنید.'; }
      finally { running = false; controls(); }
    });
    upgrade.addEventListener('click', async function(){
      if (running || !receipt || !consent.checked) return;
      running = true; controls();
      try {
        for(var n = 0; n < 80; n++) {
          message.textContent = 'در حال ارتقای مرحله‌ای؛ لطفاً صفحه را نبندید…';
          var r = await fetch('/api/admin/system/schema', { method:'POST', credentials:'same-origin', cache:'no-store', redirect:'error',
            headers:{'Content-Type':'application/json'}, body:JSON.stringify({receipt:receipt,confirmBackup:true}) });
          var out = await r.json(); if (!r.ok || !out.ok) throw new Error(out.error || 'ارتقا متوقف شد.');
          document.getElementById('schema-count').textContent = String(out.data.remaining).replace(/[0-9]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'[Number(d)];});
          if(out.data.ready){ ready = true; message.textContent = 'ساختار تکمیل شد؛ اکنون وارد پنل شوید.'; return; }
        }
        throw new Error('برای ادامه، دوباره دکمهٔ تکمیل ساختار را بزنید.');
      } catch(e) { message.textContent = e.message || 'ارتباط قطع شد؛ ادامهٔ ارتقا را دوباره بزنید.'; }
      finally { running = false; controls(); }
    });
    controls();
  })();`;
  return publicShell({title:'ارتقای امن دیتابیس',body,scripts,cafeName:settings.cafe_name});
}
