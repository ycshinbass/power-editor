import {googleRssFetch,GOOGLE_RSS_REFRESH_MS,GOOGLE_RSS_MAX_AGE_MS} from './google-rss-transport.mjs';
import {googleRssWithFallback,googleNewsMaxAge,googleFallbackConfigured} from './google-rss-fallback.mjs';
import {parseFeed} from './feed.mjs';
import {headlineRegions} from './google-news.mjs';
import {createD1SnapshotStore} from './snapshot-d1.mjs';
const HOUR=3600000;
const queries={power:'전력망 OR 전력수급 OR 송전 OR 변전 OR 정전',outage:'(정전 OR "전력 공급 중단") (가구 OR 세대 OR 복구 OR 한전) -정전협정 -휴전 -전쟁 -단전예고',kepco:'한국전력 OR 한전'};
export function focusedNewsMatch(title,category){
 if(typeof title!=='string'||title.length>280)return false;
 if(category==='outage'){
  if(/매뉴얼|모의\s*훈련|대응\s*훈련|예방\s*교육/.test(title))return false;
  if(/정전\s*(협정|협상|합의|선언|회담|기념|용량|기\b)|휴전|종전|전쟁|가자|이스라엘|우크라이나|러시아|북한|미국|중국|일본|유럽|스페인|포르투갈|대만|베트남|인도|필리핀|해외|단전\s*예고|정전\s*(예고|예정|대비|훈련|우려)|계획\s*정전|체납|미납/.test(title))return false;
  if(!headlineRegions(title).length&&!/국내|전국/.test(title))return false;
  return /정전|전력\s*공급\s*(중단|끊)|전기\s*공급\s*(중단|끊)/.test(title)&&/정전\s*(발생|사고)|복구|가구|세대|먹통|암흑|끊겨|끊겼|중단|불편|고장|화재|停電/.test(title);
 }
 if(category==='power')return /전력망|전력수급|송전|변전|발전소|전기요금|전력공급/.test(title)&&!/전쟁|군사|전투|배구|주가/.test(title);
 if(category==='kepco')return /한국전력|한전|\bKEPCO\b/i.test(title)&&/전력망|송전|변전|배전|계통|전기요금|경영|실적|영업이익|적자|흑자|투자|기술|사업|수주|협약|조직|인사|안전|설비|재무|부채|정책/.test(title)&&!/홈플러스|체납|미납|단전\s*예고|배구|V리그|주가|목표주가|주식|종목|매수|매도|배당|봉사|기부|사회공헌/.test(title);
 return false;
}
export function selectFocusedNews(items,category,now=Date.now()){
 const seen=new Set();return items.filter(i=>{const age=now-Date.parse(i.publishedAt),key=i.title.replace(/\s+/g,' ').trim();if(age< -600000||age>72*HOUR||!Number.isFinite(age)||!focusedNewsMatch(i.title,category)||seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,5).map(({title,url,publishedAt,publisherName})=>({title,url,publishedAt,publisherName,regions:headlineRegions(title)}));
}
// An explicitly published, successful laptop collection is a bounded recovery snapshot.
// Its original timestamp is immutable; it never clears the provider's shared cooldown.
export async function restoreFocusedSnapshot(store,key,category,snapshot,now,collectionPath='operator-laptop'){
 let old=await store.read(key);
 const checked=Date.parse(snapshot?.checkedAt);
 if(snapshot?.status!=='ok'||snapshot?.category!==category||!Number.isFinite(checked)||checked>now||now-checked>=GOOGLE_RSS_MAX_AGE_MS||!Array.isArray(snapshot.items)||snapshot.items.length>5)return old;
 const validLink=item=>{try{const u=new URL(item.url);return u.protocol==='https:'&&u.hostname==='news.google.com'&&!u.username&&!u.password&&!u.port&&u.pathname.startsWith('/rss/articles/')&&typeof item.title==='string'&&typeof item.publisherName==='string';}catch{return false;}};
 if(!snapshot.items.every(validLink))return old;
 const data={status:'ok',category,items:selectFocusedNews(snapshot.items,category,now),checkedAt:new Date(checked).toISOString(),expiresAt:new Date(checked+GOOGLE_RSS_REFRESH_MS).toISOString(),validUntil:new Date(checked+GOOGLE_RSS_MAX_AGE_MS).toISOString(),source:'Google 뉴스 RSS',collectionPath,notice:category==='outage'?'최근 72시간 제목에서 국내 발생·복구 근거가 확인된 보도입니다. 현재 정전 사고 수나 전체 발생 목록이 아닙니다.':'최근 72시간 전력산업 관련 보도입니다. 제목 기준 규칙 선별이며 원문에서 사실을 확인하세요.'};
 for(let n=0;n<2;n++){
  const value=old.value||{},good=value.lastGood||(value.data?.status==='ok'&&!value.data.refreshError?value.data:null);
  if(value.leaseUntil>now||Date.parse(good?.checkedAt)>=checked)return old;
  const next={...value,data,lastGood:data};
  const saved=await store.compareAndSwap(key,old.version,next);
  if(saved.applied)return {value:next,version:saved.version};
  old=await store.read(key);
 }
 return old;
}
export async function collectFocusedNews(env,category,{now=Date.now(),fetchFn=fetch,store=env.DB?createD1SnapshotStore(env.DB):null,transport=googleRssWithFallback,localSnapshot=null}={}){
 if(!Object.hasOwn(queries,category))return {status:'invalid_category',items:[]};
 if(!store)return {status:'unavailable',items:[]};
 const key='focused-news:'+(category==='kepco'?'v2:':'v1:')+category,slot=Math.floor(now/HOUR),old=await restoreFocusedSnapshot(store,key,category,localSnapshot,now),value={...(old.value||{})};
 // Existing snapshots keep their original receipt time, but adopt the new retention limit.
 for(const field of ['data','lastGood'])if(value[field]?.status==='ok'&&Number.isFinite(Date.parse(value[field].checkedAt)))value[field]={...value[field],validUntil:new Date(Date.parse(value[field].checkedAt)+GOOGLE_RSS_MAX_AGE_MS).toISOString()};
 const lastGood=value.lastGood||(value.data?.status==='ok'&&!value.data.refreshError?value.data:null);
 const age=now-Date.parse(lastGood?.checkedAt),usable=lastGood&&age>=0&&(lastGood.collectionPath==='cloudflare-fallback'?age<googleNewsMaxAge(lastGood):age<=googleNewsMaxAge(lastGood));
 const result=(failureCode,retryAt,upstream,status='unavailable')=>{
  const error={status,category,items:[],checkedAt:new Date(now).toISOString(),failureCode,retryAt,...(upstream?{upstream}:{})};
  if(!usable)return error;
  return {...lastGood,items:selectFocusedNews(lastGood.items||[],category,now),stale:true,refreshError:true,attemptedAt:new Date(now).toISOString(),failureCode,retryAt,...(upstream?{upstream}:{}),notice:'Google 뉴스 최신 조회 지연으로 이전 성공 수집분을 표시합니다. 수집 '+lastGood.checkedAt+' · 원문 발행일을 확인하세요.'};
 };
 if(usable&&now-Date.parse(lastGood.checkedAt)<GOOGLE_RSS_REFRESH_MS)return {...lastGood,expiresAt:new Date(Date.parse(lastGood.checkedAt)+GOOGLE_RSS_REFRESH_MS).toISOString()};
 const sameSlot=value.slot===slot,attempts=sameSlot?(value.attempts||0):0;
 if(value.leaseUntil>now)return result('collection_in_progress',new Date(value.leaseUntil).toISOString(),undefined,'updating');
 const lastRequestAt=Object.hasOwn(value,'lastRequestAt')?(value.lastRequestAt??0):Date.parse(value.data?.attemptedAt||value.data?.checkedAt);
 const requestDue=Number.isFinite(lastRequestAt)?lastRequestAt+GOOGLE_RSS_REFRESH_MS:0;
 if(value.data?.status==='ok'&&!value.data.refreshError&&!value.data.stale&&usable&&requestDue>now)return {...value.data,expiresAt:new Date(requestDue).toISOString()};
 const due=Math.max(requestDue,value.nextAttemptAt||0,Date.parse(value.data?.retryAt)||0);
 const newFallback=!usable&&googleFallbackConfigured(env)&&!value.data?.fallbackAttempted&&value.data?.collectionPath!=='cloudflare-fallback'&&value.data?.failureCode&&value.data.failureCode!=='google_rss_busy';
 if(due>now&&!newFallback)return {...(value.data?.status==='ok'&&!usable?result(value.data.failureCode,new Date(due).toISOString(),value.data.upstream):value.data||result('retry_pending',new Date(due).toISOString())),retryAt:new Date(due).toISOString()};
 if(sameSlot&&attempts>=3)return result(value.data?.failureCode||'collection_interrupted',new Date((slot+1)*HOUR).toISOString(),value.data?.upstream);
 const claim=await store.compareAndSwap(key,old.version,{slot,attempts,leaseUntil:now+30000,lastRequestAt:Number.isFinite(lastRequestAt)?lastRequestAt:null,lastGood:usable?lastGood:null,data:value.data||null});
 if(!claim.applied)return result('collection_in_progress',new Date(now+15000).toISOString(),undefined,'updating');
 let data,spent=true;
 try{
  const u=new URL('https://news.google.com/rss/search');u.search=new URLSearchParams({q:queries[category]+' when:3d',hl:'ko',gl:'KR',ceid:'KR:ko'});
  const primaryFailure=newFallback&&due>now?Object.assign(Error(value.data.failureCode),{upstream:value.data.upstream,retryAt:new Date(due).toISOString()}):null;
  const r=await transport(u,{headers:{'User-Agent':'PowerEditor/1.0 (+https://power-editor-design-1031.ycshinbass.chatgpt.site/)','Accept':'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8'},redirect:'manual',signal:AbortSignal.timeout(10000)},{store,fetchFn,clock:()=>now,env,allowFallback:!usable,primaryFailure});
  if(!r.ok)throw Error('upstream_http_'+r.status);
  const xml=await r.text();if(new TextEncoder().encode(xml).length>750000)throw Error('limit');
  if(!/<rss[\s>]|<feed[\s>]/i.test(xml))throw Error('invalid_feed');
  const source={id:'google-focused-'+category,format:'google-news-rss',hosts:['news.google.com']};
  const items=selectFocusedNews(parseFeed(xml,source,now),category,now);
  data={status:'ok',category,items,checkedAt:new Date(now).toISOString(),expiresAt:new Date(now+GOOGLE_RSS_REFRESH_MS).toISOString(),source:'Google 뉴스 RSS',notice:category==='outage'?'최근 72시간 제목에서 국내 발생·복구 근거가 확인된 보도입니다. 현재 정전 사고 수나 전체 발생 목록이 아닙니다.':'최근 72시간 전력산업 관련 보도입니다. 제목 기준 규칙 선별이며 원문에서 사실을 확인하세요.'};
  data.collectionPath=r.headers.get('X-Power-Collection-Path')==='cloudflare-fallback'?'cloudflare-fallback':'sites';
  data.validUntil=new Date(now+googleNewsMaxAge(data)).toISOString();
 }catch(error){
  spent=!['google_rss_busy','google_rss_cooldown'].includes(error.message);
  const code=error.name==='TimeoutError'?'upstream_timeout':/^[a-z_0-9]+$/.test(error.message)?error.message:'invalid_feed';
  data=result(code,error.retryAt||new Date(now+GOOGLE_RSS_REFRESH_MS).toISOString(),error.upstream,error.message==='google_rss_busy'?'updating':'unavailable');
  if(error.fallbackAttempted){data.fallbackAttempted=true;data.primaryFailure=error.primaryFailure;}
 }
 await store.compareAndSwap(key,claim.version,{slot,attempts:attempts+(spent?1:0),lastRequestAt:spent?now:Number.isFinite(lastRequestAt)?lastRequestAt:null,nextAttemptAt:Date.parse(data.retryAt)||0,data,lastGood:data.status==='ok'&&!data.refreshError?data:usable?lastGood:null});return data;
}
export async function handleFocusedNews(request,env,options={}){const category=new URL(request.url).searchParams.get('category')||'outage';const task=collectFocusedNews(env,category,{localSnapshot:options.localSnapshot?.categories?.[category]});options.waitUntil?.(task.catch(()=>{}));const data=await task;if(data.status==='ok')data.items=selectFocusedNews(data.items||[],category);return Response.json(data,{headers:{'Cache-Control':'private, no-store'}});}
