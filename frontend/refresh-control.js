// One request per resource; identical clicks share work, changed selections cancel old I/O.
export function latestRequest(fetcher=fetch,timeoutMs=20000){
 let active=null;
 return {run(url){
  if(active?.url===url)return active.promise;
  active?.controller.abort(Object.assign(Error('superseded'),{code:'superseded'}));
  const controller=new AbortController(),entry={url,controller};active=entry;
  const timer=setTimeout(()=>controller.abort(Object.assign(Error('request timeout'),{code:'request_timeout'})),timeoutMs);
  entry.promise=Promise.resolve().then(()=>fetcher(url,{cache:'no-store',signal:controller.signal})).then(async r=>{if(!r.ok)throw Error('request failed');const value=await r.json();if(controller.signal.aborted)throw controller.signal.reason;if(active!==entry)throw Object.assign(Error('superseded'),{code:'superseded'});return value}).catch(error=>{if(controller.signal.aborted)throw controller.signal.reason;throw error}).finally(()=>{clearTimeout(timer);if(active===entry)active=null});
  return entry.promise;
 },cancel(){if(!active)return false;active.controller.abort(Object.assign(Error('request cancelled'),{code:'request_cancelled'}));active=null;return true}};
}
export function staleLocal(value){
 if(!value||typeof value!=='object')return value;
 const mark=items=>Array.isArray(items)?items.map(item=>({...item,stale:true})):items;
 return {...value,stale:true,items:mark(value.items),nearestCandidates:mark(value.nearestCandidates),groups:Array.isArray(value.groups)?value.groups.map(group=>({...group,stale:true,items:mark(group.items)})):value.groups};
}
export function mergeLocal(previous,next){
 const result={...previous,...next};
 for(const [key,value] of Object.entries(next||{}))if(value&&typeof value==='object'&& !['ok','partial','stale'].includes(value.status)&&['ok','partial','stale'].includes(previous?.[key]?.status))result[key]=key==='weather'&&value.reason==='refresh_pending'&&!previous[key].stale&&!previous[key].refreshError&&Number.isFinite(Date.parse(previous[key].referenceAt))&&Date.now()-Date.parse(previous[key].referenceAt)<=7200000?{...previous[key],refreshPending:true}:{...staleLocal(previous[key]),refreshError:value.reason||value.status};
 return result;
}
// No polling timer: revisit an old visible tab, but never fetch merely because it is hidden.
export function onVisibleRefresh(doc,refresh,minimumMs=15*60*1000,now=()=>Date.now()){
 let last=now();
 const listener=()=>{if(doc.visibilityState==='visible'&&now()-last>=minimumMs){last=now();refresh()}};
 doc.addEventListener('visibilitychange',listener);
 const cleanup=()=>doc.removeEventListener('visibilitychange',listener);cleanup.touch=()=>{last=now()};return cleanup;
}

export const intentionalCancellation=error=>['request_cancelled','superseded'].includes(error?.code);
