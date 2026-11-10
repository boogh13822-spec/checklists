/** Login regressions: real SQLite/Worker routes, legacy upgrades and native form navigation. No external network. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'login-tests-'));
try {
  const file = join(dir, 'module.mjs');
  await build({ stdin: { contents: `export { createToken, resetRateLimit, loginDestination, getActiveUser } from './src/lib/auth'; export { loginPage } from './src/ui/public'; export { DEFAULT_SETTINGS, invalidateSettingsCache } from './src/lib/settings'; export { default as worker } from './src/index';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: file });
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
    m.resetRateLimit('login:local:09120000000');
    if (db) db.close();
    const next=database();db=next.db;
    env={DB:next.api, JWT_SECRET:'local-test-only-not-real-0123456789abcdef'};
  }
  globalThis.fetch=async()=>{throw new Error('Unexpected external network in login test');};

  async function http(path,{method='GET',body,cookie='',https=false,headers={}}={}) {
    const tasks=[];const r=await m.worker.fetch(new Request((https?'https':'http')+'://app.test'+path,{method,headers:{'Content-Type':body instanceof URLSearchParams?'application/x-www-form-urlencoded':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:body instanceof URLSearchParams?body.toString():JSON.stringify(body)}:{})}),env,{waitUntil:p=>tasks.push(p)});
    await Promise.all(tasks);const text=await r.text();return {response:r,text,json:r.headers.get('content-type')?.includes('application/json')?JSON.parse(text):null};
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
    reset();const l=await login();const cookie=l.response.headers.get('set-cookie').split(';')[0];const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const s=prepare(q);if(q.includes('SELECT * FROM users WHERE id'))s.first=async()=>{throw new Error('simulated DB outage');};return s;};
    const s=await http('/api/auth/session',{cookie});assert.equal(s.response.status,503);assert.equal(s.json.code,'SESSION_UNAVAILABLE');assert.equal(s.response.headers.get('set-cookie'),null);
    env.DB.prepare=prepare;assert.equal((await http('/api/auth/session',{cookie})).json.data.authenticated,true);
  });
  await test('revoked sessions remain rejected and null login bodies return 400',async()=>{
    reset();const l=await login();const cookie=l.response.headers.get('set-cookie').split(';')[0];db.prepare('UPDATE users SET token_version=token_version+1 WHERE id=?').run(l.json.data.userId);assert.equal((await http('/api/auth/session',{cookie})).json.data.authenticated,false);
    assert.equal((await http('/api/auth/login',{method:'POST',body:null})).response.status,400);
  });

  await test('legacy DB without optional loyalty fields accepts login and the resulting session',async()=>{
    reset();db.exec('ALTER TABLE users DROP COLUMN lifetime_points; ALTER TABLE users DROP COLUMN sms_opt_in;');
    const l=await login();const cookie=l.response.headers.get('set-cookie').split(';')[0];
    const s=await http('/api/auth/session',{cookie});assert.equal(s.response.status,200);assert.equal(s.json.data.authenticated,true);
  });

  const credentials={phone:'09120000000',password:'Admin@12345'};
  function legacy(){db.exec('ALTER TABLE users DROP COLUMN token_version; ALTER TABLE users DROP COLUMN lifetime_points; ALTER TABLE users DROP COLUMN sms_opt_in;');}
  function hasVersion(){return db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='token_version');}
  function native(body=credentials,extra={}){return http('/login',{method:'POST',body:new URLSearchParams(body),...extra});}
  await test('native form sets one secure cookie, then server confirms it and reaches role-bound destination',async()=>{
    reset();const l=await native({...credentials,next:'/admin/settings?tab=menu'},{https:true});assert.equal(l.response.status,303);assert.match(l.response.headers.get('cache-control'),/no-store/);assert.equal(l.response.headers.getSetCookie().length,1);
    const cookie=l.response.headers.get('set-cookie').split(';')[0];const target=l.response.headers.get('location');assert(!target.includes(credentials.password));const done=await http(target,{cookie,https:true});assert.equal(done.response.status,303);assert.equal(done.response.headers.get('location'),'/admin/settings?tab=menu');assert.equal(done.response.headers.get('x-app-build'),'auth-native-v3');
  });
  await test('legacy login adds only session version, preserves all user data and records the additive upgrade once',async()=>{
    reset();legacy();const before=db.prepare('SELECT * FROM users ORDER BY id').all();const l=await login();assert(hasVersion());const after=db.prepare('SELECT * FROM users ORDER BY id').all();assert.deepEqual(JSON.parse(JSON.stringify(after.map(({token_version,...row})=>row))),JSON.parse(JSON.stringify(before)));assert(after.every(r=>r.token_version===0));
    const cookie=l.response.headers.get('set-cookie').split(';')[0];assert.equal((await http('/api/auth/session',{cookie})).json.data.authenticated,true);await login();assert.equal(db.prepare("SELECT COUNT(*) c FROM admin_logs WHERE action='auth_schema_upgrade'").get().c,1);
    assert(!db.prepare('PRAGMA table_info(users)').all().some(c=>['lifetime_points','sms_opt_in'].includes(c.name)));
  });
  await test('valid pre-upgrade signed session can upgrade version and remain authenticated',async()=>{
    reset();legacy();const token=await m.createToken(env.JWT_SECRET,{id:1,name:'legacy',role:'admin'});const s=await http('/api/auth/session',{cookie:'cc_session='+token});assert.equal(s.json.data.authenticated,true);assert(hasVersion());
  });
  await test('two concurrent legacy logins tolerate only duplicate-column race and both authenticate',async()=>{
    reset();legacy();const results=await Promise.all([login(),login()]);for(const l of results){const cookie=l.response.headers.get('set-cookie').split(';')[0];assert.equal((await http('/api/auth/session',{cookie})).json.data.authenticated,true);}assert.equal(db.prepare("SELECT COUNT(*) c FROM admin_logs WHERE action='auth_schema_upgrade'").get().c,1);
  });
  await test('anonymous and bad-password requests never upgrade the DB',async()=>{
    reset();legacy();assert.equal((await http('/api/auth/session')).json.data.authenticated,false);assert.equal((await http('/auth/complete')).response.status,401);assert.equal((await native({...credentials,password:'wrong'})).response.status,401);assert(!hasVersion());
  });
  await test('inactive account with correct password cannot trigger migration or receive a cookie',async()=>{
    reset();legacy();db.prepare('UPDATE users SET is_active=0 WHERE id=1').run();const r=await native();assert.equal(r.response.status,403);assert.equal(r.response.headers.get('set-cookie'),null);assert(!hasVersion());
  });
  await test('DDL failure is a server/schema error, never a successful login or a wiped DB',async()=>{
    reset();legacy();const before=db.prepare('SELECT * FROM users').all();const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const stmt=prepare(q);if(q.startsWith('ALTER TABLE'))stmt.run=async()=>{throw new Error('simulated D1 read-only');};return stmt;};
    const r=await http('/api/auth/login',{method:'POST',body:credentials});assert.equal(r.response.status,503);assert.equal(r.json.code,'AUTH_SCHEMA_UNAVAILABLE');assert.equal(r.response.headers.get('set-cookie'),null);assert.deepEqual(db.prepare('SELECT * FROM users').all(),before);
  });
  await test('corrupt negative session version fails closed without resetting it',async()=>{
    reset();db.prepare('UPDATE users SET token_version=-1 WHERE id=1').run();const r=await http('/api/auth/login',{method:'POST',body:credentials});assert.equal(r.response.status,503);assert.equal(r.response.headers.get('set-cookie'),null);assert.equal(db.prepare('SELECT token_version v FROM users WHERE id=1').get().v,-1);
  });
  await test('password change racing with legacy repair cannot mint a token from the old password',async()=>{
    reset();legacy();const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const stmt=prepare(q);if(q.startsWith('ALTER TABLE')){const run=stmt.run.bind(stmt);stmt.run=async()=>{const r=await run();db.prepare("UPDATE users SET password_hash='changed-concurrently',token_version=1 WHERE id=1").run();return r;};}return stmt;};
    const r=await http('/api/auth/login',{method:'POST',body:credentials});assert.equal(r.response.status,401);assert.equal(r.json.code,'CREDENTIALS_CHANGED');assert.equal(r.response.headers.get('set-cookie'),null);
  });
  await test('concurrent revocation during repair is re-read, not overwritten with zero',async()=>{
    reset();legacy();const token=await m.createToken(env.JWT_SECRET,{id:1,name:'legacy',role:'admin'});const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const stmt=prepare(q);if(q.startsWith('ALTER TABLE'))stmt.run=async()=>{db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');db.prepare('UPDATE users SET token_version=2 WHERE id=1').run();throw new Error('D1_ERROR: duplicate column name: token_version: SQLITE_ERROR');};return stmt;};
    const r=await http('/api/auth/session',{cookie:'cc_session='+token});assert.equal(r.json.data.authenticated,false);assert.equal(db.prepare('SELECT token_version v FROM users WHERE id=1').get().v,2);
  });
  await test('native wrong-password response preserves phone, never echoes password, and supports retry',async()=>{
    reset();const r=await native({...credentials,password:'not-the-secret-<script>'});assert.equal(r.response.status,401);assert.match(r.text,/اشتباه/);assert(r.text.includes('value="09120000000"'));assert(!r.text.includes('not-the-secret'));assert(!r.text.includes('disabled='));assert.equal((await native()).response.status,303);
  });
  await test('normal form handles Persian and Arabic digits and international phone format on the server',async()=>{
    for(const phone of ['۰۹۱۲۰۰۰۰۰۰۰','٠٩١٢٠٠٠٠٠٠٠','+98 912 000 0000','00989120000000']){reset();assert.equal((await native({...credentials,phone})).response.status,303,phone);}
  });
  await test('native form works without any JS auth fetch, API helper or session-probe gate',async()=>{
    const html=m.loginPage(m.DEFAULT_SETTINGS,'/admin/settings',false,'cookie');assert.match(html,/<form[^>]*method="post"[^>]*action="\/login"[^>]*target="_top"/);assert.match(html,/name="phone"/);assert.match(html,/name="password"/);assert.match(html,/name="next" value="\/admin\/settings"/);assert(!html.includes('confirmSession'));assert(!html.includes('ورود کامل نشد'));assert(!html.includes('login-open'));assert(!html.includes('Incognito'));
  });
  await test('form/JSON login both reject cross-origin including same host over wrong scheme',async()=>{
    reset();for(const path of ['/login','/api/auth/login'])for(const headers of [{Origin:'https://evil.test'},{Origin:'https://app.test'},{'Sec-Fetch-Site':'cross-site'}]){const r=await http(path,{method:'POST',body:path==='/login'?new URLSearchParams(credentials):credentials,headers});assert.equal(r.response.status,403);assert.equal(r.response.headers.get('set-cookie'),null);}
    assert.equal((await native(credentials,{headers:{Origin:'http://app.test','Sec-Fetch-Site':'same-origin'}})).response.status,303);
  });
  await test('safe navigation rejects external, backslash, traversal and role-prefix lookalikes',async()=>{
    for(const next of ['//evil.test','/\\evil.test','https://evil.test','/administrator','/staff','/admin/../../staff','/admin\nInjected: x','/admin/../staff'])assert.equal(m.loginDestination(next,'admin'),'/admin',next);
    assert.equal(m.loginDestination('/staffing','staff'),'/staff');assert.equal(m.loginDestination('/admin/settings?x=1','admin'),'/admin/settings?x=1');
  });
  await test('completion without valid cookie is denied and never redirects to protected data',async()=>{
    reset();for(const cookie of ['', 'cc_session=forged.jwt.token']){const r=await http('/auth/complete?next=/admin',{cookie});assert.equal(r.response.status,401);assert.equal(r.response.headers.get('location'),null);assert.match(r.text,/نشست معتبر دریافت نشد/);}assert.equal((await http('/api/admin/stats')).response.status,401);
  });
  await test('DB outage yields 503 not fake logout across completion, protected page, protected API and auth/me',async()=>{
    reset();const l=await login();const cookie=l.response.headers.get('set-cookie').split(';')[0];const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const s=prepare(q);if(q.includes('SELECT * FROM users WHERE id'))s.first=async()=>{throw new Error('simulated lookup outage');};return s;};
    for(const path of ['/auth/complete?next=/admin','/admin','/api/admin/stats','/api/auth/me']){const r=await http(path,{cookie});assert.equal(r.response.status,503,path);assert.equal(r.response.headers.get('location'),null);assert.equal(r.response.headers.get('set-cookie'),null);}
  });
  await test('initial account DB outage returns a useful 503 on native form, without cookie',async()=>{
    reset();const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=q=>{const s=prepare(q);if(q.includes('FROM users'))s.first=async()=>{throw new Error('simulated DB outage');};return s;};const r=await native();assert.equal(r.response.status,503);assert.match(r.text,/خواندن حساب از دیتابیس/);assert.equal(r.response.headers.get('set-cookie'),null);
  });
  await test('malformed bodies, non-string credentials and oversized form/JSON fail safely',async()=>{
    reset();for(const body of [null,[],{phone:[],password:'x'},{phone:credentials.phone,password:{}}])assert.equal((await http('/api/auth/login',{method:'POST',body})).response.status,400);
    for(const path of ['/login','/api/auth/login']){const body={...credentials,password:'x'.repeat(17000)};assert.equal((await http(path,{method:'POST',body:path==='/login'?new URLSearchParams(body):body})).response.status,413);}
  });
  await test('form and API share failed-login rate limit; retry header is preserved',async()=>{
    reset();for(let i=0;i<8;i++){const r=await (i%2?native({...credentials,password:'wrong'}):http('/api/auth/login',{method:'POST',body:{...credentials,password:'wrong'}}));assert.equal(r.response.status,401);}
    const r=await native();assert.equal(r.response.status,429);assert(Number(r.response.headers.get('retry-after'))>0);assert.equal(r.response.headers.get('set-cookie'),null);
  });
  await test('health exposes deployment build identifier but no secret or credentials',async()=>{
    reset();const r=await http('/api/health');assert.equal(r.json.data.build,'auth-native-v3');assert(!r.text.includes(env.JWT_SECRET));assert(!r.text.includes(credentials.password));
  });
  await test('legacy native login completes all server redirects and renders the actual dashboard',async()=>{
    reset();legacy();const l=await native();assert.equal(l.response.status,303);const cookie=l.response.headers.get('set-cookie').split(';')[0];const done=await http(l.response.headers.get('location'),{cookie});assert.equal(done.response.status,303);const dashboard=await http(done.response.headers.get('location'),{cookie});assert.equal(dashboard.response.status,200);assert.match(dashboard.text,/text\/javascript|<script/);
  });
  await test('completion cannot mistake a valid different account for the intended sign-in identity',async()=>{
    reset();const l=await login();const cookie=l.response.headers.get('set-cookie').split(';')[0];const r=await http('/auth/complete?uid=2&next=/admin',{cookie});assert.equal(r.response.status,401);assert.equal(r.response.headers.get('location'),null);
  });
  await test('form feedback and redirect fields are HTML escaped and never create inline code',async()=>{
    const html=m.loginPage(m.DEFAULT_SETTINGS,'/admin/"<script>INJECTED</script>',false,'',{message:'<script>ERROR_INJECTED</script>',phone:'" onfocus="INJECTED'});assert(!html.includes('<script>INJECTED'));assert(!html.includes('<script>ERROR_INJECTED'));assert(html.includes('&lt;script&gt;ERROR_INJECTED'));
  });
  console.log(`\n${passed}/${passed} login regression checks passed.`);
} finally { await rm(dir,{recursive:true,force:true}); }
