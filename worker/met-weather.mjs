import {WEATHER_CITIES} from './weather.mjs';
import {createD1SnapshotStore} from './snapshot-d1.mjs';
import {normalizeMet} from './met-normalize.mjs';
const MET_UA='PowerEditor/0.2 (+https://power-editor-design-1031.keenibis32.chatgpt.site)';
const metMemory=new Map(),metInFlight=new Map();
const metResponse=data=>Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
function unavailable(city,code,now,until){return {status:'unavailable',city,source:'MET Norway',checkedAt:new Date(now).toISOString(),error:'모델 예보를 확인할 수 없습니다. 공식 기상정보를 확인하세요.',errorCode:code,...(until?{retryAt:new Date(until).toISOString()}:{}),officialWarning:'unavailable',wildfire:'unavailable'}}
export function retryAt(value,now,defaultMs=3600000){const seconds=/^\d+$/.test(value||'')?Number(value):NaN,parsed=Number.isFinite(seconds)?now+seconds*1000:Date.parse(value||'');return Number.isFinite(parsed)&&parsed>now&&parsed<8640000000000000?parsed:now+defaultMs}
async function boundedMetBody(r){if(Number(r.headers.get('content-length'))>250000)throw Error('body_limit');const reader=r.body?.getReader();if(!reader)throw Error('body_invalid');let length=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>250000)throw Error('body_limit');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}const bytes=new Uint8Array(length);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}
function metStore(env){
 const d1=env.DB?createD1SnapshotStore(env.DB):null;
 return {
  async read(k){const local=metMemory.get(k)||null;if(!d1)return local;const saved=(await d1.read(k)).value;if(k==='weather:met:backoff')return local||saved?{retryAt:Math.max(local?.retryAt||0,saved?.retryAt||0)}:null;if(!local)return saved;if(!saved)return local;const latest=Date.parse(local.fetchedAt||'')>Date.parse(saved.fetchedAt||'')?local:saved;return {...latest,retryAt:Math.max(local.retryAt||0,saved.retryAt||0)}},
  async write(k,value){if(k==='weather:met:backoff')value={...value,retryAt:Math.max(value.retryAt||0,metMemory.get(k)?.retryAt||0)};metMemory.set(k,value);if(!d1)return;
   for(let i=0;i<4;i++){const old=await d1.read(k);if(k==='weather:met:backoff')value={...value,retryAt:Math.max(value.retryAt||0,old.value?.retryAt||0)};if((await d1.compareAndSwap(k,old.version,value)).applied)return}throw Error('cache_write_conflict');
  }
 }
}
export async function handleMetWeather(request,env={},options={}){
 const city=new URL(request.url).searchParams.get('city')||'순천';if(!Object.hasOwn(WEATHER_CITIES,city))return Response.json({status:'unavailable',error:'지원하지 않는 지역입니다.'},{status:400});
 const [lat,lon]=WEATHER_CITIES[city],key=`weather:met:${lat}:${lon}`,now=options.now?.()??Date.now(),fetchFn=options.fetchFn||fetch,store=metStore(env);
 try{
  const cached=await store.read(key),global=await store.read('weather:met:backoff');
  if(cached?.nextFetchAt>now&&cached?.raw){const data=normalizeMet(cached.raw,city,cached.fetchedAt,new Date(now).toISOString());return metResponse({...data,fromCache:true})}
  const fallback=(failure)=>{const age=now-Date.parse(cached?.fetchedAt);if(cached?.raw&&age>=0&&age<=3*3600000){try{return {...normalizeMet(cached.raw,city,cached.fetchedAt,new Date(now).toISOString()),stale:true,refreshError:failure.reason||'provider_failure',fallback:true}}catch{}}return failure};
  const retry=Math.max(global?.retryAt||0,cached?.retryAt||0);if(retry>now)return metResponse(fallback(unavailable(city,'provider_backoff',now,retry)));
  if(metInFlight.has(key))return metResponse(await metInFlight.get(key));
  const operation=(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
   try{
    let url=new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');url.searchParams.set('lat',String(lat));url.searchParams.set('lon',String(lon));
    const headers={'User-Agent':MET_UA,'Accept-Encoding':'gzip, deflate',...(cached?.lastModified?{'If-Modified-Since':cached.lastModified}:{})};
    let r;for(let redirects=0;redirects<3;redirects++){r=await fetchFn(url,{headers,signal:controller.signal,redirect:'manual'});if(![301,302,303,307,308].includes(r.status))break;const location=r.headers.get('location');await r.body?.cancel().catch(()=>{});if(!location||redirects===2)throw Error('redirect_rejected');const next=new URL(location,url);if(next.origin!=='https://api.met.no'||next.username||next.password||next.hash)throw Error('redirect_rejected');url=next}
    if(r.status===429){const until=retryAt(r.headers.get('retry-after'),now);await r.body?.cancel().catch(()=>{});await store.write('weather:met:backoff',{retryAt:until});return unavailable(city,'provider_rate_limited',now,until)}
    if(r.status===403){await r.body?.cancel().catch(()=>{});const until=now+24*3600000;await store.write('weather:met:backoff',{retryAt:until});return unavailable(city,'provider_access_restricted',now,until)}
    const expires=Date.parse(r.headers.get('expires')||''),nextFetchAt=Number.isFinite(expires)&&expires>now?expires:now+1800000;
    if(r.status===304){if(!cached?.raw)throw Error('invalid_not_modified');const data=normalizeMet(cached.raw,city,new Date(now).toISOString());await store.write(key,{...cached,nextFetchAt,fetchedAt:new Date(now).toISOString(),retryAt:0});return {...data,notModified:true}}
    if(!r.ok){const until=retryAt(r.headers.get('retry-after'),now,1800000);await r.body?.cancel().catch(()=>{});await store.write(key,{...(cached||{}),retryAt:until,nextFetchAt:0});return unavailable(city,'upstream_http',now,until)}
    const raw=await boundedMetBody(r),data=normalizeMet(raw,city,new Date(now).toISOString());
    await store.write(key,{raw,nextFetchAt,lastModified:(r.headers.get('last-modified')||'').length<=100&&Number.isFinite(Date.parse(r.headers.get('last-modified')||''))?r.headers.get('last-modified'):null,fetchedAt:new Date(now).toISOString(),retryAt:0});
    return {...data,...(r.status===203?{providerWarning:'deprecated_version'}:{})};
   }catch(e){const code=controller.signal.aborted?'timeout':['body_limit','body_invalid','redirect_rejected','upstream_http','invalid_not_modified'].includes(e.message)?e.message:'provider_data_invalid';const until=now+1800000;await store.write(key,{...(cached||{}),retryAt:until,nextFetchAt:0});return unavailable(city,code,now,until)}finally{clearTimeout(timer)}
  })();metInFlight.set(key,operation);try{const result=await operation;return metResponse(result.status==='ok'?result:fallback(result))}finally{metInFlight.delete(key)}
 }catch{return metResponse(unavailable(city,'cache_unavailable',now))}
}
export function clearMetMemory(){metMemory.clear();metInFlight.clear()}
