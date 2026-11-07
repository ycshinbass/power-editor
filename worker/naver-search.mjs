import {REGION_CATALOG} from '../frontend/regions.js';
import {naverNewsStatus,requestNaverNews} from './naver-news.mjs';
import {createD1SnapshotStore} from './snapshot-d1.mjs';

const PREFIX='api:naver:search:';
const HOUR=3600000;
const categories={power:'전력',kepco:'한국전력'};
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function naverSearchTarget(category='power',region=''){
  if(category==='local'){
    const place=REGION_CATALOG.find(r=>r.id===region);
    if(!place)fail('region_required');
    const index=REGION_CATALOG.indexOf(place);
    return {key:PREFIX+'local-'+index,category,region:place.id,query:place.id+' 전력'};
  }
  if(!Object.hasOwn(categories,category)||region)fail('query_invalid');
  return {key:PREFIX+category,category,region:'',query:categories[category]};
}
function validLink(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}}
export function validateNaverResult(data){
  if(!data||!Array.isArray(data.items)||data.items.length>5||!Number.isSafeInteger(data.total)||data.total<0||data.start!==1||!Number.isInteger(data.display)||data.display<0||data.display>5)fail('naver_response_invalid');
  if(data.items.some(i=>!i||typeof i.title!=='string'||typeof i.description!=='string'||i.title.length>2000||i.description.length>10000||!validLink(i.link)||i.originallink&&!validLink(i.originallink)||typeof i.pubDate!=='string'))fail('naver_response_invalid');
  return data; // Original response fields, content and item order remain intact.
}
export async function readNaverSearch({env,target,store,fetchImpl=fetch,now=Date.now()}={}){
  if(!naverNewsStatus(env,now).enabled)return {enabled:false,status:'not_configured'};
  const slot=Math.floor(now/HOUR),old=await store.read(target.key);
  let attempt=1;
  if(old.value?.slot===slot){
    if(old.value.result)return {enabled:true,status:'ok',query:target.query,checkedAt:old.value.checkedAt,expiresAt:old.value.expiresAt,result:old.value.result};
    const age=now-(old.value.startedAt??old.value.expiresAt-HOUR);
    if(old.value.status!=='updating')return {enabled:true,status:old.value.status,query:target.query};
    if(age<15000)return {enabled:true,status:'updating',query:target.query,retryAfter:5};
    if((old.value.attempt||1)>=2)return {enabled:true,status:'temporarily_unavailable',query:target.query};
    attempt=(old.value.attempt||1)+1;
  }
  // Replace the prior result before a new query. No indefinite fallback/cache.
  const pending={...target,slot,attempt,startedAt:now,status:'updating',checkedAt:null,expiresAt:now+HOUR,result:null};
  const lock=await store.compareAndSwap(target.key,old.version,pending);
  if(!lock.applied)return {enabled:true,status:'updating',query:target.query};
  try{
    const result=validateNaverResult(await requestNaverNews({env,store,query:target.query,requestId:'search.'+slot+'.'+target.key.slice(PREFIX.length)+'.r'+attempt,fetchImpl,now}));
    const value={...pending,status:'ok',checkedAt:new Date(now).toISOString(),result};
    if(!(await store.compareAndSwap(target.key,lock.version,value)).applied)return {enabled:true,status:'updating',query:target.query};
    return {enabled:true,status:'ok',query:target.query,checkedAt:value.checkedAt,expiresAt:value.expiresAt,result};
  }catch(error){
    if(error.code==='naver_rate_limited'){
      await store.compareAndSwap(target.key,lock.version,{...pending,slot:-1,status:'updating'});
      return {enabled:true,status:'updating',query:target.query,retryAfter:2};
    }
    const status=['naver_quota_exhausted','naver_rate_limited'].includes(error.code)?'usage_limited':'temporarily_unavailable';
    await store.compareAndSwap(target.key,lock.version,{...pending,status});
    return {enabled:true,status,query:target.query};
  }
}
export async function cleanupNaverSearch(DB,now=Date.now()){
  // This namespace holds only temporary search results, never user preferences.
  await DB.prepare("DELETE FROM editor_snapshots WHERE key LIKE 'api:naver:search:%' AND json_extract(value, '$.expiresAt') <= ?").bind(now).run();
}
export async function handleNaverSearch(request,env,{now=Date.now(),fetchImpl=fetch}={}){
  const u=new URL(request.url),headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  const reply=(body,status=200)=>Response.json(body,{status,headers});
  if(request.method!=='GET')return reply({error:'method_not_allowed'},405);
  const enabled=!!env.DB&&naverNewsStatus(env,now).enabled;
  if(u.pathname==='/api/naver-search/config')return reply({enabled,provider:'NAVER API HUB',categories:['power','local','kepco'],ai:false,cadence:'on_demand',display:5});
  if(!enabled)return reply({enabled:false,status:'not_configured'},503);
  let target;try{
    if([...u.searchParams.keys()].some(k=>!['category','region'].includes(k)))fail('query_invalid');
    target=naverSearchTarget(u.searchParams.get('category')||'power',u.searchParams.get('region')||'');
  }catch{return reply({enabled:true,error:'query_invalid'},400);}
  try{
    await cleanupNaverSearch(env.DB,now);
    return reply(await readNaverSearch({env,target,store:createD1SnapshotStore(env.DB),fetchImpl,now}));
  }catch{return reply({enabled:true,status:'temporarily_unavailable'},503);}
}
// On-demand only: scheduled refresh never enumerates or fetches regional searches.
export async function refreshNaverSearch(){return {enabled:false,status:'on_demand_only'};}
