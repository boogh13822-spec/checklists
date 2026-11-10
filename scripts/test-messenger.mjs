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
  await build({ stdin: { contents: `export * from './src/lib/fallback'; export * from './src/lib/fallback-adapters'; export { invalidateSettingsCache } from './src/lib/settings'; export { default as worker } from './src/index'; export { createToken } from './src/lib/auth';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: file });
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
  function reset() { db?.close();m.invalidateSettingsCache(); const next=database();db=next.db;env={DB:next.api, JWT_SECRET:'local-test-only-not-real-0123456789abcdef', FALLBACK_ENCRYPTION_KEY:key}; }
  function rows() {return db.prepare('SELECT * FROM fallback_jobs ORDER BY id').all();}
  function response(body,status=200) {return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});}
  let calls=[];
  const originalFetch = globalThis.fetch, originalWarn = console.warn;
  let warnings=[];
  console.warn=(...args)=>warnings.push(args);
  function success() { calls=[]; globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return response({ok:true,result:String(url).endsWith('/sendMessage')?{message_id:10}:{id:String(url).endsWith('/getMe')?123456:-1001234567890}});}; }
  function noLeak(value) { const text=JSON.stringify(value);assert(!text.includes(token));assert(!text.includes(params.message));assert(!text.includes('RAW_PRIVATE_EXCEPTION'));assert(!text.includes('RAW_PRIVATE_BODY'));assert(!text.includes('-1001234567890')); }
  const send=()=>m.adapters.telegram.send(token,'-1001234567890',params.message);
  async function signedRequest(path,{role='admin',anonymous=false,origin,body={channel:'telegram'},rawBody,headers={}}={}){
    const uid=role==='admin'?1:2;
    const jwt=await m.createToken(env.JWT_SECRET,{id:uid,role,name:'آزمایش',token_version:0});
    const waits=[];
    const r=await m.worker.fetch(new Request('https://example.test'+path,{method:'POST',headers:{'Content-Type':'application/json',...(!anonymous?{Cookie:'cc_session='+jwt}:{}),...(origin?{Origin:origin}:{}),...headers},body:rawBody??JSON.stringify(body)}),env,{waitUntil:p=>waits.push(p)});
    await Promise.all(waits);
    return {r,body:await r.json(),waits};
  }
  const probe=(opts)=>signedRequest('/api/admin/fallback/diagnose',opts);
  async function setup() { reset();warnings=[];success();await m.saveFallbackConfig(env,{...config(['telegram','bale'],false),notifyEnabled:true,notifyActions:true}); }


  try {
    await test('both fixed origins: read-only getMe then getChat; no sendMessage/update/webhook or queue', async()=>{
      await setup();
      for (const channel of ['telegram','bale']) {
        calls=[];const report=await m.diagnoseFallback(env,channel);
        assert(report.ready);assert.equal(report.messageSent,false);
        assert.deepEqual(report.checks.map(c=>c.stage),['bot','chat']);
        assert.deepEqual(calls.map(c=>new URL(c.url).pathname.split('/').pop()),['getMe','getChat']);
        assert(calls.every(c=>new URL(c.url).origin===(channel==='telegram'?'https://api.telegram.org':'https://tapi.bale.ai')&&c.opts.redirect==='manual'));
        assert.equal(calls[0].opts.body,'{}');assert.equal(JSON.parse(calls[1].opts.body).chat_id,'-1001234567890');
        assert(report.checks.every(c=>/^[\da-f-]{36}$/.test(c.diagnostic.referenceId)&&c.diagnostic.elapsedMs>=0));noLeak(report);
      }
      assert.equal(rows().length,0);
    });
    await test('no AbortSignal.timeout dependency; real AbortController signal; timer cleared on success',async()=>{
      success();const timeout=AbortSignal.timeout,clear=globalThis.clearTimeout;let clears=0;
      AbortSignal.timeout=undefined;globalThis.clearTimeout=t=>{clears++;clear(t);};
      try{assert((await send()).ok);assert(calls[0].opts.signal instanceof AbortSignal);assert.equal(clears,1);}
      finally{AbortSignal.timeout=timeout;globalThis.clearTimeout=clear;}
    });
    for (const [cause,code] of [['ENOTFOUND','DNS_FAILURE'],['EAI_AGAIN','DNS_FAILURE'],['CERT_HAS_EXPIRED','TLS_FAILURE'],['ERR_TLS_CERT_ALTNAME_INVALID','TLS_FAILURE'],['ECONNRESET','NETWORK_RESET'],['ETIMEDOUT','NETWORK_TIMEOUT'],['UNKNOWN_WITH_PRIVATE_URL','FETCH_FAILED']]) {
      await test('exact allowlisted network classification: '+cause,async()=>{
        let count=0;globalThis.fetch=async()=>{count++;throw Object.assign(new TypeError('RAW_PRIVATE_EXCEPTION '+token),{cause:{code:cause,message:token}});};
        const result=await send();assert(!result.ok);assert.equal(result.diagnostic.code,code);assert.equal(result.diagnostic.phase,'request');assert.equal(count,1);assert.equal(result.retryAfter,undefined);noLeak([result,warnings]);
      });
    }
    await test('unknown AbortError without our own deadline is not falsely reported as a timeout',async()=>{
      globalThis.fetch=async()=>{throw new DOMException('RAW_PRIVATE_EXCEPTION '+token,'AbortError');};
      assert.equal((await send()).diagnostic.code,'FETCH_FAILED');
    });
    await test('our deadline aborts fetch, clears timer, records timeout and never retries',async()=>{
      const set=globalThis.setTimeout,clear=globalThis.clearTimeout;let budget,cleared=0,count=0;
      globalThis.setTimeout=(fn,ms)=>{budget=ms;queueMicrotask(fn);return 424242;};globalThis.clearTimeout=()=>cleared++;
      globalThis.fetch=async(_url,{signal})=>{count++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('RAW_PRIVATE_EXCEPTION '+token)),{once:true}));};
      try{const result=await send();assert.equal(result.diagnostic.code,'NETWORK_TIMEOUT');assert.equal(result.diagnostic.phase,'request');assert.equal(result.retryAfter,undefined);assert.equal(budget,12000);assert.equal(count,1);assert.equal(cleared,1);noLeak(result);}
      finally{globalThis.setTimeout=set;globalThis.clearTimeout=clear;}
    });
    await test('missing runtime abort capability is classified before sending',async()=>{
      const Controller=globalThis.AbortController;let count=0;
      globalThis.fetch=async()=>{count++;throw Error('must not send');};globalThis.AbortController=undefined;
      try{const result=await send();assert.equal(result.diagnostic.code,'RUNTIME_UNAVAILABLE');assert.equal(result.diagnostic.phase,'setup');assert.equal(count,0);}
      finally{globalThis.AbortController=Controller;}
    });
    await test('setup error is not a network/token error',async()=>{
      const Controller=globalThis.AbortController;
      globalThis.AbortController=class{constructor(){throw Error('RAW_PRIVATE_EXCEPTION '+token);}};
      try{assert.equal((await send()).diagnostic.code,'REQUEST_SETUP_FAILED');}finally{globalThis.AbortController=Controller;}
    });
    await test('redirect is reported with safe reference and never followed',async()=>{
      calls=[];globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return new Response('RAW_PRIVATE_BODY '+token,{status:302,headers:{Location:'https://not-allowed.test/'+token}});};
      const result=await send();assert.equal(result.diagnostic.code,'REDIRECT_BLOCKED');assert.equal(result.diagnostic.httpStatus,302);assert.equal(calls.length,1);assert.equal(calls[0].opts.redirect,'manual');noLeak([result,warnings]);
    });
    await test('body stream failure is distinguished from request/parse failures',async()=>{
      globalThis.fetch=async()=>({status:200,text:async()=>{throw new Error('RAW_PRIVATE_EXCEPTION '+token);}});
      const result=await send();assert.equal(result.diagnostic.code,'BODY_READ_FAILED');assert.equal(result.diagnostic.phase,'body');noLeak(result);
    });
    for (const [name,data,status] of [['HTML upstream response','RAW_PRIVATE_BODY '+token,502],['broken JSON','{"ok":',200],['missing success result','{"ok":true}',200],['missing message ID','{"ok":true,"result":{"id":42}}',200],['oversized JSON',JSON.stringify({ok:true,result:{message_id:1},padding:'p'.repeat(65536)}),200]]) {
      await test(name+' yields INVALID_RESPONSE with HTTP, not NETWORK_UNKNOWN',async()=>{
        globalThis.fetch=async()=>new Response(data,{status});const result=await send();assert.equal(result.diagnostic.code,'INVALID_RESPONSE');assert.equal(result.diagnostic.httpStatus,status);assert.equal(result.retryAfter,undefined);noLeak(result);
      });
    }
    for(const [status,code] of [[401,'INVALID_TOKEN'],[404,'INVALID_TOKEN'],[400,'INVALID_CHAT'],[403,'FORBIDDEN'],[503,'PROVIDER_ERROR']]) {
      await test('provider JSON rejection '+status+' is safe '+code,async()=>{
        globalThis.fetch=async()=>response({ok:false,error_code:status,description:'RAW_PRIVATE_BODY '+token},status);
        const result=await send();assert.equal(result.diagnostic.code,code);assert.equal(result.diagnostic.httpStatus,status);assert.equal(result.retryAfter,undefined);noLeak([result,warnings]);
      });
    }
    await test('explicit HTTP 429 is the sole automatic-retry category, with bounded delay',async()=>{
      globalThis.fetch=async()=>response({ok:false,error_code:429,parameters:{retry_after:999999},description:token},429);
      const result=await send();assert.equal(result.diagnostic.code,'RATE_LIMITED');assert.equal(result.retryAfter,86400);noLeak(result);
    });
    await test('bad bot identity stops before getChat, with no queue writes or raw provider body',async()=>{
      await setup();calls=[];globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return response({ok:false,error_code:401,description:'RAW_PRIVATE_BODY '+token},401);};
      const report=await m.diagnoseFallback(env,'telegram');assert(!report.ready);assert.equal(report.checks.length,1);assert.equal(report.checks[0].code,'INVALID_TOKEN');assert.equal(calls.length,1);assert.equal(rows().length,0);noLeak([report,warnings]);
    });
    await test('valid bot plus rejected chat isolates the chat stage',async()=>{
      await setup();globalThis.fetch=async(url)=>response(String(url).endsWith('/getMe')?{ok:true,result:{id:42}}:{ok:false,error_code:400,description:token},String(url).endsWith('/getMe')?200:400);
      const report=await m.diagnoseFallback(env,'bale');assert(!report.ready);assert.deepEqual(report.checks.map(c=>c.code),['BOT_REACHABLE','INVALID_CHAT']);noLeak(report);
    });
    await test('encrypted credentials remain usable when fallback delivery is off; env token takes precedence',async()=>{
      await setup();env.TELEGRAM_BOT_TOKEN='999999:'+'z'.repeat(32);success();const report=await m.diagnoseFallback(env,'telegram');assert(report.ready);assert(calls.every(c=>c.url.includes('/bot'+env.TELEGRAM_BOT_TOKEN+'/')));assert.equal(rows().length,0);assert(!JSON.stringify(report).includes(env.TELEGRAM_BOT_TOKEN));
    });
    await test('API admin probe does not wake queued work or notify actions, even with notifications enabled',async()=>{
      await setup();await m.enqueueFallback(env,{...params,type:'probe-test'},'test');const before=rows();assert.equal(before.length,2);
      const {r,body,waits}=await probe();assert.equal(r.status,200);assert(body.data.ready);assert.equal(body.data.messageSent,false);assert.equal(waits.length,0);assert.deepEqual(rows(),before);assert.equal(calls.length,2);assert(calls.every(c=>!/sendMessage|getUpdates|Webhook/.test(c.url)));
      const audit=db.prepare("SELECT * FROM admin_logs WHERE action='fallback_diagnose'").all();assert.equal(audit.length,1);noLeak([body,audit,warnings]);
    });
    await test('API authentication and role checks reject anonymous/staff before touching provider',async()=>{
      await setup();for(const [opts,status] of [[{anonymous:true},401],[{role:'staff'},403]]){const {r}=await probe(opts);assert.equal(r.status,status);}assert.equal(calls.length,0);assert.equal(rows().length,0);
    });
    await test('API cross-origin write is forbidden without provider request',async()=>{
      await setup();assert.equal((await probe({origin:'https://attacker.test'})).r.status,403);assert.equal(calls.length,0);
    });
    await test('API missing/invalid channel and JSON are rejected; oversized body capped',async()=>{
      for(const opts of [{body:{channel:'https://attacker.test'}},{body:{channel:'eitaa'}},{body:[]},{rawBody:'{'}]){await setup();assert.equal((await probe(opts)).r.status,400);assert.equal(calls.length,0);}
      await setup();assert.equal((await probe({rawBody:'x'.repeat(17000)})).r.status,413);assert.equal(calls.length,0);
    });
    await test('API three probes/minute and then Retry-After; no fourth remote call',async()=>{
      await setup();for(let i=0;i<3;i++)assert.equal((await probe()).r.status,200);
      const {r,body}=await probe();assert.equal(r.status,429);assert.equal(body.code,'RATE_LIMITED');assert(Number(r.headers.get('Retry-After'))>0);assert.equal(calls.length,6);assert.equal(rows().length,0);
    });
    await test('API config/decryption failure is safe and never sends or alters saved credentials',async()=>{
      await setup();const stored=await m.loadFallbackConfig(env);env.FALLBACK_ENCRYPTION_KEY=Buffer.alloc(32,9).toString('base64');
      const {r,body}=await probe();assert.equal(r.status,400);assert.equal(body.code,'FALLBACK_CONFIG_ERROR');assert.equal(calls.length,0);assert.deepEqual(await m.loadFallbackConfig(env),stored);noLeak(body);
    });
    await test('API error report returns safe phase/code/reference, never upstream secrets',async()=>{
      await setup();globalThis.fetch=async()=>{throw Error('RAW_PRIVATE_EXCEPTION https://api.telegram.org/bot'+token+'/getMe');};
      const {r,body}=await probe();assert.equal(r.status,200);assert(!body.data.ready);assert.equal(body.data.checks[0].code,'FETCH_FAILED');assert.equal(body.data.checks[0].diagnostic.phase,'request');noLeak([body,warnings]);assert.equal(rows().length,0);
    });
    await test('read-only probe has separate 6-second deadline per stage, without retries',async()=>{
      await setup();const set=globalThis.setTimeout,clear=globalThis.clearTimeout;let budget,count=0;
      globalThis.setTimeout=(fn,ms)=>{budget=ms;queueMicrotask(fn);return 424242;};globalThis.clearTimeout=()=>{};
      globalThis.fetch=async(_url,{signal})=>{count++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('RAW_PRIVATE_EXCEPTION '+token)),{once:true}));};
      try{const report=await m.diagnoseFallback(env,'telegram');assert(!report.ready);assert.equal(report.checks[0].code,'NETWORK_TIMEOUT');assert.equal(budget,6000);assert.equal(count,1);assert.equal(rows().length,0);noLeak(report);}
      finally{globalThis.setTimeout=set;globalThis.clearTimeout=clear;}
    });
    await test('malformed successful getMe is not accepted as a working bot',async()=>{
      await setup();calls=[];globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return response({ok:true,result:{username:'RAW_PRIVATE_BODY '+token}});};
      const report=await m.diagnoseFallback(env,'telegram');assert(!report.ready);assert.equal(report.checks[0].code,'INVALID_RESPONSE');assert.equal(calls.length,1);noLeak(report);
    });
    await test('API fails closed on unavailable D1 rate limiter with a specific 503',async()=>{
      await setup();const prepare=env.DB.prepare;
      env.DB.prepare=query=>{if(query.includes('INSERT INTO rate_limits'))throw Error('simulated database unavailable');return prepare(query);};
      const {r,body}=await probe();assert.equal(r.status,503);assert.equal(body.code,'DIAGNOSIS_UNAVAILABLE');assert.equal(calls.length,0);assert.equal(rows().length,0);
    });
    console.log(`\n${passed}/${passed} messenger diagnostic checks passed (mocked providers; actual Worker/SQLite/WebCrypto).`);
  } finally { globalThis.fetch=originalFetch;console.warn=originalWarn; }
} finally { await rm(dir,{recursive:true,force:true}); }
