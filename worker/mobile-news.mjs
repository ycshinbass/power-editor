import {createD1SnapshotStore} from './snapshot-d1.mjs';
import {parseFeed} from './feed.mjs';
import {restoreFocusedSnapshot,selectFocusedNews} from './focused-news.mjs';
import {GOOGLE_RSS_MAX_AGE_MS,GOOGLE_RSS_REFRESH_MS} from './google-rss-transport.mjs';
const STATE='mobile-news:v1',HOUR=3600000;
// Leave four hours for the hourly phone job and the existing two-hour retry floor.
const UNATTENDED_REFRESH_MS=GOOGLE_RSS_MAX_AGE_MS-4*HOUR;
const queries={kepco:'한국전력 OR 한전',power:'전력망 OR 전력수급 OR 송전 OR 변전 OR 변압기',outage:'(정전 OR "전력 공급 중단") (발생 OR 복구 OR 가구 OR 세대) -정전협정 -휴전 -종전 -단전예고'};
const key=c=>'focused-news:'+(c==='kepco'?'v2:':'v1:')+c;
export async function markMobileNewsVisit(env,now=Date.now()){
 if(!env.MOBILE_NEWS_TOKEN_HASH||!env.DB)return;
 const store=createD1SnapshotStore(env.DB),old=await store.read(STATE);
 if(now-(old.value?.lastVisitAt||0)<300000)return;
 await store.compareAndSwap(STATE,old.version,{...old.value,lastVisitAt:now});
}
async function authorized(request,env){
 const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1];
 if(!token||!env.MOBILE_NEWS_TOKEN_HASH)return false;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
 const hash=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
 let diff=hash.length^env.MOBILE_NEWS_TOKEN_HASH.length;for(let n=0;n<hash.length;n++)diff|=hash.charCodeAt(n)^(env.MOBILE_NEWS_TOKEN_HASH.charCodeAt(n)||0);return diff===0;
}
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function body(request,limit){
 if(!request.body)throw Error('body');
 const reader=request.body.getReader();let total=0,parts=[];
 while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw Error('limit')}parts.push(value)}
 const bytes=new Uint8Array(total);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length}return JSON.parse(new TextDecoder().decode(bytes));
}
export async function handleMobileNews(request,env,{now=Date.now(),store=env.DB?createD1SnapshotStore(env.DB):null}={}){
 const path=new URL(request.url).pathname;if(!path.startsWith('/api/mobile-news/'))return null;
 if(request.method!=='POST')return json({error:'method'},405);
 if(!await authorized(request,env))return json({error:'unauthorized'},401);
 if(!store)return json({error:'storage'},503);
 if(path==='/api/mobile-news/claim'){
  const old=await store.read(STATE),v=old.value||{};
  if(v.leaseUntil>now||v.nextAttemptAt>now)return json({jobs:[]});
  const visitAge=now-v.lastVisitAt,recentVisit=Number.isFinite(v.lastVisitAt)&&visitAge>=0&&visitAge<=HOUR;
  const refreshAge=recentVisit?GOOGLE_RSS_REFRESH_MS:UNATTENDED_REFRESH_MS;
  const jobs=[];
  for(const category of Object.keys(queries)){
   const slot=await store.read(key(category)),good=slot.value?.lastGood||slot.value?.data;
   const age=now-Date.parse(good?.checkedAt);
   if(good?.status==='ok'&&age>=0&&age<refreshAge)continue;
   const url=new URL('https://news.google.com/rss/search');url.search=new URLSearchParams({q:queries[category]+' when:3d',hl:'ko',gl:'KR',ceid:'KR:ko'});
   jobs.push({category,url:url.href});
  }
  if(!jobs.length)return json({jobs:[]});
  const leaseId=crypto.randomUUID(),next={...v,leaseId,leaseUntil:now+10*60000,categories:jobs.map(j=>j.category),nextAttemptAt:now+2*HOUR};
  const saved=await store.compareAndSwap(STATE,old.version,next);return json(saved.applied?{leaseId,jobs}:{jobs:[]});
 }
 if(path!=='/api/mobile-news/result')return json({error:'not_found'},404);
 let input;try{input=await body(request,1000000)}catch{return json({error:'invalid_body'},400)}
 const old=await store.read(STATE),v=old.value||{};
 if(!input||input.leaseId!==v.leaseId||v.leaseUntil<now||!v.categories?.includes(input.category))return json({error:'lease'},409);
 if(input.error){
  await store.compareAndSwap(STATE,old.version,{...v,leaseUntil:0,leaseId:null,categories:[],lastError:String(input.error).replace(/[^a-z0-9_]/g,'').slice(0,60),lastFailureAt:now});
  return json({accepted:true,preserved:true});
 }
 if(typeof input.xml!=='string'||new TextEncoder().encode(input.xml).length>750000||!/<rss[\s>]|<feed[\s>]/i.test(input.xml))return json({error:'invalid_feed'},400);
 let items;try{items=parseFeed(input.xml,{id:'google-focused-'+input.category,format:'google-news-rss',hosts:['news.google.com']},now)}catch{return json({error:'invalid_feed'},400)}
 // Reuse server-side headline rules. The phone cannot submit arbitrary URLs or
 // choose storage keys/timestamps. Timestamp is server receipt after a live lease.
 const snapshot={status:'ok',category:input.category,checkedAt:new Date(now).toISOString(),items:selectFocusedNews(items,input.category,now)};
 const result=await restoreFocusedSnapshot(store,key(input.category),input.category,snapshot,now,'android-phone');
 if(result.value?.lastGood?.checkedAt!==snapshot.checkedAt)return json({error:'cache_busy'},409);
 const pending=v.categories.filter(c=>c!==input.category);
 const saved=await store.compareAndSwap(STATE,old.version,{...v,categories:pending,leaseUntil:pending.length?v.leaseUntil:0,leaseId:pending.length?v.leaseId:null,lastSuccessAt:now,lastError:null});
 return json({accepted:true,count:snapshot.items.length,stateUpdated:saved.applied});
}
