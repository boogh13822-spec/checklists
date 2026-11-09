/** Offline integration tests: actual SQLite SQL + WebCrypto + mocked provider HTTP. No real tokens/network. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'upgrade-tests-'));
try {
  const file = join(dir, 'module.mjs');
  await build({ stdin: { contents: `export * from './src/lib/fallback'; export { landingPage, registerPage } from './src/ui/public'; export { notifyAdminInvoice, notifyAdminAction } from './src/lib/admin-notifications'; export { recordInvoice, voidInvoice, calculateInvoicePoints } from './src/lib/db'; export { loadSettings } from './src/lib/settings'; export * from './src/lib/fallback-adapters'; export * from './src/lib/sms'; export { DEFAULT_SETTINGS, invalidateSettingsCache } from './src/lib/settings'; export { default as worker } from './src/index'; export { requestOtpCode, verifyOtpCode } from './src/lib/otp'; export { runBirthdayJob } from './src/lib/jobs'; export { todayISO } from './src/lib/utils';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: file });
  const m = await import(pathToFileURL(file));
  let passed = 0;
  async function test(name, fn) { await fn(); passed++; console.log('✅ ' + name); }
  const sql = await readFile('schema.sql', 'utf8');
  // D1 compatibility shim backed by real SQLite (including UPDATE RETURNING / atomic batch).
  function database() {
    const db = new DatabaseSync(':memory:'); db.exec(sql);
    const api = { queries:0, prepare(query) {
      let args = [];
      const stmt = { bind(...a) { args = a; return stmt; },
        async first(column) { api.queries++; const row = db.prepare(query).get(...args); return column ? row?.[column] ?? null : row ?? null; },
        async all() { api.queries++; return { results: db.prepare(query).all(...args) }; },
        async run() { api.queries++; const info = db.prepare(query).run(...args); return { success:true,meta:{ changes:Number(info.changes),last_row_id:Number(info.lastInsertRowid) } }; } };
      return stmt;
    }, async batch(statements) { db.exec('BEGIN'); try { const results=[]; for(const s of statements)results.push(await s.run()); db.exec('COMMIT'); return results; } catch(e) { db.exec('ROLLBACK'); throw e; } } };
    return { db, api };
  }
  let db, env;
  const token = '123456:' + 'x'.repeat(32); // intentionally fake
  const key = Buffer.alloc(32, 7).toString('base64');
  const params = { phone: '+989120000000', userId: 1, type:'invoice', message:'متن کامل پیام <b>بدون مارک‌آپ</b>' };
  const config = (channels=['telegram'], enabled=true) => ({ enabled, channels: channels.map(channel=>({channel,chatId:'-1001234567890',token})) });
  function reset() { m.invalidateSettingsCache(); const next=database();db=next.db;env={DB:next.api, JWT_SECRET:'local-test-only-not-real-0123456789abcdef', FALLBACK_ENCRYPTION_KEY:key}; }
  async function setting(k,v) { await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k,JSON.stringify(v)).run(); }
  function unlock() {db.exec('UPDATE fallback_dispatch SET until_ms=0');}
  function rows() {return db.prepare('SELECT * FROM fallback_jobs ORDER BY id').all();}
  function response(body,status=200) {return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});}
  let calls=[];
  globalThis.fetch = async (url,opts) => {calls.push({url,opts});return response({ok:true,result:{message_id:10}});};


  const fixed={...m.DEFAULT_SETTINGS,sms_enabled:0,points_mode:'invoice',invoice_points:17};
  const reports=(extra={},chs=['telegram'])=>({...config(chs,false),notifyEnabled:true,notifyInvoices:true,notifyActions:true,...extra});
  function customer(phone='09123330001'){return Number(db.prepare("INSERT INTO users(name,phone,role,sms_opt_in) VALUES('مشتری آزمایشی',?,'customer',0)").run(phone).lastInsertRowid);}
  function input(userId,extra={}){return {userId,registeredBy:2,items:[],amount:100,couponCode:null,...extra};}
  async function content(row){return m.unseal(env,row.payload,'job:'+row.id);}
  async function request(method,path,body,cookie){const tasks=[];const r=await m.worker.fetch(new Request('http://app.test'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env,{waitUntil:p=>tasks.push(p)});await Promise.all(tasks);return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  async function login(staff=false){const r=await request('POST','/api/auth/login',{phone:staff?'09120000001':'09120000000',password:staff?'Staff@12345':'Admin@12345'});assert.equal(r.status,200);return r.cookie;}
  function hold(){db.prepare('UPDATE fallback_dispatch SET until_ms=?').run(Date.now()+3600000);}

  await test('fixed invoice points ignore amount and daily visit flag; zero earns none',async()=>{
    for(const amount of [1,100,5000000000])for(const visitAlreadyEarned of [true,false]){
      assert.deepEqual({...m.calculateInvoicePoints({amount,settings:fixed,visitAlreadyEarned}),note:''},{points:17,visitDay:false,note:''});
    }
    assert.equal(m.calculateInvoicePoints({amount:0,settings:fixed,visitAlreadyEarned:false}).points,0);
  });
  await test('two same-day invoices earn fixed points each; persisted request retry never awards twice',async()=>{
    reset();const id=customer();const a=await m.recordInvoice(env,fixed,input(id,{amount:1,clientRequestId:'sale-a'}));const b=await m.recordInvoice(env,fixed,input(id,{amount:999999,clientRequestId:'sale-b'}));
    assert(a.ok&&b.ok);assert.equal(a.pointsEarned,17);assert.equal(b.pointsEarned,17);
    const duplicate=await m.recordInvoice(env,{...fixed,invoice_points:100},input(id,{amount:999,clientRequestId:'sale-a'}));
    assert(duplicate.ok&&duplicate.duplicate);assert.equal(duplicate.pointsEarned,17);assert.equal(duplicate.invoiceId,a.invoiceId);
    assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(id).points,34);assert.equal(db.prepare('SELECT count(*) n FROM invoices WHERE visit_day IS NOT NULL').get().n,0);
  });
  await test('request ID collision across customers is rejected without leaking invoice result',async()=>{
    reset();const id=customer(),other=customer('09123330002');assert((await m.recordInvoice(env,fixed,input(id,{clientRequestId:'unique'}))).ok);
    const r=await m.recordInvoice(env,fixed,input(other,{clientRequestId:'unique'}));assert.equal(r.code,'REQUEST_ID_CONFLICT');assert.equal(r.invoiceId,undefined);assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(other).points,0);
  });
  await test('daily visit remains once per Tehran day; amount ratio remains unchanged',async()=>{
    reset();const id=customer(),visit={...fixed,points_mode:'visit',visit_points:9,visit_min_amount:100};
    assert.equal((await m.recordInvoice(env,visit,input(id,{amount:99}))).pointsEarned,0);
    assert.equal((await m.recordInvoice(env,visit,input(id))).pointsEarned,9);
    assert.equal((await m.recordInvoice(env,visit,input(id))).pointsEarned,0);
    assert.equal((await m.recordInvoice(env,{...fixed,points_mode:'amount',currency_unit:1000,points_per_currency:2},input(id,{amount:2500}))).pointsEarned,4);
  });
  await test('policy changes and void reverse stored awards, not current policy; zero policy is legal',async()=>{
    reset();const id=customer(),a=await m.recordInvoice(env,fixed,input(id));assert(a.ok);
    const v=await m.voidInvoice(env,{...fixed,invoice_points:1000},a.invoiceId,1,{reason:'تست برگشت'});assert(v.ok);assert.equal(v.pointsReversed,17);assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(id).points,0);
    assert.equal((await m.recordInvoice(env,{...fixed,invoice_points:0},input(id))).pointsEarned,0);
  });
  await test('manual same-name/different-price rows persist accurately with discount/change',async()=>{
    reset();const id=customer();const r=await m.recordInvoice(env,fixed,input(id,{items:[{name:'قهوه سفارشی',price:100,qty:2},{name:'قهوه سفارشی',price:150,qty:2}],manualDiscount:40,payment:{cash:500}}));
    assert(r.ok);assert.equal(r.subtotal,500);assert.equal(r.amount,460);assert.equal(r.paidCash,460);assert.equal(r.change,40);assert.equal(r.pointsEarned,17);assert.equal(JSON.parse(db.prepare('SELECT items FROM invoices WHERE id=?').get(r.invoiceId).items).length,2);
  });
  await test('malformed manual names/prices/quantities and >50 lines never create financial records',async()=>{
    reset();const id=customer();for(const bad of [{name:' ',price:1,qty:1},{name:'<>',price:1,qty:1},{name:null,price:1,qty:1},{name:'x'.repeat(61),price:1,qty:1},{name:'x',price:-1,qty:1},{name:'x',price:1.5,qty:1},{name:'x',price:1,qty:1.5},{name:'x',price:1,qty:100},{name:'x',price:1,qty:0},null])assert.equal((await m.recordInvoice(env,fixed,input(id,{items:[bad]}))).code,'INVALID_ITEM');
    assert.equal((await m.recordInvoice(env,fixed,input(id,{items:Array.from({length:51},()=>({name:'x',price:1,qty:1}))}))).code,'INVALID_ITEM');assert.equal(db.prepare('SELECT count(*) n FROM invoices').get().n,0);
  });
  await test('reports are off by default and enabling SMS fallback never silently enables reports',async()=>{
    reset();assert.equal(m.safeFallbackConfig(env,await m.loadFallbackConfig(env)).notifyEnabled,false);await m.saveFallbackConfig(env,config());await m.notifyAdminAction(env,{id:1,action:'points_adjust',actor:'admin'});assert.equal(rows().length,0);
  });
  await test('report-only config works with healthy sms.ir; duplicate persisted event deduplicates per destination',async()=>{
    reset();await m.saveFallbackConfig(env,reports({},['telegram','bale']));env.SMSIR_API_KEY='fake-key';env.SMS_SENDER='3000123';await setting('sms_provider','smsir');await setting('sms_enabled',1);
    const id=customer(),r=await m.recordInvoice(env,fixed,input(id,{items:[{name:'قهوه',price:250,qty:2}],manualDiscount:40,payment:{cash:500}}));assert(r.ok);
    await m.notifyAdminInvoice(env,r.invoiceId);await m.notifyAdminInvoice(env,r.invoiceId);assert.equal(rows().length,2);assert(rows().every(r=>r.reason==='event'&&r.type==='report_invoice'));
    const p=await content(rows()[0]);assert(p.message.includes('۴۶۰'));assert(p.message.includes('۴۰'));assert(p.message.includes('۱۷'));assert(p.message.includes('قهوه'));assert(!JSON.stringify(rows()).includes('قهوه'));
    calls=[];globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return response({ok:true,result:{message_id:9}});};await m.processFallbackQueue(env);assert.equal(calls.length,1);assert(!calls[0].url.includes('sms.ir'));assert(!JSON.parse(calls[0].opts.body).text.includes('ارسال دستی پیامک'));
    await m.notifyAdminInvoice(env,r.invoiceId);assert.equal(rows().length,2);
  });
  await test('scope filtering treats invoice correction as invoice, and never forwards arbitrary auth categories',async()=>{
    reset();await m.saveFallbackConfig(env,reports({notifyInvoices:false}));await m.notifyAdminAction(env,{id:1,action:'invoice_correct',actor:'a'});await m.notifyAdminAction(env,{id:2,action:'login',actor:'a',details:'secret'});await m.notifyAdminAction(env,{id:3,action:'points_adjust',actor:'a',details:'مقدار ۲۰'});assert.equal(rows().length,1);assert.equal(rows()[0].type,'report_action');
    await m.saveFallbackConfig(env,reports({notifyActions:false}));assert.equal(rows()[0].status,'skipped');await m.notifyAdminAction(env,{id:4,action:'invoice_void',actor:'a'});assert.equal(rows().filter(r=>r.status==='pending').length,1);
  });
  await test('notify cannot enable with no scopes; invalid config never overwrites saved encrypted token',async()=>{
    reset();await m.saveFallbackConfig(env,reports());const before=db.prepare("SELECT value FROM settings WHERE key='sms_fallback_config'").get().value;
    await assert.rejects(()=>m.saveFallbackConfig(env,reports({notifyInvoices:false,notifyActions:false})));await assert.rejects(()=>m.saveFallbackConfig(env,reports({notifyEnabled:'yes'})));
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='sms_fallback_config'").get().value,before);
  });
  await test('destination removal cancels pending reports; source and primary-path settings stay independent',async()=>{
    reset();await m.saveFallbackConfig(env,reports());await m.notifyAdminAction(env,{id:1,action:'cash_in',actor:'a'});await m.saveFallbackConfig(env,reports({channels:[{channel:'telegram',chatId:'999',token:''}]}));assert.equal(rows()[0].status,'skipped');
    const c=m.safeFallbackConfig(env,await m.loadFallbackConfig(env));assert.equal(c.enabled,false);assert.equal(c.notifyEnabled,true);assert.equal(c.channels[0].tokenSource,'database');assert(c.encryptionKeyConfigured);
  });
  await test('env-token priority is visible, cannot be deceptively replaced from UI, invalid key is visible',async()=>{
    reset();env.TELEGRAM_BOT_TOKEN=token;await m.saveFallbackConfig(env,reports({channels:[{channel:'telegram',chatId:'123',token:''}]}));assert.equal(m.safeFallbackConfig(env,await m.loadFallbackConfig(env)).channels[0].tokenSource,'env');
    await assert.rejects(()=>m.saveFallbackConfig(env,reports()));env.FALLBACK_ENCRYPTION_KEY='invalid';assert.equal(m.safeFallbackConfig(env,await m.loadFallbackConfig(env)).encryptionKeyConfigured,false);
  });
  await test('failed unknown delivery requires explicit duplicate consent; retry is CAS and preserves event dedup',async()=>{
    reset();await m.saveFallbackConfig(env,reports());await m.notifyAdminAction(env,{id:9,action:'points_adjust',actor:'a'});let row=rows()[0];db.prepare("UPDATE fallback_jobs SET status='failed',error='NETWORK_UNKNOWN',attempts=1 WHERE id=?").run(row.id);
    await assert.rejects(()=>m.retryFallbackJob(env,row.id),/CONFIRM_DUPLICATE_RISK/);await m.retryFallbackJob(env,row.id,true);assert.equal(rows()[0].status,'pending');assert.equal(rows()[0].attempts,0);await assert.rejects(()=>m.retryFallbackJob(env,row.id,true),/NOT_RETRYABLE/);
    await m.notifyAdminAction(env,{id:9,action:'points_adjust',actor:'a'});assert.equal(rows().length,1);
  });
  await test('certain failed delivery may retry, but OTP/expiry/config changes cannot be replayed',async()=>{
    reset();await m.saveFallbackConfig(env,config());await m.enqueueFallback(env,params,'inactive');const id=rows()[0].id;db.prepare("UPDATE fallback_jobs SET status='failed',error='FORBIDDEN: bot blocked',attempts=1 WHERE id=?").run(id);await m.retryFallbackJob(env,id);
    db.prepare("UPDATE fallback_jobs SET status='failed',type='otp' WHERE id=?").run(id);await assert.rejects(()=>m.retryFallbackJob(env,id,true),/OTP_NO_REPLAY/);
    db.prepare("UPDATE fallback_jobs SET type='invoice',expires_at=0 WHERE id=?").run(id);await assert.rejects(()=>m.retryFallbackJob(env,id,true),/NOT_RETRYABLE/);
    db.prepare('UPDATE fallback_jobs SET expires_at=? WHERE id=?').run(Date.now()+100000,id);await m.saveFallbackConfig(env,config([],false));await assert.rejects(()=>m.retryFallbackJob(env,id,true),/CONFIG_CHANGED/);
  });
  await test('queue priority delivers OTP before reports, and reports do not change SMS/manual semantics',async()=>{
    reset();await m.saveFallbackConfig(env,reports({enabled:true}));await m.notifyAdminAction(env,{id:1,action:'shift_open',actor:'a'});await m.enqueueFallback(env,{...params,type:'otp',message:'123456'},'inactive');calls=[];
    globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return response({ok:true,result:{message_id:8}});};await m.processFallbackQueue(env);assert.equal(rows().find(r=>r.status==='sent').type,'otp');assert(JSON.parse(calls[0].opts.body).text.includes('123456'));assert.equal(rows().find(r=>r.type==='otp').payload,'');
  });
  await test('history pagination/filters/stats are accurate, encrypted payload never exposed, expired ordinary text retained',async()=>{
    reset();await m.saveFallbackConfig(env,reports({},['telegram','bale']));for(let i=0;i<17;i++)await m.notifyAdminAction(env,{id:i,action:'cash_in',actor:'a'});assert.equal(rows().length,34);
    const a=await m.fallbackHistory(env,1),b=await m.fallbackHistory(env,2);assert.equal(a.items.length,30);assert.equal(b.items.length,4);assert.equal(a.total,34);assert.equal(a.stats.pending,34);assert(!('payload' in a.items[0]));assert.equal((await m.fallbackHistory(env,1,'pending','bale')).total,17);
    db.prepare('UPDATE fallback_jobs SET expires_at=0 WHERE id=?').run(rows()[0].id);await m.processFallbackQueue(env,true);const expired=await m.fallbackHistory(env,1,'expired');assert.equal(expired.total,1);assert(expired.items[0].content.message.includes('انجام‌دهنده'));
  });
  await test('null staff invoice request returns 400 rather than runtime exception',async()=>{
    reset();const cookie=await login(true);assert.equal((await request('POST','/api/staff/invoices',null,cookie)).status,400);
  });
  await test('HTTP settings validation is all-or-nothing for invalid tiers and malformed/oversized menus',async()=>{
    reset();const cookie=await login();for(const extra of [{tiers:{silver:500,gold:2,vip:5000}},{menu_items:Array.from({length:1001},(_,i)=>({name:'n'+i,price:1}))},{menu_items:[null]},{menu_items:[{name:'',price:1}]},{invoice_points:-1},{invoice_points:1.2},{invoice_points:'17'},{points_mode:'other'}]){
      const r=await request('PUT','/api/admin/settings',{cafe_name:'should-not-change',points_mode:'invoice',...extra},cookie);assert.equal(r.status,400,JSON.stringify(r));assert.notEqual(db.prepare("SELECT value FROM settings WHERE key='cafe_name'").get().value,JSON.stringify('should-not-change'));
    }
  });
  await test('1000-item settings save is atomic, round-trips whole menu and stays inside Free D1 request budget with report delivery',async()=>{
    reset();const cookie=await login();await m.saveFallbackConfig(env,reports({},['telegram','bale']));globalThis.fetch=async()=>response({ok:true,result:{message_id:10}});
    const menu=Array.from({length:1000},(_,i)=>({name:'آیتم '+i,price:100+i,category:'دسته '+(i%20)}));m.invalidateSettingsCache();env.DB.queries=0;
    const r=await request('PUT','/api/admin/settings',{...m.DEFAULT_SETTINGS,points_mode:'invoice',invoice_points:29,menu_items:menu},cookie);assert.equal(r.status,200,JSON.stringify(r));assert(env.DB.queries<=50,'queries='+env.DB.queries);console.log('   Full settings + report dispatcher D1 queries: '+env.DB.queries);
    const loaded=await m.loadSettings(env,true);assert.equal(loaded.points_mode,'invoice');assert.equal(loaded.invoice_points,29);const get=await request('GET','/api/admin/settings',undefined,cookie);assert.equal(get.body.data.menu.length,1000);
    assert.equal(rows().filter(r=>r.type==='report_action').length,2);
  });
  await test('staff cannot select awarded points; HTTP invoice reports deduplicate on request retry within Free D1 budget',async()=>{
    reset();const cookie=await login(true);await setting('points_mode','invoice');await setting('invoice_points',17);m.invalidateSettingsCache();await m.saveFallbackConfig(env,reports());globalThis.fetch=async()=>response({ok:true,result:{message_id:10}});const id=customer();
    const body={userId:id,items:[{name:'دستی',price:1,qty:1}],pointsEarned:99999,points:99999,clientRequestId:'http-repeat'};env.DB.queries=0;
    const r=await request('POST','/api/staff/invoices',body,cookie);assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.body.data.pointsEarned,17);assert(env.DB.queries<=50,'queries='+env.DB.queries);console.log('   Invoice + report dispatcher D1 queries: '+env.DB.queries);
    const again=await request('POST','/api/staff/invoices',body,cookie);assert.equal(again.body.data.duplicate,true);assert.equal(rows().length,1);assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(id).points,17);
  });
  await test('retry HTTP endpoint requires admin and explicit uncertain-delivery consent',async()=>{
    reset();const staff=await login(true),admin=await login();await m.saveFallbackConfig(env,reports());await m.notifyAdminAction(env,{id:1,action:'points_adjust',actor:'a'});const id=rows()[0].id;db.prepare("UPDATE fallback_jobs SET status='failed',error='TIMEOUT_UNKNOWN',attempts=1 WHERE id=?").run(id);hold();
    assert.equal((await request('POST','/api/admin/fallback/'+id+'/retry',{},staff)).status,403);const no=await request('POST','/api/admin/fallback/'+id+'/retry',{},admin);assert.equal(no.status,409);assert.equal(no.body.code,'CONFIRM_DUPLICATE_RISK');assert.equal((await request('POST','/api/admin/fallback/'+id+'/retry',{confirmDuplicateRisk:true},admin)).status,202);assert.equal(rows()[0].status,'pending');
  });

  await test('request-ID race recovery also checks customer ownership',async()=>{
    reset();const id=customer(),other=customer('09123330002');assert((await m.recordInvoice(env,fixed,input(id,{clientRequestId:'race-key'}))).ok);
    const prepare=env.DB.prepare.bind(env.DB);let skip=true;env.DB.prepare=q=>{const stmt=prepare(q);if(skip&&q.includes('SELECT * FROM invoices WHERE client_request_id')){skip=false;stmt.first=async()=>null;}return stmt;};
    const result=await m.recordInvoice(env,fixed,input(other,{clientRequestId:'race-key'}));assert.equal(result.code,'REQUEST_ID_CONFLICT');assert.equal(db.prepare('SELECT count(*) n FROM invoices').get().n,1);
  });
  await test('full report queue leaves finances intact and records a non-recursive local failure log',async()=>{
    reset();await m.saveFallbackConfig(env,reports());const id=customer(),sale=await m.recordInvoice(env,fixed,input(id));assert(sale.ok);
    db.exec("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO fallback_jobs(id,channel,chat_id,type,payload,reason,next_at,expires_at) SELECT 'full-'||x,'telegram','123','report_action','fixture','event',0,9999999999999 FROM n");
    await m.notifyAdminInvoice(env,sale.invoiceId);assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(id).points,17);assert.equal(db.prepare("SELECT count(*) n FROM admin_logs WHERE action='admin_report_failed' AND target_id=?").get(String(sale.invoiceId)).n,1);assert.equal(rows().length,1000);
  });
  await test('correction emits one completed report per destination, no transient sale report, within Free D1 budget',async()=>{
    reset();const cookie=await login();await setting('points_mode','invoice');await setting('invoice_points',17);m.invalidateSettingsCache();await m.saveFallbackConfig(env,reports({enabled:true},['telegram','bale']));const id=customer();db.prepare('UPDATE users SET sms_opt_in=1 WHERE id=?').run(id);
    const sale=await m.recordInvoice(env,fixed,input(id,{payment:{cash:100}}));assert(sale.ok);db.exec('DELETE FROM fallback_jobs');globalThis.fetch=async()=>response({ok:true,result:{message_id:10}});unlock();env.DB.queries=0;
    const result=await request('POST','/api/admin/invoices/'+sale.invoiceId+'/correct',{items:[{name:'اصلاح',price:200,qty:1}],reason:'اصلاح آزمون',payment:{cash:200}},cookie);assert.equal(result.status,200,JSON.stringify(result));assert(env.DB.queries<=50,'queries='+env.DB.queries);console.log('   Correction + both SMS/report destinations + dispatcher D1 queries: '+env.DB.queries);
    const events=rows().filter(r=>r.reason==='event');assert.equal(events.length,2);const p=await content(events[0]);assert(p.title.includes('اصلاح'));assert(p.message.includes('امتیاز جدید: 17'));assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(id).points,17);
    for(const action of ['correct','void'])assert.equal((await request('POST','/api/admin/invoices/'+result.body.data.newInvoiceId+'/'+action,null,cookie)).status,400);
  });

  await test('daily-visit correction transfers today claim atomically and sends final, not temporary, balance',async()=>{
    reset();const cookie=await login();const visit={...fixed,points_mode:'visit',visit_points:9,visit_min_amount:100};await setting('points_mode','visit');await setting('visit_points',9);await setting('visit_min_amount',100);m.invalidateSettingsCache();await m.saveFallbackConfig(env,reports({enabled:true},['telegram','bale']));const id=customer();
    const sale=await m.recordInvoice(env,visit,input(id,{payment:{cash:100}}));assert.equal(sale.pointsEarned,9);db.exec('DELETE FROM fallback_jobs');globalThis.fetch=async()=>response({ok:true,result:{message_id:10}});unlock();env.DB.queries=0;
    const result=await request('POST','/api/admin/invoices/'+sale.invoiceId+'/correct',{items:[{name:'اصلاح روزانه',price:200,qty:1}],reason:'اصلاح آزمون روزانه',payment:{cash:200}},cookie);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.data.pointsEarned,9);assert.equal(result.body.data.totalPoints,9);assert(env.DB.queries<=50,'queries='+env.DB.queries);console.log('   Daily correction + final receipts/reports/dispatcher D1 queries: '+env.DB.queries);
    assert.equal(db.prepare('SELECT count(*) n FROM invoices WHERE visit_day IS NOT NULL AND voided_at IS NULL').get().n,1);const receipt=rows().find(r=>r.type==='invoice');const p=await content(receipt);assert(p.message.includes('موجودی: ۹'));assert(p.message.includes('۹ امتیاز'));assert.equal(rows().filter(r=>r.reason==='event').length,2);
    const later=await m.recordInvoice(env,visit,input(id,{amount:1000}));assert.equal(later.pointsEarned,0);assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(id).points,9);
  });
  await test('daily correction below minimum gets no award; failed transfer rolls back old award/claim and sends no premature receipt',async()=>{
    for(const failTransfer of [false,true]){
      reset();const cookie=await login();const visit={...fixed,points_mode:'visit',visit_points:9,visit_min_amount:100};await setting('points_mode','visit');await setting('visit_points',9);await setting('visit_min_amount',100);m.invalidateSettingsCache();await m.saveFallbackConfig(env,reports({enabled:true}));const id=customer();const sale=await m.recordInvoice(env,visit,input(id,{payment:{cash:100}}));db.exec('DELETE FROM fallback_jobs');hold();
      if(failTransfer){const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const stmt=prepare(q);if(q.includes('UPDATE invoices SET points_earned='))stmt.run=async()=>{throw new Error('simulated D1 transfer failure');};return stmt;};}
      const result=await request('POST','/api/admin/invoices/'+sale.invoiceId+'/correct',{items:[{name:'اصلاح',price:failTransfer?200:50,qty:1}],reason:'تست حداقل و جبران',payment:{cash:failTransfer?200:50}},cookie);
      assert.equal(result.status,failTransfer?409:200,JSON.stringify(result));assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(id).points,failTransfer?9:0);
      assert.equal(db.prepare('SELECT count(*) n FROM invoices WHERE visit_day IS NOT NULL AND voided_at IS NULL').get().n,failTransfer?1:0);
      if(failTransfer){assert.equal(rows().length,0);assert.equal(db.prepare('SELECT voided_at FROM invoices WHERE id=?').get(sale.invoiceId).voided_at,null);assert.equal(db.prepare('SELECT count(*) n FROM invoices WHERE voided_at IS NULL').get().n,1);}
    }
  });
  await test('correction cannot reuse a request ID belonging to another sale, even for the same customer',async()=>{
    reset();const cookie=await login(),id=customer();await setting('points_mode','invoice');await setting('invoice_points',17);m.invalidateSettingsCache();const a=await m.recordInvoice(env,fixed,input(id,{payment:{cash:100}}));await m.recordInvoice(env,fixed,input(id,{clientRequestId:'other-sale'}));
    const result=await request('POST','/api/admin/invoices/'+a.invoiceId+'/correct',{items:[{name:'اصلاح',price:200,qty:1}],reason:'تست شناسه تکراری',payment:{cash:200},clientRequestId:'other-sale'},cookie);assert.equal(result.status,409);assert.equal(result.body.code,'REQUEST_ID_CONFLICT');assert.equal(db.prepare('SELECT count(*) n FROM invoices WHERE voided_at IS NULL').get().n,2);assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(id).points,34);
  });
  await test('public pages describe fixed-invoice policy correctly and escape configurable cafe name',async()=>{
    const landing=m.landingPage({...fixed,cafe_name:'<img src=x onerror=alert(1)>'});assert(landing.includes('هر فاکتور با مبلغ مثبت'));assert(!landing.includes('<img src=x'));assert(m.registerPage(fixed).includes('هر فاکتور با مبلغ مثبت'));
  });
  console.log(`\n${passed}/${passed} upgrade integration tests passed (actual SQLite, Worker routes, mocked provider HTTP).`);
} finally { await rm(dir,{recursive:true,force:true}); }
