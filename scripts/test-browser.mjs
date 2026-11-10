/** Real Chromium + local Worker/D1, with external CDN blocked and messenger HTTP/UI fixtures.
 * Optional tooling: npm install --prefix .cache/browser-tools --no-package-lock playwright-core@1.65.0 @sparticuz/chromium@153.0.0
 * BROWSER_TOOLS_DIR=.cache/browser-tools npm run test:browser
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
let browser,original,admin,passed=0;
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
  await request('/api/admin/settings',{method:'PUT',body:{points_mode:'invoice',invoice_points:23,menu_items:menu}});
  const archive=join(dir,'libraries.tar');await writeFile(archive,brotliDecompressSync(await readFile(join(dirname(tools.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'))));execFileSync('tar',['-xf',archive,'-C',dir]);
  browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!['--disable-web-security','--disable-site-isolation-trials','--single-process'].includes(a)),env:{...process.env,LD_LIBRARY_PATH:join(dir,'lib')+':'+(process.env.LD_LIBRARY_PATH||'')},headless:true});
  const errors=[];
  async function pageFor(cookie){
    const context=await browser.newContext({viewport:{width:1280,height:900}});if(cookie)await context.addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:BASE}]);
    await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(BASE).origin?r.continue():r.abort());
    await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='.hidden{display:none!important}';document.head.appendChild(s);}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;
  }
  async function fillLogin(page){await page.locator('#phone').fill(process.env.ADMIN_PHONE||'09120000000');await page.locator('#password').fill(process.env.ADMIN_PASSWORD||'Admin@12345');}
  await test('login with legacy cookie URL has no old warning and real cookie login reaches dashboard',async()=>{
    const page=await pageFor('');await page.goto(BASE+'/login?e=cookie');assert(!(await page.locator('body').innerText()).includes('مرورگر کوکی ورود را ذخیره نکرد'));await fillLogin(page);await page.locator('#login-btn').click();await page.waitForURL(BASE+'/admin');const cookie=(await page.context().cookies()).find(c=>c.name==='cc_session');assert(cookie&&cookie.httpOnly&&cookie.sameSite==='Lax');
  });
  await test('real browser retries one stale unauthenticated session response and completes login',async()=>{
    const page=await pageFor('');let probes=0;await page.route('**/api/auth/session*',async route=>{if(++probes===1)await route.fulfill({json:{ok:true,data:{authenticated:false,userId:null,role:null}}});else await route.continue();});
    await page.goto(BASE+'/login');await fillLogin(page);await page.locator('#login-btn').click();await page.waitForURL(BASE+'/admin');assert.equal(probes,2);
  });
  await test('real browser with no returned cookie stops on form after three checks with safe standalone link',async()=>{
    const page=await pageFor('');let probes=0;page.on('request',r=>{if(r.url().includes('/api/auth/session'))probes++;});await page.route('**/api/auth/login',r=>r.fulfill({json:{ok:true,data:{userId:1,role:'admin',name:'fixture',redirect:'/admin'}}}));
    await page.goto(BASE+'/login');await fillLogin(page);await page.locator('#login-btn').click();await page.waitForFunction(()=>!document.getElementById('login-feedback').classList.contains('hidden'));assert.equal(probes,3);assert(new URL(page.url()).pathname==='/login');assert.equal((await page.context().cookies()).filter(c=>c.name==='cc_session').length,0);assert(!(await page.locator('#login-btn').isDisabled()));assert.equal(await page.locator('#login-open').getAttribute('target'),'_blank');
  });
  await test('real browser session network failure does not report welcome or blame browser cookies',async()=>{
    const page=await pageFor('');let probes=0;await page.route('**/api/auth/session*',r=>{probes++;return r.abort();});await page.goto(BASE+'/login');await fillLogin(page);await page.locator('#login-btn').click();await page.waitForFunction(()=>!document.getElementById('login-feedback').classList.contains('hidden'));assert.equal(probes,3);assert(new URL(page.url()).pathname==='/login');assert(!(await page.locator('body').innerText()).includes('مرورگر کوکی ورود را ذخیره نکرد'));assert(!(await page.locator('#login-btn').isDisabled()));
  });
  await test('real browser wrong password stays on login and shows credential error, not cookie error',async()=>{
    const page=await pageFor('');await page.goto(BASE+'/login');await fillLogin(page);await page.locator('#password').fill('definitely-wrong');await page.locator('#login-btn').click();await page.waitForFunction(()=>document.getElementById('toast-host').textContent.includes('اشتباه'));assert(new URL(page.url()).pathname==='/login');assert(!(await page.locator('#login-btn').isDisabled()));assert(await page.locator('#login-feedback').evaluate(el=>el.classList.contains('hidden')));
  });
  const staffPage=await pageFor(staff);
  await test('large-menu staff landing shows categories, not 1000 product cards',async()=>{await staffPage.goto(BASE+'/staff');await staffPage.waitForSelector('#custom-add');assert.equal(await staffPage.locator('#menu-grid [data-menu-index]').count(),0);assert.equal(await staffPage.locator('#category-tabs [data-cat]').count(),11);});
  await test('category and search render 40 at a time; show-more appends another page',async()=>{
    await staffPage.locator('[data-cat="گروه 0"]').click();assert.equal(await staffPage.locator('#menu-grid [data-menu-index]').count(),40);await staffPage.locator('#menu-more').click();assert.equal(await staffPage.locator('#menu-grid [data-menu-index]').count(),80);
    await staffPage.locator('[data-cat="__popular__"]').click();await staffPage.locator('#menu-search').fill('محصول آزمون');assert.equal(await staffPage.locator('#menu-grid [data-menu-index]').count(),40);
  });
  async function add(name,price,qty='1'){await staffPage.locator('#custom-name').fill(name);await staffPage.locator('#custom-price').fill(price);await staffPage.locator('#custom-qty').fill(qty);await staffPage.locator('#custom-add').click();}
  await test('manual entry accepts Persian/Arabic digits and whitespace/grouping; same-name prices remain separate',async()=>{
    await add('قهوه دستی',' ۱۲ ۵۰۰ ','۲');assert.equal(await staffPage.locator('#selected-list [data-rm]').count(),1);assert((await staffPage.locator('#sum-total').innerText()).replace(/[,٬]/g,'').includes('۲۵۰۰۰'),await staffPage.locator('#sum-total').innerText());
    await add('قهوه دستی','١٣٬٠٠٠');assert.equal(await staffPage.locator('#selected-list [data-rm]').count(),2);assert((await staffPage.locator('#sum-total').innerText()).replace(/[,٬]/g,'').includes('۳۸۰۰۰'));assert((await staffPage.locator('#sum-points').innerText()).includes('۲۳'));
  });
  await test('reserved prototype names are safe and invalid quantity never changes cart',async()=>{
    await add('__proto__','100','1');await add('constructor','200','1');assert.equal(await staffPage.locator('#selected-list [data-rm]').count(),4);await add('نامعتبر','100','100');assert.equal(await staffPage.locator('#selected-list [data-rm]').count(),4);
  });
  await test('cart increment, decrement and remove operate on the precise name/price row',async()=>{
    await staffPage.locator('#selected-list [data-inc]').first().click();assert((await staffPage.locator('#sum-total').innerText()).replace(/[,٬]/g,'').includes('۵۰۸۰۰'));await staffPage.locator('#selected-list [data-dec]').first().click();await staffPage.locator('#selected-list [data-rm]').last().click();assert.equal(await staffPage.locator('#selected-list [data-rm]').count(),3);
  });
  const adminPage=await pageFor(admin);
  await test('admin menu editor pages 1000 items and searching preserves original row indices',async()=>{
    await adminPage.goto(BASE+'/admin/settings');await adminPage.waitForSelector('[data-menu-name]');assert.equal(await adminPage.locator('[data-menu-name]').count(),50);await adminPage.locator('#menu-admin-more').click();assert.equal(await adminPage.locator('[data-menu-name]').count(),100);
    await adminPage.locator('#menu-admin-search').fill('محصول آزمون 999');assert.equal(await adminPage.locator('[data-menu-name]').count(),1);assert.equal(await adminPage.locator('[data-menu-name]').getAttribute('data-menu-name'),'999');
  });
  // Messenger panel uses explicit fixtures: no real bot credential is saved or provider called.
  let cfg={enabled:false,notifyEnabled:false,notifyInvoices:true,notifyActions:true,encryptionKeyConfigured:true,primaryActive:true,channels:[]};
  const job={id:'fixture-report',channel:'telegram',chat_id:'123',user_id:null,type:'report_action',reason:'event',status:'failed',error:'NETWORK_UNKNOWN: نتیجه نامشخص',attempts:1,expires_at:Date.now()+1000000,created_at:'2026-10-21 12:00:00',content:{phone:'09123334444',message:'<script>window.INJECTED=true</script> & متن امن',requestedAt:new Date().toISOString()}};
  let retryBody=null,puts=0,slowHistory=null;
  const panel=await pageFor(admin);
  await panel.route('**/api/admin/fallback**',async route=>{
    const req=route.request(),url=new URL(req.url());let value;
    if(url.pathname.endsWith('/history')){const snapshot={items:[{...job}],total:1,page:1,stats:{failed:job.status==='failed'?1:0,sent:job.status==='sent'?1:0}};if(slowHistory){const wait=slowHistory;slowHistory=null;await wait;}value=snapshot;}
    else if(url.pathname.endsWith('/retry')){retryBody=req.postDataJSON();job.status='sent';value={message:'در صف قرار گرفت'};}
    else if(url.pathname.endsWith('/test'))value={ids:['fixture-report']};
    else if(req.method()==='PUT'){const body=req.postDataJSON();puts++;cfg={...cfg,...body,channels:body.channels.map(c=>({channel:c.channel,chatId:c.chatId,hasToken:!!c.token,tokenSource:'database'}))};value={saved:true};}
    else value=cfg;
    await route.fulfill({json:{ok:true,data:value}});
  });
  await test('admin messenger panel boots, exposes separate toggles and escapes history content',async()=>{
    await panel.goto(BASE+'/admin/fallback');await panel.waitForFunction(()=>!document.getElementById('fallback-save').disabled);await panel.waitForSelector('[data-retry-id]');assert.equal(await panel.locator('#fallback-notify').isChecked(),false);assert.equal(await panel.locator('#fallback-enabled').isChecked(),false);assert.equal(await panel.evaluate(()=>window.INJECTED),undefined);assert((await panel.locator('#fallback-history').innerText()).includes('<script>'));
  });
  await test('report-only save retains independence, clears secret input, and tracks unsaved edits',async()=>{
    await panel.locator('#fallback-notify').check();await panel.locator('#fb-telegram-selected').check();await panel.locator('#fb-telegram-chat').fill('123');await panel.locator('#fb-telegram-token').fill('123456:'+ 'x'.repeat(32));assert((await panel.locator('#fallback-dirty').innerText()).length>0);await panel.locator('#fallback-save').click();await panel.waitForFunction(()=>document.getElementById('fallback-dirty').textContent==='');assert.equal(puts,1);assert.equal(cfg.enabled,false);assert.equal(cfg.notifyEnabled,true);assert.equal(await panel.locator('#fb-telegram-token').inputValue(),'');
  });
  await test('uncertain-delivery retry asks for consent and transmits explicit risk confirmation',async()=>{
    panel.once('dialog',d=>d.accept());await panel.locator('[data-retry-id]').click();await panel.waitForFunction(()=>document.getElementById('fallback-history').textContent.includes('ارسال موفق'));assert.equal(retryBody.confirmDuplicateRisk,true);
  });
  await test('in-flight history cannot overwrite a newer filter, and latest filter is fetched again',async()=>{
    let release;slowHistory=new Promise(r=>release=r);const waiting=panel.waitForRequest(r=>r.url().includes('/history'));await panel.locator('#fallback-refresh').click();await waiting;await panel.locator('#fallback-status').selectOption('sent');const next=panel.waitForRequest(r=>r.url().includes('status=sent'));release();await next;
  });
  await test('env-sourced token is explained and not editable in browser',async()=>{
    cfg.channels[0]={channel:'telegram',chatId:'123',hasToken:true,tokenSource:'env'};await panel.locator('#fallback-reload').click();await panel.waitForFunction(()=>document.getElementById('fb-telegram-source').textContent.includes('Secret'));assert(await panel.locator('#fb-telegram-token').isDisabled());
  });
  await test('all tested pages have zero uncaught JavaScript errors',async()=>assert.deepEqual(errors,[]));
  console.log(`\n${passed}/${passed} real Chromium checks passed (CDN blocked, messenger UI fixtures; no live provider verification).`);
}finally{
  if(browser)await browser.close();
  if(original)await request('/api/admin/settings',{method:'PUT',body:{...original.settings,menu_items:original.menu}});
  await rm(dir,{recursive:true,force:true});
}
