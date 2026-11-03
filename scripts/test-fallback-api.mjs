/** Run ONLY on disposable local D1. Never sends a real messenger request. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
function localSQL(command) { execFileSync('npx',['wrangler','d1','execute','cafe-club-db','--local','--command',command],{stdio:'pipe'}); }
const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Local test only');
async function call(path, {cookie='',method='GET',body,origin}={}) {
  const headers = {Cookie:cookie};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(origin)headers.Origin=origin;
  const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
  const json=await response.json().catch(()=>null);return {response,json};
}
async function login(phone,password) {
  const {response}=await call('/api/auth/login',{method:'POST',body:{phone,password}});
  assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
}
const admin=await login('09120000000','Admin@12345');
const staff=await login('09120000001','Staff@12345');
let passed=0;
async function test(name,fn){await fn();passed++;console.log('✅ '+name);}
await test('unauthenticated fallback settings API is protected',async()=>{assert.equal((await call('/api/admin/fallback')).response.status,401);});
await test('staff cannot read/update history or settings',async()=>{
  for(const path of ['/api/admin/fallback','/api/admin/fallback/history'])assert.equal((await call(path,{cookie:staff})).response.status,403);
  assert.equal((await call('/api/admin/fallback',{cookie:staff,method:'PUT',body:{enabled:false,channels:[]}})).response.status,403);
});
await test('CSRF cross-origin write blocked',async()=>{
  assert.equal((await call('/api/admin/fallback',{cookie:admin,method:'PUT',body:{enabled:false,channels:[]},origin:'https://evil.invalid'})).response.status,403);
});
await test('admin can read empty config and history',async()=>{
  const result=await call('/api/admin/fallback',{cookie:admin});assert.equal(result.response.status,200);
  assert.equal(result.json.data.channels.length,0);assert.equal((await call('/api/admin/fallback/history',{cookie:admin})).response.status,200);
  assert.equal(result.json.data.encryptionKeyConfigured,true,'add a generated FALLBACK_ENCRYPTION_KEY to ignored .dev.vars and restart');
});
// Hold dispatch lease while testing 202 acceptance: the fake credential can never reach a provider.
localSQL("UPDATE fallback_dispatch SET until_ms="+(Date.now()+120000)+",owner='api-test'; DELETE FROM rate_limits WHERE key LIKE 'fallback:test:%'");
const fakeToken='123456:'+'q'.repeat(32); // deliberately fake; never sent
try {
  await test('D1 atomic configuration save with encrypted token and masked API/HTML',async()=>{
    const result=await call('/api/admin/fallback',{cookie:admin,method:'PUT',body:{enabled:false,channels:[{channel:'telegram',chatId:'123456',token:fakeToken}]}});
    assert.equal(result.response.status,200);
    const read=await call('/api/admin/fallback',{cookie:admin});assert.equal(read.json.data.channels[0].hasToken,true);
    assert(!JSON.stringify(read.json).includes(fakeToken));
    const html=await (await fetch(base+'/admin/settings',{headers:{Cookie:admin}})).text();assert(!html.includes(fakeToken));
  });
  await test('sensitive fallback config excluded from JSON backup',async()=>{
    const {response,json}=await call('/admin/export/backup.json',{cookie:admin});assert.equal(response.status,200);
    assert(!('sms_fallback_config' in json.settings));assert(!JSON.stringify(json).includes(fakeToken));
  });
  await test('unsupported adapter, bad chat and duplicate channel rejected',async()=>{
    for(const channels of [[{channel:'eitaa',chatId:'1',token:fakeToken}],[{channel:'telegram',chatId:'https://evil.invalid',token:fakeToken}],
      [{channel:'telegram',chatId:'1',token:fakeToken},{channel:'telegram',chatId:'2',token:fakeToken}]]) {
      assert.equal((await call('/api/admin/fallback',{cookie:admin,method:'PUT',body:{enabled:true,channels}})).response.status,400);
    }
    assert.equal((await call('/api/admin/fallback',{cookie:admin})).json.data.channels[0].chatId,'123456');
  });
  await test('enable, preserve blank token, disable (no job, no network send)',async()=>{
    const body={enabled:true,channels:[{channel:'telegram',chatId:'123456',token:''}]};
    assert.equal((await call('/api/admin/fallback',{cookie:admin,method:'PUT',body})).response.status,200);
    assert.equal((await call('/api/admin/fallback',{cookie:admin})).json.data.enabled,true);
    assert.equal((await call('/api/admin/fallback',{cookie:admin,method:'PUT',body:{...body,enabled:false}})).response.status,200);
  });
  await test('test endpoint returns 202 and durable D1 job without network wait',async()=>{
    const result=await call('/api/admin/fallback/test',{cookie:admin,method:'POST',body:{channel:'telegram'}});
    assert.equal(result.response.status,202);assert.equal(result.json.data.ids.length,1);
    const history=await call('/api/admin/fallback/history',{cookie:admin});
    const job=history.json.data.items.find(j=>j.id===result.json.data.ids[0]);assert.equal(job.status,'pending');assert.equal(job.reason,'test');
    assert(job.content.message.includes('تست اتصال'));assert(!JSON.stringify(job).includes(fakeToken));
  });
  await test('invalid test channel rejected and test endpoint rate-limited (no send)',async()=>{
    // Missing/invalid channels never enqueue a job.
    for(let i=0;i<2;i++)assert.equal((await call('/api/admin/fallback/test',{cookie:admin,method:'POST',body:i===0?null:{channel:'eitaa'}})).response.status,400);
    assert.equal((await call('/api/admin/fallback/test',{cookie:admin,method:'POST',body:{channel:'eitaa'}})).response.status,429);
  });
} finally {
  const restored=await call('/api/admin/fallback',{cookie:admin,method:'PUT',body:{enabled:false,channels:[]}});
  assert.equal(restored.response.status,200);
  localSQL("UPDATE fallback_dispatch SET until_ms=0,owner=NULL");
}
console.log(`\n${passed}/${passed} local Worker + D1 API checks passed.`);
