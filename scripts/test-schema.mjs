/** Real SQLite + Worker regression suite: old schemas, backups, recovery and every main page. No live network. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'schema-tests-'));
try {
  const file=join(dir,'module.mjs');
  await build({stdin:{contents:`export * from './src/lib/schema'; export {createToken,resetRateLimit} from './src/lib/auth'; export {invalidateSettingsCache} from './src/lib/settings'; export {default as worker} from './src/index'; export {sign} from 'hono/jwt';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:file});
  const m=await import(pathToFileURL(file));
  const schema=await readFile('schema.sql','utf8');
  let db,env,passed=0;
  const secret='local-schema-tests-only-0123456789abcdef';
  function reset(old=false){
    if(db)db.close(); db=new DatabaseSync(':memory:');
    const sql=old?schema.split('\n').filter(l=>!l.includes('referral_code')).join('\n'):schema;
    db.exec(sql);
    if(old){
      db.exec('PRAGMA foreign_keys=OFF');
      for(const t of ['cash_movements','shifts','admin_logs','otp_codes','rate_limits','fallback_jobs','fallback_dispatch','fallback_channel_limits'])db.exec('DROP TABLE '+t);
      for(const row of db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='invoices' AND sql IS NOT NULL").all())db.exec('DROP INDEX '+row.name);
      for(const col of ['visit_day','client_request_id','voided_at','voided_by','void_reason','payment_method','paid_cash','paid_card','paid_online','change_amount','shift_id','replaces_invoice_id'])db.exec('ALTER TABLE invoices DROP COLUMN '+col);
      for(const col of ['lifetime_points','sms_opt_in','token_version'])db.exec('ALTER TABLE users DROP COLUMN '+col);
      db.exec('PRAGMA foreign_keys=ON');
      db.prepare("INSERT INTO users(name,phone,role,points,tier) VALUES('مشتری قدیمی','09123456789','customer',123,'silver')").run();
      db.prepare("INSERT INTO invoices(user_id,amount,items,subtotal,discount,points_earned,registered_by) VALUES(3,25000,'[]',27000,2000,25,2)").run();
      db.prepare("UPDATE settings SET value=? WHERE key='cafe_name'").run(JSON.stringify('نام کافه حفظ شود'));
      db.prepare("UPDATE settings SET value=? WHERE key='sms_api_key'").run(JSON.stringify('TEST_DATABASE_SECRET_DO_NOT_DISPLAY'));
    }
    const api={queries:0,prepare(query){let args=[];const stmt={bind(...a){args=a;return stmt;},async first(column){api.queries++;const row=db.prepare(query).get(...args);return column?row?.[column]??null:row??null;},async all(){api.queries++;return{results:db.prepare(query).all(...args),success:true};},async run(){api.queries++;const r=db.prepare(query).run(...args);return{success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};return stmt;},async batch(statements){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};
    env={DB:api,JWT_SECRET:secret};m.invalidateSettingsCache();m.resetRateLimit('login:local:09120000000');
  }
  globalThis.fetch=async()=>{throw new Error('External network must not be used');};
  async function request(path,{method='GET',body,cookie='',headers={}}={}){
    const tasks=[];const response=await m.worker.fetch(new Request('https://app.test'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env,{waitUntil:p=>tasks.push(p)});await Promise.all(tasks);const text=await response.text();return{response,text,json:response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):null};
  }
  async function login(){const r=await request('/api/auth/login',{method:'POST',body:{phone:'09120000000',password:'Admin@12345'}});assert.equal(r.response.status,200);return r.response.headers.get('set-cookie').split(';')[0];}
  const clone=x=>JSON.parse(JSON.stringify(x));
  async function test(name,fn){await fn();passed++;console.log('✅ '+name);}
  async function snapshot(cookie){const r=await request('/admin/export/backup.json?scope=upgrade',{cookie});assert.equal(r.response.status,200);return{r,receipt:r.response.headers.get('x-upgrade-receipt')};}
  async function upgrade(cookie,receipt){let last;for(let i=0;i<80;i++){env.DB.queries=0;last=await request('/api/admin/system/schema',{method:'POST',body:{receipt,confirmBackup:true},cookie});assert.equal(last.response.status,200,last.text);assert(env.DB.queries<=50,'upgrade request exceeded Free D1 queries: '+env.DB.queries);if(last.json.data.ready)return last;}throw new Error('Upgrade failed to finish');}

  await test('public home and login remain reachable with a previous valid session and broken dashboard',async()=>{
    reset(true);const cookie=await login();for(const path of ['/','/login']){const r=await request(path,{cookie});assert.equal(r.response.status,200);assert.equal(r.response.headers.get('location'),null);}const panel=await request('/admin',{cookie});assert.equal(panel.response.status,303);assert.equal(panel.response.headers.get('location'),'/admin/system');
  });
  await test('missing shifts and invoice payment fields are detected before business SQL executes',async()=>{
    reset(true);const status=await m.schemaStatus(env.DB,true);assert(!status.ready);assert(status.pending.some(s=>s.key==='table:shifts'));assert(status.pending.some(s=>s.key==='column:invoices.voided_at'));assert(status.pending.some(s=>s.key==='column:invoices.paid_cash'));
  });
  await test('recovery page works without shift/payment/referral tables or fields',async()=>{
    reset(true);const cookie=await login();const r=await request('/admin/system',{cookie});assert.equal(r.response.status,200);assert(r.text.includes('بررسی و ارتقای امن دیتابیس'));assert(!r.text.includes('TEST_DATABASE_SECRET_DO_NOT_DISPLAY'));
  });
  await test('upgrade endpoints and private backup are inaccessible without admin authorization',async()=>{
    reset(true);for(const path of ['/api/admin/system/schema'])assert.equal((await request(path)).response.status,401);const staff='cc_session='+await m.createToken(secret,{id:2,role:'staff',name:'staff'});for(const path of ['/api/admin/system/schema','/admin/export/backup.json?scope=upgrade']){const r=await request(path,{cookie:staff});assert([302,403].includes(r.response.status));}assert.equal((await request('/api/admin/system/schema',{method:'POST',body:{},cookie:staff})).response.status,403);
  });
  await test('CSRF blocks migration POST even for a valid admin and backup receipt',async()=>{
    reset(true);const cookie=await login();const {receipt}=await snapshot(cookie);const r=await request('/api/admin/system/schema',{cookie,method:'POST',body:{receipt,confirmBackup:true},headers:{Origin:'https://evil.test'}});assert.equal(r.response.status,403);
  });
  await test('schema cannot be changed without successful backup and explicit acknowledgement',async()=>{
    reset(true);const cookie=await login();const before=clone(db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all());for(const body of [{},{confirmBackup:true,receipt:'forged'},{receipt:await m.backupReceipt(secret,1),confirmBackup:false}])assert.equal((await request('/api/admin/system/schema',{cookie,method:'POST',body})).response.status,409);assert.deepEqual(clone(db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()),before);
  });
  await test('private backup preserves identities, hashes, invoices, raw settings and unknown user tables',async()=>{
    reset(true);db.exec('CREATE TABLE custom_history(id INTEGER PRIMARY KEY, content TEXT)');db.prepare('INSERT INTO custom_history VALUES(1,?)').run('متن خصوصی');const cookie=await login();const {r,receipt}=await snapshot(cookie);assert(receipt);assert.match(r.response.headers.get('cache-control'),/no-store/);assert.match(r.response.headers.get('content-disposition'),/attachment/);assert.equal(r.json.data.users.length,3);assert(r.json.sequences.some(s=>s.name==='users'&&s.seq===3));assert(r.json.data.users[0].password_hash);assert(r.json.data.settings.some(v=>v.value.includes('TEST_DATABASE_SECRET_DO_NOT_DISPLAY')));assert.equal(r.json.data.custom_history[0].content,'متن خصوصی');assert.equal(r.json.data.invoices[0].amount,25000);assert(!r.text.includes(secret));assert(!r.text.includes('Admin@12345'));
  });
  await test('backup receipt is not a session or a cross-account migration grant',async()=>{
    reset(true);const receipt=await m.backupReceipt(secret,1);assert.equal((await request('/api/admin/system/schema',{cookie:'cc_session='+receipt})).response.status,401);assert.equal(await m.verifyBackupReceipt(secret,2,receipt),false);assert.equal(await m.verifyBackupReceipt(secret,1,receipt),true);
  });
  await test('expired and wrong-purpose receipts fail closed',async()=>{
    reset(true);for(const aud of ['schema-backup','session']){const exp=aud==='schema-backup'?Math.floor(Date.now()/1000)-1:Math.floor(Date.now()/1000)+100;const token=await m.sign({uid:1,aud,exp,version:m.SCHEMA_VERSION},secret,'HS256');assert.equal(await m.verifyBackupReceipt(secret,1,token),false);}
  });
  await test('complete staged upgrade preserves every old user and invoice value, adds lifetime baseline once',async()=>{
    reset(true);const cookie=await login();const beforeUsers=clone(db.prepare('SELECT * FROM users ORDER BY id').all());const beforeInvoices=clone(db.prepare('SELECT * FROM invoices ORDER BY id').all());const beforeSettings=clone(db.prepare('SELECT * FROM settings ORDER BY key').all());const {receipt}=await snapshot(cookie);await upgrade(cookie,receipt);
    for(const old of beforeUsers){const current=db.prepare('SELECT * FROM users WHERE id=?').get(old.id);for(const [k,v]of Object.entries(old))assert.equal(current[k],v,k);}for(const old of beforeInvoices){const current=db.prepare('SELECT * FROM invoices WHERE id=?').get(old.id);for(const [k,v]of Object.entries(old))assert.equal(current[k],v,k);}assert.deepEqual(clone(db.prepare('SELECT * FROM settings ORDER BY key').all()),beforeSettings);assert.equal(db.prepare('SELECT lifetime_points p FROM users WHERE id=3').get().p,123);assert.equal((await m.schemaStatus(env.DB,true)).ready,true);assert(db.prepare("SELECT COUNT(*) n FROM admin_logs WHERE action='database_upgrade'").get().n>0);
  });
  await test('all primary pages render after an actual legacy upgrade, not just session confirmation',async()=>{
    reset(true);const cookie=await login();const {receipt}=await snapshot(cookie);await upgrade(cookie,receipt);for(const path of ['/admin','/admin/customers','/admin/invoices','/admin/shifts','/admin/reports','/admin/settings','/admin/fallback','/admin/sms','/admin/logs','/admin/staff','/admin/coupons','/staff','/staff/history','/staff/shift']){const r=await request(path,{cookie});assert.equal(r.response.status,200,path+' '+r.text.slice(0,100));}
  });
  await test('repeat upgrade on ready DB is a no-op, preserving legitimate zero lifetime totals',async()=>{
    reset();const cookie=await login();db.prepare('UPDATE users SET points=200,lifetime_points=0 WHERE id=1').run();const {receipt}=await snapshot(cookie);const before=clone(db.prepare('SELECT * FROM users').all());await upgrade(cookie,receipt);assert.deepEqual(clone(db.prepare('SELECT * FROM users').all()),before);assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_logs WHERE action='database_upgrade'").get().n,0);
  });
  await test('lifetime ALTER and baseline roll back together if baseline fails',async()=>{
    reset();db.exec('ALTER TABLE users DROP COLUMN lifetime_points');const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const stmt=prepare(q);if(q.startsWith('UPDATE users SET lifetime_points'))stmt.run=async()=>{throw new Error('simulated baseline failure');};return stmt;};await assert.rejects(()=>m.applySchemaSteps(env.DB,{uid:1,name:'admin'}));assert(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='lifetime_points'));
  });
  await test('ambiguous missing historical columns stop automatic changes before any DDL',async()=>{
    reset();db.exec('DROP INDEX idx_invoices_created_at; DROP INDEX idx_invoices_payment; DROP INDEX idx_invoices_staff_day; ALTER TABLE invoices DROP COLUMN created_at;');const before=clone(db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all());const status=await m.schemaStatus(env.DB,true);assert(status.blocked.includes('column:invoices.created_at'));await assert.rejects(()=>m.applySchemaSteps(env.DB,{uid:1,name:'admin'}),/MANUAL_REVIEW/);assert.deepEqual(clone(db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()),before);
  });
  await test('large backup never silently truncates or issues a migration receipt',async()=>{
    reset();db.exec('CREATE TABLE large_history(id INTEGER PRIMARY KEY, value TEXT)');db.exec("WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO large_history(id,value) SELECT x,'test' FROM n");const cookie=await login();const r=await request('/admin/export/backup.json?scope=upgrade',{cookie});assert.equal(r.response.status,503);assert.equal(r.response.headers.get('x-upgrade-receipt'),null);assert.equal(r.json.code,'BACKUP_FAILED');
  });
  await test('duplicate referral codes stop unique-index creation without deleting or modifying users',async()=>{
    reset();db.exec('DROP INDEX ux_users_referral_code'); // Existing core column UNIQUE remains in fresh DB; simulate a conflicting index failure safely.
    const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const stmt=prepare(q);if(q.startsWith('CREATE UNIQUE INDEX IF NOT EXISTS ux_users_referral_code'))stmt.run=async()=>{throw new Error('UNIQUE constraint failed: users.referral_code');};return stmt;};const before=clone(db.prepare('SELECT * FROM users').all());await assert.rejects(()=>m.applySchemaSteps(env.DB,{uid:1,name:'admin'}),/UNIQUE/);assert.deepEqual(clone(db.prepare('SELECT * FROM users').all()),before);
  });
  await test('partial schema blocks public registration and authenticated business writes before mutation',async()=>{
    reset(true);const cookie=await login();const before=db.prepare('SELECT COUNT(*) n FROM invoices').get().n;assert.equal((await request('/api/staff/invoices',{method:'POST',body:{},cookie})).json.code,'SCHEMA_UPGRADE_REQUIRED');assert.equal((await request('/api/auth/register',{method:'POST',body:{}})).response.status,503);assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,before);
  });
  await test('cron does not run business jobs or dispatch against an incomplete schema',async()=>{
    reset(true);const tasks=[];await m.worker.scheduled({cron:'* * * * *',scheduledTime:Date.now()},env,{waitUntil:p=>tasks.push(p)});await Promise.all(tasks);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,3);
  });
  await test('unexpected server errors have matching safe tracking IDs, correct title and no raw SQL leakage',async()=>{
    reset();const cookie=await login();await m.schemaStatus(env.DB);const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{if(q.includes("FROM users WHERE role = 'customer'"))throw new Error('INTERNAL_SQL_SECRET_NOT_FOR_CLIENT');return prepare(q);};for(const path of ['/admin','/api/admin/stats']){const r=await request(path,{cookie});assert.equal(r.response.status,500);const id=r.response.headers.get('x-request-id');assert(id);assert(!r.text.includes('INTERNAL_SQL_SECRET_NOT_FOR_CLIENT'));assert(!r.text.includes('صفحه‌ای که دنبالش بودید پیدا نشد'));if(r.json)assert.equal(r.json.requestId,id);else assert(r.text.includes(id));}
  });
  await test('legacy customer profile and auth/me are functional after schema upgrade',async()=>{
    reset(true);const admin=await login();const {receipt}=await snapshot(admin);await upgrade(admin,receipt);const cookie='cc_session='+await m.createToken(secret,{id:3,name:'مشتری قدیمی',role:'customer',token_version:0});const profile=await request('/me',{cookie});assert.equal(profile.response.status,200);assert(profile.text.includes('مشتری قدیمی'));const me=await request('/api/auth/me',{cookie});assert.equal(me.json.data.authenticated,true);assert.equal(me.json.data.user.id,3);
  });
  await test('dispatcher control rows are restored without resetting any existing lease or cooldown',async()=>{
    reset();db.exec("DELETE FROM fallback_dispatch; DELETE FROM fallback_channel_limits WHERE channel='bale'; UPDATE fallback_channel_limits SET until_ms=987654321 WHERE channel='telegram'");assert.equal((await m.schemaStatus(env.DB,true)).ready,false);await m.applySchemaSteps(env.DB,{uid:1,name:'admin'});assert.equal((await m.schemaStatus(env.DB,true)).ready,true);assert.equal(db.prepare('SELECT until_ms FROM fallback_dispatch WHERE id=1').get().until_ms,0);assert.equal(db.prepare("SELECT until_ms FROM fallback_channel_limits WHERE channel='telegram'").get().until_ms,987654321);assert.equal(db.prepare("SELECT until_ms FROM fallback_channel_limits WHERE channel='bale'").get().until_ms,0);
  });
  console.log(`\n${passed}/${passed} schema/recovery regressions passed.`);
}finally{await rm(dir,{recursive:true,force:true});}
