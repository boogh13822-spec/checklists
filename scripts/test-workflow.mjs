/** Offline integration tests: actual SQLite SQL + WebCrypto + mocked provider HTTP. No real tokens/network. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'fallback-tests-'));
try {
  const file = join(dir, 'module.mjs');
  await build({ stdin: { contents: `export * from './src/lib/fallback'; export * from './src/lib/fallback-adapters'; export * from './src/lib/permissions'; export { sign } from 'hono/jwt'; export { startAdminCampaign,resumeAdminCampaign } from './src/lib/campaigns'; export { todayISO } from './src/lib/utils'; export { hashOtp } from './src/lib/otp'; export { registerCustomer, listCustomers, tierLabel, listSmsLogs, recordInvoice, recoverInvoiceReceipt, voidInvoice } from './src/lib/db'; export { isValidBirthDate } from './src/lib/utils'; export { sendSms } from './src/lib/sms'; export { DEFAULT_SETTINGS, loadSettings, invalidateSettingsCache } from './src/lib/settings'; export { default as worker } from './src/index'; export { createToken,resetRateLimit } from './src/lib/auth';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: file });
  const m = await import(pathToFileURL(file));
  let passed = 0;
  async function test(name, fn) { await fn(); passed++; console.log('✅ ' + name); }
  const sql = await readFile('schema.sql', 'utf8');
  // D1 compatibility shim backed by real SQLite (including UPDATE RETURNING / atomic batch).
  function database() {
    const db = new DatabaseSync(':memory:'); db.exec(sql);let batchQueue=Promise.resolve();
    const api = { queries:0, prepare(query) {
      let args = [];
      const stmt = { bind(...a) { args = a; return stmt; },
        async first(column) { api.queries++; const row = db.prepare(query).get(...args); return column ? row?.[column] ?? null : row ?? null; },
        async all() { api.queries++; return { results: db.prepare(query).all(...args) }; },
        async run() { api.queries++; const info = db.prepare(query).run(...args); return { success:true,meta:{ changes:Number(info.changes),last_row_id:Number(info.lastInsertRowid) } }; } };
      return stmt;
    }, batch(statements) { const run=async()=>{ db.exec('BEGIN'); try { const results=[]; for(const s of statements)results.push(await s.run()); db.exec('COMMIT'); return results; } catch(e) { db.exec('ROLLBACK'); throw e; } };const result=batchQueue.then(run,run);batchQueue=result.catch(()=>{});return result; } };
    return { db, api };
  }
  let db, env;
  const token = '123456:' + 'x'.repeat(32); // intentionally fake
  const key = Buffer.alloc(32, 7).toString('base64');
  const params = { phone: '+989120000000', userId: 1, type:'invoice', message:'متن کامل پیام <b>بدون مارک‌آپ</b>' };
  const config = (channels=['telegram'], enabled=true) => ({ enabled, channels: channels.map(channel=>({channel,chatId:'-1001234567890',token})) });
  const originalFetch=globalThis.fetch,originalWarn=console.warn;
  let calls=[],warnings=[],requestSequence=0;
  console.warn=(...args)=>warnings.push(args);
  function reset(){db?.close();m.invalidateSettingsCache();const next=database();db=next.db;env={DB:next.api,JWT_SECRET:'local-test-only-not-real-0123456789abcdef',FALLBACK_ENCRYPTION_KEY:key};calls=[];warnings=[];globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return new Response(JSON.stringify({ok:true,result:{message_id:10,id:42}}),{headers:{'Content-Type':'application/json'}});};}
  function rows(){return db.prepare('SELECT * FROM fallback_jobs ORDER BY rowid').all();}
  function unlock(){db.exec('UPDATE fallback_dispatch SET until_ms=0');}
  function hold(){db.exec('UPDATE fallback_dispatch SET until_ms='+ (Date.now()+120000));}
  function caps(values){db.prepare('UPDATE users SET permissions=? WHERE id=2').run(values===null?null:JSON.stringify(values));}
  function customer(phone='09123334444',nickname='لقب مشترک'){return Number(db.prepare("INSERT INTO users(name,phone,nickname,role,sms_opt_in) VALUES('مشتری آزمون',?,?,'customer',0)").run(phone,nickname).lastInsertRowid);}
  async function request(path,{role='admin',anonymous=false,method='GET',body,origin,ip,cookie:providedCookie}={}){
    const cookie=providedCookie??'cc_session='+await m.createToken(env.JWT_SECRET,{id:role==='admin'?1:2,role,name:'آزمون'});
    const tasks=[];const r=await m.worker.fetch(new Request('https://app.test'+path,{method,headers:{'Content-Type':'application/json','CF-Connecting-IP':ip??'198.51.100.'+(++requestSequence%250),...(!anonymous?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{waitUntil:p=>tasks.push(p)});
    const text=await r.text();let data;try{data=JSON.parse(text);}catch{}
    await Promise.all(tasks);return {r,data,text};
  }
  async function configured(extra={}){await m.saveFallbackConfig(env,{enabled:false,notifyEnabled:false,channels:config(['telegram','bale']).channels,...extra});}
  const labels={bronze:'دوست کافه',silver:'همراه',gold:'ویژه',vip:'خانواده'};
  const post=(path,body,opts={})=>request(path,{method:'POST',body,...opts});
  const put=(path,body,opts={})=>request(path,{method:'PUT',body,...opts});
  function assertSafe(value){const text=JSON.stringify(value);assert(!text.includes(token));assert(!text.includes('RAW_PRIVATE_ERROR'));assert(!text.includes('secret-api-key'));}
  try {
    await test('tier labels save without changing any tier ID, balance, threshold or customer row',async()=>{
      reset();customer();const users=db.prepare('SELECT * FROM users').all();const r=await put('/api/admin/settings',{tier_labels:labels});assert.equal(r.r.status,200);const settings=await m.loadSettings(env,true);assert.deepEqual(settings.tier_labels,labels);assert.deepEqual(settings.tiers,m.DEFAULT_SETTINGS.tiers);assert.deepEqual(db.prepare('SELECT * FROM users').all(),users);assert.equal(m.tierLabel('gold',settings),'ویژه');
    });
    await test('invalid labels reject the whole settings request, not a partial save',async()=>{
      for(const invalid of [{bronze:'x'}, {...labels,bronze:''},{...labels,bronze:'x'.repeat(31)},{...labels,gold:'<img src=x>'},{...labels,unknown:'x'},null,[]]){
        reset();const before=await m.loadSettings(env,true);const r=await put('/api/admin/settings',{tier_labels:invalid,cafe_name:'نباید ذخیره شود'});assert.equal(r.r.status,400);assert.equal(r.data.code,'INVALID_TIER_LABELS');assert.equal((await m.loadSettings(env,true)).cafe_name,before.cafe_name);
      }
    });
    await test('labels render in settings, admin list/filter, customer view and staff scripts',async()=>{
      reset();const id=customer();await put('/api/admin/settings',{tier_labels:labels});
      for(const path of ['/admin/settings','/admin/customers','/admin/customers/'+id,'/register','/staff']){const r=await request(path);assert.equal(r.r.status,200);assert(r.text.includes('دوست کافه')||r.text.includes('ویژه'),path);}
      const portalCookie='cc_session='+await m.createToken(env.JWT_SECRET,{id,role:'customer',name:'مشتری'});const portal=await request('/me',{cookie:portalCookie});assert.equal(portal.r.status,200);assert(portal.text.includes('دوست کافه'));
    });
    await test('staff permission creation is explicit and no customer list is granted by default',async()=>{
      reset();const r=await post('/api/admin/staff',{name:'پرسنل جدید',phone:'09121112222',password:'Test-only@123',permissions:['customer.create','invoice.create']});assert.equal(r.r.status,201);const u=db.prepare('SELECT * FROM users WHERE id=?').get(r.data.data.id);assert.deepEqual(JSON.parse(u.permissions),['customer.create','invoice.create']);assert.equal(u.role,'staff');assert(u.password_hash&&!u.password_hash.includes('Test-only'));
    });
    await test('invalid permission/role input cannot partially disable an employee or create one',async()=>{
      reset();for(const permissions of [['admin'],['invoice.create','invoice.create'],'all',{invoice:true},null]){const r=await put('/api/admin/staff/2',{permissions,is_active:0});assert.equal(r.r.status,400);assert.equal(db.prepare('SELECT is_active FROM users WHERE id=2').get().is_active,1);}
      assert.equal((await post('/api/admin/staff',{name:'پرسنل',phone:'09121112222',password:'Test-only@123',permissions:['admin']})).r.status,400);
      assert.equal((await put('/api/admin/staff/2',{role:'owner',is_active:0})).r.status,400);assert.equal(db.prepare('SELECT is_active FROM users WHERE id=2').get().is_active,1);
    });
    await test('new permission takes effect immediately on same session, including revocation',async()=>{
      reset();caps([]);const cookie='cc_session='+await m.createToken(env.JWT_SECRET,{id:2,role:'staff',name:'کارمند'});
      const payload={name:'مشتری جدید',phone:'09121112222',nickname:'آشنا',sms_opt_in:false};
      assert.equal((await post('/api/staff/customers',payload,{cookie})).r.status,403);
      await put('/api/admin/staff/2',{permissions:['customer.create']});assert.equal((await post('/api/staff/customers',payload,{cookie})).r.status,201);
      await put('/api/admin/staff/2',{permissions:[]});assert.equal((await post('/api/staff/customers',{...payload,phone:'09121112223'},{cookie})).r.status,403);
    });
    await test('JWT role/permission claims cannot override current database permissions',async()=>{
      reset();caps([]);const forged='cc_session='+await m.sign({uid:2,sub:'2',name:'fake',role:'admin',permissions:Object.keys(m.STAFF_PERMISSIONS),tv:0,exp:Math.floor(Date.now()/1000)+600},env.JWT_SECRET,'HS256');
      assert.equal((await request('/api/staff/customers',{cookie:forged})).r.status,403);assert.equal((await request('/api/admin/staff',{cookie:forged})).r.status,403);
    });
    await test('legacy null permissions preserve only old invoice/history/shift capabilities; corrupt policy denies all',async()=>{
      reset();caps(null);assert.deepEqual(m.storedPermissions(null),m.LEGACY_STAFF_PERMISSIONS);assert(!m.storedPermissions(null).includes('customer.list'));db.prepare('UPDATE users SET permissions=? WHERE id=2').run('{broken');assert.equal((await request('/api/staff/customer?phone=09123334444',{role:'staff'})).r.status,403);
    });
    await test('no-permission employee cannot call direct invoice/history/shift/creation/search/list APIs or admin exports',async()=>{
      reset();caps([]);for(const path of ['/api/staff/customer?phone=09123334444','/api/staff/invoices/today','/api/staff/shift','/api/staff/customers','/api/staff/customers/search?q=123','/api/admin/staff','/api/admin/fallback/history','/admin/export/customers.csv'])assert([302,403].includes((await request(path,{role:'staff'})).r.status),path);
      for(const path of ['/api/staff/invoices','/api/staff/customers','/api/staff/shift/open','/api/admin/staff'])assert.equal((await post(path,{name:'پرسنل',permissions:['customer.list']},{role:'staff'})).r.status,403,path);
    });
    await test('create-only employee can register customer without directory or invoice permission; role/points injection ignored',async()=>{
      reset();caps(['customer.create']);const r=await post('/api/staff/customers',{name:'مشتری جدید',phone:'۰۹۱۲۱۱۱۲۲۲۲',nickname:'دوست',role:'admin',points:99999,sms_opt_in:false},{role:'staff'});assert.equal(r.r.status,201);const u=db.prepare('SELECT * FROM users WHERE id=?').get(r.data.data.id);assert.equal(u.role,'customer');assert.equal(u.points,0);assert.equal(u.nickname,'دوست');assert.equal(u.birth_date,null);assert.equal((await request('/api/staff/customers',{role:'staff'})).r.status,403);
    });
    await test('quick-create then invoice uses same phone/ID, even with directory/search/history/shift denied',async()=>{
      reset();caps(['customer.create','invoice.create']);const created=await post('/api/staff/customers',{name:'مشتری سریع',phone:'09121112222',nickname:'سریع',sms_opt_in:false},{role:'staff'});assert.equal(created.r.status,201);const selected=await request('/api/staff/customer?phone=09121112222',{role:'staff'});assert.equal(selected.data.data.customer.id,created.data.data.id);assert.equal(selected.data.data.customer.nickname,'سریع');assert(!('last_visit_date' in selected.data.data.customer));assert(!('sms_opt_in' in selected.data.data.customer));
      const body={userId:created.data.data.id,customerPhone:'09121112222',items:[{name:'چای',price:10000,qty:1}],payment:{card:10000},clientRequestId:'quick-flow-repeat'};
      assert.equal((await post('/api/staff/invoices',body,{role:'staff'})).r.status,201);const duplicate=await post('/api/staff/invoices',body,{role:'staff'});assert.equal(duplicate.r.status,201);assert(duplicate.data.data.duplicate);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,1);assert.equal((await request('/api/staff/customers',{role:'staff'})).r.status,403);
    });
    await test('invoice-only staff must supply matching full phone, not guessed user ID',async()=>{
      reset();caps(['invoice.create']);const id=customer();const body={userId:id,items:[{name:'چای',price:1000,qty:1}]};assert.equal((await post('/api/staff/invoices',body,{role:'staff'})).data.code,'CUSTOMER_PHONE_REQUIRED');assert.equal((await post('/api/staff/invoices',{...body,customerPhone:'09121112222'},{role:'staff'})).r.status,400);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,0);assert.equal((await request('/api/staff/coupons/check?userId='+id+'&subtotal=1000&code=TEST',{role:'staff'})).data.code,'CUSTOMER_PHONE_REQUIRED');
    });
    await test('partial phone/nickname lookup without separate permission is denied, not silently listed',async()=>{
      reset();caps(['invoice.create','customer.create']);customer();for(const value of ['123','لقب مشترک','%'])assert.equal((await request('/api/staff/customer?phone='+encodeURIComponent(value),{role:'staff'})).r.status,400);
      assert.equal((await request('/api/staff/customers/search?q=123',{role:'staff'})).r.status,403);
    });
    await test('nickname duplicates remain separate selectable customers; Persian/Arabic phone fragments normalize',async()=>{
      reset();caps(['customer.search']);customer('09123334444','لقب مشترک');customer('09123334445','لقب مشترک');const byName=await request('/api/staff/customers/search?q='+encodeURIComponent('لقب مشترک'),{role:'staff'});assert.equal(byName.r.status,200);assert.equal(byName.data.data.items.length,2);assert(byName.data.data.items.every(u=>Object.keys(u).sort().join(',')==='id,name,nickname,phone'));for(const digits of ['۳۳۳','٣٣٣'])assert.equal((await request('/api/staff/customers/search?q='+encodeURIComponent(digits),{role:'staff'})).data.data.items.length,2);
    });
    await test('search wildcard/SQL-injection input is literal and bounded, not an accidental full directory',async()=>{
      reset();caps(['customer.search']);for(let i=0;i<25;i++)customer('0912111'+String(i).padStart(4,'0'),'آشنا');for(const q of ['%%','__',"' OR 1=1 --"]){const r=await request('/api/staff/customers/search?q='+encodeURIComponent(q),{role:'staff'});assert.equal(r.r.status,200);assert.equal(r.data.data.items.length,0);}
      const r=await request('/api/staff/customers/search?q='+encodeURIComponent('آشنا'),{role:'staff'});assert.equal(r.data.data.items.length,20);assert(r.data.data.hasMore);assert.equal((await request('/api/staff/customers/search?q=1',{role:'staff'})).r.status,400);
    });
    await test('directory grant is independent, read-only and paginated, never exposes staff/credentials',async()=>{
      reset();caps(['customer.list']);for(let i=0;i<22;i++)customer('0912111'+String(i).padStart(4,'0'));const one=await request('/api/staff/customers',{role:'staff'});const two=await request('/api/staff/customers?page=2',{role:'staff'});assert.equal(one.data.data.items.length,20);assert.equal(two.data.data.items.length,2);assert(!one.text.includes('password_hash'));assert.equal((await put('/api/admin/customers/3',{points:999},{role:'staff'})).r.status,403);assert.equal((await request('/api/staff/customers/search?q=123',{role:'staff'})).r.status,403);
    });
    await test('admin customer search includes nickname, literal fragments and normalized Persian digits',async()=>{
      reset();const id=customer('09123334444','دوست همیشگی');for(const q of ['همیشگی','۳۳۳','333']){const r=await m.listCustomers(env.DB,{q});assert(r.items.some(u=>u.id===id));}assert.equal((await m.listCustomers(env.DB,{q:'%%'})).total,0);
    });
    await test('nickname validation, clearing, duplicate phone and omitted nickname preserve data correctly',async()=>{
      reset();const id=customer();assert.equal((await put('/api/admin/customers/'+id,{name:'نام جدید',phone:'09123334444',birth_date:''})).r.status,200);assert.equal(db.prepare('SELECT nickname FROM users WHERE id=?').get(id).nickname,'لقب مشترک');assert.equal((await put('/api/admin/customers/'+id,{name:'نام جدید',phone:'09123334444',birth_date:'',nickname:''})).r.status,200);assert.equal(db.prepare('SELECT nickname FROM users WHERE id=?').get(id).nickname,'');assert.equal((await post('/api/admin/customers',{name:'نام جدید',phone:'09123334444',sms_opt_in:false})).r.status,409);assert.equal((await post('/api/admin/customers',{name:'نام جدید',phone:'09121112222',nickname:'a'.repeat(41)})).r.status,400);
    });
    await test('impossible/future birthdays are rejected instead of silently rolling into another date',async()=>{
      reset();assert(!m.isValidBirthDate('2023-02-31'));assert(!m.isValidBirthDate('2099-01-01'));assert(m.isValidBirthDate('2000-02-29'));assert.equal((await post('/api/admin/customers',{name:'نام جدید',phone:'09121112222',birth_date:'2023-02-31',sms_opt_in:false})).r.status,400);
    });
    await test('manual send requires admin, same origin, explicit confirmation and valid saved target',async()=>{
      reset();await configured();hold();const body={channel:'telegram',message:'متن دستی',confirmAdminOnly:true,requestId:crypto.randomUUID()};assert.equal((await post('/api/admin/fallback/send',body,{anonymous:true})).r.status,401);assert.equal((await post('/api/admin/fallback/send',body,{role:'staff'})).r.status,403);assert.equal((await post('/api/admin/fallback/send',body,{origin:'https://attacker.test'})).r.status,403);assert.equal(rows().length,0);assert.equal(calls.length,0);
    });
    await test('manual request validation never sends to arbitrary URL/chat or accepts missing consent',async()=>{
      for(const patch of [{confirmAdminOnly:false},{channel:'https://evil.test'},{message:''},{message:'x'.repeat(2001)},{requestId:'bad'},{phone:'123'}]){reset();await configured();hold();const r=await post('/api/admin/fallback/send',{channel:'telegram',message:'متن دستی',confirmAdminOnly:true,requestId:crypto.randomUUID(),...patch});assert.equal(r.r.status,400);assert.equal(rows().length,0);assert.equal(calls.length,0);}
    });
    await test('manual request is durable async encrypted and deduplicated while automatic toggles are off',async()=>{
      reset();await configured();hold();const body={channel:'both',message:'متن محرمانهٔ دستی',confirmAdminOnly:true,requestId:crypto.randomUUID()};const r=await post('/api/admin/fallback/send',body);assert.equal(r.r.status,202);assert.equal(r.data.data.ids.length,2);assert.equal(calls.length,0);assert.equal(rows().length,2);assert(!JSON.stringify(rows()).includes(body.message));assert.equal((await post('/api/admin/fallback/send',body)).r.status,202);assert.equal(rows().length,2);await configured();assert(rows().every(j=>j.status==='pending'));unlock();await m.processFallbackQueue(env);assert.equal(rows().filter(j=>j.status==='sent').length,1);
    });
    await test('manual send is limited to 3 per minute and no fourth job is admitted',async()=>{
      reset();await configured();hold();for(let i=0;i<3;i++)assert.equal((await post('/api/admin/fallback/send',{channel:'telegram',message:'متن دستی',confirmAdminOnly:true,requestId:crypto.randomUUID()})).r.status,202);assert.equal((await post('/api/admin/fallback/send',{channel:'telegram',message:'متن دستی',confirmAdminOnly:true,requestId:crypto.randomUUID()})).r.status,429);assert.equal(rows().length,3);
    });
    await test('failed messenger sends one cross-channel error alert without replaying the original or leaking raw error',async()=>{
      reset();await configured();await m.enqueueFallback(env,{phone:'',userId:null,type:'manual',message:'متن اصلی محرمانه'},'manual','telegram');globalThis.fetch=async()=>{throw Error('RAW_PRIVATE_ERROR '+token);};unlock();await m.processFallbackQueue(env);const original=rows().find(j=>j.type==='manual');const alert=rows().find(j=>j.type==='report_error');assert.equal(original.status,'failed');assert.equal(original.attempts,1);assert.equal(alert.channel,'bale');const payload=await m.unseal(env,alert.payload,'job:'+alert.id);assert(!payload.message.includes('متن اصلی'));assertSafe(payload);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admin_logs WHERE action='fallback_delivery_failed'").get().n,1);assertSafe(rows());
    });
    await test('error-alert failure never creates recursive alerts; source remains failed',async()=>{
      reset();await configured();await m.enqueueDeliveryAlert(env,'job:test','FETCH_FAILED','telegram');globalThis.fetch=async()=>{throw Error('RAW_PRIVATE_ERROR '+token);};unlock();await m.processFallbackQueue(env);assert.equal(rows().length,1);assert.equal(rows()[0].type,'report_error');assert.equal(rows()[0].status,'failed');
    });
    await test('error toggle cancels error notices independently, without canceling manual messages',async()=>{
      reset();await configured();await m.enqueueDeliveryAlert(env,'job:test','FETCH_FAILED','telegram');await m.enqueueFallback(env,{phone:'',userId:null,type:'manual',message:'متن دستی'},'manual','telegram');await configured({notifyErrors:false});assert.equal(rows().find(j=>j.type==='report_error').status,'skipped');assert.equal(rows().find(j=>j.type==='manual').status,'pending');assert.deepEqual(await m.enqueueDeliveryAlert(env,'job:another','FETCH_FAILED','telegram'),[]);
    });
    await test('SMS fallback log links each channel and distinguishes admin receipt from customer delivery',async()=>{
      reset();const id=customer();await configured({enabled:true});const result=await m.sendSms(env,{...m.DEFAULT_SETTINGS,sms_enabled:0},{phone:'09123334444',userId:id,type:'invoice',message:'رسید خرید'});assert.equal(result.status,'pending');assert.equal(result.fallbackIds.length,2);unlock();await m.processFallbackQueue(env);const logs=await m.listSmsLogs(env.DB,{});assert.equal(logs.items[0].status,'pending');assert.equal(logs.items[0].delivery_kind,'admin_fallback');const perChannel=JSON.parse(logs.items[0].fallback_delivery);assert.equal(perChannel.length,2);assert.equal(perChannel.filter(j=>j.status==='sent').length,1);assert.equal(perChannel.filter(j=>j.status==='pending').length,1);
    });
    await test('SMS failure without forwarding still queues a sanitized error notice with automatic reports disabled',async()=>{
      reset();const id=customer();await configured({enabled:false});globalThis.fetch=async()=>{throw Error('RAW_PRIVATE_ERROR secret-api-key');};const result=await m.sendSms(env,{...m.DEFAULT_SETTINGS,sms_provider:'smsir',sms_api_key:'secret-api-key',sms_sender:'3000000000'},{phone:'09123334444',userId:id,type:'invoice',message:'رسید'});assert.equal(result.status,'failed');assert.equal(rows().length,2);assert(rows().every(j=>j.type==='report_error'));assertSafe(db.prepare('SELECT * FROM sms_logs').all());for(const job of rows())assertSafe(await m.unseal(env,job.payload,'job:'+job.id));
    });
    await test('provider acceptance vs console logs and customer opt-out/OTP erasure remain distinct',async()=>{
      reset();const id=customer();await m.sendSms(env,m.DEFAULT_SETTINGS,{phone:'09123334444',userId:id,type:'invoice',message:'رسید آزمایشی'});assert.equal(db.prepare('SELECT delivery_kind FROM sms_logs').get().delivery_kind,'console');await configured({enabled:true});await m.sendSms(env,{...m.DEFAULT_SETTINGS,sms_enabled:0},{phone:'09123334444',userId:id,type:'otp',message:'کد 876543',expiresAt:Date.now()+110000});const otp=db.prepare("SELECT * FROM sms_logs WHERE type='otp'").get();assert(!otp.message.includes('876543'));const history=await m.fallbackHistory(env);assert(history.items.filter(j=>j.type==='otp').every(j=>j.content===null));unlock();await m.processFallbackQueue(env);assert.equal(db.prepare("SELECT payload FROM fallback_jobs WHERE type='otp' AND status='sent'").get().payload,'');
    });
    await test('v5 DB upgrades additively with a backup receipt and preserve every existing row/permission default',async()=>{
      reset();customer();db.exec('ALTER TABLE users DROP COLUMN nickname;ALTER TABLE users DROP COLUMN permissions;ALTER TABLE sms_logs DROP COLUMN fallback_ids;ALTER TABLE sms_logs DROP COLUMN delivery_kind;ALTER TABLE users DROP COLUMN staff_role;ALTER TABLE users DROP COLUMN staff_active;');const users=db.prepare('SELECT * FROM users ORDER BY id').all();const status=await request('/api/admin/system/schema');assert(!status.data.data.ready);assert.equal((await post('/api/admin/system/schema',{confirmBackup:true,receipt:'invalid'})).r.status,409);const backup=await request('/admin/export/backup.json?scope=upgrade');assert.equal(backup.r.status,200);assertSafe(backup.text.replace(env.JWT_SECRET,'').replace(env.FALLBACK_ENCRYPTION_KEY,''));let upgraded=await post('/api/admin/system/schema',{confirmBackup:true,receipt:backup.r.headers.get('X-Upgrade-Receipt')});for(let i=0;i<4&&!upgraded.data.data.ready;i++)upgraded=await post('/api/admin/system/schema',{confirmBackup:true,receipt:backup.r.headers.get('X-Upgrade-Receipt')});assert.equal(upgraded.r.status,200);assert(upgraded.data.data.ready);const after=db.prepare('SELECT * FROM users ORDER BY id').all();assert.deepEqual(JSON.parse(JSON.stringify(after.map(({nickname,permissions,staff_role,staff_active,...row})=>row))),JSON.parse(JSON.stringify(users)));assert(after.every(u=>u.nickname===''&&u.permissions===null));
    });
    await test('failed-send alert plus hour-boundary maintenance stays within 50 D1 queries',async()=>{
      reset();await configured({enabled:true});await m.enqueueFallback(env,{phone:'09123334444',userId:null,type:'invoice',message:'رسید'},'inactive','telegram');
      for(let i=0;i<20;i++)db.prepare("INSERT INTO users(name,phone,role,last_visit_date) VALUES(?,?,'customer','2026-01-01')").run('Budget test','091255500'+String(i).padStart(2,'0'));
      globalThis.fetch=async()=>{throw Error('RAW_PRIVATE_ERROR '+token);};env.DB.queries=0;const tasks=[];
      await m.worker.scheduled({cron:'* * * * *',scheduledTime:Date.UTC(2026,10,3,10,0)},env,{waitUntil:p=>tasks.push(p)});await Promise.all(tasks);
      assert.equal(rows().find(j=>j.type==='invoice').status,'failed');assert.equal(rows().find(j=>j.type==='report_error').channel,'bale');assert(env.DB.queries<=50,'D1 query count: '+env.DB.queries);console.log('   Failure + error notice hour-boundary D1 queries: '+env.DB.queries);
    });
    await test('invoice request IDs cannot reveal another employee receipt or silently act for another actor',async()=>{
      reset();caps(['invoice.create']);const id=customer();const body={userId:id,customerPhone:'09123334444',items:[{name:'چای',qty:1,price:10000}],clientRequestId:'cross-actor-id'};
      assert.equal((await post('/api/staff/invoices',body)).r.status,201);const result=await post('/api/staff/invoices',body,{role:'staff'});assert.equal(result.r.status,400);assert.equal(result.data.code,'REQUEST_ID_CONFLICT');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,1);
    });
    await test('public registration keeps optional nickname but cannot grant roles or employee permissions',async()=>{
      reset();const result=await post('/api/auth/register',{name:'مشتری ثبت‌نام',phone:'09121112222',birth_date:'2000-02-29',nickname:'آشنای عمومی',role:'admin',staff_role:'admin',staff_active:1,permissions:['customer.list'],sms_opt_in:false},{anonymous:true});assert.equal(result.r.status,201);const user=db.prepare("SELECT * FROM users WHERE phone='09121112222'").get();assert.equal(user.nickname,'آشنای عمومی');assert.equal(user.role,'customer');assert.equal(user.permissions,null);assert.equal(user.staff_role,null);
    });
    const staffInput={name:'نام پرسنلی تازه',phone:'09123334444',password:'DualRole@123',permissions:['customer.create','invoice.create']};
    async function linkCustomer(){const id=customer();await post('/api/admin/staff',{...staffInput,confirmExistingCustomer:true});return id;}
    async function passwordLogin(){const r=await post('/api/auth/login',{phone:staffInput.phone,password:staffInput.password},{anonymous:true});assert.equal(r.r.status,200,r.text);return r.r.headers.get('set-cookie').split(';')[0];}
    async function customerCookie(id){const row=db.prepare('SELECT * FROM users WHERE id=?').get(id);return 'cc_session='+await m.createToken(env.JWT_SECRET,row);}
    await test('existing customer needs explicit admin confirmation and non-admin cannot add personnel access',async()=>{
      reset();const id=customer();const before=db.prepare('SELECT * FROM users WHERE id=?').get(id);assert.equal((await post('/api/admin/staff',staffInput,{role:'staff'})).r.status,403);const r=await post('/api/admin/staff',staffInput);assert.equal(r.r.status,409);assert.equal(r.data.code,'CONFIRM_CUSTOMER_STAFF');assert.deepEqual(db.prepare('SELECT * FROM users WHERE id=?').get(id),before);
    });
    await test('link keeps customer ID, name, birthday, points, referrals, invoices and consent intact',async()=>{
      reset();const id=customer();db.prepare("UPDATE users SET birth_date='1991-04-02',points=87,lifetime_points=400,tier='silver' WHERE id=?").run(id);
      await m.recordInvoice(env,m.DEFAULT_SETTINGS,{userId:id,registeredBy:2,items:[],amount:1000,clientRequestId:'before-dual'});
      const before=db.prepare('SELECT * FROM users WHERE id=?').get(id);const invoices=db.prepare('SELECT * FROM invoices').all();const r=await post('/api/admin/staff',{...staffInput,confirmExistingCustomer:true});assert.equal(r.r.status,201,r.text);assert.equal(r.data.data.id,id);const after=db.prepare('SELECT * FROM users WHERE id=?').get(id);for(const key of Object.keys(before).filter(k=>!['staff_role','staff_active','password_hash','permissions','token_version'].includes(k)))assert.equal(after[key],before[key],key);assert.equal(after.role,'customer');assert.equal(after.staff_role,'staff');assert.equal(after.token_version,before.token_version+1);assert.deepEqual(db.prepare('SELECT * FROM invoices').all(),invoices);assert.equal((await post('/api/admin/staff',{...staffInput,confirmExistingCustomer:true})).r.status,409);
    });
    await test('dual password login has staff permissions; customer OTP-shaped session never has staff authority',async()=>{
      reset();const id=await linkCustomer();const cookie=await passwordLogin();assert.equal((await request('/staff',{cookie})).r.status,200);assert.equal((await request('/api/staff/customers',{cookie})).r.status,403);const cc=await customerCookie(id);assert.equal((await request('/me',{cookie:cc})).r.status,200);assert.equal((await request('/api/staff/customer?phone=09123334444',{cookie:cc})).r.status,403);assert.equal((await request('/api/admin/staff',{cookie:cc})).r.status,403);
    });
    await test('dual user stays searchable and can receive their own customer invoices and points',async()=>{
      reset();const id=await linkCustomer();assert.equal((await request('/api/staff/customer?phone=09123334444')).data.data.customer.id,id);const sale=await post('/api/staff/invoices',{userId:id,customerPhone:'09123334444',amount:200000,clientRequestId:'after-dual'});assert.equal(sale.r.status,201,sale.text);assert.equal(db.prepare('SELECT user_id FROM invoices').get().user_id,id);assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(id).role,'customer');
    });
    await test('dual employee appears once in staff list and remains in customer directory',async()=>{
      reset();const id=await linkCustomer();const list=await request('/api/admin/staff');const members=list.data.data.staff;assert.equal(members.filter(u=>u.id===id).length,1);assert.equal(members.find(u=>u.id===id).role,'staff');assert.equal(members.find(u=>u.id===id).customer_member,1);assert((await request('/admin/customers')).text.includes('09123334444'));
    });
    await test('staff disable immediately revokes password session but preserves customer access and billing',async()=>{
      reset();const id=await linkCustomer(),cookie=await passwordLogin(),cc=await customerCookie(id);assert.equal((await put('/api/admin/staff/'+id,{is_active:0})).r.status,200);assert.equal((await request('/api/staff/customer?phone=09123334444',{cookie})).r.status,401);assert.equal((await request('/me',{cookie:cc})).r.status,200);const row=db.prepare('SELECT * FROM users WHERE id=?').get(id);assert.equal(row.is_active,1);assert.equal(row.staff_active,0);assert.equal((await post('/api/auth/login',{phone:staffInput.phone,password:staffInput.password},{anonymous:true})).r.status,403);assert.equal((await put('/api/admin/staff/'+id,{is_active:1})).r.status,200);await passwordLogin();
    });
    await test('dual permissions update immediately and password reset invalidates old sessions',async()=>{
      reset();const id=await linkCustomer(),cookie=await passwordLogin();await put('/api/admin/staff/'+id,{permissions:[]});assert.equal((await post('/api/staff/customers',{name:'مشتری تست',phone:'09124445555'},{cookie})).r.status,403);assert.equal((await post('/api/admin/staff/'+id+'/password',{})).r.status,200);assert.equal((await request('/api/staff/customer?phone=09123334444',{cookie})).r.status,401);
    });
    await test('removing dual personnel access never deletes customer or financial records and can be added again',async()=>{
      reset();const id=await linkCustomer(),cookie=await passwordLogin();await m.recordInvoice(env,m.DEFAULT_SETTINGS,{userId:id,registeredBy:2,items:[],amount:15000,clientRequestId:'keep-on-remove'});const invoices=db.prepare('SELECT * FROM invoices').all();db.prepare('UPDATE users SET points=55 WHERE id=?').run(id);const r=await request('/api/admin/staff/'+id,{method:'DELETE'});assert.equal(r.r.status,200,r.text);const row=db.prepare('SELECT * FROM users WHERE id=?').get(id);assert.equal(row.points,55);assert.equal(row.role,'customer');assert.equal(row.staff_role,null);assert.equal(row.password_hash,null);assert.deepEqual(db.prepare('SELECT * FROM invoices').all(),invoices);assert.equal((await request('/api/staff/customer?phone=09123334444',{cookie})).r.status,401);assert.equal((await request('/me',{cookie:await customerCookie(id)})).r.status,200);assert.equal((await post('/api/admin/staff',{...staffInput,confirmExistingCustomer:true})).r.status,201);
    });
    await test('customer delete/suspend cannot bypass personnel protection on linked accounts',async()=>{
      reset();const id=await linkCustomer();assert.equal((await request('/api/admin/customers/'+id,{method:'DELETE'})).r.status,409);assert.equal((await post('/api/admin/customers/'+id+'/deactivate',{})).r.status,409);assert.equal(db.prepare('SELECT is_active FROM users WHERE id=?').get(id).is_active,1);
    });
    await test('dual admin password login is privileged but customer token still is not; last admin protected',async()=>{
      reset();const id=customer();await post('/api/admin/staff',{...staffInput,role:'admin',confirmExistingCustomer:true});const cookie=await passwordLogin();assert.equal((await request('/api/admin/staff',{cookie})).r.status,200);assert.equal((await request('/api/admin/staff',{cookie:await customerCookie(id)})).r.status,403);db.prepare("UPDATE users SET is_active=0 WHERE id=1").run();assert.equal((await put('/api/admin/staff/'+id,{role:'staff'},{cookie})).r.status,400);
    });
    await test('staff creates customer with birthday; impossible and future birthdays are still rejected',async()=>{
      reset();caps(['customer.create']);const payload={name:'تولد مشتری',phone:'09124445555',birth_date:'1991-04-02',sms_opt_in:false};const r=await post('/api/staff/customers',payload,{role:'staff'});assert.equal(r.r.status,201);assert.equal(db.prepare('SELECT birth_date FROM users WHERE id=?').get(r.data.data.id).birth_date,'1991-04-02');for(const date of ['2001-02-29','2999-01-01'])assert.equal((await post('/api/staff/customers',{...payload,phone:'09124446666',birth_date:date},{role:'staff'})).r.status,400);
    });
    await test('v6 to v7 receipt-gated additive upgrade preserves every customer and invoice value',async()=>{
      reset();customer();db.exec('ALTER TABLE users DROP COLUMN staff_role;ALTER TABLE users DROP COLUMN staff_active;');const before=db.prepare('SELECT * FROM users ORDER BY id').all();const backup=await request('/admin/export/backup.json?scope=upgrade');const r=await post('/api/admin/system/schema',{confirmBackup:true,receipt:backup.r.headers.get('X-Upgrade-Receipt')});assert.equal(r.r.status,200,r.text);assert(r.data.data.ready);const after=db.prepare('SELECT * FROM users ORDER BY id').all();assert.deepEqual(JSON.parse(JSON.stringify(after.map(({staff_role,staff_active,...u})=>u))),JSON.parse(JSON.stringify(before)));assert(after.every(u=>u.staff_role===null&&u.staff_active===1));
    });
    await test('real customer OTP verification on dual identity issues a customer session, never personnel privileges',async()=>{
      reset();const id=await linkCustomer(),code='123456';const hash=await m.hashOtp(code,staffInput.phone,env.JWT_SECRET);db.prepare("INSERT INTO otp_codes(phone,code_hash,expires_at) VALUES(?,?,datetime('now','+5 minutes'))").run(staffInput.phone,hash);
      const result=await post('/api/auth/otp/verify',{phone:staffInput.phone,code},{anonymous:true});assert.equal(result.r.status,200,result.text);const cookie=result.r.headers.get('set-cookie').split(';')[0];assert.equal((await request('/api/auth/me',{cookie})).data.data.user.role,'customer');assert.equal((await request('/me',{cookie})).r.status,200);assert.equal((await request('/api/admin/staff',{cookie})).r.status,403);assert.equal((await request('/api/staff/customer?phone='+staffInput.phone,{cookie})).r.status,403);
    });
    await test('removing dual access with an open shift requires closing shift and preserves the customer',async()=>{
      reset();const id=await linkCustomer();db.prepare("INSERT INTO shifts(staff_id,staff_name) VALUES(?,?)").run(id,'مشتری پرسنلی');const result=await request('/api/admin/staff/'+id,{method:'DELETE'});assert.equal(result.r.status,409);assert.equal(result.data.code,'OPEN_SHIFT');assert.equal(db.prepare('SELECT staff_role FROM users WHERE id=?').get(id).staff_role,'staff');
    });
    await test('admin-first ignores live SMS credentials and forwards to both saved admin channels',async()=>{
      reset();const id=customer();await configured({deliveryMode:'admin',enabled:false});const result=await m.sendSms(env,{...m.DEFAULT_SETTINGS,sms_enabled:1,sms_provider:'smsir',sms_api_key:'secret-api-key',sms_sender:'3000000000'},{phone:'09123334444',userId:id,type:'invoice',message:'پیام زیبا برای مشتری'});assert.equal(result.status,'pending');assert.equal(calls.length,0);assert.equal(rows().length,2);assert(rows().every(j=>j.reason==='admin_handoff'));assert(rows()[0].handoff_key);assert.equal(rows()[0].handoff_key,rows()[1].handoff_key);
    });
    await test('admin-only campaign never falls through to provider after mode changes',async()=>{
      reset();const id=customer();await configured({deliveryMode:'sms'});const r=await m.sendSms(env,{...m.DEFAULT_SETTINGS,sms_provider:'smsir',sms_api_key:'secret-api-key',sms_sender:'3000000000'},{userId:id,phone:'09123334444',type:'birthday',message:'تولد',adminOnly:true});assert.equal(r.status,'skipped');assert.equal(calls.length,0);
    });
    await test('admin-mode configuration validation is atomic and requires key, target and valid mode',async()=>{
      reset();for(const body of [{enabled:false,deliveryMode:'admin',channels:[]},{enabled:false,deliveryMode:'invalid',channels:[]}])await assert.rejects(()=>m.saveFallbackConfig(env,body));assert.equal(db.prepare("SELECT COUNT(*) n FROM settings WHERE key='sms_fallback_config'").get().n,0);
    });
    await test('switching away from admin mode cancels pending handoff instead of sending to customer',async()=>{
      reset();await configured({deliveryMode:'admin'});await m.enqueueFallback(env,{...params,type:'welcome'},'admin_handoff');await configured({deliveryMode:'sms'});unlock();await m.processFallbackQueue(env);assert.equal(rows().filter(r=>r.status==='sent').length,0);assert.equal(calls.length,0);
    });
    await test('human declaration marks both channel copies but never claims provider/customer delivery',async()=>{
      reset();const id=customer();await configured({deliveryMode:'admin'});const ids=await m.enqueueFallback(env,{...params,userId:id,type:'welcome'},'admin_handoff');hold();assert.equal((await m.fallbackHistory(env)).manualTodo,1);
      const no=await post('/api/admin/fallback/'+ids[0]+'/forwarded',{});assert.equal(no.r.status,400);assert.equal((await post('/api/admin/fallback/'+ids[0]+'/forwarded',{confirmSent:true},{role:'staff'})).r.status,403);
      const yes=await post('/api/admin/fallback/'+ids[0]+'/forwarded',{confirmSent:true});assert.equal(yes.r.status,200);assert(rows().every(j=>!!j.manual_sent_at&&j.status==='pending'));assert.equal((await m.fallbackHistory(env)).manualTodo,0);assert.equal((await m.fallbackHistory(env,1,'','','done')).total,2);assert.equal((await m.fallbackHistory(env,1,'','','todo')).total,0);
    });
    await test('OTP and internal reports cannot be marked as manually delivered to customer',async()=>{
      reset();await configured({deliveryMode:'admin',notifyEnabled:true});hold();for(const type of ['otp','report_invoice']){const ids=await m.enqueueFallback(env,{...params,type},type==='otp'?'admin_handoff':'event');assert.equal((await post('/api/admin/fallback/'+ids[0]+'/forwarded',{confirmSent:true})).r.status,400);}
    });
    await test('archive customer retains invoices, coupon, points and rejects new sale for inactive customer',async()=>{
      reset();const id=customer();await m.recordInvoice(env,m.DEFAULT_SETTINGS,{userId:id,registeredBy:2,items:[],amount:10000,clientRequestId:'archive-keep'});const before=db.prepare('SELECT * FROM invoices').all();db.prepare("INSERT INTO coupons(code,user_id,value) VALUES('KEEP',?,10)").run(id);const r=await request('/api/admin/customers/'+id,{method:'DELETE'});assert.equal(r.r.status,200);assert.equal(r.data.data.archived,true);assert.equal(r.data.data.deleted,false);assert.deepEqual(db.prepare('SELECT * FROM invoices').all(),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM coupons WHERE user_id=?').get(id).n,1);assert.equal(db.prepare('SELECT is_active FROM users WHERE id=?').get(id).is_active,0);assert.equal((await m.recordInvoice(env,m.DEFAULT_SETTINGS,{userId:id,registeredBy:2,items:[],amount:20000})).ok,false);
    });
    await test('racing one-use coupon produces one sale only, no extra points or coupon overuse',async()=>{
      reset();const id=customer();db.prepare("INSERT INTO coupons(code,user_id,value,max_uses) VALUES('RACE',?,20,1)").run(id);const input={userId:id,registeredBy:2,items:[],amount:10000,couponCode:'RACE'};const results=await Promise.all([m.recordInvoice(env,m.DEFAULT_SETTINGS,{...input,clientRequestId:'race-a'}),m.recordInvoice(env,m.DEFAULT_SETTINGS,{...input,clientRequestId:'race-b'})]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,1);assert.equal(db.prepare("SELECT used_count FROM coupons WHERE code='RACE'").get().used_count,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM operation_assertions').get().n,0);
    });
    await test('coupon validation is repeated inside write batch after stale preflight and rolls back entirely',async()=>{
      reset();const id=customer();db.prepare("INSERT INTO coupons(code,user_id,value,max_uses) VALUES('LATE',?,20,1)").run(id);const prepare=env.DB.prepare.bind(env.DB);let changed=false;env.DB.prepare=q=>{const stmt=prepare(q);if(q.includes('SELECT * FROM coupons WHERE UPPER(code)')){const first=stmt.first;stmt.first=async(...args)=>{const row=await first(...args);if(!changed){changed=true;db.prepare("UPDATE coupons SET used_count=1 WHERE code='LATE'").run();}return row;};}return stmt;};const result=await m.recordInvoice(env,m.DEFAULT_SETTINGS,{userId:id,registeredBy:2,items:[],amount:10000,couponCode:'LATE'});assert.equal(result.ok,false);assert.equal(result.code,'COUPON_CONFLICT');assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(id).points,0);
    });
    await test('OTP concurrent verification issues exactly one authenticated session',async()=>{
      reset();await linkCustomer();const code='543210',hash=await m.hashOtp(code,staffInput.phone,env.JWT_SECRET);db.prepare("INSERT INTO otp_codes(phone,code_hash,expires_at) VALUES(?,?,datetime('now','+5 minutes'))").run(staffInput.phone,hash);const results=await Promise.all([post('/api/auth/otp/verify',{phone:staffInput.phone,code},{anonymous:true}),post('/api/auth/otp/verify',{phone:staffInput.phone,code},{anonymous:true})]);assert.equal(results.filter(r=>r.r.status===200).length,1);assert.equal(results.filter(r=>r.r.headers.has('set-cookie')).length,1);
    });
    await test('birthday campaign prepares more than six recipients through resumable bounded batches',async()=>{
      reset();await configured({deliveryMode:'admin'});for(let i=0;i<9;i++)db.prepare("INSERT INTO users(name,phone,birth_date,role,sms_opt_in) VALUES('تولد صف',?,?,'customer',1)").run('091255500'+String(i).padStart(2,'0'),m.todayISO());
      env.DB.queries=0;await m.startAdminCampaign(env,m.DEFAULT_SETTINGS,'birthday');assert(env.DB.queries<=50,'first batch queries '+env.DB.queries);
      for(let i=0;i<8;i++){env.DB.queries=0;const running=await m.resumeAdminCampaign(env);assert(env.DB.queries<=50,'resume queries '+env.DB.queries);if(!running)break;}
      assert.equal(rows().filter(j=>j.type==='birthday').length,18);assert.equal(db.prepare("SELECT queued FROM campaign_progress WHERE job='birthday'").get().queued,9);assert.equal(db.prepare("SELECT status FROM campaign_progress WHERE job='birthday'").get().status,'done');assert.equal(db.prepare("SELECT COUNT(*) n FROM coupons WHERE reason='birthday'").get().n,9);assert.equal(calls.length,0);
    });
    await test('campaign cursor failure can resume without duplicate handoff or duplicate birthday coupon',async()=>{
      reset();await configured({deliveryMode:'admin'});for(let i=0;i<4;i++)db.prepare("INSERT INTO users(name,phone,birth_date,role,sms_opt_in) VALUES('بازیابی صف',?,?,'customer',1)").run('091266600'+String(i).padStart(2,'0'),m.todayISO());
      const prepare=env.DB.prepare.bind(env.DB);let inject=true;env.DB.prepare=q=>{const stmt=prepare(q);if(q.includes('SET cursor=')&&inject){stmt.run=async()=>{inject=false;throw Error('test checkpoint failure');};}return stmt;};
      await m.startAdminCampaign(env,m.DEFAULT_SETTINGS,'birthday');db.exec('UPDATE campaign_progress SET until_ms=0');for(let i=0;i<5;i++)await m.resumeAdminCampaign(env);
      assert.equal(rows().length,8);assert.equal(db.prepare("SELECT COUNT(*) n FROM coupons WHERE reason='birthday'").get().n,4);assert.equal(db.prepare('SELECT status FROM campaign_progress').get().status,'done');assert.equal(db.prepare('SELECT queued FROM campaign_progress').get().queued,4);
    });
    await test('churn checkpoint rollback retains correct queued count and throttle on resume',async()=>{
      reset();await configured({deliveryMode:'admin'});for(let i=0;i<4;i++)db.prepare("INSERT INTO users(name,phone,last_visit_date,role,sms_opt_in) VALUES('یادآوری',?,datetime('now','-90 days'),'customer',1)").run('091277700'+String(i).padStart(2,'0'));const prepare=env.DB.prepare.bind(env.DB);let inject=true;env.DB.prepare=q=>{const stmt=prepare(q);if(q.includes('SET cursor=')&&inject){stmt.run=async()=>{inject=false;throw Error('test churn checkpoint');};}return stmt;};await m.startAdminCampaign(env,m.DEFAULT_SETTINGS,'churn');assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE last_churn_sms_at IS NOT NULL').get().n,0);db.exec('UPDATE campaign_progress SET until_ms=0');for(let i=0;i<5;i++)await m.resumeAdminCampaign(env);assert.equal(rows().length,8);assert.equal(db.prepare('SELECT queued FROM campaign_progress').get().queued,4);assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE last_churn_sms_at IS NOT NULL').get().n,4);
    });
    await test('expired and cancelled messages remain in history but not the current manual work queue',async()=>{
      reset();await configured({deliveryMode:'admin'});await m.enqueueFallback(env,{...params,type:'welcome'},'admin_handoff');db.exec("UPDATE fallback_jobs SET expires_at=0");assert.equal((await m.fallbackHistory(env)).total,2);assert.equal((await m.fallbackHistory(env)).manualTodo,0);assert.equal((await m.fallbackHistory(env,1,'','','todo')).total,0);
    });
    await test('new templates contain no invented churn discount and referral message uses real placeholders',async()=>{
      assert(!m.DEFAULT_SETTINGS.sms_templates.churn.includes('۱۰٪'));assert(m.DEFAULT_SETTINGS.sms_templates.birthday.includes('{percent}'));assert(m.DEFAULT_SETTINGS.sms_templates.redeem.includes('{code}'));
    });
    await test('interrupted correction is visible, second replacement is refused, explicit completion is idempotent',async()=>{
      reset();const id=customer();const input={userId:id,registeredBy:1,items:[],amount:10000};const original=await m.recordInvoice(env,m.DEFAULT_SETTINGS,{...input,clientRequestId:'orig-review'});const replacement=await m.recordInvoice(env,m.DEFAULT_SETTINGS,{...input,amount:20000,replacesInvoiceId:original.invoiceId,clientRequestId:'new-review',deferReceipt:true});assert(replacement.ok);
      const second=await m.recordInvoice(env,m.DEFAULT_SETTINGS,{...input,replacesInvoiceId:original.invoiceId,clientRequestId:'duplicate-replacement'});assert.equal(second.ok,false);assert.equal(second.code,'CORRECTION_PENDING_REVIEW');const checks=await request('/api/admin/system/checks');assert.equal(checks.data.data.corrections.length,1);
      const path='/api/admin/invoices/'+original.invoiceId+'/complete-correction';assert.equal((await post(path,{})).r.status,400);assert.equal((await post(path,{confirm:true},{role:'staff'})).r.status,403);assert.equal((await post(path,{confirm:true})).r.status,200);const again=await post(path,{confirm:true});assert.equal(again.r.status,200);assert(again.data.data.duplicate);assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices WHERE voided_at IS NULL').get().n,1);assert.equal((await request('/api/admin/system/checks')).data.data.corrections.length,0);
    });
    await test('void claim and reversal are one transaction even when the reversal fails',async()=>{
      reset();const id=customer();const sale=await m.recordInvoice(env,m.DEFAULT_SETTINGS,{userId:id,registeredBy:1,items:[],amount:10000,clientRequestId:'void-atomic'});const points=db.prepare('SELECT points FROM users WHERE id=?').get(id).points;const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const statement=prepare(q);if(q.includes('SET points = MAX'))statement.run=async()=>{throw Error('test reversal failure');};return statement;};const r=await post('/api/admin/invoices/'+sale.invoiceId+'/void',{reason:'آزمون تراکنش'});assert.equal(r.r.status,409);assert.equal(db.prepare('SELECT voided_at FROM invoices WHERE id=?').get(sale.invoiceId).voided_at,null);assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(id).points,points);
    });
    await test('durable personnel login limit survives memory-bucket resets',async()=>{
      reset();const ip='203.0.113.88',phone='09120000000';for(let i=0;i<20;i++){m.resetRateLimit('login:'+ip+':'+phone);const r=await post('/api/auth/login',{phone,password:'wrong-test'},{anonymous:true,ip});assert.equal(r.r.status,401,r.text);}m.resetRateLimit('login:'+ip+':'+phone);const blocked=await post('/api/auth/login',{phone,password:'wrong-test'},{anonymous:true,ip});assert.equal(blocked.r.status,429);assert(blocked.r.headers.get('Retry-After'));
    });
    await test('private upgrade backup restores actual users, invoices, coupons and sequences into an empty SQLite DB',async()=>{
      reset();const id=customer();await m.recordInvoice(env,m.DEFAULT_SETTINGS,{userId:id,registeredBy:1,items:[],amount:12300,clientRequestId:'restore-real'});db.prepare("INSERT INTO coupons(code,user_id,value) VALUES('RESTORE',?,15)").run(id);const backup=await request('/admin/export/backup.json?scope=upgrade');const snapshot=JSON.parse(backup.text);const restored=new DatabaseSync(':memory:');
      try{restored.exec('PRAGMA foreign_keys=OFF');for(const row of snapshot.schema.filter(s=>s.type==='table'))restored.exec(row.sql);for(const [table,items] of Object.entries(snapshot.data)){for(const item of items){const cols=Object.keys(item);restored.prepare('INSERT INTO "'+table.replaceAll('"','""')+'" ('+cols.map(c=>'"'+c.replaceAll('"','""')+'"').join(',')+') VALUES('+cols.map(()=>'?').join(',')+')').run(...cols.map(k=>item[k]));}}for(const row of snapshot.schema.filter(s=>s.type!=='table'))restored.exec(row.sql);restored.exec('DELETE FROM sqlite_sequence');for(const row of snapshot.sequences)restored.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run(row.name,row.seq);for(const table of ['users','invoices','coupons','sms_logs'])assert.deepEqual(JSON.parse(JSON.stringify(restored.prepare('SELECT * FROM '+table+' ORDER BY id').all())),JSON.parse(JSON.stringify(db.prepare('SELECT * FROM '+table+' ORDER BY id').all())));assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(),[]);}finally{restored.close();}
    });
    await test('production schema creates no demo account, public password or sample configuration',async()=>{
      const sql=await readFile('schema-production.sql','utf8'),production=new DatabaseSync(':memory:');try{production.exec(sql);assert.equal(production.prepare('SELECT COUNT(*) n FROM users').get().n,0);assert.equal(production.prepare('SELECT COUNT(*) n FROM settings').get().n,0);assert(!sql.includes('Admin@'));assert(!sql.includes('Staff@'));assert.equal(production.prepare('SELECT COUNT(*) n FROM fallback_channel_limits').get().n,2);}finally{production.close();}
    });
    await test('v9 receipt intent and invoice are atomic when queue admission fails; retry recovers without another sale',async()=>{
      reset();await configured({deliveryMode:'admin'});const id=customer(),prepare=env.DB.prepare.bind(env.DB);let broken=true;
      env.DB.prepare=q=>{const stmt=prepare(q);if(q.includes('INSERT OR IGNORE INTO fallback_jobs')&&broken)stmt.run=async()=>{throw Error('injected queue admission outage');};return stmt;};
      const input={userId:id,registeredBy:1,items:[],amount:10000,clientRequestId:'durable-receipt'};
      const sale=await m.recordInvoice(env,m.DEFAULT_SETTINGS,input);assert(sale.ok);assert(sale.deliveryWarning);assert.equal(sale.receiptStatus,'pending');assert.equal(rows().length,0);assert.equal(db.prepare('SELECT status FROM invoice_receipts').get().status,'pending');
      const duplicate=await m.recordInvoice(env,m.DEFAULT_SETTINGS,input);assert(duplicate.duplicate&&duplicate.deliveryWarning);broken=false;db.exec('UPDATE invoice_receipts SET until_ms=0');await m.recoverInvoiceReceipt(env,m.DEFAULT_SETTINGS);assert.equal(rows().length,2);assert.equal(db.prepare('SELECT status FROM invoice_receipts').get().status,'queued');assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,1);assert.equal(calls.length,0);
    });
    await test('v9 receipt intent write failure rolls back invoice and customer points entirely',async()=>{
      reset();await configured({deliveryMode:'admin'});const id=customer(),prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const stmt=prepare(q);if(q.includes('INSERT INTO invoice_receipts'))stmt.run=async()=>{throw Error('injected intent write failure');};return stmt;};const sale=await m.recordInvoice(env,m.DEFAULT_SETTINGS,{userId:id,registeredBy:1,items:[],amount:10000});assert.equal(sale.ok,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(id).points,0);
    });
    await test('v9 receipt checkpoint crash is recovered by stable event key without duplicate queue work',async()=>{
      reset();await configured({deliveryMode:'admin'});const id=customer(),prepare=env.DB.prepare.bind(env.DB);let broken=true;
      env.DB.prepare=q=>{const stmt=prepare(q);if(q.includes('UPDATE invoice_receipts SET status=?,owner=NULL,until_ms=')&&broken)stmt.run=async()=>{throw Error('injected checkpoint crash');};return stmt;};
      const sale=await m.recordInvoice(env,m.DEFAULT_SETTINGS,{userId:id,registeredBy:1,items:[],amount:10000});assert(sale.ok);assert.equal(rows().length,2);assert.equal(db.prepare('SELECT status FROM invoice_receipts').get().status,'processing');broken=false;db.exec('UPDATE invoice_receipts SET until_ms=0');await Promise.all([m.recoverInvoiceReceipt(env,m.DEFAULT_SETTINGS),m.recoverInvoiceReceipt(env,m.DEFAULT_SETTINGS)]);assert.equal(rows().length,2);assert.equal(db.prepare('SELECT status FROM invoice_receipts').get().status,'queued');assert.equal(calls.length,0);
    });
    await test('v9 deferred correction receipts stay held until original reversal, then recover after a crash',async()=>{
      reset();await configured({deliveryMode:'admin'});const id=customer(),base={userId:id,registeredBy:1,items:[],amount:10000};const original=await m.recordInvoice(env,m.DEFAULT_SETTINGS,base);const replacement=await m.recordInvoice(env,m.DEFAULT_SETTINGS,{...base,replacesInvoiceId:original.invoiceId,deferReceipt:true});assert(replacement.ok);await m.recoverInvoiceReceipt(env,m.DEFAULT_SETTINGS);assert.equal(rows().length,2);assert.equal(db.prepare('SELECT status FROM invoice_receipts WHERE invoice_id=?').get(replacement.invoiceId).status,'held');const voided=await m.voidInvoice(env,m.DEFAULT_SETTINGS,original.invoiceId,1,{replacementInvoiceId:replacement.invoiceId});assert(voided.ok);await m.recoverInvoiceReceipt(env,m.DEFAULT_SETTINGS);assert.equal(rows().length,4);assert.equal(db.prepare('SELECT status FROM invoice_receipts WHERE invoice_id=?').get(replacement.invoiceId).status,'queued');
    });
    await test('v9 voided and expired unprepared receipts never produce an admin message',async()=>{
      reset();await configured({deliveryMode:'admin'});const id=customer(),base={userId:id,registeredBy:1,items:[],amount:10000,deferReceipt:true};const first=await m.recordInvoice(env,m.DEFAULT_SETTINGS,base);await m.voidInvoice(env,m.DEFAULT_SETTINGS,first.invoiceId,1);await m.recoverInvoiceReceipt(env,m.DEFAULT_SETTINGS);assert.equal(db.prepare('SELECT status FROM invoice_receipts WHERE invoice_id=?').get(first.invoiceId).status,'cancelled');const second=await m.recordInvoice(env,m.DEFAULT_SETTINGS,base);db.prepare('UPDATE invoice_receipts SET expires_at=0 WHERE invoice_id=?').run(second.invoiceId);await m.recoverInvoiceReceipt(env,m.DEFAULT_SETTINGS);assert.equal(db.prepare('SELECT status FROM invoice_receipts WHERE invoice_id=?').get(second.invoiceId).status,'expired');assert.equal(rows().length,0);
    });
    await test('v9 receipt recovery never falls through to sms.ir after admin mode is disabled',async()=>{
      reset();await configured({deliveryMode:'admin'});const id=customer();await m.recordInvoice(env,m.DEFAULT_SETTINGS,{userId:id,registeredBy:1,items:[],amount:10000,deferReceipt:true});await configured({deliveryMode:'sms'});await configured({deliveryMode:'admin'});await m.recoverInvoiceReceipt(env,{...m.DEFAULT_SETTINGS,sms_enabled:1,sms_provider:'smsir',sms_api_key:'secret-api-key',sms_sender:'3000000000'});assert.equal(rows().length,0);assert.equal(calls.length,0);assert.equal(db.prepare('SELECT status FROM invoice_receipts').get().status,'cancelled');
    });
    await test('v9 mode round trip irreversibly cancels pending admin handoffs',async()=>{
      reset();await configured({deliveryMode:'admin'});await m.enqueueFallback(env,{...params,type:'welcome'},'admin_handoff');await configured({deliveryMode:'sms'});assert(rows().every(j=>j.status==='skipped'));await configured({deliveryMode:'admin'});unlock();await m.processFallbackQueue(env);assert.equal(calls.length,0);
    });
    await test('v9 cancellation during receipt preparation prevents late admission even after mode round trip',async()=>{
      reset();await configured({deliveryMode:'admin'});const id=customer(),sale=await m.recordInvoice(env,m.DEFAULT_SETTINGS,{userId:id,registeredBy:1,items:[],amount:10000,deferReceipt:true});db.prepare("UPDATE invoice_receipts SET status='processing',owner='stale' WHERE invoice_id=?").run(sale.invoiceId);await configured({deliveryMode:'sms'});await configured({deliveryMode:'admin'});await assert.rejects(()=>m.enqueueFallback(env,{...params,userId:id,type:'invoice',eventKey:'invoice-receipt:'+sale.invoiceId,receiptGuard:{invoiceId:sale.invoiceId,owner:'stale'}},'admin_handoff'));assert.equal(rows().length,0);
    });
    await test('v9 referrer-credit SQL failure rolls back sale, receipt, flag and all points, then same request can retry',async()=>{
      reset();await configured({deliveryMode:'admin'});const ref=customer('09127774444'),id=customer('09127775555');db.prepare('UPDATE users SET referred_by=? WHERE id=?').run(ref,id);const prepare=env.DB.prepare.bind(env.DB);let broken=true;env.DB.prepare=q=>{const stmt=prepare(q);if(q.includes('UPDATE users SET points=points+?,lifetime_points=')&&broken)stmt.run=async()=>{throw Error('injected referral credit failure');};return stmt;};const input={userId:id,registeredBy:1,items:[],amount:10000,clientRequestId:'atomic-reward'},settings={...m.DEFAULT_SETTINGS,referral_reward_points:25};assert.equal((await m.recordInvoice(env,settings,input)).ok,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM invoice_receipts').get().n,0);assert.equal(db.prepare('SELECT referral_rewarded FROM users WHERE id=?').get(id).referral_rewarded,0);assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(ref).points,0);broken=false;assert((await m.recordInvoice(env,settings,input)).ok);assert.equal(db.prepare('SELECT referral_rewarded FROM users WHERE id=?').get(id).referral_rewarded,1);assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(ref).points,25);
    });
    await test('v9 concurrent first purchases award referrer once and compute tier inside the transaction',async()=>{
      reset();const ref=customer('09127774444'),id=customer('09127775555');db.prepare('UPDATE users SET referred_by=? WHERE id=?').run(ref,id);const settings={...m.DEFAULT_SETTINGS,referral_reward_points:100,tiers:{silver:50,gold:90,vip:1000}},input={userId:id,registeredBy:1,items:[],amount:10000};const sales=await Promise.all([m.recordInvoice(env,settings,{...input,clientRequestId:'ref-a'}),m.recordInvoice(env,settings,{...input,clientRequestId:'ref-b'})]);assert(sales.every(s=>s.ok));assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(ref).points,100);assert.equal(db.prepare('SELECT tier FROM users WHERE id=?').get(ref).tier,'gold');
    });
    await test('v9 postcommit message outage never turns a committed referred sale into an error',async()=>{
      reset();await configured({deliveryMode:'admin'});const ref=customer('09127774444'),id=customer('09127775555');db.prepare('UPDATE users SET referred_by=? WHERE id=?').run(ref,id);const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const stmt=prepare(q);if(q.includes('INSERT OR IGNORE INTO fallback_jobs'))stmt.run=async()=>{throw Error('injected messaging outage');};return stmt;};const sale=await m.recordInvoice(env,{...m.DEFAULT_SETTINGS,referral_reward_points:25},{userId:id,registeredBy:1,items:[],amount:10000});assert(sale.ok&&sale.deliveryWarning);assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(ref).points,25);assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,1);
    });
    await test('v9 each unavailable OTP limiter fails closed, preserves old code, and returns HTTP 503 with retry delay',async()=>{
      for(const prefix of ['otp:ip:','otp:phone:','otp:hour:']){
        reset();const id=customer();await put('/api/admin/settings',{otp_login_enabled:1});await configured({deliveryMode:'admin'});db.prepare("INSERT INTO otp_codes(phone,code_hash,expires_at) VALUES('09123334444','old-code',datetime('now','+2 minutes'))").run();const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const stmt=prepare(q);if(q.includes('INSERT INTO rate_limits')){let args=[];const bind=stmt.bind;stmt.bind=(...a)=>{args=a;bind(...a);return stmt;};const first=stmt.first;stmt.first=async(...a)=>{if(String(args[0]).startsWith(prefix))throw Error('injected limiter outage');return first(...a);};}return stmt;};const r=await post('/api/auth/otp/request',{phone:'09123334444'},{anonymous:true});assert.equal(r.r.status,503,r.text);assert.equal(r.data.code,'RATE_LIMIT_UNAVAILABLE');assert.equal(r.r.headers.get('retry-after'),'60');assert.equal(db.prepare('SELECT COUNT(*) n FROM otp_codes').get().n,1);assert.equal(db.prepare('SELECT used_at FROM otp_codes').get().used_at,null);assert.equal(rows().length,0);assert.equal(calls.length,0);
      }
    });
    await test('v9 bad legacy phone and birthday are reported while healthy campaign recipients continue',async()=>{
      reset();await configured({deliveryMode:'admin'});const bad=customer('bad-legacy'),dateBad=customer('09128880000'),good=customer('09128881111');db.exec('UPDATE users SET sms_opt_in=1 WHERE role=\'customer\'');db.prepare('UPDATE users SET birth_date=? WHERE id IN (?,?)').run(m.todayISO(),bad,good);db.prepare("UPDATE users SET birth_date='broken-birthday' WHERE id=?").run(dateBad);await m.startAdminCampaign(env,m.DEFAULT_SETTINGS,'birthday');for(let i=0;i<3;i++)await m.resumeAdminCampaign(env);assert.equal(db.prepare('SELECT status FROM campaign_progress').get().status,'done');assert.equal(rows().length,2);assert(rows().every(j=>j.user_id===good));assert.equal(db.prepare('SELECT COUNT(*) n FROM campaign_issues').get().n,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM coupons').get().n,1);const report=await request('/api/admin/campaigns');assert.equal(report.data.data.issues.length,2);
    });
    await test('v9 shared queue outage pauses campaign without advancing healthy recipient or marking invalid data',async()=>{
      reset();await configured({deliveryMode:'admin'});const id=customer();db.prepare('UPDATE users SET birth_date=?,sms_opt_in=1 WHERE id=?').run(m.todayISO(),id);const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const stmt=prepare(q);if(q.includes('INSERT OR IGNORE INTO fallback_jobs'))stmt.run=async()=>{throw Error('injected shared queue outage');};return stmt;};await m.startAdminCampaign(env,m.DEFAULT_SETTINGS,'birthday');assert.equal(db.prepare('SELECT status FROM campaign_progress').get().status,'paused');assert.equal(db.prepare('SELECT cursor FROM campaign_progress').get().cursor,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM campaign_issues').get().n,0);
    });
    await test('v9 receipt recovery endpoints require admin, durable rate limit and never expose credentials',async()=>{
      reset();assert.equal((await request('/api/admin/receipts',{role:'staff'})).r.status,403);assert.equal((await post('/api/admin/receipts/recover',{}, {role:'staff'})).r.status,403);assert.equal((await request('/api/admin/receipts',{anonymous:true})).r.status,401);for(let i=0;i<3;i++)assert.equal((await post('/api/admin/receipts/recover',{})).r.status,200);assert.equal((await post('/api/admin/receipts/recover',{})).r.status,429);assertSafe((await request('/api/admin/receipts')).data);
    });
    await test('v9 full referred/coupon invoice route including background dispatcher fits 50 D1 queries',async()=>{
      reset();await configured({deliveryMode:'admin',notifyEnabled:true});const ref=customer('09127774444'),id=customer('09127775555');db.prepare('UPDATE users SET referred_by=? WHERE id=?').run(ref,id);db.prepare("INSERT INTO coupons(code,user_id,value) VALUES('BUDGET',?,10)").run(id);env.DB.queries=0;const r=await post('/api/staff/invoices',{userId:id,amount:10000,couponCode:'BUDGET',clientRequestId:'budget-full'});assert.equal(r.r.status,201,r.text);assert(env.DB.queries<=50,'queries '+env.DB.queries);
    });
    await test('v9 reward-flag failure rolls back already-updated referrer credit and entire sale',async()=>{
      reset();const ref=customer('09127774444'),id=customer('09127775555');db.prepare('UPDATE users SET referred_by=? WHERE id=?').run(ref,id);const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const stmt=prepare(q);if(q.includes('UPDATE users SET referral_rewarded=1'))stmt.run=async()=>{throw Error('injected flag write failure');};return stmt;};const sale=await m.recordInvoice(env,{...m.DEFAULT_SETTINGS,referral_reward_points:25},{userId:id,registeredBy:1,items:[],amount:10000});assert.equal(sale.ok,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(ref).points,0);assert.equal(db.prepare('SELECT referral_rewarded FROM users WHERE id=?').get(id).referral_rewarded,0);
    });
    await test('v9 minute Cron automatically prepares one durable admin receipt within the D1 budget',async()=>{
      reset();await configured({deliveryMode:'admin'});const id=customer();await m.recordInvoice(env,m.DEFAULT_SETTINGS,{userId:id,registeredBy:1,items:[],amount:10000,deferReceipt:true});const tasks=[];env.DB.queries=0;await m.worker.scheduled({cron:'* * * * *',scheduledTime:Date.parse('2026-10-21T00:03:00Z')},env,{waitUntil:p=>tasks.push(p)});await Promise.all(tasks);assert.equal(rows().length,2);assert.equal(db.prepare('SELECT status FROM invoice_receipts').get().status,'queued');assert.equal(calls.length,0);assert(env.DB.queries<=50,'queries '+env.DB.queries);
    });
    console.log(`\n${passed}/${passed} customer workflow checks passed (actual Worker/SQLite/WebCrypto, mocked providers).`);
  }finally{globalThis.fetch=originalFetch;console.warn=originalWarn;db?.close();}
}finally{await rm(dir,{recursive:true,force:true});}
