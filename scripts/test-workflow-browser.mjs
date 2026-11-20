/** Real Chromium + local Worker/D1, with external CDN blocked and messenger HTTP/UI fixtures.
 * Optional tooling: npm install --prefix .cache/browser-tools --no-package-lock playwright-core@1.65.0 @sparticuz/chromium@153.0.0
 * BROWSER_TOOLS_DIR=.cache/browser-tools npm run test:workflow:browser
 * Only runs against localhost. Temporarily changes local points/menu settings, restored in finally.
 * This verifies behavior, NOT Tailwind CDN rendering or live Telegram/Bale receipt.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
const tools=createRequire(process.env.BROWSER_TOOLS_DIR?join(resolve(process.env.BROWSER_TOOLS_DIR),'package.json'):import.meta.url);
const {default:chromium}=await import(pathToFileURL(tools.resolve('@sparticuz/chromium')));
const playwrightModule=await import(pathToFileURL(tools.resolve('playwright-core')));
const playwright=playwrightModule.chromium||playwrightModule.default.chromium;
const BASE=process.env.BASE_URL||'http://127.0.0.1:8787';
assert(['127.0.0.1','localhost'].includes(new URL(BASE).hostname),'Use a disposable local database only.');
const dir=await mkdtemp(join(tmpdir(),'cafe-browser-'));
let browser,original,admin,passed=0,employeeId,employeeCookie,employeePage,adminPage,customerId,customerPhone;
async function test(label,fn){await fn();passed++;console.log('✅ '+label);}
async function request(path,{cookie=admin,method='GET',body}={}){
  const r=await fetch(BASE+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data=await r.json();assert(r.ok,JSON.stringify(data));return {data:data.data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
try{
  admin=(await request('/api/auth/login',{cookie:'',method:'POST',body:{phone:process.env.ADMIN_PHONE||'09120000000',password:process.env.ADMIN_PASSWORD||'Admin@12345'}})).cookie;
  const staff=(await request('/api/auth/login',{cookie:'',method:'POST',body:{phone:process.env.STAFF_PHONE||'09120000001',password:process.env.STAFF_PASSWORD||'Staff@12345'}})).cookie;
  original=(await request('/api/admin/settings')).data;
  const menu=Array.from({length:1000},(_,i)=>({name:'محصول آزمون '+i,price:1000+i,category:'گروه '+(i%10)}));
  await request('/api/admin/settings',{method:'PUT',body:{points_mode:'invoice',invoice_points:23,require_shift:0,sms_enabled:0,tier_labels:{bronze:'دوست کافه',silver:'همراه',gold:'ویژه',vip:'خانواده'},menu_items:menu}});
  const archive=join(dir,'libraries.tar');await writeFile(archive,brotliDecompressSync(await readFile(join(dirname(tools.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'))));execFileSync('tar',['-xf',archive,'-C',dir]);
  browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!['--disable-web-security','--disable-site-isolation-trials','--single-process'].includes(a)),env:{...process.env,LD_LIBRARY_PATH:join(dir,'lib')+':'+(process.env.LD_LIBRARY_PATH||'')},headless:true});
  const errors=[];
  async function pageFor(cookie, options={}){
    const context=await browser.newContext({viewport:{width:1280,height:900},...options});if(cookie)await context.addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:BASE}]);
    await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(BASE).origin?r.continue():r.abort());
    await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='.hidden{display:none!important}html{scroll-behavior:auto!important}*,*::before,*::after{animation:none!important;transition:none!important}';document.head.appendChild(s);}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;
  }
  async function fillLogin(page){await page.locator('#phone').fill(process.env.ADMIN_PHONE||'09120000000');await page.locator('#password').fill(process.env.ADMIN_PASSWORD||'Admin@12345');}
  const password='Local-browser-test@123';
  const uniquePhone=()=> '0912'+String(Math.floor(Math.random()*9000000)+1000000);
  const employeePhone=uniquePhone();
  await test('admin creates staff through real checkbox UI without directory/search/history/shift grants',async()=>{
    adminPage=await pageFor(admin);await adminPage.goto(BASE+'/admin/staff');await adminPage.locator('#open-add-staff').click();
    assert(await adminPage.locator('#s-permissions input[value="customer.create"]').isChecked());assert(!(await adminPage.locator('#s-permissions input[value="customer.list"]').isChecked()));
    await adminPage.locator('#s-name').fill('پرسنل آزمون رابط');await adminPage.locator('#s-phone').fill(employeePhone);await adminPage.locator('#s-password').fill(password);
    for(const key of ['invoice.history','shift.manage'])await adminPage.locator('#s-permissions input[value="'+key+'"]').uncheck();
    const waiting=adminPage.waitForResponse(r=>r.url().endsWith('/api/admin/staff')&&r.request().method()==='POST');await adminPage.locator('#staff-submit').click();const response=await waiting;const result=await response.json();assert.equal(response.status(),201,JSON.stringify(result));employeeId=result.data.id;await adminPage.locator('.modal-backdrop [data-act="ok"]').click();await adminPage.waitForSelector('[data-permissions-id="'+employeeId+'"]');
    employeeCookie=(await request('/api/auth/login',{cookie:'',method:'POST',body:{phone:employeePhone,password}})).cookie;
  });
  await test('restricted staff sees creation/invoicing, but directory controls and forbidden navigation are hidden',async()=>{
    employeePage=await pageFor(employeeCookie);await employeePage.goto(BASE+'/staff');assert(await employeePage.locator('[data-invoice-only]').first().isVisible());assert(await employeePage.locator('#quick-customer').isVisible());assert(!(await employeePage.locator('#customer-list').isVisible()));assert.equal(await employeePage.locator('nav a[href="/staff/history"]').count(),0);assert.equal(await employeePage.locator('a[href="/staff/shift"]').count(),0);
    assert.equal((await employeePage.context().request.get(BASE+'/api/staff/customers')).status(),403);
  });
  await test('inline customer registration retains phone, nickname and unchecked opt-in, without navigating or listing customers',async()=>{
    customerPhone=uniquePhone();await employeePage.locator('#phone-input').fill(customerPhone);await employeePage.locator('#quick-customer summary').click();await employeePage.locator('#quick-name').fill('مشتری سریع مرورگر');await employeePage.locator('#quick-nickname').fill('آشنای همیشگی');assert(!(await employeePage.locator('#quick-sms').isChecked()));
    const created=employeePage.waitForResponse(r=>r.url().endsWith('/api/staff/customers')&&r.request().method()==='POST');await employeePage.locator('#quick-save').click();const response=await created;const result=await response.json();assert.equal(response.status(),201,JSON.stringify(result));customerId=result.data.id;
    await employeePage.waitForFunction(()=>!document.getElementById('customer-card').classList.contains('hidden'));assert((await employeePage.locator('#c-name').innerText()).includes('آشنای همیشگی'));assert.equal(await employeePage.locator('#phone-input').inputValue(),customerPhone);assert.equal(new URL(employeePage.url()).pathname,'/staff');
  });
  await test('same-page invoice submits the selected customer and full-phone proof with exact Persian amount',async()=>{
    await employeePage.locator('#manual-amount').fill('۳۵٬۰۰۰');await employeePage.locator('#manual-amount').blur();const waiting=employeePage.waitForResponse(r=>r.url().endsWith('/api/staff/invoices')&&r.request().method()==='POST');await employeePage.locator('#submit-invoice').click();const response=await waiting;const out=await response.json();assert.equal(response.status(),201,JSON.stringify(out));assert.equal(response.request().postDataJSON().customerPhone,customerPhone);assert.equal(out.data.amount,35000);assert.equal((await request('/api/admin/invoices/'+out.data.invoiceId)).data.user_id,customerId);await employeePage.waitForSelector('#receipt-modal:not(.hidden)');assert((await employeePage.locator('#r-tier').innerText()).includes('دوست کافه'));await employeePage.locator('#new-invoice').click();
  });
  await test('editing lookup phone invalidates old customer before an invoice can be sent',async()=>{
    await employeePage.locator('#phone-input').fill(customerPhone);await employeePage.locator('#search-btn').click();await employeePage.waitForSelector('#customer-card:not(.hidden)');await employeePage.locator('#phone-input').fill('123');assert(await employeePage.locator('#customer-card').evaluate(n=>n.classList.contains('hidden')));let invoices=0;const listener=r=>{if(r.method()==='POST'&&r.url().endsWith('/api/staff/invoices'))invoices++;};employeePage.on('request',listener);await employeePage.locator('#submit-invoice').click();assert.equal(invoices,0);employeePage.off('request',listener);
  });
  await test('changing nickname does not invent a birthday for quick-registered customer',async()=>{
    const detail=await pageFor(admin);await detail.goto(BASE+'/admin/customers/'+customerId);assert.equal(await detail.locator('#e-nickname').inputValue(),'آشنای همیشگی');assert(!(await detail.locator('#e-birth-known').isChecked()));assert(await detail.locator('#e-year').isDisabled());await detail.locator('#e-nickname').fill('لقب تازه');const waiting=detail.waitForResponse(r=>r.url().endsWith('/api/admin/customers/'+customerId)&&r.request().method()==='PUT');await detail.locator('#save-btn').click();const response=await waiting;assert.equal(response.status(),200);assert.equal(response.request().postDataJSON().birth_date,'');
  });
  await test('permission editor grants search immediately to existing session without granting directory',async()=>{
    adminPage=await pageFor(admin);await adminPage.goto(BASE+'/admin/staff');
    await adminPage.locator('[data-permissions-id="'+employeeId+'"]').click();await adminPage.locator('#permission-fields input[value="customer.search"]').check();await adminPage.locator('#save-permissions').click();await adminPage.waitForFunction(()=>document.getElementById('permissions-modal').classList.contains('hidden'));
    employeePage=await pageFor(employeeCookie);await employeePage.goto(BASE+'/staff');await employeePage.locator('#phone-input').fill('لقب تازه');await employeePage.locator('#search-btn').click();await employeePage.waitForSelector('#customer-choices button');assert((await employeePage.locator('#customer-choices').innerText()).includes(customerPhone));assert(!(await employeePage.locator('#customer-list').isVisible()));await employeePage.locator('#customer-choices button').first().click();await employeePage.waitForSelector('#customer-card:not(.hidden)');assert((await employeePage.locator('#c-name').innerText()).includes('لقب تازه'));
  });
  await test('an out-of-order older full-phone response cannot replace a newer selected customer',async()=>{
    const phone2=uniquePhone();const second=(await request('/api/admin/customers',{method:'POST',body:{name:'مشتری دوم مرورگر',phone:phone2,sms_opt_in:false}})).data;
    let release;const wait=new Promise(r=>release=r);const path='**/api/staff/customer?phone='+customerPhone;let delivered;
    await employeePage.route(path,async route=>{await wait;await route.fulfill({json:{ok:true,data:{found:true,customer:{id:customerId,name:'پاسخ قدیمی',phone:customerPhone,points:0,tier:'bronze',coupons:[]}}}});});
    const firstRequest=employeePage.waitForRequest(r=>r.url().endsWith('phone='+customerPhone));await employeePage.locator('#phone-input').fill(customerPhone);await employeePage.locator('#search-btn').click();await firstRequest;
    await employeePage.locator('#phone-input').fill(phone2);await employeePage.locator('#search-btn').click();await employeePage.waitForFunction(()=>document.getElementById('c-name').textContent.includes('مشتری دوم'));
    delivered=employeePage.waitForResponse(r=>r.url().endsWith('phone='+customerPhone));release();await delivered;await employeePage.waitForTimeout(100);assert((await employeePage.locator('#c-name').innerText()).includes('مشتری دوم'));await employeePage.unroute(path);
  });
  await test('lost invoice response keeps the exact request across reload and retry returns the same invoice',async()=>{
    await employeePage.locator('#manual-amount').fill('۱۲۰۰۰');await employeePage.locator('#manual-amount').blur();let captured,committedId;
    const invoicePattern='**/api/staff/invoices';await employeePage.route(invoicePattern,async route=>{if(route.request().method()!=='POST')return route.continue();captured=route.request().postDataJSON();const response=await route.fetch();const data=await response.json();assert.equal(response.status(),201,JSON.stringify(data));committedId=data.data.invoiceId;await route.abort('failed');});
    await employeePage.locator('#submit-invoice').click();await employeePage.waitForFunction(()=>document.getElementById('invoice-request-state').textContent.includes('نامعلوم'));assert(await employeePage.locator('#phone-input').isDisabled());assert(await employeePage.locator('#manual-amount').isDisabled());await employeePage.unroute(invoicePattern);await employeePage.reload();await employeePage.waitForFunction(()=>document.getElementById('invoice-request-state').textContent.includes('تعیین‌تکلیف'));assert(await employeePage.locator('#phone-input').isDisabled());
    const waiting=employeePage.waitForResponse(r=>r.url().endsWith('/api/staff/invoices')&&r.request().method()==='POST');await employeePage.locator('#submit-invoice').click();const response=await waiting;const out=await response.json();assert.equal(response.status(),201,JSON.stringify(out));assert.equal(out.data.invoiceId,committedId);assert(out.data.duplicate);assert.deepEqual(response.request().postDataJSON(),captured);await employeePage.waitForSelector('#receipt-modal:not(.hidden)');assert(!(await employeePage.locator('#phone-input').isDisabled()));assert.equal(await employeePage.evaluate(id=>sessionStorage.getItem('cc.invoice.pending:'+id),employeeId),null);await employeePage.locator('#new-invoice').click();
  });
  await test('revoked invoice permission blocks a stale open tab before any write',async()=>{
    await employeePage.locator('#phone-input').fill(customerPhone);await employeePage.locator('#search-btn').click();await employeePage.waitForSelector('#customer-card:not(.hidden)');await employeePage.locator('#manual-amount').fill('1000');await employeePage.locator('#manual-amount').blur();await request('/api/admin/staff/'+employeeId,{method:'PUT',body:{permissions:['customer.create']}});
    const waiting=employeePage.waitForResponse(r=>r.url().endsWith('/api/staff/invoices')&&r.request().method()==='POST');await employeePage.locator('#submit-invoice').click();assert.equal((await waiting).status(),403);await employeePage.reload();assert(!(await employeePage.locator('[data-invoice-only]').first().isVisible()));assert(await employeePage.locator('#quick-customer').isVisible());assert(!(await employeePage.locator('#search-btn').isVisible()));
  });
  await test('admin list add-customer modal continues straight to invoice with phone preselected',async()=>{
    adminPage=await pageFor(admin);await adminPage.goto(BASE+'/admin/customers');await adminPage.locator('#open-add').click();assert(await adminPage.locator('#add-invoice-now').isChecked());assert(!(await adminPage.locator('#add-birth-known').isChecked()));const phone=uniquePhone();await adminPage.locator('#add-name').fill('مشتری فرم مدیر');await adminPage.locator('#add-phone').fill(phone);await adminPage.locator('#add-nickname').fill('مدیرپسند');await adminPage.locator('#add-submit').click();await adminPage.waitForURL(u=>u.pathname==='/staff');await adminPage.waitForSelector('#customer-card:not(.hidden)');assert.equal(await adminPage.locator('#phone-input').inputValue(),phone);assert((await adminPage.locator('#c-name').innerText()).includes('مدیرپسند'));assert.equal(new URL(adminPage.url()).search,'');
  });
  await test('tier label settings have all four editable names and correct personalized threshold labels',async()=>{
    await adminPage.goto(BASE+'/admin/settings');for(const [key,value] of Object.entries({bronze:'دوست کافه',silver:'همراه',gold:'ویژه',vip:'خانواده'}))assert.equal(await adminPage.locator('#tier_label_'+key).inputValue(),value);assert.equal((await adminPage.locator('label[for="tier_gold"]').innerText()).trim(),'ویژه');
  });
  // Messenger UI fixtures below never save credentials or invoke provider HTTP in the Worker.
  const panel=await pageFor(admin);let manualAttempts=[],cfg={enabled:false,notifyEnabled:false,notifyErrors:true,encryptionKeyConfigured:true,channels:[{channel:'telegram',chatId:'123',hasToken:true,tokenSource:'env'},{channel:'bale',chatId:'456',hasToken:true,tokenSource:'env'}]},fixtureItems=[],loseManualResponse=true;
  const text='پیام کامل قابل کپی — '+ 'متن آزمایشی '.repeat(25);
  await panel.route('**/api/admin/fallback**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;let data;
    if(path.endsWith('/send')){manualAttempts.push(req.postDataJSON());if(loseManualResponse){loseManualResponse=false;return route.abort('failed');}fixtureItems=['telegram','bale'].map((channel,i)=>({id:'manual-fixture-'+i,channel,chat_id:i?'456':'123',type:'manual',reason:'manual',status:'pending',attempts:0,created_at:'2026-10-21 12:00:00',expires_at:Date.now()+86400000,content:{message:text,phone:'',requestedAt:new Date().toISOString()}}));data={ids:fixtureItems.map(j=>j.id),message:'در صف قرار گرفت'};}
    else if(path.endsWith('/history'))data={items:fixtureItems,total:fixtureItems.length,page:1,stats:{pending:fixtureItems.filter(j=>j.status==='pending').length,sent:fixtureItems.filter(j=>j.status==='sent').length,failed:fixtureItems.filter(j=>j.status==='failed').length}};
    else if(req.method()==='PUT'){cfg={...cfg,...req.postDataJSON()};data={saved:true};}else data=cfg;
    await route.fulfill({status:path.endsWith('/send')?202:200,json:{ok:true,data}});
  });
  await test('manual composer requires confirmation, preserves request on network loss and distinguishes queued from sent',async()=>{
    await panel.goto(BASE+'/admin/fallback');await panel.waitForFunction(()=>!document.getElementById('fallback-save').disabled);assert(await panel.locator('#fallback-errors').isChecked());await panel.locator('summary').filter({hasText:'نوشتن و ارسال پیام دستی'}).click();await panel.locator('#fb-manual-text').fill(text);await panel.locator('#fb-manual-send').click();assert.equal(manualAttempts.length,0);await panel.locator('#fb-manual-confirm').check();await panel.locator('#fb-manual-send').click();await panel.waitForFunction(()=>document.getElementById('fb-manual-result').textContent.includes('همان دکمه'));assert(await panel.locator('#fb-manual-text').isDisabled());await panel.locator('#fb-manual-send').click();await panel.waitForFunction(()=>document.getElementById('fb-manual-result').textContent.includes('در صف'));assert.equal(manualAttempts.length,2);assert.deepEqual(manualAttempts[0],manualAttempts[1]);assert(!(await panel.locator('#fb-manual-text').isDisabled()));assert.equal(await panel.locator('#fb-manual-text').inputValue(),'');
  });
  await test('manual tracking shows success/failure per messenger and full text copies without truncation',async()=>{
    fixtureItems[0].status='sent';fixtureItems[0].provider_id='98765';fixtureItems[1].status='failed';fixtureItems[1].error='FETCH_FAILED: بررسی خطا';await panel.locator('#fallback-refresh').click();await panel.waitForFunction(()=>document.getElementById('fb-manual-result').textContent.includes('98765'));const result=await panel.locator('#fb-manual-result').textContent();assert(result.includes('تلگرام'));assert(result.includes('بله'));assert(result.includes('ناموفق'));assert(result.includes('FETCH_FAILED'));
    await panel.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.COPIED_TEXT=text}}));await panel.locator('[data-copy-message]').first().click();assert.equal(await panel.evaluate(()=>window.COPIED_TEXT),text);
  });
  await test('tested workflow pages produce no uncaught JavaScript errors',async()=>assert.deepEqual(errors,[]));
  console.log(`\n${passed}/${passed} workflow Chromium checks passed (local real D1 flows; messenger UI fixtures, CDN blocked).`);
}finally{
  if(original&&admin)await request('/api/admin/settings',{method:'PUT',body:original}).catch(e=>console.error('Restore local test settings failed:',e.message));
  if(browser){if(process.exitCode)console.error('browser test failed');await browser.close();}await rm(dir,{recursive:true,force:true});
}
