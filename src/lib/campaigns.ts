/** Resumable admin-only campaign preparation. No customer SMS and no uncertain replay. */
import type {AppSettings, Bindings, UserRow} from '../types';
import {createCoupon, tierLabel} from './db';
import {loadFallbackConfig} from './fallback';
import {fetchWeather, renderSms, sendSms} from './sms';
import {daysSince,formatJalali,todayISO,todayJalali,toJalali,toGregorian,toPersianDigits,utcStamp} from './utils';
import type {JobResult} from './jobs';
type Campaign='birthday'|'churn'|'weather';
type Progress={job:Campaign;day:string;cursor:number;queued:number;scanned:number;status:string;context:string|null;owner:string|null};
export async function startAdminCampaign(env:Bindings,settings:AppSettings,job:Campaign):Promise<JobResult>{
  const day=todayISO();
  const existing=await env.DB.prepare('SELECT * FROM campaign_progress WHERE job=?').bind(job).first<Progress>();
  if(!existing || existing.day!==day){
    let context:string|null=null;
    if(job==='weather'){
      const weather=await fetchWeather(env,settings);
      if(!weather.ok)return {job,ok:false,sent:0,failed:1,skipped:0,message:'آب‌وهوا دریافت نشد؛ کمپین ایجاد نشد.'};
      context=JSON.stringify(weather);
    }
    await env.DB.prepare(`INSERT INTO campaign_progress(job,day,context) VALUES(?,?,?) ON CONFLICT(job) DO UPDATE SET
      day=excluded.day,context=excluded.context,cursor=0,queued=0,scanned=0,status='running',error=NULL,until_ms=0,owner=NULL,updated_at=datetime('now') WHERE campaign_progress.day!=excluded.day`).bind(job,day,context).run();
  }
  await resumeAdminCampaign(env,job,settings);
  const current=await env.DB.prepare('SELECT * FROM campaign_progress WHERE job=?').bind(job).first<Progress>();
  return {job,ok:current?.status!=='paused',sent:0,queued:current?.queued??0,failed:0,skipped:0,
    message:current?.status==='done'?'آماده‌سازی کمپین کامل شد؛ پیام‌ها برای ارسال دستی ادمین در صف‌اند.':'آماده‌سازی مرحله‌ای فعال است؛ ادامه به‌طور خودکار در Cron دقیقه‌ای انجام می‌شود.',details:{...current,owner:undefined}};
}
/** Returns false only if no resumable work exists. At most three recipient writes per invocation. */
export async function resumeAdminCampaign(env:Bindings,only?:Campaign,provided?:AppSettings):Promise<boolean>{
  const now=Date.now(),owner=crypto.randomUUID();
  const candidate=await env.DB.prepare(`SELECT * FROM campaign_progress WHERE status IN ('running','paused') AND until_ms<=? ${only?'AND job=?':''} ORDER BY updated_at,job LIMIT 1`)
    .bind(now,...(only?[only]:[])).first<Progress>();
  if(!candidate)return false;
  if(candidate.day!==todayISO()){
    await env.DB.prepare("UPDATE campaign_progress SET status='expired',error='مهلت روز کمپین تمام شد؛ پیام قدیمی خودکار ارسال نمی‌شود.' WHERE job=? AND day=?").bind(candidate.job,candidate.day).run();return true;
  }
  const config=await loadFallbackConfig(env);
  if(config.deliveryMode!=='admin')return false;
  const row=await env.DB.prepare(`UPDATE campaign_progress SET until_ms=?,owner=?,status='running' WHERE job=? AND day=? AND until_ms<=? RETURNING *`)
    .bind(now+90_000,owner,candidate.job,candidate.day,now).first<Progress>();
  if(!row)return true;
  let cursor=row.cursor,queued=0,scanned=0,attempts=0,failed=false,more=false;const churnIds:number[]=[];
  try{
    const {loadSettings}=await import('./settings');const settings=provided??await loadSettings(env,true);
    const users=await env.DB.prepare(`SELECT u.*,(SELECT COUNT(*) FROM invoices i WHERE i.user_id=u.id AND i.voided_at IS NULL) AS visits FROM users u
      WHERE u.id>? AND u.role='customer' AND u.is_active=1 AND u.sms_opt_in=1 ORDER BY u.id LIMIT 50`).bind(cursor).all<UserRow&{visits:number}>();
    const today=todayJalali();
    for(const user of users.results??[]){
      if(attempts>=3){more=true;break;}
      let eligible=false;
      if(row.job==='birthday' && user.birth_date){const [y,m,d]=user.birth_date.split('-').map(Number);const j=toJalali(y,m,d);eligible=j.jm===today.jm&&j.jd===today.jd;}
      if(row.job==='churn' && user.last_visit_date){const baseline=user.visits>=settings.churn_min_visits&&user.avg_visit_interval>0?user.avg_visit_interval:30;eligible=daysSince(user.last_visit_date)>baseline+settings.churn_grace_days&&(!user.last_churn_sms_at||daysSince(user.last_churn_sms_at)>=30);}
      if(row.job==='weather')eligible=daysSince(user.last_visit_date||user.created_at)<=30;
      if(eligible){
        attempts++;
        const vars:Record<string,string|number>={name:user.name,tier:tierLabel(user.tier,settings),last_visit:daysSince(user.last_visit_date)};
        if(row.job==='birthday'){
          const start=toGregorian(today.jy,1,1),startISO=utcStamp(Date.UTC(start.gy,start.gm-1,start.gd)-3.5*3600000);
          const old=await env.DB.prepare("SELECT code,value,expires_at,is_active,used_count,max_uses FROM coupons WHERE user_id=? AND reason='birthday' AND created_at>=? ORDER BY id DESC LIMIT 1").bind(user.id,startISO).first<{code:string;value:number;expires_at:string|null;is_active:number;used_count:number;max_uses:number}>();
          if(old&&(!old.is_active||old.used_count>=old.max_uses||(old.expires_at&&Date.parse(old.expires_at.replace(' ','T')+'Z')<=now))){cursor=user.id;scanned++;continue;}
          const coupon=old??await createCoupon(env.DB,{userId:user.id,kind:'percent',value:settings.birthday_coupon_percent,reason:'birthday',expiresAt:utcStamp(now+14*86400000),maxUses:1});
          if(!coupon)throw Error('COUPON_PREPARATION_FAILED');vars.coupon=coupon.code;vars.percent=toPersianDigits(coupon.value);vars.expiry=formatJalali(coupon.expires_at);
        }
        if(row.job==='weather'){const w=JSON.parse(row.context||'{}');Object.assign(vars,{city:w.city,weather:w.label,temp:w.temp,advice:w.advice});}
        const result=await sendSms(env,settings,{userId:user.id,phone:user.phone,type:row.job,message:renderSms(settings,row.job,vars),expiresAt:row.job==='birthday'?Date.parse(row.day+'T20:30:00Z'):undefined,eventKey:`campaign:${row.job}:${row.day}:${user.id}`,adminOnly:true});
        if(result.status!=='pending'){failed=true;break;}
        queued++;
        if(row.job==='churn')churnIds.push(user.id);
      }
      cursor=user.id;scanned++;
    }
    more=more||(users.results?.length===50);
    const checkpoint=env.DB.prepare(`UPDATE campaign_progress SET cursor=?,queued=queued+?,scanned=scanned+?,status=?,error=?,until_ms=?,owner=NULL,updated_at=datetime('now') WHERE job=? AND owner=?`)
      .bind(cursor,queued,scanned,failed?'paused':more?'running':'done',failed?'صف مقصد آماده نیست؛ پس از رفع اتصال/ظرفیت، ادامه بدون تکرار پیام قبلی انجام می‌شود.':null,failed?now+300000:0,row.job,owner);
    // Throttle timestamp and cursor commit together, preserving replay accounting.
    const updates=churnIds.length?[env.DB.prepare(`UPDATE users SET last_churn_sms_at=? WHERE id IN (${churnIds.map(()=>'?').join(',')})`).bind(utcStamp(now),...churnIds)]:[];
    await env.DB.batch([...updates,checkpoint]);
  }catch{
    // Do not advance cursor on uncertain queue write. Stable event keys deduplicate the retry.
    await env.DB.prepare("UPDATE campaign_progress SET status='paused',error='آماده‌سازی متوقف شد؛ تنظیمات و دیتابیس را بررسی کنید.',until_ms=?,owner=NULL,updated_at=datetime('now') WHERE job=? AND owner=?")
      .bind(now+300000,row.job,owner).run();
  }
  return true;
}
