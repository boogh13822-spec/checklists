/** Disposable LEGACY local D1 only. Run against a separately prepared old DB on port 8788.
 * Uses the same optional Chromium tools as test-browser.mjs. No real provider/CDN traffic.
 */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
const tools=createRequire(join(resolve(process.env.BROWSER_TOOLS_DIR||'.cache/browser-tools'),'package.json'));
const {default:chromium}=await import(pathToFileURL(tools.resolve('@sparticuz/chromium')));
const playwrightModule=await import(pathToFileURL(tools.resolve('playwright-core')));
const playwright=playwrightModule.chromium||playwrightModule.default.chromium;
const BASE=process.env.BASE_URL||'http://127.0.0.1:8788';
assert(['localhost','127.0.0.1'].includes(new URL(BASE).hostname),'Use disposable LOCAL D1 only');
const dir=await mkdtemp(join(tmpdir(),'recovery-browser-'));let browser,passed=0,snapshot;
async function test(name,fn){await fn();passed++;console.log('✅ '+name);}
try{
  const archive=join(dir,'libraries.tar');await writeFile(archive,brotliDecompressSync(await readFile(join(dirname(tools.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'))));execFileSync('tar',['-xf',archive,'-C',dir]);
  browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!['--disable-web-security','--disable-site-isolation-trials','--single-process'].includes(a)),env:{...process.env,LD_LIBRARY_PATH:join(dir,'lib')+':'+(process.env.LD_LIBRARY_PATH||'')},headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
  await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(BASE).origin?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await test('native login on legacy D1 reaches a working recovery page, not a 500',async()=>{
    await page.goto(BASE+'/login');await page.locator('#phone').fill('09120000000');await page.locator('#password').fill('Admin@12345');await page.locator('#login-btn').click();await page.waitForURL(BASE+'/admin/system');assert((await page.locator('h1').innerText()).includes('ارتقای امن دیتابیس'));assert(await page.locator('#schema-upgrade').isDisabled());const r=await context.request.get(BASE+'/api/admin/system/schema');assert.equal((await r.json()).data.ready,false,'Legacy DB must be prepared before running this suite');
  });
  await test('previous valid session no longer redirects public home or login into a broken dashboard',async()=>{
    for(const path of ['/','/login','/me/login']){const r=await page.goto(BASE+path);assert.equal(r.status(),200);assert.equal(new URL(page.url()).pathname,path);}await page.goto(BASE+'/admin/system');
  });
  await test('no backup receipt means no schema mutation even for the logged-in admin',async()=>{
    const r=await context.request.post(BASE+'/api/admin/system/schema',{data:{confirmBackup:true,receipt:'forged'}});assert.equal(r.status(),409);assert(await page.locator('#schema-upgrade').isDisabled());
  });
  await test('private backup downloads successfully and confirmation remains required',async()=>{
    const downloading=page.waitForEvent('download');await page.locator('#schema-backup').click();const download=await downloading;const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);snapshot=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert(snapshot.data.users[0].password_hash);assert(!JSON.stringify(snapshot).includes('Admin@12345'));await page.waitForFunction(()=>!document.getElementById('schema-consent').disabled);assert(await page.locator('#schema-upgrade').isDisabled());
  });
  await test('explicit consent completes real staged D1 DDL and unlocks the dashboard',async()=>{
    await page.locator('#schema-consent').check();assert(!(await page.locator('#schema-upgrade').isDisabled()));await page.locator('#schema-upgrade').click();await page.waitForFunction(()=>document.getElementById('schema-message').textContent.includes('ساختار تکمیل شد'),null,{timeout:45000});const r=await context.request.get(BASE+'/api/admin/system/schema');assert.equal((await r.json()).data.ready,true);await page.locator('#schema-dashboard').click();await page.waitForURL(BASE+'/admin');
  });
  await test('old identities and invoice amounts survive the upgrade',async()=>{
    const r=await context.request.get(BASE+'/admin/export/backup.json');assert.equal(r.status(),200);const after=await r.json();assert.deepEqual(after.users.map(u=>[u.id,u.name,u.phone,u.points]),snapshot.data.users.map(u=>[u.id,u.name,u.phone,u.points]));assert.deepEqual(after.invoices.map(i=>[i.id,i.amount]),snapshot.data.invoices.map(i=>[i.id,i.amount]));
  });
  await test('all main admin/staff pages return 200 after upgrading the real old D1',async()=>{
    for(const path of ['/admin','/admin/customers','/admin/invoices','/admin/shifts','/admin/reports','/admin/settings','/admin/fallback','/admin/sms','/admin/logs','/admin/staff','/admin/coupons','/register','/me/login','/staff','/staff/history','/staff/shift']){const r=await page.goto(BASE+path);assert.equal(r.status(),200,path);}
  });
  await test('recovery and dashboard scripts have zero uncaught JS errors',async()=>assert.deepEqual(errors,[]));
  console.log(`\n${passed}/${passed} real Chromium legacy recovery checks passed (local D1, CDN blocked).`);
}finally{if(browser)await browser.close();await rm(dir,{recursive:true,force:true});}
