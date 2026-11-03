import type { AppSettings } from '../types';
import { appShell } from './layout';

export const fallbackPanel = `
<section id="fallback" class="glass rounded-3xl p-5 scroll-mt-24 space-y-4">
  <h2 class="font-bold">ارسال جایگزین پیامک (Fallback)</h2>
  <p class="hint">اگر پنل غیرفعال/تنظیم‌نشده باشد، یا ارسال اصلی شکست بخورد، پیام برای ارسال دستی به ادمین می‌رسد. مسیر سالم پیامک همیشه اولویت دارد.</p>
  <p class="text-amber-300 text-xs leading-6">⚠️ کد ورود (OTP) هم ارسال می‌شود. فقط از گفت‌وگوی خصوصی یا کانال خصوصی محدود به ادمین استفاده کنید. کد فقط ۲ دقیقه اعتبار دارد؛ ارسال به بات به معنی تحویل به مشتری نیست.</p>
  <p id="fallback-state" class="hint" role="status">در حال دریافت تنظیمات…</p>
  <label class="flex items-center gap-2"><input id="fallback-enabled" type="checkbox" role="switch" /> فعال‌سازی ارسال جایگزین</label>
  <div class="grid sm:grid-cols-2 gap-4">
    ${(['telegram', 'bale'] as const).map(channel => `
    <fieldset class="rounded-2xl border border-white/10 p-4 space-y-3">
      <legend>${channel === 'telegram' ? 'تلگرام' : 'بله'}</legend>
      <label class="flex gap-2"><input id="fb-${channel}-selected" type="checkbox" /> ارسال به این پیام‌رسان</label>
      <label class="label" for="fb-${channel}-chat">شناسه مقصد (Chat ID)</label>
      <input id="fb-${channel}-chat" class="field font-mono" dir="ltr" maxlength="40" placeholder="Chat ID یا @channel" autocomplete="off" />
      <label class="label" for="fb-${channel}-token">توکن بات</label>
      <div class="flex gap-2">
        <input id="fb-${channel}-token" class="field font-mono" type="password" dir="ltr" maxlength="230" autocomplete="new-password" placeholder="توکن جدید؛ خالی یعنی حفظ مقدار قبلی" />
        <button type="button" id="fb-${channel}-reveal" class="btn btn-ghost btn-sm" aria-label="نمایش یا مخفی‌سازی توکن">نمایش</button>
      </div>
      <label class="text-xs flex gap-2"><input id="fb-${channel}-clear" type="checkbox" /> حذف توکن ذخیره‌شده (Secret محیطی حذف نمی‌شود)</label>
      <button type="button" id="fb-${channel}-test" class="btn btn-ghost btn-sm">تست ارسال ${channel === 'telegram' ? 'تلگرام' : 'بله'}</button>
    </fieldset>`).join('')}
  </div>
  <p class="hint">ابتدا در بات Start بزنید؛ برای کانال، بات باید مجوز ارسال داشته باشد. توکن هرگز از سرور بازگردانده نمی‌شود. قبل از تست، تنظیمات این بخش را ذخیره کنید.</p>
  <div class="flex flex-wrap gap-2">
    <button id="fallback-save" type="button" class="btn btn-primary btn-sm" disabled>ذخیره تنظیمات جایگزین</button>
    <a href="/admin/fallback" class="btn btn-ghost btn-sm">تاریخچه کامل ارسال جایگزین</a>
    <button id="fallback-refresh" type="button" class="btn btn-ghost btn-sm">تازه‌سازی نتیجه تست / تاریخچه</button>
  </div>
  <div id="fallback-history" class="space-y-3" aria-live="polite"></div>
  <div class="flex gap-3 items-center">
    <button id="fb-prev" type="button" class="btn btn-ghost btn-sm">قبلی</button>
    <span id="fb-page" class="text-xs"></span>
    <button id="fb-next" type="button" class="btn btn-ghost btn-sm">بعدی</button>
  </div>
</section>`;

export const fallbackScripts = String.raw`
(function () {
  var channels = ['telegram', 'bale'];
  var page = 1;
  var ready = false;
  function el(id) { return document.getElementById(id); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function(c) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
  }); }
  function faDate(value) {
    if (!value) return '—';
    var d = new Date(value.indexOf('T') < 0 ? value.replace(' ','T') + 'Z' : value);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('fa-IR', {timeZone:'Asia/Tehran'});
  }
  function showState(config) {
    el('fallback-state').textContent = !config.encryptionKeyConfigured
      ? 'ابتدا FALLBACK_ENCRYPTION_KEY را در Secrets ورکر تنظیم کنید (راهنما در FALLBACK-FA.md).'
      : config.primaryActive ? 'پنل اصلی آماده است: مسیر جایگزین فقط پس از شکست ارسال اصلی استفاده می‌شود.' : 'پنل اصلی خاموش یا ناقص است: مسیر جایگزین در صورت روشن بودن استفاده می‌شود.';
  }
  async function loadConfig() {
    var config = await api('/api/admin/fallback');
    el('fallback-enabled').checked = config.enabled;
    channels.forEach(function(ch) {
      var c = config.channels.find(function(x) { return x.channel === ch; });
      el('fb-'+ch+'-selected').checked = !!c;
      el('fb-'+ch+'-chat').value = c ? c.chatId : '';
      el('fb-'+ch+'-token').value = '';
      el('fb-'+ch+'-token').placeholder = c && c.hasToken ? 'توکن ذخیره شده؛ خالی یعنی بدون تغییر' : 'توکن جدید بات';
      el('fb-'+ch+'-clear').checked = false;
    });
    showState(config);
    ready = true;
    el('fallback-save').disabled = false;
  }
  async function history() {
    var data = await api('/api/admin/fallback/history?page=' + page);
    var labels = {pending:'در صف',processing:'در حال ارسال',sent:'تحویل به ادمین (نه مشترک)',failed:'ناموفق',skipped:'لغوشده',expired:'منقضی'};
    el('fallback-history').innerHTML = data.items.length ? data.items.map(function(j) {
      return '<article class="rounded-xl border border-white/10 p-3 text-xs space-y-2">' +
        '<div>' + esc(j.channel === 'telegram' ? 'تلگرام' : 'بله') + ' — ' + esc(labels[j.status] || j.status) + ' — ' + esc(faDate(j.created_at)) + '</div>' +
        '<div dir="ltr" class="font-mono select-all">' + esc(j.content ? j.content.phone : j.type === 'otp' ? 'OTP — محتوای محرمانه نمایش داده نمی‌شود' : 'محتوا در دسترس نیست') + '</div>' +
        '<pre class="whitespace-pre-wrap break-words font-sans">' + esc(j.content ? j.content.message : '') + '</pre>' +
        '<div>تلاش: ' + esc(j.attempts) + ' | مقصد: <bdi>' + esc(j.chat_id) + '</bdi> | نوع: ' + esc(j.type) + '</div>' +
        (j.error ? '<div class="text-amber-300">' + esc(j.error) + '</div>' : '') + '</article>';
    }).join('') : '<p class="hint">هنوز ارسالی در تاریخچه وجود ندارد.</p>';
    el('fb-page').textContent = page.toLocaleString('fa-IR') + ' / ' + Math.max(1,Math.ceil(data.total/30)).toLocaleString('fa-IR');
    el('fb-prev').disabled = page <= 1;
    el('fb-next').disabled = page * 30 >= data.total;
  }
  function report(e) { toast(e.message || 'ارتباط با سرور برقرار نشد.', 'error'); }
  el('fallback-save').addEventListener('click', async function() {
    if (!ready) return;
    var btn = el('fallback-save'); setLoading(btn,true,'در حال ذخیره…');
    try {
      var payload = {enabled:el('fallback-enabled').checked,channels:channels.filter(function(ch) {
        return el('fb-'+ch+'-selected').checked;
      }).map(function(ch) { return {channel:ch,chatId:el('fb-'+ch+'-chat').value.trim(),token:el('fb-'+ch+'-token').value.trim(),clearToken:el('fb-'+ch+'-clear').checked}; })};
      await api('/api/admin/fallback',{method:'PUT',body:payload});
      await loadConfig(); toast('تنظیمات جایگزین ذخیره شد.','success');
    } catch(e) { report(e); } finally { setLoading(btn,false); }
  });
  channels.forEach(function(ch) {
    el('fb-'+ch+'-reveal').addEventListener('click', function() {
      var input = el('fb-'+ch+'-token'); input.type = input.type === 'password' ? 'text' : 'password';
      this.textContent = input.type === 'password' ? 'نمایش' : 'مخفی';
    });
    el('fb-'+ch+'-test').addEventListener('click', async function() {
      var btn = this; setLoading(btn,true,'در حال ثبت تست…');
      try {
        var result = await api('/api/admin/fallback/test',{method:'POST',body:{channel:ch}});
        toast(result.message,'success'); page = 1; await history();
      } catch(e) { report(e); } finally { setLoading(btn,false); }
    });
  });
  el('fallback-refresh').addEventListener('click', function() { history().catch(report); });
  el('fb-prev').addEventListener('click', function() { if(page>1)page--; history().catch(report); });
  el('fb-next').addEventListener('click', function() { page++; history().catch(report); });
  document.addEventListener('sms-settings-saved', function() { api('/api/admin/fallback').then(showState).catch(report); });
  loadConfig().catch(report); history().catch(report);
})();`;

export function adminFallbackPage(settings: AppSettings, userName: string): string {
  return appShell({ title: 'ارسال جایگزین پیامک', role: 'admin', userName, active: 'settings',
    body: `<div class="max-w-6xl mx-auto p-4 sm:p-6"><a href="/admin/settings" class="btn btn-ghost mb-4">بازگشت به تنظیمات</a>${fallbackPanel}</div>`,
    scripts: fallbackScripts, cafeName: settings.cafe_name });
}
