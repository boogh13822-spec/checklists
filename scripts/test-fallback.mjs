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
  await build({ stdin: { contents: `export * from './src/lib/fallback'; export * from './src/lib/fallback-adapters'; export * from './src/lib/sms'; export { DEFAULT_SETTINGS, invalidateSettingsCache } from './src/lib/settings'; export { default as worker } from './src/index'; export { requestOtpCode, verifyOtpCode } from './src/lib/otp'; export { runBirthdayJob } from './src/lib/jobs'; export { todayISO } from './src/lib/utils';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: file });
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

  await test('migration is additive and repeatable; existing users survive', async()=>{
    reset();const migration=await readFile('migrations/0005_sms_fallback.sql','utf8');
    db.exec(migration);db.exec(migration);assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,2);
  });
  await test('invalid configuration rejected atomically', async()=>{
    reset();await assert.rejects(()=>m.saveFallbackConfig(env,{enabled:true,channels:[{channel:'webhook',chatId:'1',token}]}));
    await assert.rejects(()=>m.saveFallbackConfig(env,config(['telegram','telegram'])));
    await assert.rejects(()=>m.saveFallbackConfig(env,{enabled:true,channels:[{channel:'telegram',chatId:'https://127.0.0.1',token}]}));
    assert.equal(db.prepare('SELECT count(*) n FROM settings WHERE key=?').get('sms_fallback_config').n,0);
  });
  await test('tokens encrypted, public config never includes credential', async()=>{
    reset();await m.saveFallbackConfig(env,config(['telegram','bale']));
    const raw=db.prepare('SELECT value FROM settings WHERE key=?').get('sms_fallback_config').value;
    assert(!raw.includes(token));assert(!JSON.stringify(m.safeFallbackConfig(env,await m.loadFallbackConfig(env))).includes(token));
    const c=await m.loadFallbackConfig(env);assert.equal(await m.unseal(env,c.channels[0].token,'token:telegram'),token);
    await assert.rejects(()=>m.unseal(env,c.channels[0].token,'token:bale'));
  });
  await test('missing encryption key cannot enable fallback', async()=>{
    reset();delete env.FALLBACK_ENCRYPTION_KEY;await assert.rejects(()=>m.saveFallbackConfig(env,config()));
  });
  await test('blank token retains old secret; explicit clear disables it', async()=>{
    reset();await m.saveFallbackConfig(env,config());
    await m.saveFallbackConfig(env,{enabled:true,channels:[{channel:'telegram',chatId:'123',token:''}]});
    assert(m.safeFallbackConfig(env,await m.loadFallbackConfig(env)).channels[0].hasToken);
    await m.saveFallbackConfig(env,{enabled:false,channels:[{channel:'telegram',chatId:'123',clearToken:true}]});
    assert(!m.safeFallbackConfig(env,await m.loadFallbackConfig(env)).channels[0].hasToken);
  });
  await test('inactive SMS + fallback on: enqueue both channels without network wait', async()=>{
    reset();await m.saveFallbackConfig(env,config(['telegram','bale']));calls=[];
    const result=await m.sendSms(env,{...m.DEFAULT_SETTINGS,sms_enabled:0},params);
    assert.equal(result.status,'pending');assert.equal(rows().length,2);assert.equal(calls.length,0);
    assert(!JSON.stringify(rows()).includes(params.message));
  });
  await test('queue worker sends correct Telegram payload, normalized copyable phone, full text and Jalali time', async()=>{
    calls=[];await m.processFallbackQueue(env);assert.equal(calls.length,1);
    const call=calls[0];const body=JSON.parse(call.opts.body);
    assert(body.text.includes('09120000000'));assert(body.text.includes(params.message));
    assert(body.text.includes('شناسه کاربر: 1'));assert(!body.parse_mode);assert.equal(call.opts.redirect,'manual');
    assert.equal(rows().filter(r=>r.status==='sent').length,1);
  });
  await test('second channel uses Bale native API', async()=>{
    unlock();calls=[];await m.processFallbackQueue(env);assert(calls[0].url.startsWith('https://tapi.bale.ai/bot'));
  });
  await test('healthy active sms.ir never falls back', async()=>{
    reset();await m.saveFallbackConfig(env,config());calls=[];
    globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return response({status:1,data:{messageIds:[55]}});};
    const r=await m.sendSms(env,{...m.DEFAULT_SETTINGS,sms_provider:'smsir',sms_api_key:'fake-key',sms_sender:'3000123'},params);
    assert.equal(r.status,'sent');assert.equal(rows().length,0);assert.equal(calls.length,1);assert(calls[0].url.includes('api.sms.ir'));
  });
  await test('failed active sms.ir falls back once (primary_failed reason)',async()=>{
    globalThis.fetch=async()=>response({},401);
    const r=await m.sendSms(env,{...m.DEFAULT_SETTINGS,sms_provider:'smsir',sms_api_key:'fake-key',sms_sender:'3000123'},params);
    assert.equal(r.status,'pending');assert.equal(rows()[0].reason,'primary_failed');
  });
  await test('inactive primary and fallback off never sends or queues',async()=>{
    reset();calls=[];globalThis.fetch=async()=>{throw new Error('must not fetch');};
    const r=await m.sendSms(env,{...m.DEFAULT_SETTINGS,sms_enabled:0},params);
    assert.equal(r.status,'skipped');assert.equal(rows().length,0);
  });
  await test('invalid phone rejected without a job',async()=>{
    await m.saveFallbackConfig(env,config());const r=await m.sendSms(env,m.DEFAULT_SETTINGS,{...params,phone:'garbage'});
    assert.equal(r.status,'failed');assert.equal(rows().length,0);
  });
  for (const [code,label] of [[401,'INVALID_TOKEN'],[400,'INVALID_CHAT'],[403,'FORBIDDEN']]) {
    await test('safe provider error '+code+' without token leak', async()=>{
      reset();await m.saveFallbackConfig(env,config());await m.enqueueFallback(env,params,'inactive');
      globalThis.fetch=async()=>response({ok:false,error_code:code,description:token},code);
      await m.processFallbackQueue(env);assert.equal(rows()[0].status,'failed');assert(rows()[0].error.includes(label));assert(!rows()[0].error.includes(token));
    });
  }
  await test('429 honors Retry-After and retries only after scheduled time',async()=>{
    reset();await m.saveFallbackConfig(env,config());await m.enqueueFallback(env,params,'inactive');calls=[];
    globalThis.fetch=async(url)=>{calls.push(url);return response({ok:false,error_code:429,parameters:{retry_after:120}},429);};
    await m.processFallbackQueue(env);assert.equal(rows()[0].status,'pending');assert(rows()[0].next_at>Date.now()+115000);
    unlock();await m.processFallbackQueue(env);assert.equal(calls.length,1);
    db.exec('UPDATE fallback_jobs SET next_at=0; UPDATE fallback_channel_limits SET until_ms=0');unlock();
    globalThis.fetch=async()=>response({ok:true,result:{message_id:22}});
    await m.processFallbackQueue(env);assert.equal(rows()[0].status,'sent');assert.equal(rows()[0].attempts,2);
  });
  await test('ambiguous network errors are not automatically replayed and never leak URL token',async()=>{
    reset();await m.saveFallbackConfig(env,config());await m.enqueueFallback(env,params,'inactive');
    globalThis.fetch=async()=>{throw new Error('https://api.telegram.org/bot'+token);};
    await m.processFallbackQueue(env);assert.equal(rows()[0].status,'failed');assert(!rows()[0].error.includes(token));
    unlock();await m.processFallbackQueue(env);assert.equal(rows()[0].attempts,1);
  });
  await test('parallel workers cannot send one job twice',async()=>{
    reset();await m.saveFallbackConfig(env,config());await m.enqueueFallback(env,params,'inactive');calls=[];
    globalThis.fetch=async(url)=>{calls.push(url);return response({ok:true,result:{message_id:1}});};
    await Promise.all([m.processFallbackQueue(env),m.processFallbackQueue(env)]);assert.equal(calls.length,1);assert.equal(rows()[0].attempts,1);
  });
  await test('OTP encrypted in outbox and redacted in both histories, then erased on completion',async()=>{
    reset();await m.saveFallbackConfig(env,config());const otp={...params,type:'otp',message:'کد ورود: 765432'};
    await m.sendSms(env,{...m.DEFAULT_SETTINGS,sms_enabled:0},otp);
    assert(!JSON.stringify(rows()).includes('765432'));
    assert(!JSON.stringify(await m.fallbackHistory(env)).includes('765432'));
    assert(!db.prepare('SELECT message FROM sms_logs ORDER BY id DESC LIMIT 1').get().message.includes('765432'));
    await m.processFallbackQueue(env);assert.equal(rows()[0].payload,'');
  });
  await test('expired OTP is never sent',async()=>{
    reset();await m.saveFallbackConfig(env,config());await m.enqueueFallback(env,{...params,type:'otp'},'inactive');
    db.exec('UPDATE fallback_jobs SET expires_at=0');calls=[];await m.processFallbackQueue(env);
    assert.equal(rows()[0].status,'expired');assert.equal(rows()[0].payload,'');assert.equal(calls.length,0);
  });
  await test('activating primary skips previously queued inactive jobs',async()=>{
    reset();await m.saveFallbackConfig(env,config());await m.enqueueFallback(env,params,'inactive');
    await setting('sms_provider','smsir');await setting('sms_api_key','fake-key');await setting('sms_sender','3000123');
    calls=[];await m.processFallbackQueue(env);assert.equal(rows()[0].status,'skipped');assert.equal(calls.length,0);
  });
  await test('switch off cancels pending jobs and erases OTP',async()=>{
    reset();await m.saveFallbackConfig(env,config());await m.enqueueFallback(env,{...params,type:'otp'},'inactive');
    await m.saveFallbackConfig(env,config([],false));assert.equal(rows()[0].status,'skipped');assert.equal(rows()[0].payload,'');
  });
  await test('stale in-flight jobs become delivery-unknown, not duplicate sends',async()=>{
    reset();await m.saveFallbackConfig(env,config());await m.enqueueFallback(env,params,'inactive');
    db.exec("UPDATE fallback_jobs SET status='processing',locked_at=0");calls=[];await m.processFallbackQueue(env,true);
    assert.equal(rows()[0].status,'failed');assert(rows()[0].error.includes('DELIVERY_UNKNOWN'));assert.equal(calls.length,0);
  });
  await test('explicit test works even with global fallback disabled',async()=>{
    reset();await m.saveFallbackConfig(env,config(['telegram'],false));
    await m.enqueueFallback(env,params,'test','telegram');await m.processFallbackQueue(env);assert.equal(rows()[0].status,'sent');
  });
  await test('queue capacity is all-or-nothing for multiple channels',async()=>{
    reset();await m.saveFallbackConfig(env,config(['telegram','bale']));
    db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<999)
      INSERT INTO fallback_jobs(id,channel,chat_id,type,payload,reason,next_at,expires_at) SELECT 'capacity-'||x,'telegram','1','admin','','test',0,9999999999999 FROM n`);
    await assert.rejects(()=>m.enqueueFallback(env,params,'inactive'),/QUEUE_FULL/);assert.equal(rows().length,999);
  });
  await test('environment token override supported; DB never contains it',async()=>{
    reset();env.TELEGRAM_BOT_TOKEN=token;
    await m.saveFallbackConfig(env,{enabled:true,channels:[{channel:'telegram',chatId:'123'}]});
    assert(!db.prepare('SELECT value FROM settings WHERE key=?').get('sms_fallback_config').value.includes(token));
    await m.enqueueFallback(env,params,'inactive');await m.processFallbackQueue(env);assert.equal(rows()[0].status,'sent');
  });
  await test('OTP request reports queued, not delivered; deadline matches original code',async()=>{
    reset();await m.saveFallbackConfig(env,config());
    db.exec("INSERT INTO users(name,phone,role) VALUES('OTP test','09121112233','customer')");
    const r=await m.requestOtpCode(env,{...m.DEFAULT_SETTINGS,sms_enabled:0},'09121112233','local-test');
    assert.equal(r.ok,true);assert.equal(r.sent,false);assert.equal(r.queued,true);
    const otp=db.prepare('SELECT * FROM otp_codes ORDER BY id DESC LIMIT 1').get();
    assert(rows()[0].expires_at <= Date.parse(otp.expires_at.replace(' ','T')+'Z'));
    const plain=await m.unseal(env,rows()[0].payload,'job:'+rows()[0].id);
    const code=plain.message.match(/\b\d{6}\b/)[0];
    assert.equal((await m.verifyOtpCode(env,'09121112233',code)).ok,true);
  });
  await test('OTP unavailable path invalidates code and reports failure, not sent',async()=>{
    reset();db.exec("INSERT INTO users(name,phone,role) VALUES('OTP test','09121112233','customer')");
    const r=await m.requestOtpCode(env,{...m.DEFAULT_SETTINGS,sms_enabled:0},'09121112233','local-test');
    assert.equal(r.ok,false);assert.equal(r.code,'OTP_SEND_FAILED');
    assert(db.prepare('SELECT used_at FROM otp_codes ORDER BY id DESC LIMIT 1').get().used_at);
  });
  await test('previously failed primary still dispatches fallback while primary configured',async()=>{
    reset();await m.saveFallbackConfig(env,config());await m.enqueueFallback(env,params,'primary_failed');
    await setting('sms_provider','smsir');await setting('sms_api_key','fake');await setting('sms_sender','3000123');
    await m.processFallbackQueue(env);assert.equal(rows()[0].status,'sent');
  });
  await test('message too close to expiry is not sent past deadline',async()=>{
    reset();await m.saveFallbackConfig(env,config());await m.enqueueFallback(env,{...params,type:'otp',expiresAt:Date.now()+5000},'inactive');
    calls=[];await m.processFallbackQueue(env);assert.equal(rows()[0].status,'expired');assert.equal(calls.length,0);
  });
  await test('30-day history retention applies even when feature is disabled',async()=>{
    reset();await m.saveFallbackConfig(env,config());await m.enqueueFallback(env,params,'inactive');
    db.exec("UPDATE fallback_jobs SET status='failed',created_at=datetime('now','-31 days')");
    await m.saveFallbackConfig(env,config([],false));await m.processFallbackQueue(env,true);assert.equal(rows().length,0);
  });
  await test('new OTP supersedes all older queued codes for the same user',async()=>{
    reset();await m.saveFallbackConfig(env,config(['telegram','bale']));
    await m.enqueueFallback(env,{...params,type:'otp',message:'old 111111'},'inactive');
    await m.enqueueFallback(env,{...params,type:'otp',message:'new 222222'},'inactive');
    assert.equal(rows().filter(j=>j.status==='pending').length,2);
    assert.equal(rows().filter(j=>j.status==='skipped' && j.payload==='').length,2);
  });
  await test('provider 429 cooldown does not block the other messenger',async()=>{
    reset();await m.saveFallbackConfig(env,config(['telegram','bale']));await m.enqueueFallback(env,params,'inactive');
    globalThis.fetch=async(url)=>url.includes('telegram')?response({ok:false,error_code:429,parameters:{retry_after:120}},429):response({ok:true,result:{message_id:1}});
    await m.processFallbackQueue(env);unlock();await m.processFallbackQueue(env);
    assert.equal(rows().find(j=>j.channel==='bale').status,'sent');assert.equal(rows().find(j=>j.channel==='telegram').status,'pending');
  });
  await test('fallback keeps full template beyond the original 480-char SMS cap',async()=>{
    reset();await m.saveFallbackConfig(env,config());const message='پیام کامل '.repeat(100);
    await m.sendSms(env,{...m.DEFAULT_SETTINGS,sms_enabled:0},{...params,message});
    const job=rows()[0];const payload=await m.unseal(env,job.payload,'job:'+job.id);assert.equal(payload.message,message.trim());
    const tooLong=await m.sendSms(env,{...m.DEFAULT_SETTINGS,sms_enabled:0},{...params,message:'x'.repeat(2001)});
    assert.equal(tooLong.status,'skipped');assert(tooLong.error.includes('۲۰۰۰'));assert.equal(rows().length,1);
  });
  await test('minute Cron actually dispatches persisted work without running daily jobs',async()=>{
    reset();await m.saveFallbackConfig(env,config());await m.enqueueFallback(env,params,'inactive');
    globalThis.fetch=async()=>response({ok:true,result:{message_id:111}});
    const tasks=[];
    await m.worker.scheduled({cron:'* * * * *',scheduledTime:Date.UTC(2026,10,3,10,10)},env,{waitUntil:p=>tasks.push(p)});
    await Promise.all(tasks);assert.equal(rows()[0].status,'sent');assert.equal(tasks.length,1);
  });
  await test('actual Worker HTTP 202 returns before Bot API resolves; waitUntil completes delivery',async()=>{
    reset();await m.saveFallbackConfig(env,config());
    const loginTasks=[];
    const login=await m.worker.fetch(new Request('http://app.test/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'09120000000',password:'Admin@12345'})}),env,{waitUntil:p=>loginTasks.push(p)});
    assert.equal(login.status,200);await Promise.all(loginTasks);unlock();
    const cookie=login.headers.get('set-cookie').split(';')[0];
    let finish,called;const providerStarted=new Promise(r=>called=r);const providerGate=new Promise(r=>finish=r);
    globalThis.fetch=async()=>{called();return providerGate;};
    const tasks=[];
    const res=await m.worker.fetch(new Request('http://app.test/api/admin/fallback/test',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({channel:'telegram'})}),env,{waitUntil:p=>tasks.push(p)});
    assert.equal(res.status,202);assert.equal(tasks.length,1);
    await providerStarted;assert.equal(rows()[0].status,'processing');
    finish(response({ok:true,result:{message_id:222}}));await Promise.all(tasks);assert.equal(rows()[0].status,'sent');
  });
  await test('birthday job skips existing coupons without starving later customers or counting queued as sent',async()=>{
    reset();await m.saveFallbackConfig(env,config());let lastId;
    for(let i=1;i<=7;i++) {
      lastId=Number(db.prepare('INSERT INTO users(name,phone,role,birth_date) VALUES(?,?,?,?)').run('Birthday test','0912444000'+i,'customer',m.todayISO()).lastInsertRowid);
      if(i<=6)db.prepare("INSERT INTO coupons(code,user_id,kind,value,reason) VALUES(?,?,'percent',10,'birthday')").run('PREVIOUS-'+i,lastId);
    }
    const r=await m.runBirthdayJob(env,{...m.DEFAULT_SETTINGS,sms_enabled:0},true);
    assert.equal(r.sent,0);assert.equal(r.queued,1);assert.equal(r.failed,0);assert.equal(rows().length,1);assert.equal(rows()[0].user_id,lastId);
    assert.equal(db.prepare("SELECT count(*) n FROM coupons WHERE reason='birthday'").get().n,7);
  });
  await test('hour-boundary maintenance plus dispatcher stay below 50 D1 queries',async()=>{
    reset();await m.saveFallbackConfig(env,config());await m.enqueueFallback(env,params,'inactive');
    for(let i=0;i<20;i++)db.prepare("INSERT INTO users(name,phone,role,last_visit_date) VALUES(?,?,'customer','2026-01-01')").run('Budget test','091255500'+String(i).padStart(2,'0'));
    globalThis.fetch=async()=>response({ok:true,result:{message_id:333}});
    env.DB.queries=0;const tasks=[];
    await m.worker.scheduled({cron:'* * * * *',scheduledTime:Date.UTC(2026,10,3,10,0)},env,{waitUntil:p=>tasks.push(p)});
    await Promise.all(tasks);assert.equal(rows()[0].status,'sent');assert(env.DB.queries<=50,'D1 query count: '+env.DB.queries);
    console.log('   D1 queries at hour boundary: '+env.DB.queries);
  });
  await test('idle request wake-ups perform no lease writes when no work is due',async()=>{
    reset();await m.saveFallbackConfig(env,config([],false));await m.processFallbackQueue(env);
    const lease=db.prepare('SELECT until_ms,owner FROM fallback_dispatch WHERE id=1').get();assert.equal(lease.until_ms,0);assert.equal(lease.owner,null);
  });
  console.log(`\n${passed}/${passed} fallback tests passed (mocked HTTP, actual SQLite).`);
} finally { await rm(dir,{recursive:true,force:true}); }
