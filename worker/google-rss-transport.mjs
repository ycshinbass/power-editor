// Each configured collection route shares its cooldown across all page requests.
// The optional fallback is demand-driven; it never resets the primary cooldown.
const KEY='google-rss:transport:v1',MINUTE=60000;
export const GOOGLE_RSS_REFRESH_MS=120*MINUTE;
export const GOOGLE_RSS_MAX_AGE_MS=24*60*MINUTE;
const retryDelay=failures=>Math.min(60*MINUTE*2**Math.min(Math.max(0,failures-1),4),6*60*MINUTE);
const legacyKeys=['focused-news:v1:outage','focused-news:v2:kepco','focused-news:v1:power'];
const failure=(code,upstream,retryAt)=>Object.assign(Error(code),{upstream,retryAt});
export async function readGoogleRssState(store,stateKey=KEY){
 let state=await store.read(stateKey);
 if(state.value)return state;
 if(stateKey!==KEY)return state;
 // Preserve a rejection already observed before this shared gate was installed.
 const legacy=await Promise.all(legacyKeys.map(k=>store.read(k)));
 const blocked=legacy.map(x=>x.value?.data).filter(d=>d?.upstream?.kind==='google_traffic_challenge').sort((a,b)=>Date.parse(b.attemptedAt||b.checkedAt)-Date.parse(a.attemptedAt||a.checkedAt))[0];
 if(blocked){const at=Date.parse(blocked.attemptedAt||blocked.checkedAt);if(Number.isFinite(at)){
  await store.compareAndSwap(KEY,null,{failures:1,blockedUntil:at+60*MINUTE,upstream:blocked.upstream,leaseUntil:0,nextAt:0,lastFailureAt:at});
  state=await store.read(KEY);
 }}
 return state;
}
async function boundedText(response){
 if(Number(response.headers.get('content-length'))>750000)throw Error('rss_size_limit');
 const reader=response.body?.getReader();if(!reader)return '';
 const decoder=new TextDecoder();let text='',size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>750000)throw Error('rss_size_limit');text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}finally{await reader.cancel().catch(()=>{});}
}
export function googleRssResponseDetails(response,text=''){
 return {httpStatus:response.status,kind:/unusual traffic|automated queries|captcha|\/sorry\//i.test(text)?'google_traffic_challenge':/temporarily unavailable|service unavailable|temporary error|server error/i.test(text)?'service_unavailable':/access denied|forbidden/i.test(text)?'access_denied':'http_error',contentType:response.headers.get('content-type'),server:response.headers.get('server'),retryAfter:response.headers.get('retry-after'),title:(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').slice(0,120)};
}
export async function googleRssFetch(url,options,{store,fetchFn=fetch,clock=Date.now,stateKey=KEY}={}){
 const u=new URL(url);if(u.origin!=='https://news.google.com'||u.pathname!=='/rss/search')throw Error('rss_url_invalid');
 if(!store)throw Error('rss_storage_required');
 const now=clock(),old=await readGoogleRssState(store,stateKey),value=old.value||{};
 const blockedUntil=Math.max(value.blockedUntil||0,value.failures&&value.lastFailureAt?value.lastFailureAt+retryDelay(value.failures):0);
 if(blockedUntil>now)throw failure('google_rss_cooldown',value.upstream,new Date(blockedUntil).toISOString());
 const due=Math.max(value.leaseUntil||0,value.nextAt||0);
 if(due>now)throw failure('google_rss_busy',undefined,new Date(due).toISOString());
 const claim=await store.compareAndSwap(stateKey,old.version,{...value,leaseUntil:now+15000});
 if(!claim.applied)throw failure('google_rss_busy',undefined,new Date(now+15000).toISOString());
 try{
  const response=await fetchFn(u,{...options,signal:AbortSignal.timeout(10000),redirect:'manual'});
  const text=await boundedText(response),details=googleRssResponseDetails(response,text);
  const feed=/<rss[\s>]|<feed[\s>]/i.test(text);
  if(!response.ok||!feed&&details.kind==='google_traffic_challenge')throw failure('upstream_http_'+response.status,details);
  if(!feed)throw failure('invalid_feed',details);
  await store.compareAndSwap(stateKey,claim.version,{failures:0,blockedUntil:0,leaseUntil:0,nextAt:clock()+2000,lastSuccessAt:clock()});
  return new Response(text,{status:response.status,headers:response.headers});
 }catch(error){
  const at=clock(),failures=(value.failures||0)+1,backoff=retryDelay(failures);
  const retry=error.upstream?.retryAfter,headerAt=retry&&/^\d+$/.test(retry)?at+Number(retry)*1000:Date.parse(retry);
  const blockedUntil=Math.max(at+backoff,Number.isFinite(headerAt)?headerAt:0);
  const upstream=error.upstream||{httpStatus:null,kind:error.name==='TimeoutError'?'timeout':'transport_error'};
  await store.compareAndSwap(stateKey,claim.version,{failures,blockedUntil,leaseUntil:0,nextAt:0,lastFailureAt:at,upstream});
  console.warn(JSON.stringify({event:'google_rss_failure',route:stateKey===KEY?'sites':'cloudflare-fallback',at:new Date(at).toISOString(),...upstream,retryAt:new Date(blockedUntil).toISOString()}));
  throw failure(error.message,upstream,new Date(blockedUntil).toISOString());
 }
}
