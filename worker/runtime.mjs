import {handlePowerDemand} from './power-demand.mjs';
import {googleNewsSources} from './google-news.mjs';
import {reserveNewsRun} from './news-budget.mjs';
import {diverseNews,freshNews,newsMatchesRegions} from '../frontend/logic.js';
import {SOURCES,collectBriefing,limitGoogleNewsAge,parseRegions,regionsMatch,REGION_NAMES} from './feed.mjs';
import {createSnapshotService} from './snapshots.mjs';
import {createD1SnapshotStore} from './snapshot-d1.mjs';
import {createPushService,validatePushEndpoint} from './push.mjs';
import {createWebPushSender} from './web-push.mjs';
import {createEditorialService} from './editorial.mjs';
import {naverNewsStatus} from './naver-news.mjs';
import {handleNaverSearch,refreshNaverSearch} from './naver-search.mjs';
// Exact previous and current origins returned by Sites for this same owner-private project.
const SITE_ORIGINS=new Set(['https://power-editor-design-1031.keenibis32.chatgpt.site','https://power-editor-design-1031.ycshinbass.chatgpt.site']);
const response=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export async function digestText(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export function privateWriterAllowed(request,env){const u=new URL(request.url),origin=request.headers.get('origin');return (env.SITE_PUBLIC_ACCESS!=='true'||env.updaterAuthenticated===true)&&env.PRIVATE_UPDATER_ENABLED==='true'&&!!env.DB&&SITE_ORIGINS.has(u.origin)&&(!origin||origin===u.origin)}
async function jsonBody(request,limit=12000){if(!(request.headers.get('content-type')||'').startsWith('application/json'))throw Error('content_type');if(Number(request.headers.get('content-length'))>limit)throw Error('body_limit');const reader=request.body?.getReader();if(!reader)throw Error('body_required');const parts=[];let n=0;try{for(;;){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>limit)throw Error('body_limit');parts.push(r.value)}}finally{await reader.cancel().catch(()=>{})}const b=new Uint8Array(n);let i=0;for(const p of parts){b.set(p,i);i+=p.length}return JSON.parse(new TextDecoder().decode(b))}
// Transaction callbacks MUST have no external side effects; only a CAS winner returns.
export function createPrivatePushStore(store){return {async transaction(uid,fn){const key='pushuser:'+uid;for(let i=0;i<8;i++){const old=await store.read(key);const entries=structuredClone(old.value||{});const tx={get:async k=>entries[k],set:async(k,v)=>{entries[k]=v},delete:async k=>{delete entries[k]},list:async p=>Object.entries(entries).filter(([k])=>k.startsWith(p)).map(([key,value])=>({key,value}))};const result=await fn(tx);if(JSON.stringify(entries).length>2000000)throw Error('private_storage_limit');const write=await store.compareAndSwap(key,old.version,entries);if(write.applied)return result}throw Error('write_conflict')}}}
function snapshotService(request,env){return createSnapshotService({store:createD1SnapshotStore(env.DB),staleAfterMs:16*60*60000,authorize:()=>privateWriterAllowed(request,env),collect:async()=>collectBriefing([],{store:createD1SnapshotStore(env.DB),sources:SOURCES.filter(source=>source.format!=='google-news-rss'),allowPrivateSources:env.SITE_PUBLIC_ACCESS!=='true'&&privateWriterAllowed(request,env),cache:typeof caches!=='undefined'?caches.default:null})})}
function pushService(env){const configured=false;return createPushService({store:env.DB?createPrivatePushStore(createD1SnapshotStore(env.DB)):null,config:{approved:!!configured,configured:!!configured,regionNames:REGION_NAMES},regionMatches:regionsMatch,resolveUser:ctx=>ctx?.verifiedUserId,send:configured?createWebPushSender(env):null,digest:digestText})}
function editorialService(request,env,seedEvents={events:[]}){return createEditorialService({store:createD1SnapshotStore(env.DB),getSnapshot:async()=>(await snapshotService(request,env).readSnapshot()).snapshot,seedEvents})}
// Hourly server runs: next hour plus a bounded grace period.
export function newsCadence(stored,now=Date.now()){
 const at=Date.parse(stored.checkedAt);let next=null;
 if(Number.isFinite(at))next=(Math.floor(at/3600000)+1)*3600000;
 const sourceFailure=stored.lastAttempt?.outcome==='retained'||(stored.snapshot?.sources||[]).some(s=>s.status!=='ok'||s.stale);
 const overdue=next!==null&&now>next+15*60000;
 return {status:!stored.snapshot?'missing':sourceFailure?'source_failure':overdue?'overdue':'fresh',stale:!!stored.snapshot&&(sourceFailure||overdue),nextScheduledAt:next===null?null:new Date(next).toISOString(),scheduleTimezone:'Asia/Seoul'};
}
// One owner-private preference and one rolling edition: no per-device AI batches.
const EDITORIAL_PREFERENCE='editorial:preference:v1',EDITORIAL_SELECTION='editorial:selection:v1';
export function editorialSlot(at=Date.now()){
 const shifted=at+5*60000,day=Math.floor((shifted+9*3600000)/86400000)*86400000-9*3600000;
 return new Date(shifted>=day+16*3600000?day+16*3600000:shifted>=day+7*3600000?day+7*3600000:day-8*3600000).toISOString();
}
const aiReviewAllowed=()=>false; // No news data is sent to AI, including official sources.
const articleIdentity=i=>({id:i.id,sourceId:i.sourceId,url:i.url,originalTitle:i.title,publishedAt:i.publishedAt});
const sameArticle=(r,i)=>r.sourceId===i.sourceId&&r.url===i.url&&r.originalTitle===(i.title||i.originalTitle)&&r.publishedAt===i.publishedAt;
export async function saveEditorialPreference(store,regions,now=Date.now()){
 if(!Array.isArray(regions)||regions.length>30||regions.some(r=>typeof r!=='string'||!REGION_NAMES.includes(r)))throw Error('regions_invalid');
 regions=[...new Set(regions)].sort();
 for(let n=0;n<8;n++){const old=await store.read(EDITORIAL_PREFERENCE);if(old.value&&JSON.stringify(old.value.regions)===JSON.stringify(regions))return {...old.value,changed:false};
 const value={regions,checkedAt:new Date(now).toISOString()};if((await store.compareAndSwap(EDITORIAL_PREFERENCE,old.version,value)).applied)return {...value,changed:true};}throw Error('write_conflict');
}
export async function reserveEditorialSelection(store,stored,attempt,records,now=Date.now()){
 const old=await store.read(EDITORIAL_SELECTION),slot=editorialSlot(now);
 if(old.value?.slot===slot)return old.value;
 // Read-back of an old/manual attempt cannot create a new edition from old items.
 if(!attempt||attempt.outcome!=='stored'||editorialSlot(Date.parse(attempt.finishedAt))!==slot||attempt.snapshotCheckedAt!==stored.checkedAt||!stored.snapshot)return null;
 const preference=(await store.read(EDITORIAL_PREFERENCE)).value,regions=preference?.regions||[],items=stored.snapshot.items||[];
 const ranked=diverseNews(items.filter(i=>newsMatchesRegions(i,regions)),regions,now).slice(0,5);
 const fresh=new Set(attempt.newItemIds||[]),reviewable=ranked.filter(i=>fresh.has(i.id)&&freshNews(i,now)&&aiReviewAllowed(i)&&!i.stale&&!i.editorial&&!(records.records||[]).some(r=>sameArticle(r,i))).map(articleIdentity);
 const selection={slot,requestId:attempt.requestId,checkedAt:new Date(now).toISOString(),regions,selectionRegionStatus:preference?'confirmed':'unset',articles:ranked.map(articleIdentity),reviewable};
 for(let n=0;n<8;n++){const current=n?await store.read(EDITORIAL_SELECTION):old;if(current.value?.slot===slot)return current.value;if(current.value?.slot>slot)return null;if((await store.compareAndSwap(EDITORIAL_SELECTION,current.version,selection)).applied)return selection;}throw Error('write_conflict');
}
export async function handleCentralBriefing(request,env,options={}){
 if(!env.DB)return null;const stored=await snapshotService(request,env).readSnapshot();
 if(!stored.snapshot&&new URL(request.url).searchParams.get('google')==='1'){
  const regions=parseRegions(new URL(request.url).searchParams.get('regions')||''),task=collectBriefing(regions,{env,sources:googleNewsSources(regions),store:createD1SnapshotStore(env.DB)});options.waitUntil?.(task.catch(()=>{}));return response(await task);
 }
 if(!stored.snapshot)return response({version:1,checkedAt:new Date().toISOString(),status:'unavailable',stale:false,items:[],sources:[],notice:'중앙 자료를 아직 수집하지 않았습니다. 서버 갱신을 기다려 주세요.'});
 const regions=parseRegions(new URL(request.url).searchParams.get('regions')||''),p=limitGoogleNewsAge(structuredClone(stored.snapshot)),cadence=newsCadence(stored);
 let google=null;
 // Only the visible legacy briefing requests Google material. The hourly job never does.
 if(new URL(request.url).searchParams.get('google')==='1'){
  const task=collectBriefing(regions,{env,sources:googleNewsSources(regions),store:createD1SnapshotStore(env.DB),cache:typeof caches!=='undefined'?caches.default:null});
  options.waitUntil?.(task.catch(()=>{}));google=await task;
  p.items=[...p.items.filter(i=>!i.sourceId?.startsWith('google-')),...google.items].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,100);
  p.sources=[...(p.sources||[]).filter(s=>!s.id?.startsWith('google-')),...google.sources];
  p.coverage={successful:p.sources.filter(s=>s.status==='ok').length,total:p.sources.length,notice:google.coverage.notice};
  p.status=p.coverage.successful===p.coverage.total?'ok':p.items.length?'partial':'unavailable';
 }
 p.items=p.items.map(({editorial,...item})=>item);
 const selected=null;const editorialSelection=selected?.slot===editorialSlot()?selected:null;
 return response({...p,editorialSelection,stale:cadence.stale||!!google?.stale,items:p.items.filter(i=>newsMatchesRegions(i,regions)),selection:{...p.selection,regions},central:{...cadence,checkedAt:stored.checkedAt,lastAttempt:stored.lastAttempt?.finishedAt||null},...(cadence.stale?{notice:cadence.status==='source_failure'?'뉴스 출처의 최신 수집에 실패했습니다. 이전 자료가 포함될 수 있습니다.':'뉴스 정기 갱신 시각이 지났습니다. 이전 수집 자료입니다.'}:{})});
}
export function compactAutomationSummary(stored,attempt,editorial,events,now=Date.now(),selection=null){
 const records=editorial.records||[],items=stored.snapshot?.items||[],newIds=new Set(attempt?.newItemIds||[]);
 const matches=(r,i)=>r.sourceId===i.sourceId&&r.url===i.url&&r.originalTitle===i.title&&r.publishedAt===i.publishedAt;
 const current=items.filter(i=>newIds.has(i.id));
 const eligible=selection?.requestId===attempt?.requestId?current.filter(i=>aiReviewAllowed(i)&&selection.reviewable.some(r=>sameArticle(r,i))&&!records.some(r=>matches(r,i))):[];
 const candidates=eligible.slice(0,5).map(i=>({id:i.id,sourceId:i.sourceId,url:i.url,originalTitle:i.title,publishedAt:i.publishedAt,scope:i.scope,regions:i.regions||[]}));
 const verified=records.filter(r=>aiReviewAllowed(r)&&current.some(i=>matches(r,i))).map(({sourceId,url,originalTitle,publishedAt,checkedAt,expiresAt})=>({sourceId,url,originalTitle,publishedAt,checkedAt,expiresAt}));
 // Automation never receives restricted publisher metadata, even from an old reservation.
 const safeSelection=selection?{slot:selection.slot,requestId:selection.requestId,checkedAt:selection.checkedAt,regions:selection.regions,selectionRegionStatus:selection.selectionRegionStatus,articles:(selection.articles||[]).map(i=>aiReviewAllowed(i)?{id:i.id,sourceId:i.sourceId,url:i.url,originalTitle:i.originalTitle,publishedAt:i.publishedAt}:{id:i.id,sourceId:i.sourceId,metadataRedacted:true}),reviewable:(selection.reviewable||[]).filter(aiReviewAllowed).map(i=>({id:i.id,sourceId:i.sourceId,url:i.url,originalTitle:i.originalTitle,publishedAt:i.publishedAt}))}:null;
 const eventChecks=(events.events||[]).map(e=>({id:e.id,status:e.status,checkedAt:e.checkedAt,expiresAt:e.expiresAt,expired:Date.parse(e.expiresAt)<=now,reviewDue:Date.parse(e.expiresAt)>now&&now-Date.parse(e.checkedAt)>=86400000}));
 return {version:1,requestMatched:!!attempt,requestId:attempt?.requestId||null,outcome:attempt?.outcome||null,errorCode:attempt?.errorCode||null,central:{...newsCadence(stored,now),checkedAt:stored.checkedAt},sources:(stored.snapshot?.sources||[]).map(({id,status,checkedAt,stale,error})=>({id,status,checkedAt,stale:!!stale,...(error?{error}:{})})),newItemCount:newIds.size,candidateCount:eligible.length,candidatesTruncated:false,editorialSelection:safeSelection,candidates,editorial:{count:records.length,checkedAt:editorial.checkedAt,verified},events:{checkedAt:events.checkedAt,checks:eventChecks,reviewDue:eventChecks.some(e=>e.reviewDue)}};
}
export function subscriptionFailure(e){return response({error:e.code==='test_rate_limited'?'rate_limited':'invalid_subscription_request'},e.code==='test_rate_limited'?429:400)}
async function dispatchPending(env,svc){
 const push=pushService(env);if(!push.state().enabled)return {enabled:false};
 try{const intents=await svc.readPendingNotificationIntents();const users=await env.DB.prepare("SELECT key FROM editor_snapshots WHERE key LIKE 'pushuser:%' LIMIT 100").all();let accepted=0;
 for(const {key} of users.results||[]){const ctx={verifiedUserId:key.slice(9)};for(const intent of intents){if(!Array.isArray(intent.newItems))continue;const eventId='briefing-'+(await digestText(intent.requestId)).slice(0,24);await push.enqueue(ctx,eventId,{title:'우리지역 전력에디터',body:'새 전력 소식이 있습니다. 앱에서 제목과 기사 출처를 확인하세요.',url:'/'},{createdAt:Date.parse(intent.finishedAt),items:intent.newItems})}accepted+=(await push.dispatch(ctx)).providerAccepted}
 return {enabled:true,providerAccepted:accepted,deviceDelivery:'unverified'}
 }catch{return {enabled:true,status:'dispatch_failed',deviceDelivery:'unverified'}}
}
export async function handleRuntime(request,env,{seedEvents={events:[]},editorialWorkflow={}}={}){
 const u=new URL(request.url);
 if(['/api/naver-search','/api/naver-search/config'].includes(u.pathname))return handleNaverSearch(request,env);
 // A public Site's platform gate is not writer authorization. Verify the operator service token's digest.
 if(env.SITE_PUBLIC_ACCESS==='true'){const token=request.headers.get('X-Editor-Updater')||'';const authenticated=token.length>=32&&token.length<=10000&&/^[a-f0-9]{64}$/.test(env.EDITOR_UPDATER_TOKEN_SHA256||'')&&await digestText(token)===env.EDITOR_UPDATER_TOKEN_SHA256;env={...env,updaterAuthenticated:authenticated};}
 if(u.pathname==='/api/editorial')return response({error:'news_ai_disabled',records:[]},410);
 if(u.pathname==='/api/naver-news/status'){
  if(!privateWriterAllowed(request,env))return response({error:'updater_not_authorized'},403);
  if(request.method!=='GET')return response({error:'method_not_allowed'},405);
  return response(naverNewsStatus(env));
 }
 if(u.pathname==='/api/editorial-preference'){
  if(!privateWriterAllowed(request,env)||request.headers.get('origin')!==u.origin)return response({error:'updater_not_authorized'},403);
  if(request.method!=='POST')return response({error:'method_not_allowed'},405);
  try{const body=await jsonBody(request,3000);if(Object.keys(body).some(k=>k!=='regions'))throw Error('regions_invalid');return response(await saveEditorialPreference(createD1SnapshotStore(env.DB),body.regions));}catch{return response({error:'preference_update_failed'},400)}
 }
 if(['/api/automation-summary','/api/editorial-workflow'].includes(u.pathname)){
  if(!privateWriterAllowed(request,env))return response({error:'updater_not_authorized'},403);
  if(request.method!=='GET')return response({error:'method_not_allowed'},405);
  if(u.pathname==='/api/editorial-workflow')return response(editorialWorkflow);
  const requestId=u.searchParams.get('requestId');if(!requestId||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(requestId))return response({error:'request_id_invalid'},400);
  const svc=snapshotService(request,env),ed=editorialService(request,env,seedEvents);
  const [stored,attempt,records,events]=await Promise.all([svc.readSnapshot(),svc.readRefreshAttempt(requestId),ed.readEditorial(),ed.readEvents()]);
  const selection=await reserveEditorialSelection(createD1SnapshotStore(env.DB),stored,attempt,records);
  return response(compactAutomationSummary(stored,attempt,records,events,Date.now(),selection));
 }
 if(['/api/editorial','/api/events'].includes(u.pathname)){
  if(u.pathname==='/api/events'&&request.method==='GET')return response(env.DB?await editorialService(request,env,seedEvents).readEvents():seedEvents);
  if(!privateWriterAllowed(request,env))return response({error:'updater_not_authorized'},403);
  if(request.method==='GET'&&u.pathname==='/api/editorial')return response(await editorialService(request,env,seedEvents).readEditorial());
  if(request.method!=='POST')return response({error:'method_not_allowed'},405);
  try{const body=await jsonBody(request,64000),service=editorialService(request,env,seedEvents);if(u.pathname==='/api/editorial'){const selection=(await createD1SnapshotStore(env.DB).read(EDITORIAL_SELECTION)).value;if(selection?.slot!==editorialSlot()||!Array.isArray(body.records)||body.records.length>5||body.records.some(r=>!selection.reviewable.some(i=>sameArticle(i,r))))return response({error:'outside_editorial_selection'},400);}return response(u.pathname==='/api/events'?await service.upsertEvents(body):await service.upsertEditorial(body))}catch(e){return response({error:typeof e.code==='string'?e.code:'editorial_update_invalid'},400)}
 }
 if(['/api/refresh','/api/dispatch'].includes(u.pathname)){
  if(request.method!=='POST')return response({error:'method_not_allowed'},405);
  if(!privateWriterAllowed(request,env))return response({error:'updater_not_authorized'},403);
  try{const b=await jsonBody(request),svc=snapshotService(request,env);
   if(u.pathname==='/api/dispatch'){if(!b||Object.keys(b).length)return response({error:'empty_body_required'},400);return response({pushes:await dispatchPending(env,svc)})}
   if(typeof b.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(b.requestId)||b.dispatch!==undefined&&typeof b.dispatch!=='boolean')return response({error:'request_id_invalid'},400);
   const prior=await svc.readRefreshAttempt(b.requestId);
   if(!prior){const budget=await reserveNewsRun(createD1SnapshotStore(env.DB),b.requestId);if(!budget.allowed)return response({error:'edition_already_requested',requestId:budget.requestId,slot:budget.slot},429);}
   const focused={status:'on_demand_only',notice:'Google RSS is collected only by visible-page requests.'};
   const [result,naver,demand]=await Promise.all([svc.refresh({requestId:b.requestId}),refreshNaverSearch(env),env.PUBLIC_DATA_SERVICE_KEY?handlePowerDemand(request,env).then(r=>r.json()).then(d=>({status:d.status,retention:d.retention})).catch(()=>({status:"unavailable"})):Promise.resolve({status:"not_configured"})]),after=await svc.readSnapshot();
   const pushes=b.dispatch===false?{enabled:pushService(env).state().enabled,status:'deferred'}:await dispatchPending(env,svc);
   return response({refresh:result,central:{status:after.status,checkedAt:after.checkedAt},naver,focused,demand,pushes});
  }catch(e){return response({error:['body_limit','content_type','request_id_invalid','body_required'].includes(e.message)?e.message:'refresh_failed'},400)}
 }
 if(!u.pathname.startsWith('/api/push/'))return null;
 if(u.pathname==='/api/push/config'&&request.method==='GET')return response({enabled:false,reason:'feature_removed'});
 return response({error:'notifications_removed'},410);
}
