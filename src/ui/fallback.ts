import type { AppSettings } from '../types';
import { appShell } from './layout';

/** Same compact panel is reused in Settings and the dedicated history page. */
export const fallbackPanel = `
<section id="fallback" class="glass rounded-3xl p-4 sm:p-5 scroll-mt-24 space-y-4">
  <div><h2 class="font-bold text-base">میز پیام‌های مشتری</h2>
    <p class="hint">۱. دریافت در بله/تلگرام  ←  ۲. کپی متن و شماره  ←  ۳. ارسال دستی و ثبت انجام کار</p></div>
  <p id="fallback-state" class="rounded-xl bg-white/5 p-3 text-xs leading-6" role="status">در حال دریافت تنظیمات…</p>
    <div class="border-t border-white/10 pt-4 space-y-3">
    <div class="flex flex-wrap gap-3 items-center justify-between"><h3 class="font-bold text-sm">کارهای ارسال دستی</h3>
      <button id="fallback-refresh" type="button" class="btn btn-ghost btn-sm">تازه‌سازی</button></div>
    <label class="label" for="fallback-handoff">نمایش کارها</label><select id="fallback-handoff" class="field"><option value="">همهٔ پیام‌ها و گزارش‌ها</option><option value="todo">نیازمند ارسال دستی به مشتری</option><option value="done">ارسال دستی ثبت‌شده توسط مدیر</option></select>
    <details class="rounded-xl border border-white/10 p-3"><summary class="cursor-pointer">آماده‌سازی کمپین‌های خودکار</summary><div id="campaign-progress" class="hint" role="status"></div></details>
    <details class="rounded-xl border border-white/10 p-3"><summary class="cursor-pointer">رسیدهای خرید در انتظار آماده‌سازی</summary><p class="hint">این وضعیت، تحویل به مشتری نیست. بازیابی فقط رسیدهای جدیدِ حالت ادمین را آماده می‌کند، نه پیامک یا OTP.</p><div id="receipt-progress" class="hint" role="status"></div><button id="receipt-recover" type="button" class="btn btn-ghost btn-sm">بررسی دوبارهٔ یک رسید</button></details>
    <div id="fallback-stats" class="text-xs text-cream/60" aria-live="polite"></div>
    <p class="hint">ارسال موفق یعنی تأیید API پیام‌رسان؛ خواندن پیام توسط ادمین یا رسیدن پیامک به مشتری را تأیید نمی‌کند.</p>
    <div class="flex flex-wrap gap-2">
      <label class="text-xs">وضعیت<select id="fallback-status" class="field mt-1"><option value="">همه</option><option value="failed">ناموفق</option><option value="pending">در صف</option><option value="processing">در حال ارسال</option><option value="sent">ارسال‌شده</option><option value="skipped">لغوشده</option><option value="expired">منقضی</option></select></label>
      <label class="text-xs">مقصد<select id="fallback-channel" class="field mt-1"><option value="">هر دو</option><option value="telegram">تلگرام</option><option value="bale">بله</option></select></label>
    </div>
    <div id="fallback-history" class="space-y-3" aria-live="polite"></div>
    <div class="flex gap-3 items-center">
      <button id="fb-prev" type="button" class="btn btn-ghost btn-sm">قبلی</button><span id="fb-page" class="text-xs"></span><button id="fb-next" type="button" class="btn btn-ghost btn-sm">بعدی</button>
      <a href="/admin/fallback" class="btn btn-ghost btn-sm">صفحه کامل تاریخچه</a>
    </div>
  </div>
  <details id="fallback-connection" open class="rounded-2xl border border-white/10 p-4"><summary class="font-bold cursor-pointer">اتصال و روش ارسال (یک‌بار تنظیم کنید)</summary><div class="space-y-4 mt-4">
  <label class="label" for="fallback-mode">روش ارسال پیام‌های مشتری</label>
  <select id="fallback-mode" class="field"><option value="admin">پیشنهادی: فقط به ادمین در بله و تلگرام؛ ارسال نهایی دستی</option><option value="sms">حالت قبلی: پنل پیامک با مسیر جایگزین</option></select>
  <button id="fallback-recommend" type="button" class="btn btn-ghost btn-sm">انتخاب حالت پیشنهادی ادمین</button>
  <p class="hint">در حالت ادمین، حتی با داشتن اعتبار sms.ir هیچ پیامکی خودکار به مشتری نمی‌رود. پس از انتخاب، ذخیره کنید.</p>
  <div class="grid sm:grid-cols-2 gap-3">
    <label class="rounded-2xl border border-white/10 p-4 flex gap-3 items-start">
      <input id="fallback-notify" type="checkbox" role="switch" class="mt-1" />
      <span><b class="text-sm">گزارش خودکار عملیات</b><span class="block hint">فاکتور، امتیاز، صندوق و اقدامات حساس؛ حتی وقتی پنل پیامک روشن است.</span></span>
    </label>
    <label class="rounded-2xl border border-white/10 p-4 flex gap-3 items-start">
      <input id="fallback-enabled" type="checkbox" role="switch" class="mt-1" />
      <span><b class="text-sm">ارسال دستی پیامک توسط ادمین</b><span class="block hint">اگر پنل خاموش باشد یا ارسال پیامک شکست بخورد، شماره و متن برای شما فرستاده می‌شود.</span></span>
    </label>
  </div>
  <div class="flex flex-wrap gap-4 text-xs">
    <label class="flex gap-2"><input id="fallback-errors" type="checkbox" checked /> اعلان خطای ارسال (از پیام‌رسان دیگرِ فعال)</label>
    <label class="flex gap-2"><input id="fallback-invoices" type="checkbox" checked /> گزارش فاکتور، اصلاح و ابطال</label>
    <label class="flex gap-2"><input id="fallback-actions" type="checkbox" checked /> گزارش امتیاز، صندوق و مدیریت</label>
  </div>
  <div class="grid sm:grid-cols-2 gap-3">
    ${(['telegram', 'bale'] as const).map(ch => `
    <fieldset class="rounded-2xl border border-white/10 p-4 space-y-3">
      <legend class="font-semibold">${ch === 'telegram' ? 'تلگرام' : 'بله'}</legend>
      <label class="flex gap-2 text-sm"><input id="fb-${ch}-selected" type="checkbox" /> ارسال به ${ch === 'telegram' ? 'تلگرام' : 'بله'}</label>
      <div id="fb-${ch}-fields" class="space-y-3 hidden">
        <label class="label" for="fb-${ch}-chat">شناسه مقصد (Chat ID)</label>
        <input id="fb-${ch}-chat" class="field font-mono" dir="ltr" maxlength="40" placeholder="شناسه عددی یا @channel" autocomplete="off" />
        <label class="label" for="fb-${ch}-token">توکن بات</label>
        <div class="flex gap-2">
          <input id="fb-${ch}-token" class="field font-mono" type="password" dir="ltr" maxlength="230" autocomplete="new-password" placeholder="توکن جدید" />
          <button type="button" id="fb-${ch}-reveal" class="btn btn-ghost btn-sm" aria-label="نمایش یا مخفی‌سازی توکن">نمایش</button>
        </div>
        <p id="fb-${ch}-source" class="hint"></p>
        <details class="text-xs"><summary class="cursor-pointer text-cream/50">حذف توکن ذخیره‌شده</summary>
          <label class="flex gap-2 mt-2"><input id="fb-${ch}-clear" type="checkbox" /> حذف توکن برنامه؛ Secret محیطی حذف نمی‌شود.</label></details>
        <div class="flex flex-wrap gap-2">
          <button type="button" id="fb-${ch}-diagnose" class="btn btn-ghost btn-sm">بررسی ارتباط بدون ارسال</button>
          <button type="button" id="fb-${ch}-test" class="btn btn-ghost btn-sm">ذخیره و ارسال پیام آزمایشی</button>
        </div>
        <p class="hint">بررسی ارتباط فقط توکن ذخیره‌شده و مقصد را با API بررسی می‌کند؛ Webhook لازم نیست و پیام جدیدی نمی‌سازد؛ کارهای قبلی صف ممکن است طبق روال ادامه یابند.</p>
        <p id="fb-${ch}-diagnostic" class="hint whitespace-pre-line break-words" role="status" aria-live="polite"></p>
        <p id="fb-${ch}-result" class="hint" role="status"></p>
      </div>
    </fieldset>`).join('')}
  </div>
  <details class="text-xs leading-7 text-amber-200/80"><summary class="cursor-pointer">راهنمای اتصال و نکته امنیتی کد ورود</summary>
    ابتدا در بات Start بزنید؛ در کانال، بات باید مجوز ارسال داشته باشد. توکن خالی یعنی حفظ مقدار قبلی.
    پیامک جایگزین شامل کد ورود هم می‌شود؛ فقط مقصد خصوصی مخصوص ادمین انتخاب کنید. کد ۲ دقیقه اعتبار دارد و در تاریخچه نمایش داده نمی‌شود.
    گزارش مدیریتی، رسید پیامک به مشتری نیست. حذف مقصد، پیام‌های معلق آن مقصد را لغو می‌کند.
  </details>
  <div class="flex flex-wrap gap-2 items-center">
    <button id="fallback-save" type="button" class="btn btn-primary btn-sm" disabled>ذخیره پیام‌های ادمین</button>
    <button id="fallback-reload" type="button" class="btn btn-ghost btn-sm">بازخوانی تنظیمات</button>
    <span id="fallback-dirty" class="text-xs text-amber-300" aria-live="polite"></span>
  </div>
  </div></details>
  <details class="rounded-2xl border border-white/10 p-4"><summary class="font-bold cursor-pointer text-sm">نوشتن و ارسال پیام دستی به ادمین</summary><div class="space-y-3 mt-4">
    <p class="hint">فقط به مقصدهای ذخیره‌شدهٔ مدیر ارسال می‌شود؛ پیامک به مشتری نیست. رسیدن به API هم تأیید خواندن پیام نیست.</p>
    <fieldset id="fb-manual-fields" class="space-y-3"><label class="label" for="fb-manual-channel">پیام‌رسان</label><select id="fb-manual-channel" class="field"><option value="both">هر دو مقصد ذخیره‌شده</option><option value="telegram">فقط تلگرام</option><option value="bale">فقط بله</option></select><label class="label" for="fb-manual-phone">شمارهٔ مرتبط (اختیاری؛ برای کپی و ارسال دستی SMS)</label><input id="fb-manual-phone" type="tel" class="field" dir="ltr" maxlength="13" /><label class="label" for="fb-manual-text">متن کامل</label><textarea id="fb-manual-text" class="field" rows="5" maxlength="2000"></textarea><p class="hint">حداکثر ۲۰۰۰ کاراکتر؛ متن ناقص ارسال نمی‌شود.</p><label class="flex gap-2 text-xs"><input id="fb-manual-confirm" type="checkbox" /> می‌دانم این پیام به ادمین می‌رسد، نه به مشتری</label></fieldset>
    <button id="fb-manual-send" type="button" class="btn btn-primary btn-sm">ثبت در صف ارسال دستی</button><p id="fb-manual-result" class="hint whitespace-pre-line" role="status" aria-live="polite"></p>
  </div></details>

</section>`;

export const fallbackScripts = String.raw`
(function () {
  var channels=['telegram','bale'],page=1,ready=false,dirty=false,busy=false,historyBusy=false,historyAgain=false,timer=null,lastConfig=null;
  var tests={},locked=[],manualSnapshot=null,manualIds=[],lastHistoryItems=[];
  function lockConfig(on){
    if(on){locked=Array.from(el('fallback').querySelectorAll('input')).map(function(node){var state={node:node,disabled:node.disabled};node.disabled=true;return state;});}
    else{locked.forEach(function(state){state.node.disabled=state.disabled;});locked=[];channels.forEach(function(ch){var c=lastConfig&&lastConfig.channels.find(function(row){return row.channel===ch;});el('fb-'+ch+'-token').disabled=!!(c&&c.tokenSource==='env');});}
  }
  function el(id){return document.getElementById(id);}
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
  function fa(value){return Number(value||0).toLocaleString('fa-IR');}
  function faDate(value){if(!value)return '—';var d=new Date(value.indexOf('T')<0?value.replace(' ','T')+'Z':value);return isNaN(d.getTime())?'—':d.toLocaleString('fa-IR',{timeZone:'Asia/Tehran'});}
  function report(e){toast(e.message||'ارتباط برقرار نشد؛ دوباره تلاش کنید.','error');}
  function setDirty(value){dirty=value;el('fallback-dirty').textContent=value?'تغییرات ذخیره نشده‌اند.':'';}
  function state(config){el('fallback-state').textContent=config.deliveryMode==='admin'&&config.channels.length?'حالت ادمین فعال است: برنامه فقط در بله/تلگرام به شما پیام می‌دهد؛ ارسال به مشتری با خودتان است. '+(!config.encryptionKeyConfigured?'کلید رمزنگاری را بررسی کنید.':'شماره و متن را جدا کپی کنید و پس از ارسال، انجام کار را ثبت کنید.'):!config.encryptionKeyConfigured?'کلید رمزنگاری تنظیم نیست. در Secrets ورکر FALLBACK_ENCRYPTION_KEY را طبق راهنما تنظیم کنید.':config.primaryActive?'اتصال پیامک اصلی تنظیم شده؛ گزارش مدیریت مستقل است و پیامک جایگزین فقط هنگام شکست ارسال استفاده می‌شود.':'پنل پیامکی خاموش یا ناقص است؛ برای ارسال دستی به ادمین، سوئیچ مربوط را روشن کنید.';}
  function selectedFields(){channels.forEach(function(ch){el('fb-'+ch+'-fields').classList.toggle('hidden',!el('fb-'+ch+'-selected').checked);});}
  async function loadConfig(){
    var c=await api('/api/admin/fallback');lastConfig=c;
    if(!ready&&c.deliveryMode==='admin')el('fallback-handoff').value='todo';el('fallback-mode').value=c.deliveryMode||'sms';el('fallback-connection').open=!(c.deliveryMode==='admin'&&c.channels.length);el('fallback-enabled').checked=c.enabled;el('fallback-notify').checked=!!c.notifyEnabled;
    el('fallback-invoices').checked=c.notifyInvoices!==false;el('fallback-actions').checked=c.notifyActions!==false;el('fallback-errors').checked=c.notifyErrors!==false;
    channels.forEach(function(ch){
      var row=c.channels.find(function(x){return x.channel===ch;});
      el('fb-'+ch+'-selected').checked=!!row;el('fb-'+ch+'-chat').value=row?row.chatId:'';
      var input=el('fb-'+ch+'-token');input.value='';input.type='password';input.disabled=!!(row&&row.tokenSource==='env');
      input.placeholder=row&&row.hasToken?'توکن محفوظ است؛ خالی یعنی بدون تغییر':'توکن بات را وارد کنید';
      el('fb-'+ch+'-reveal').textContent='نمایش';el('fb-'+ch+'-clear').checked=false;
      el('fb-'+ch+'-diagnostic').textContent='';
      el('fb-'+ch+'-source').textContent=row&&row.tokenSource==='env'?'توکن از Secret ورکر خوانده می‌شود؛ برای تغییر، همان Secret را ویرایش کنید.':row&&row.hasToken?'توکن ذخیره شده و از سرور بازگردانده نمی‌شود.':'توکن واقعی را فقط اینجا یا در Secret ورکر وارد کنید.';
    });
    selectedFields();state(c);ready=true;setDirty(false);el('fallback-save').disabled=false;
  }
  function payload(){return{deliveryMode:el('fallback-mode').value,enabled:el('fallback-enabled').checked,notifyEnabled:el('fallback-notify').checked,notifyInvoices:el('fallback-invoices').checked,notifyActions:el('fallback-actions').checked,notifyErrors:el('fallback-errors').checked,
    channels:channels.filter(function(ch){return el('fb-'+ch+'-selected').checked;}).map(function(ch){return{channel:ch,chatId:el('fb-'+ch+'-chat').value.trim(),token:el('fb-'+ch+'-token').value.trim(),clearToken:el('fb-'+ch+'-clear').checked};})};}
  async function save(){
    if(!ready)throw new Error('ابتدا تنظیمات را بازخوانی کنید.');
    var data=payload();
    if(lastConfig&&lastConfig.deliveryMode==='admin'&&data.deliveryMode!=='admin'&&!window.confirm('خروج از حالت ادمین، رسیدهای آماده‌نشده و پیام‌های منتظر این مسیر را لغو می‌کند؛ با برگشت دوباره فعال نمی‌شوند. ادامه می‌دهید؟'))throw new Error('تغییر حالت لغو شد.');
    if(lastConfig&&lastConfig.channels.some(function(c){return !data.channels.some(function(n){return n.channel===c.channel;});})&&!window.confirm('حذف مقصد، پیام‌های معلق آن را لغو می‌کند. ادامه می‌دهید؟'))throw new Error('حذف مقصد لغو شد.');
    await api('/api/admin/fallback',{method:'PUT',body:data});await loadConfig();
  }
  async function receipts(){try{var data=await api('/api/admin/receipts');var labels={pending:'نیازمند آماده‌سازی',processing:'در حال بررسی',held:'منتظر تکمیل اصلاح',queued:'آمادهٔ صف ادمین',cancelled:'لغوشده',expired:'منقضی'};el('receipt-progress').textContent=data.counts.map(function(r){return(labels[r.status]||r.status)+': '+fa(r.n);}).join(' | ')+(data.items.length?' — '+data.items.map(function(r){return 'فاکتور #'+fa(r.invoice_id)+' '+(labels[r.status]||r.status)+(r.error?' ('+r.error+')':'');}).join('، '):'');}catch{el('receipt-progress').textContent='وضعیت رسیدها دریافت نشد؛ دوباره تازه‌سازی کنید.';}}
  el('receipt-recover').addEventListener('click',async function(){setLoading(this,true);try{var r=await api('/api/admin/receipts/recover',{method:'POST',body:{}});toast(r.checked?'یک رسید بررسی شد؛ وضعیت را بخوانید.':'رسید آمادهٔ بررسی وجود ندارد.','success');await receipts();await history();}catch(e){report(e);}finally{setLoading(this,false);}});
  async function campaigns(){try{var data=await api('/api/admin/campaigns');el('campaign-progress').textContent=data.items.length?data.items.map(function(row){return({birthday:'تولد',churn:'یادآوری دیدار',weather:'آب‌وهوا'}[row.job]||row.job)+' · '+({running:'در حال آماده‌سازی',paused:'متوقف؛ نیازمند بررسی',done:'آماده‌سازی کامل',expired:'مهلت روز تمام شد'}[row.status]||row.status)+' · '+fa(row.queued)+' پیام آماده · '+fa(row.issues)+' مشتری نیازمند اصلاح'+(row.error?' — '+row.error:'');}).join(' | ')+(data.issues&&data.issues.length?' — خطاهای اخیر: '+data.issues.map(function(e){return 'مشتری #'+fa(e.user_id)+' ('+e.code+')';}).join('، '):''):'هنوز کمپینی در حالت ادمین شروع نشده است.';}catch{el('campaign-progress').textContent='وضعیت کمپین دریافت نشد؛ دوباره تازه‌سازی کنید.';}}
  function schedule(delay){clearTimeout(timer);timer=setTimeout(function(){if(!document.hidden)history().catch(report);else schedule(20000);},delay);}
  async function history(){
    if(historyBusy){historyAgain=true;return;}historyBusy=true;
    try{
      var q=new URLSearchParams({page:String(page),status:el('fallback-status').value,channel:el('fallback-channel').value,handoff:el('fallback-handoff').value});
      var data=await api('/api/admin/fallback/history?'+q.toString());
      if(q.get('page')!==String(page)||q.get('status')!==el('fallback-status').value||q.get('channel')!==el('fallback-channel').value||q.get('handoff')!==el('fallback-handoff').value){historyAgain=true;return;}
      var maxPage=Math.max(1,Math.ceil(data.total/30));if(page>maxPage){page=maxPage;historyAgain=true;return;}
      var stats=data.stats||{};
      el('fallback-stats').textContent='نیازمند اقدام دستی: '+fa(data.manualTodo)+' | در صف ادمین: '+fa((stats.pending||0)+(stats.processing||0))+' | ارسال موفق: '+fa(stats.sent)+' | ناموفق: '+fa(stats.failed);
      var labels={pending:'در صف',processing:'در حال ارسال',sent:'ارسال موفق به مقصد',failed:'ناموفق',skipped:'لغوشده',expired:'مهلت تمام شده'};
      var types={manual:'پیام دستی مدیر',report_error:'هشدار خطای ارسال',report_invoice:'گزارش فاکتور',report_action:'گزارش عملیات',invoice:'پیامک رسید خرید',otp:'کد ورود محرمانه',admin:'تست اتصال',welcome:'خوش‌آمد',birthday:'تولد',churn:'یادآوری حضور',weather:'آب‌وهوا',redeem:'تبدیل امتیاز',referral:'معرفی'};
      lastHistoryItems=data.items;
      if(manualIds.length){var tracked=data.items.filter(function(job){return manualIds.indexOf(job.id)>=0;});if(tracked.length)el('fb-manual-result').textContent=tracked.map(function(job){return(job.channel==='telegram'?'تلگرام':'بله')+': '+(labels[job.status]||job.status)+(job.provider_id?' — شناسهٔ پیام '+job.provider_id:'')+(job.error?' — '+job.error:'');}).join('\n');}
      el('fallback-history').innerHTML=data.items.length?data.items.map(function(j){
        var phone=j.content&&j.content.phone||'',text=j.content&&j.content.message||'';
        var retry=j.status==='failed'&&j.type!=='otp'&&j.expires_at>Date.now()+12000;
        return '<article class="rounded-2xl border border-white/10 p-3 space-y-2 text-xs">'+
          '<div class="flex flex-wrap justify-between gap-2"><b>'+esc(types[j.type]||'پیام')+' · '+esc(j.channel==='telegram'?'تلگرام':'بله')+'</b><span class="'+(j.status==='failed'?'text-rose-300':j.status==='sent'?'text-emerald-300':'text-amber-200')+'">'+esc(labels[j.status]||j.status)+'</span></div>'+
          '<div class="text-cream/40">'+esc(faDate(j.created_at))+'</div>'+
          (phone?'<button type="button" data-copy-phone="'+esc(phone)+'" class="font-mono select-all" dir="ltr" title="کپی شماره">'+esc(phone)+' ⧉</button>':'')+
          (j.type==='otp'?'<p class="text-amber-200">متن و شماره کد ورود در تاریخچه نمایش داده نمی‌شود.</p>':text?'<p class="whitespace-pre-wrap break-words">'+esc(text.slice(0,150))+(text.length>150?'…':'')+'</p>':'<p class="hint">محتوا در دسترس نیست؛ کلید رمزنگاری را بررسی کنید.</p>')+
          (j.type!=='otp'&&text?'<button type="button" class="btn btn-ghost btn-sm" data-copy-message="'+esc(j.id)+'">کپی متن کامل برای ارسال دستی</button>':'')+
          (j.expires_at<=Date.now()?'<p class="text-amber-200">مهلت این پیام تمام شده است؛ پیش از ارسال، اعتبار محتوا را بررسی کنید.</p>':'')+
          (j.manual_sent_at?'<p class="text-emerald-300">✓ ارسال دستی توسط مدیر ثبت شد · '+esc(faDate(j.manual_sent_at))+' (اظهار مدیر، نه رسید تحویل)</p>':phone&&text&&j.type!=='otp'&&!j.type.startsWith('report_')&&j.reason!=='test'?'<button type="button" class="btn btn-primary btn-sm" data-manual-done="'+esc(j.id)+'">به مشتری فرستادم؛ ثبت انجام کار</button>':'')+
          (j.error?'<p class="text-amber-200 whitespace-pre-wrap break-words">'+esc(j.error)+'</p>':'')+
          '<details><summary class="cursor-pointer text-cream/50">جزئیات'+(text.length>150?' و متن کامل':'')+'</summary><div class="mt-2 space-y-2">'+
          (text.length>150?'<pre class="whitespace-pre-wrap break-words font-sans">'+esc(text)+'</pre>':'')+
          '<p>شناسهٔ پیام API: '+esc(j.provider_id||'هنوز تأیید نشده')+'</p><p>تعداد تلاش در این نوبت: '+fa(j.attempts)+' | مقصد: <bdi>'+esc(j.chat_id)+'</bdi></p><p>شناسه: <bdi>'+esc(j.id)+'</bdi></p></div></details>'+
          (retry?'<button type="button" class="btn btn-ghost btn-sm" data-retry-id="'+esc(j.id)+'" data-uncertain="'+(!/^(INVALID_TOKEN|INVALID_CHAT|FORBIDDEN|CONFIG_OR_KEY_ERROR|RATE_LIMITED):/.test(j.error||''))+'">تلاش مجدد پس از رفع خطا</button>':'')+'</article>';
      }).join(''):'<p class="hint">پیامی با این فیلتر وجود ندارد.</p>';
      channels.forEach(function(ch){if(!tests[ch])return;var job=data.items.find(function(j){return tests[ch].indexOf(j.id)>=0;});if(job){el('fb-'+ch+'-result').textContent='نتیجه تست: '+(labels[job.status]||job.status)+(job.error?' — '+job.error:'');if(!['pending','processing'].includes(job.status))delete tests[ch];}});
      el('fb-page').textContent=fa(page)+' / '+fa(Math.max(1,Math.ceil(data.total/30)));el('fb-prev').disabled=page<=1;el('fb-next').disabled=page*30>=data.total;
      schedule((stats.pending||stats.processing||Object.keys(tests).length)?5000:20000);
    }catch(error){schedule(20000);throw error;}finally{historyBusy=false;if(historyAgain){historyAgain=false;history().catch(report);}}
  }
  el('fallback-save').addEventListener('click',async function(){if(busy)return;busy=true;lockConfig(true);setLoading(this,true,'در حال ذخیره…');try{await save();toast('تنظیمات ذخیره شد.','success');await history();}catch(e){report(e);}finally{busy=false;lockConfig(false);setLoading(this,false);}});
  el('fallback-reload').addEventListener('click',async function(){if(busy)return;if(dirty&&!window.confirm('تغییرات ذخیره‌نشده کنار گذاشته شوند؟'))return;busy=true;lockConfig(true);try{await loadConfig();}catch(e){report(e);}finally{busy=false;lockConfig(false);}});
  ['fallback-mode','fallback-enabled','fallback-notify','fallback-invoices','fallback-actions','fallback-errors'].forEach(function(id){el(id).addEventListener('change',function(){setDirty(true);});});
  channels.forEach(function(ch){
    ['selected','chat','token','clear'].forEach(function(key){el('fb-'+ch+'-'+key).addEventListener(key==='chat'||key==='token'?'input':'change',function(){setDirty(true);selectedFields();});});
    el('fb-'+ch+'-reveal').addEventListener('click',function(){var input=el('fb-'+ch+'-token');input.type=input.type==='password'?'text':'password';this.textContent=input.type==='password'?'نمایش':'مخفی';});
    el('fb-'+ch+'-diagnose').addEventListener('click',async function(){
      if(busy||!ready)return;
      var output=el('fb-'+ch+'-diagnostic');
      if(dirty){output.textContent='ابتدا تغییرات را با دکمهٔ ذخیره پیام‌های ادمین ذخیره کنید؛ سپس بررسی ارتباط را بزنید.';return;}
      busy=true;lockConfig(true);var button=this;setLoading(button,true,'در حال بررسی…');output.textContent='بررسی از سرور Cloudflare انجام می‌شود؛ پیام جدید ارسال نمی‌شود…';
      try {
        var result=await api('/api/admin/fallback/diagnose',{method:'POST',body:{channel:ch}});
        output.textContent=result.checks.map(function(check){var d=check.diagnostic;return(check.stage==='bot'?'اعتبار توکن و ارتباط: ':'دسترسی به مقصد: ')+(check.ok?'موفق — ':'ناموفق — ')+check.message+' ['+check.code+']'+(d?' (مرحله '+d.phase+(d.httpStatus?'؛ HTTP '+d.httpStatus:'')+'؛ مدت '+fa(d.elapsedMs)+' میلی‌ثانیه؛ پیگیری '+d.referenceId+')':'');}).join('\n')+
          (result.ready?'\nAPI بات و مقصد پاسخ دادند؛ برای تأیید ارسال واقعی، جداگانه پیام آزمایشی بفرستید.':'\nبررسی متوقف شد؛ کد خطا و شناسهٔ پیگیری را بدون توکن برای پشتیبانی بفرستید.');
      }catch(e){output.textContent=e.message||'بررسی کامل نشد؛ ارتباط مرورگر با سایت را هم بررسی کنید.';}
      finally{busy=false;lockConfig(false);setLoading(button,false);}
    });
    el('fb-'+ch+'-test').addEventListener('click',async function(){if(busy||!ready)return;busy=true;lockConfig(true);var btn=this;setLoading(btn,true,'در حال ثبت تست…');try{
      if(dirty)await save();var result=await api('/api/admin/fallback/test',{method:'POST',body:{channel:ch}});tests[ch]=result.ids;
      el('fb-'+ch+'-result').textContent='تست در صف است؛ نتیجه خودکار به‌روز می‌شود. دریافت واقعی پیام را هم بررسی کنید.';
      page=1;el('fallback-status').value='';el('fallback-channel').value='';await history();
    }catch(e){el('fb-'+ch+'-result').textContent=e.message;report(e);}finally{busy=false;lockConfig(false);setLoading(btn,false);}});
  });
  el('fb-manual-send').addEventListener('click',async function(){
    if(busy||!ready)return;var button=this;
    if(dirty){el('fb-manual-result').textContent='ابتدا تغییرات تنظیمات مقصد را ذخیره کنید.';return;}
    if(!manualSnapshot){var text=el('fb-manual-text').value;if(!text.trim()||text.length>2000||!el('fb-manual-confirm').checked){el('fb-manual-result').textContent='متن را وارد و ارسال فقط به ادمین را تأیید کنید.';return;}manualSnapshot={channel:el('fb-manual-channel').value,phone:el('fb-manual-phone').value,message:text,confirmAdminOnly:true,requestId:crypto.randomUUID()};}
    busy=true;lockConfig(true);el('fb-manual-fields').disabled=true;setLoading(button,true,'در حال ثبت…');
    try{var result=await api('/api/admin/fallback/send',{method:'POST',body:manualSnapshot});manualIds=result.ids;manualSnapshot=null;el('fb-manual-text').value='';el('fb-manual-phone').value='';el('fb-manual-confirm').checked=false;el('fb-manual-result').textContent=result.message;page=1;el('fallback-status').value='';el('fallback-channel').value='';await history();}
    catch(error){el('fb-manual-result').textContent=error.message;if(error.status===400||error.status===409)manualSnapshot=null;else el('fb-manual-result').textContent+=' همان دکمه را برای پیگیری همان درخواست بزنید؛ ارسال تازه نسازید.';}
    finally{busy=false;lockConfig(false);el('fb-manual-fields').disabled=!!manualSnapshot;setLoading(button,false);}
  });
  el('fallback-recommend').addEventListener('click',function(){el('fallback-mode').value='admin';setDirty(true);toast('حالت ادمین انتخاب شد؛ مقصدها را بررسی و ذخیره کنید.','info');});
  el('fallback-history').addEventListener('click',async function(e){
    var done=e.target.closest('[data-manual-done]');if(done){if(!await confirmAction({title:'ثبت ارسال دستی',message:'آیا متن را خودتان به شمارهٔ مشتری فرستاده‌اید؟ این ثبت به معنی تحویل یا خواندن پیام نیست.',confirmText:'بله، خودم فرستادم'}))return;setLoading(done,true);try{await api('/api/admin/fallback/'+encodeURIComponent(done.dataset.manualDone)+'/forwarded',{method:'POST',body:{confirmSent:true}});toast('انجام کار برای هر دو نسخهٔ پیام ثبت شد.','success');await history();}catch(error){report(error);}finally{setLoading(done,false);}return;}

    var messageCopy=e.target.closest('[data-copy-message]');if(messageCopy){var job=lastHistoryItems.find(function(item){return item.id===messageCopy.dataset.copyMessage;});if(job&&job.type!=='otp'&&job.content){try{await navigator.clipboard.writeText(job.content.message);toast('متن کامل کپی شد.','success');}catch(_){window.prompt('متن کامل پیام:',job.content.message);}}return;}
    var copy=e.target.closest('[data-copy-phone]');if(copy){try{await navigator.clipboard.writeText(copy.dataset.copyPhone);toast('شماره کپی شد.','success');}catch(_){window.prompt('شماره را کپی کنید:',copy.dataset.copyPhone);}return;}
    var btn=e.target.closest('[data-retry-id]');if(!btn)return;
    if(!window.confirm(btn.dataset.uncertain==='true'?'ممکن است پیام قبلاً تحویل شده باشد. خطر ارسال تکراری را می‌پذیرید؟':'خطای مقصد را برطرف کرده‌اید و پیام دوباره ارسال شود؟'))return;
    setLoading(btn,true,'در حال ثبت…');try{var r=await api('/api/admin/fallback/'+encodeURIComponent(btn.dataset.retryId)+'/retry',{method:'POST',body:{confirmDuplicateRisk:btn.dataset.uncertain==='true'}});toast(r.message,'success');await history();}catch(error){report(error);}finally{setLoading(btn,false);}
  });
  ['fallback-status','fallback-channel','fallback-handoff'].forEach(function(id){el(id).addEventListener('change',function(){page=1;history().catch(report);});});
  el('fallback-refresh').addEventListener('click',function(){history().catch(report);campaigns();receipts();});
  el('fb-prev').addEventListener('click',function(){if(page>1)page--;history().catch(report);});el('fb-next').addEventListener('click',function(){page++;history().catch(report);});
  document.addEventListener('sms-settings-saved',function(){api('/api/admin/fallback').then(state).catch(report);});
  window.addEventListener('pagehide',function(){clearTimeout(timer);});
  window.addEventListener('beforeunload',function(e){if(dirty){e.preventDefault();e.returnValue='';}});
  busy=true;lockConfig(true);loadConfig().then(function(){return history();}).catch(function(e){el('fallback-state').textContent='تنظیمات دریافت نشد؛ بازخوانی تنظیمات را بزنید.';report(e);}).finally(function(){busy=false;lockConfig(false);});
  campaigns();receipts();
  history().catch(function(e){report(e);schedule(20000);});
})();`;

export function adminFallbackPage(settings: AppSettings, userName: string): string {
  return appShell({ title:'پیام‌های ادمین',role:'admin',userName,active:'messages',
    body:`<div class="max-w-6xl mx-auto p-4 sm:p-6"><a href="/admin/settings" class="btn btn-ghost mb-4">بازگشت به تنظیمات</a>${fallbackPanel}</div>`,
    scripts:fallbackScripts,cafeName:settings.cafe_name });
}
