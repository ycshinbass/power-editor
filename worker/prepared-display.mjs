import {createD1SnapshotStore} from './snapshot-d1.mjs';
// Public display responses only. Provider leases, quotas and timestamps remain authoritative.
const MINUTE=60000,HOUR=3600000,FRESH=10*MINUTE;
const routes={
 '/api/power-demand':[], '/api/power-flow':['part','date'],
 '/api/local-data':['city','regions','parts'], '/api/public-signals':['part'],
 '/api/focused-news':['category'], '/api/weather':['city']
};
const pending=new Map();
function keyFor(request){
 const u=new URL(request.url),allowed=routes[u.pathname];
 if(request.method!=='GET'||!allowed||u.search.length>6000)return null;
 if([...u.searchParams.keys()].some(k=>!allowed.includes(k)||u.searchParams.getAll(k).length!==1))return null;
 u.hash='';u.searchParams.sort();u.pathname='/__prepared-display/v1'+u.pathname;
 return new Request(u.href); // Deliberately no user headers, cookies or credentials.
}
function deadline(body,path,now){
 let records;
 if(path==='/api/local-data')records=['weather','weatherForecast','airQuality','earthquake'].filter(k=>body[k]).map(k=>body[k]);
 else if(path==='/api/public-signals')records=body.signals;
 else if(path==='/api/power-flow'&&body.supply?.status==='ok'&&!body.seriesValidated)records=[body.supply];
 else records=[body];
 if(!records?.length||records.some(d=>!['ok','partial','stale'].includes(d?.status)||d.refreshError||d.failureCode||d.fallback||d.reason&&!['refresh_pending'].includes(d.reason)))return null;
 const grace=path==='/api/focused-news'?24*HOUR:3*HOUR;
 let until=Infinity;
 for(const d of records){
  const stamp=Date.parse(d.checkedAt||d.fetchedAt),end=Date.parse(d.validUntil);
  if(!Number.isFinite(stamp)||stamp>now+MINUTE||stamp+grace<=now)return null;
  until=Math.min(until,stamp+grace,Number.isFinite(end)?end:Infinity);
 }
 // Never carry today's power/weather graph across a Korean date boundary.
 if(path!=='/api/focused-news')until=Math.min(until,Date.parse(new Date(now+9*HOUR).toISOString().slice(0,10)+'T00:00:00+09:00')+24*HOUR);
 return until>now?until:null;
}
async function visible(response,state){
 const headers=new Headers(response.headers);headers.set('Cache-Control','private, no-store');
 headers.delete('X-Prepared-Until');headers.set('X-Editor-Snapshot',state);
 if(state==='updating'){
  const body=await response.json(),mark=d=>d&&typeof d==='object'&&['ok','partial','stale'].includes(d.status)?{...d,stale:true,refreshPending:true}:d;
  const value=mark(body);if(body.signals)value.signals=body.signals.map(mark);
  for(const [key,d]of Object.entries(body))if(d&&typeof d==='object'&&!Array.isArray(d))value[key]=mark(d);
  return Response.json(value,{status:response.status,headers});
 }
 return new Response(response.body,{status:response.status,headers});
}
// Uses the existing shared table: Sites does not expose the Cache API in every runtime.
export function createPreparedCache(database){
 if(!database)return undefined;
 const store=createD1SnapshotStore(database),revisions=new Map();
 const id=async request=>'public:display:v1:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(request.url))),v=>v.toString(16).padStart(2,'0')).join('');
 return {
  async match(request){const key=await id(request),saved=await store.read(key);revisions.set(key,saved.version);const d=saved.value;return d?new Response(d.text,{status:d.status,headers:d.headers}):undefined;},
  async put(request,response){const key=await id(request),expiresAt=Number(response.headers.get('X-Prepared-Until'));
   await store.compareAndSwap(key,revisions.get(key)??null,{text:await response.text(),status:response.status,headers:[...response.headers],expiresAt});
   // Expired display copies have no archive value. Leave all provider/user records alone.
   await database.prepare("DELETE FROM editor_snapshots WHERE key >= 'public:display:v1:' AND key < 'public:display:v2:' AND json_extract(value, '$.expiresAt') <= ?").bind(Date.now()).run();
  }
 };
}
export async function preparedDisplay(request,ctx,load,{cache=globalThis.caches?.default,now=Date.now()}={}){
 const key=keyFor(request);
 if(!key||!cache||!ctx?.waitUntil)return load();
 let old;
 try{old=await cache.match(key);}catch{return load();}
 const created=Number(old?.headers.get('X-Editor-Prepared-At')),until=Number(old?.headers.get('X-Prepared-Until'));
 const usable=old&&Number.isFinite(created)&&created<=now&&until>now;
 if(usable&&now-created<FRESH)return visible(old,'hit');
 const refresh=()=>{
  if(pending.has(key.url))return pending.get(key.url);
  const task=(async()=>{
   const response=await load();
   if(response.status!==200||!(response.headers.get('Content-Type')||'').includes('application/json'))return response;
   try{
    const text=await response.clone().text();if(new TextEncoder().encode(text).length>500000)return response;
    const expires=deadline(JSON.parse(text),new URL(request.url).pathname,now);if(!expires)return response;
    const headers=new Headers(response.headers);headers.delete('Set-Cookie');
    headers.set('Cache-Control','public, max-age='+Math.max(1,Math.floor((expires-now)/1000)));
    headers.set('X-Editor-Prepared-At',String(now));headers.set('X-Prepared-Until',String(expires));
    await cache.put(key,new Response(text,{status:200,headers}));
   }catch{ /* A display cache failure cannot break a valid live response. */ }
   return response;
  })().finally(()=>pending.delete(key.url));pending.set(key.url,task);return task;
 };
 if(usable){ctx.waitUntil(refresh().then(()=>{}).catch(()=>{}));return visible(old,'updating');}
 return visible((await refresh()).clone(),'miss');
}
