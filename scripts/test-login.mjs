/** Login regressions: real SQLite/Worker routes plus client-script VM. No live browser or external network. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'login-tests-'));
try {
  const file = join(dir, 'module.mjs');
  await build({ stdin: { contents: `export { loginPage } from './src/ui/public'; export { DEFAULT_SETTINGS, invalidateSettingsCache } from './src/lib/settings'; export { default as worker } from './src/index';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: file });
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
  function reset() {
    m.invalidateSettingsCache();
    const next=database();db=next.db;
    env={DB:next.api, JWT_SECRET:'local-test-only-not-real-0123456789abcdef'};
  }
  globalThis.fetch=async()=>{throw new Error('Unexpected external network in login test');};

  async function http(path,{method='GET',body,cookie='',https=false,headers={}}={}) {
    const tasks=[];const r=await m.worker.fetch(new Request((https?'https':'http')+'://app.test'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env,{waitUntil:p=>tasks.push(p)});
    await Promise.all(tasks);return {response:r,json:await r.json()};
  }
  async function login(options={}) {
    const r=await http('/api/auth/login',{method:'POST',body:{phone:'09120000000',password:'Admin@12345'},...options});assert.equal(r.response.status,200);return r;
  }
  await test('login response and fresh session refer to the same authenticated user',async()=>{
    reset();const l=await login();const cookie=l.response.headers.get('set-cookie').split(';')[0];const s=await http('/api/auth/session?_login_check=unique',{cookie});assert.equal(s.json.data.authenticated,true);assert.equal(s.json.data.userId,l.json.data.userId);assert.equal(s.json.data.role,l.json.data.role);assert(!JSON.stringify(l.json).includes('Admin@12345'));
  });
  await test('HTTPS cookie remains Secure, HttpOnly, host-only, SameSite Lax; stale cookie is replaced once',async()=>{
    reset();const l=await login({https:true,cookie:'cc_session=invalid.jwt.token'});const cookies=l.response.headers.getSetCookie();assert.equal(cookies.length,1);assert.match(cookies[0],/HttpOnly/i);assert.match(cookies[0],/Secure/i);assert.match(cookies[0],/SameSite=Lax/i);assert.match(cookies[0],/Path=\//i);assert(!/Domain=/i.test(cookies[0]));assert(!/Max-Age=0/i.test(cookies[0]));
  });
  await test('authentication responses are private from browser and CDN caches and vary by cookie',async()=>{
    reset();const l=await login();const cookie=l.response.headers.get('set-cookie').split(';')[0];for(const r of [l,await http('/api/auth/session?_login_check=1',{cookie})]){assert.match(r.response.headers.get('cache-control'),/no-store/);assert.equal(r.response.headers.get('cdn-cache-control'),'no-store');assert.equal(r.response.headers.get('cloudflare-cdn-cache-control'),'no-store');assert.match(r.response.headers.get('vary'),/Cookie/);}
  });
  await test('no cookie is not authentication; wrong password still returns 401 and CSRF still fails closed',async()=>{
    reset();const s=await http('/api/auth/session');assert.equal(s.json.data.authenticated,false);assert.equal(s.json.data.userId,null);
    assert.equal((await http('/api/auth/login',{method:'POST',body:{phone:'09120000000',password:'wrong'}})).response.status,401);
    assert.equal((await http('/api/auth/login',{method:'POST',body:{phone:'09120000000',password:'Admin@12345'},headers:{Origin:'https://evil.test'}})).response.status,403);
    assert.equal((await http('/api/admin/stats')).response.status,401);
  });
  await test('transient DB session lookup failure returns 503, preserves cookie, then recovers',async()=>{
    reset();const l=await login();const cookie=l.response.headers.get('set-cookie').split(';')[0];const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const s=prepare(q);if(q.includes('token_version, created_at')&&q.includes('FROM users WHERE id'))s.first=async()=>{throw new Error('simulated DB outage');};return s;};
    const s=await http('/api/auth/session',{cookie});assert.equal(s.response.status,503);assert.equal(s.json.code,'SESSION_UNAVAILABLE');assert.equal(s.response.headers.get('set-cookie'),null);
    env.DB.prepare=prepare;assert.equal((await http('/api/auth/session',{cookie})).json.data.authenticated,true);
  });
  await test('revoked sessions remain rejected and null login bodies return 400',async()=>{
    reset();const l=await login();const cookie=l.response.headers.get('set-cookie').split(';')[0];db.prepare('UPDATE users SET token_version=token_version+1 WHERE id=?').run(l.json.data.userId);assert.equal((await http('/api/auth/session',{cookie})).json.data.authenticated,false);
    assert.equal((await http('/api/auth/login',{method:'POST',body:null})).response.status,400);
  });

  const loginData={userId:1,role:'admin',name:'مدیر',redirect:'/admin'};
  const signedIn=(extra={})=>({ok:true,data:{authenticated:true,userId:1,role:'admin',...extra}});
  const responseJson=(body,status=200)=>({ok:status>=200&&status<300,json:async()=>body});
  function client({replies=[responseJson(signedIn())],post=async()=>loginData,next='',timeout=false}={}) {
    const nodes=new Map(),toasts=[],navigations=[],probes=[],posts=[];
    function node(id){if(!nodes.has(id))nodes.set(id,{value:id==='#phone'?'09120000000':id==='#password'?'Admin@12345':'',disabled:false,dataset:{},textContent:'',handlers:{},classList:{values:new Set(['hidden']),add(v){this.values.add(v);},remove(v){this.values.delete(v);},contains(v){return this.values.has(v);}},addEventListener(e,fn){this.handlers[e]=fn;}});return nodes.get(id);}
    const html=m.loginPage(m.DEFAULT_SETTINGS,next,false,'cookie');const block=[...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('async function confirmSession'));
    const sandbox={console,AbortController,URL,Date,Promise,Number,String,JSON,$:node,toast:(...a)=>toasts.push(a),api:async(path,opts)=>{posts.push({path,opts});return post();},setLoading:(btn,on)=>{btn.disabled=on;},setTimeout:(fn,ms)=>{const handle={cancelled:false};if(ms<1000||timeout)queueMicrotask(()=>{if(!handle.cancelled)fn();});return handle;},clearTimeout:h=>{h.cancelled=true;},fetch:async(url,opts)=>{const idx=probes.length;probes.push({url,opts});const reply=replies[Math.min(idx,replies.length-1)];if(typeof reply==='function')return reply(url,opts);if(reply instanceof Error)throw reply;return reply;}};
    sandbox.window={location:{replace:url=>navigations.push(url)}};vm.runInNewContext(block,sandbox);
    return {node,html,toasts,navigations,probes,posts,submit:()=>node('#login-form').handlers.submit({preventDefault(){}})};
  }
  await test('old cookie error URLs no longer render the accusatory banner or Incognito advice',async()=>{
    const c=client();assert(!c.html.includes('مرورگر کوکی ورود را ذخیره نکرد'));assert(!c.html.includes('Incognito'));assert(!c.html.includes('/login?e=cookie'));assert(c.html.includes('id="login-feedback"'));assert(c.html.includes('rel="noopener noreferrer"'));
  });
  await test('normal login navigates only after confirming same identity with a cache-busting, no-store probe',async()=>{
    const c=client({next:'/admin/settings'});await c.submit();assert.deepEqual(c.navigations,['/admin/settings']);assert.equal(c.posts.length,1);assert.equal(c.probes.length,1);assert.match(c.probes[0].url,/\?_login_check=/);assert.equal(c.probes[0].opts.cache,'no-store');assert.equal(c.probes[0].opts.credentials,'same-origin');assert.equal(c.probes[0].opts.redirect,'error');
  });
  await test('a transient negative or 503 response is retried without replaying credentials or showing cookie error',async()=>{
    for(const first of [responseJson({ok:true,data:{authenticated:false}}),responseJson({ok:false},503)]){const c=client({replies:[first,responseJson(signedIn())]});await c.submit();assert.equal(c.posts.length,1);assert.equal(c.probes.length,2);assert.deepEqual(c.navigations,['/admin']);assert.notEqual(c.probes[0].url,c.probes[1].url);assert.equal(c.toasts.length,1);}
  });
  await test('network and invalid JSON failures recover if a later session probe succeeds',async()=>{
    for(const first of [new Error('network down'),{ok:true,json:async()=>{throw new Error('not JSON');}}]){const c=client({replies:[first,responseJson(signedIn())]});await c.submit();assert.deepEqual(c.navigations,['/admin']);assert.equal(c.probes.length,2);}
  });
  await test('persistent blocked cookie stays on form with recovery link, exactly three probes and no false welcome',async()=>{
    const c=client({replies:[responseJson({ok:true,data:{authenticated:false}})]});await c.submit();assert.equal(c.probes.length,3);assert.equal(c.posts.length,1);assert.equal(c.navigations.length,0);assert.equal(c.toasts.length,0);assert.equal(c.node('#login-btn').disabled,false);assert(!c.node('#login-feedback').classList.contains('hidden'));assert(c.node('#login-feedback-text').textContent.includes('ورود کامل نشد'));await c.submit();assert.equal(c.posts.length,2);
  });
  await test('persistent network failure never counts as successful authentication',async()=>{
    const c=client({replies:[new Error('offline')]});await c.submit();assert.equal(c.probes.length,3);assert.equal(c.navigations.length,0);assert.equal(c.toasts.length,0);assert.equal(c.node('#login-btn').disabled,false);
  });
  await test('wrong-account or wrong-role stale responses cannot complete login',async()=>{
    for(const extra of [{userId:2},{role:'staff'}]){const c=client({replies:[responseJson(signedIn(extra))]});await c.submit();assert.equal(c.navigations.length,0);assert.equal(c.probes.length,3);}
  });
  await test('each hanging probe has an abort deadline and releases the form after bounded attempts',async()=>{
    const c=client({timeout:true,replies:[(_url,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('aborted'))))]});await c.submit();assert.equal(c.probes.length,3);assert(c.probes.every(p=>p.opts.signal.aborted));assert.equal(c.node('#login-btn').disabled,false);assert.equal(c.navigations.length,0);
  });
  await test('double submit sends credentials once; wrong credentials still show the actual error',async()=>{
    let release;const pending=new Promise(r=>release=r);const c=client({post:()=>pending});const a=c.submit(),b=c.submit();assert.equal(c.posts.length,1);release(loginData);await Promise.all([a,b]);assert.equal(c.navigations.length,1);
    const bad=client({post:async()=>{throw new Error('رمز اشتباه است');}});await bad.submit();assert.equal(bad.probes.length,0);assert.equal(bad.toasts[0][0],'رمز اشتباه است');assert.equal(bad.node('#login-btn').disabled,false);
  });
  await test('external next URLs and admin destinations for staff are not followed',async()=>{
    const external=client({next:'//evil.test'});await external.submit();assert.deepEqual(external.navigations,['/admin']);
    const staff=client({next:'/admin',post:async()=>({...loginData,userId:2,role:'staff',redirect:'/staff'}),replies:[responseJson(signedIn({userId:2,role:'staff'}))]});await staff.submit();assert.deepEqual(staff.navigations,['/staff']);
  });
  console.log(`\n${passed}/${passed} login regression checks passed (SQLite/Worker routes and client VM; not a live browser).`);
} finally { await rm(dir,{recursive:true,force:true}); }
