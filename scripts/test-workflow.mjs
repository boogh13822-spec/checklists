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
  await build({ stdin: { contents: `export * from './src/lib/fallback'; export * from './src/lib/fallback-adapters'; export * from './src/lib/permissions'; export { sign } from 'hono/jwt'; export { registerCustomer, listCustomers, tierLabel, listSmsLogs, recordInvoice } from './src/lib/db'; export { isValidBirthDate } from './src/lib/utils'; export { sendSms } from './src/lib/sms'; export { DEFAULT_SETTINGS, loadSettings, invalidateSettingsCache } from './src/lib/settings'; export { default as worker } from './src/index'; export { createToken } from './src/lib/auth';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: file });
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
  const originalFetch=globalThis.fetch,originalWarn=console.warn;
  let calls=[],warnings=[],requestSequence=0;
  console.warn=(...args)=>warnings.push(args);
  function reset(){db?.close();m.invalidateSettingsCache();const next=database();db=next.db;env={DB:next.api,JWT_SECRET:'local-test-only-not-real-0123456789abcdef',FALLBACK_ENCRYPTION_KEY:key};calls=[];warnings=[];globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return new Response(JSON.stringify({ok:true,result:{message_id:10,id:42}}),{headers:{'Content-Type':'application/json'}});};}
  function rows(){return db.prepare('SELECT * FROM fallback_jobs ORDER BY rowid').all();}
  function unlock(){db.exec('UPDATE fallback_dispatch SET until_ms=0');}
  function hold(){db.exec('UPDATE fallback_dispatch SET until_ms='+ (Date.now()+120000));}
  function caps(values){db.prepare('UPDATE users SET permissions=? WHERE id=2').run(values===null?null:JSON.stringify(values));}
  function customer(phone='09123334444',nickname='لقب مشترک'){return Number(db.prepare("INSERT INTO users(name,phone,nickname,role,sms_opt_in) VALUES('مشتری آزمون',?,?,'customer',0)").run(phone,nickname).lastInsertRowid);}
  async function request(path,{role='admin',anonymous=false,method='GET',body,origin,cookie:providedCookie}={}){
    const cookie=providedCookie??'cc_session='+await m.createToken(env.JWT_SECRET,{id:role==='admin'?1:2,role,name:'آزمون'});
    const tasks=[];const r=await m.worker.fetch(new Request('https://app.test'+path,{method,headers:{'Content-Type':'application/json','CF-Connecting-IP':'198.51.100.'+(++requestSequence%250),...(!anonymous?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{waitUntil:p=>tasks.push(p)});
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
      reset();customer();db.exec('ALTER TABLE users DROP COLUMN nickname;ALTER TABLE users DROP COLUMN permissions;ALTER TABLE sms_logs DROP COLUMN fallback_ids;ALTER TABLE sms_logs DROP COLUMN delivery_kind;');const users=db.prepare('SELECT * FROM users ORDER BY id').all();const status=await request('/api/admin/system/schema');assert(!status.data.data.ready);assert.equal((await post('/api/admin/system/schema',{confirmBackup:true,receipt:'invalid'})).r.status,409);const backup=await request('/admin/export/backup.json?scope=upgrade');assert.equal(backup.r.status,200);assertSafe(backup.text.replace(env.JWT_SECRET,'').replace(env.FALLBACK_ENCRYPTION_KEY,''));const upgraded=await post('/api/admin/system/schema',{confirmBackup:true,receipt:backup.r.headers.get('X-Upgrade-Receipt')});assert.equal(upgraded.r.status,200);assert(upgraded.data.data.ready);const after=db.prepare('SELECT * FROM users ORDER BY id').all();assert.deepEqual(JSON.parse(JSON.stringify(after.map(({nickname,permissions,...row})=>row))),JSON.parse(JSON.stringify(users)));assert(after.every(u=>u.nickname===''&&u.permissions===null));
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
      reset();const result=await post('/api/auth/register',{name:'مشتری ثبت‌نام',phone:'09121112222',birth_date:'2000-02-29',nickname:'آشنای عمومی',role:'admin',permissions:['customer.list'],sms_opt_in:false},{anonymous:true});assert.equal(result.r.status,201);const user=db.prepare("SELECT * FROM users WHERE phone='09121112222'").get();assert.equal(user.nickname,'آشنای عمومی');assert.equal(user.role,'customer');assert.equal(user.permissions,null);
    });
    console.log(`\n${passed}/${passed} customer workflow checks passed (actual Worker/SQLite/WebCrypto, mocked providers).`);
  }finally{globalThis.fetch=originalFetch;console.warn=originalWarn;db?.close();}
}finally{await rm(dir,{recursive:true,force:true});}
