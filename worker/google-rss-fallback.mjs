import {googleRssFetch,GOOGLE_RSS_REFRESH_MS,GOOGLE_RSS_MAX_AGE_MS} from './google-rss-transport.mjs';

export const GOOGLE_FALLBACK_KEY='google-rss:transport:cloudflare-fallback:v1';
export const GOOGLE_FALLBACK_URL='https://power-editor-news-fallback.suncheon-ops.workers.dev/rss';
export function googleNewsMaxAge(data){return GOOGLE_RSS_MAX_AGE_MS;}
export function googleFallbackConfigured(env){return env?.GOOGLE_NEWS_FALLBACK_URL===GOOGLE_FALLBACK_URL&&typeof env.GOOGLE_NEWS_FALLBACK_TOKEN==='string'&&env.GOOGLE_NEWS_FALLBACK_TOKEN.length>=32;}

// Callers alone know whether a successful, matching primary snapshot is usable.
// A busy primary is not a failed primary. Both paths preserve their own backoff.
export async function googleRssWithFallback(url,options,{store,fetchFn=fetch,clock=Date.now,env={},allowFallback=false,primaryFailure=null}={}){
 try{
  if(primaryFailure)throw primaryFailure;
  const response=await googleRssFetch(url,options,{store,fetchFn,clock});
  response.headers.set('X-Power-Collection-Path','sites');
  return response;
 }catch(primary){
  if(!allowFallback||!googleFallbackConfigured(env)||primary.message==='google_rss_busy')throw primary;
  try{
   const relay=async(target,requestOptions)=>{
    // Fixed destination, fixed Google host, no cookies, redirect, or arbitrary proxy URL.
    const response=await fetchFn(GOOGLE_FALLBACK_URL,{method:'POST',redirect:'manual',signal:requestOptions.signal,headers:{Authorization:'Bearer '+env.GOOGLE_NEWS_FALLBACK_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({url:String(target)})});
    if(response.headers.get('X-Power-News-Collector')!=='1')throw Error('fallback_response_invalid');
    return response;
   };
   const response=await googleRssFetch(url,options,{store,fetchFn:relay,clock,stateKey:GOOGLE_FALLBACK_KEY});
   response.headers.set('X-Power-Collection-Path','cloudflare-fallback');
   return response;
  }catch(secondary){
   const dates=[primary.retryAt,secondary.retryAt].map(Date.parse).filter(n=>Number.isFinite(n)&&n>clock());
   throw Object.assign(Error(secondary.message),{upstream:secondary.upstream,retryAt:dates.length?new Date(Math.min(...dates)).toISOString():secondary.retryAt,primaryFailure:primary.message,fallbackAttempted:true});
  }
 }
}
