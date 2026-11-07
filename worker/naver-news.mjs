// Server-only NAVER API HUB setup. No result data goes to the news/AI pipeline.
export const NAVER_NEWS_POLICY = Object.freeze({
  collectionAllowed: true,
  curatedSelectionAllowed: false,
  aiUseAllowed: false,
  reviewedAt: '2026-11-03',
  reason: 'independent_unmodified_search_display_only',
  termsUrl: 'https://www.ncloud.com/product/applicationService/naverApiHub#resource',
  searchTermsUrl: 'https://developers.naver.com/products/terms/',
});
export const NAVER_NEWS_LIMITS = Object.freeze({daily:20000,monthly:620000});
const ENDPOINT='https://naverapihub.apigw.ntruss.com/search/v1/news';
// A later pricing review must update this date before calls can resume.
const FREE_PRICING_REVIEW_EXPIRES=Date.parse('2026-11-30T15:00:00Z');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function limit(value,maximum){
  if(value===undefined)return maximum;
  if(!/^[1-9]\d*$/.test(String(value)))fail('naver_limit_invalid');
  return Math.min(Number(value),maximum);
}
export function naverLimits(env={}){
  return {daily:limit(env.NAVER_NEWS_DAILY_LIMIT,20000),monthly:limit(env.NAVER_NEWS_MONTHLY_LIMIT,620000)};
}
function periods(now){
  if(!Number.isFinite(now))fail('naver_clock_invalid');
  const day=new Date(now+9*3600000).toISOString().slice(0,10);
  return {day,month:day.slice(0,7)};
}
// The monthly and daily counters are committed together by one durable CAS.
// Reserve before every attempt, including failures; never refund or retry HTTP.
export async function reserveNaverBudget(store,requestId,{env={},now=Date.now()}={}){
  if(!store?.read||!store?.compareAndSwap)fail('naver_budget_unavailable');
  if(typeof requestId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(requestId))fail('naver_request_id_invalid');
  const {day,month}=periods(now),limits=naverLimits(env),key='api:naver:budget:'+month;
  for(let attempt=0;attempt<8;attempt++){
    const old=await store.read(key);
    let value=old.value??{month,days:{},total:0,seen:{},lastAttemptAt:null};
    if(value.month!==month||!value.days||Object.getPrototypeOf(value.days)!==Object.prototype||Object.entries(value.days).some(([d,n])=>!d.startsWith(month+'-')||!Number.isSafeInteger(n)||n<0))fail('naver_budget_corrupt');
    const sum=Object.values(value.days).reduce((a,b)=>a+b,0);
    // Migrate the old monthly ID list without resetting previously spent quota.
    if(Array.isArray(value.requestIds)){
      if(value.requestIds.length!==sum||new Set(value.requestIds).size!==sum)fail('naver_budget_corrupt');
      if(value.requestIds.includes(requestId))return {reserved:false,reason:'duplicate_request'};
      const migrated={};for(const id of value.requestIds){if(typeof id!=='string')fail('naver_budget_corrupt');const h=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id)))).map(b=>b.toString(16).padStart(2,'0')).join('');migrated[h]=now;}
      value={month,days:value.days,total:sum,seen:migrated,lastAttemptAt:value.lastAttemptAt};
    }
    if(value.total!==sum||!Number.isSafeInteger(value.total)||!value.seen||typeof value.seen!=='object')fail('naver_budget_corrupt');
    if(value.lastAttemptAt!==null&&(!Number.isFinite(Date.parse(value.lastAttemptAt))||Date.parse(value.lastAttemptAt)>now))fail('naver_clock_invalid');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(requestId)))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const seen=Object.fromEntries(Object.entries(value.seen).filter(([,at])=>Number.isFinite(at)&&now-at<=2*3600000));
    if(Object.hasOwn(seen,hash))return {reserved:false,reason:'duplicate_request'};
    if((value.days[day]||0)>=limits.daily||value.total>=limits.monthly)return {reserved:false,reason:'quota_exhausted'};
    if(value.lastAttemptAt&&now-Date.parse(value.lastAttemptAt)<1000)return {reserved:false,reason:'rate_limited'};
    const next={month,days:{...value.days,[day]:(value.days[day]||0)+1},total:value.total+1,seen:{...seen,[hash]:now},lastAttemptAt:new Date(now).toISOString()};
    if((await store.compareAndSwap(key,old.version,next)).applied)return {reserved:true,daily:next.days[day],monthly:next.total};
  }
  fail('naver_budget_conflict');
}
export function naverNewsStatus(env={},now=Date.now()){
  let limits=null;try{limits=naverLimits(env);}catch{}
  return {
    provider:'NAVER API HUB',api:'news',
    credentialsConfigured:!!env.NAVER_NEWS_CLIENT_ID&&!!env.NAVER_NEWS_CLIENT_SECRET,
    enabled:env.NAVER_NEWS_ENABLED==='true'&&NAVER_NEWS_POLICY.collectionAllowed&&!!limits&&!!env.NAVER_NEWS_CLIENT_ID&&!!env.NAVER_NEWS_CLIENT_SECRET&&now<FREE_PRICING_REVIEW_EXPIRES,
    collectionStatus:'independent_search_only',
    policy:NAVER_NEWS_POLICY,limits,timezone:'Asia/Seoul',
    providerLimits:{monthly:775000},freeTier:{monthly:775000},
    pricingReviewExpiresAt:new Date(FREE_PRICING_REVIEW_EXPIRES).toISOString(),
    scheduleConnected:false,aiConnected:false,curatedFiveConnected:false,
  };
}
// Only the isolated search module calls this function. Never pass these results
// to feed selection, bookmarks, editorial summaries or push payloads.
export async function requestNaverNews({env={},store,requestId,query,fetchImpl=fetch,now=Date.now()}={}){
  if(!NAVER_NEWS_POLICY.collectionAllowed)fail('naver_result_use_permission_required');
  if(env.NAVER_NEWS_ENABLED!=='true')fail('naver_disabled');
  if(now>=FREE_PRICING_REVIEW_EXPIRES)fail('naver_pricing_review_required');
  if(!env.NAVER_NEWS_CLIENT_ID||!env.NAVER_NEWS_CLIENT_SECRET)fail('naver_credentials_missing');
  if(typeof query!=='string'||!query.trim()||query.length>200)fail('naver_query_invalid');
  const reserved=await reserveNaverBudget(store,requestId,{env,now});
  if(!reserved.reserved)fail('naver_'+reserved.reason);
  const url=new URL(ENDPOINT);url.search=new URLSearchParams({query,display:'5',start:'1',sort:'date',format:'json'});
  let response;
  try{response=await fetchImpl(url,{headers:{'X-NCP-APIGW-API-KEY-ID':env.NAVER_NEWS_CLIENT_ID,'X-NCP-APIGW-API-KEY':env.NAVER_NEWS_CLIENT_SECRET},redirect:'manual',signal:AbortSignal.timeout(10000)});}catch{fail('naver_request_failed');}
  if(!response.ok){await response.body?.cancel();fail('naver_http_'+response.status);}
  const reader=response.body?.getReader();if(!reader)fail('naver_response_invalid');
  const chunks=[];let bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2000000)fail('naver_response_too_large');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
  const data=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(data));}catch{fail('naver_response_invalid');}
}
