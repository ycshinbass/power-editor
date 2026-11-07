import test from 'node:test';import assert from 'node:assert/strict';
import {googleRssFetch,readGoogleRssState,GOOGLE_RSS_REFRESH_MS,GOOGLE_RSS_MAX_AGE_MS} from '../worker/google-rss-transport.mjs';
import {collectFocusedNews} from '../worker/focused-news.mjs';
import {collectBriefing,clearFeedMemory,limitGoogleNewsAge} from '../worker/feed.mjs';
import {googleNewsSources} from '../worker/google-news.mjs';
const url='https://news.google.com/rss/search?q=test',start=Date.parse('2026-11-05T01:00:00Z');
function memory(initial={}){const rows=new Map(Object.entries(initial).map(([k,value])=>[k,{value,version:'0'}]));let n=0;return {rows,read:async k=>structuredClone(rows.get(k)||{value:null,version:null}),compareAndSwap:async(k,v,value)=>{if((rows.get(k)?.version||null)!==v)return {applied:false};const version=String(++n);rows.set(k,{value:structuredClone(value),version});return {applied:true,version};}};}
const rss=()=>new Response('<rss><channel></channel></rss>',{headers:{'content-type':'application/xml'}});
test('a traffic rejection stops all categories until cooldown, then a successful probe restores requests',async()=>{
 const store=memory();let now=start,calls=0;
 const fetchFn=async()=>{calls++;return calls===1?new Response('<title>Sorry...</title>automated queries',{status:503}):rss();};
 await assert.rejects(googleRssFetch(url,{}, {store,fetchFn,clock:()=>now}),e=>e.upstream.kind==='google_traffic_challenge'&&Date.parse(e.retryAt)===start+3600000);
 now+=1000;await assert.rejects(googleRssFetch(url+'&q=other',{}, {store,fetchFn,clock:()=>now}),/google_rss_cooldown/);assert.equal(calls,1);
 now=start+3600001;assert.equal((await googleRssFetch(url,{}, {store,fetchFn,clock:()=>now})).status,200);assert.equal(calls,2);assert.equal((await readGoogleRssState(store)).value.blockedUntil,0);
});
test('an observed pre-upgrade rejection is honored without sending a new probe',async()=>{
 const store=memory({'focused-news:v2:kepco':{data:{checkedAt:new Date(start).toISOString(),upstream:{kind:'google_traffic_challenge',httpStatus:503}}}});
 await assert.rejects(googleRssFetch(url,{}, {store,clock:()=>start+1000,fetchFn:()=>assert.fail('must not request')}),/google_rss_cooldown/);
});
test('concurrent collectors do not send parallel RSS requests and preserve retry metadata',async()=>{
 const store=memory();let release,calls=0;
 const pending=new Promise(r=>release=r),fetchFn=async()=>{calls++;await pending;return rss()};
 const a=googleRssFetch(url,{}, {store,fetchFn,clock:()=>start});
 while(!calls)await new Promise(r=>setImmediate(r));
 await assert.rejects(googleRssFetch(url,{}, {store,fetchFn,clock:()=>start}),e=>e.message==='google_rss_busy'&&Date.parse(e.retryAt)>start);
 release();await a;assert.equal(calls,1);
});
test('Retry-After is honored and HTML success pages never masquerade as empty RSS',async()=>{
 const store=memory();await assert.rejects(googleRssFetch(url,{}, {store,clock:()=>start,fetchFn:async()=>new Response('Unavailable',{status:503,headers:{'retry-after':'7200'}})}),e=>Date.parse(e.retryAt)===start+7200000);
 await assert.rejects(googleRssFetch(url,{}, {store:memory(),clock:()=>start,fetchFn:async()=>new Response('<html>not a feed</html>')}),/invalid_feed/);
 assert.equal((await googleRssFetch(url,{}, {store:memory(),clock:()=>start,fetchFn:async()=>new Response('<rss><channel><title>captcha news</title></channel></rss>')})).status,200);
});
test('a shared cooldown does not consume category retry attempts or erase a recent success',async()=>{
 const item={title:'순천 아파트 정전 발생…300가구 복구',url:'https://news.google.com/rss/articles/abc',publishedAt:new Date(start).toISOString(),publisherName:'시험'};
 const store=memory({'google-rss:transport:v1':{blockedUntil:start+1800000,upstream:{kind:'google_traffic_challenge'}},'focused-news:v1:outage':{slot:Math.floor(start/3600000)-1,lastGood:{status:'ok',checkedAt:new Date(start-7200000).toISOString(),items:[item]}}});
 const result=await collectFocusedNews({},'outage',{store,now:start,fetchFn:()=>assert.fail('must not request')});
 assert.equal(result.items.length,1);assert.equal(result.refreshError,true);assert.equal(result.checkedAt,new Date(start-7200000).toISOString());assert.equal(store.rows.get('focused-news:v1:outage').value.attempts,0);assert.equal(Date.parse(result.retryAt),start+1800000);
 const boundary=await collectFocusedNews({},'outage',{store,now:start+22*3600000,fetchFn:async()=>new Response('offline',{status:503})});assert.equal(boundary.items.length,1);assert.equal(boundary.checkedAt,result.checkedAt);
 const expired=await collectFocusedNews({},'outage',{store,now:start+22*3600000+1,fetchFn:()=>assert.fail('wait for retry')});assert.equal(expired.items.length,0);assert.equal(expired.status,'unavailable');
});

test('a saved v103 cooldown adopts the longer one-hour minimum',async()=>{
 const store=memory({'google-rss:transport:v1':{failures:1,lastFailureAt:start,blockedUntil:start+1800000}});
 await assert.rejects(googleRssFetch(url,{}, {store,clock:()=>start+1800001,fetchFn:()=>assert.fail('must wait')}),e=>Date.parse(e.retryAt)===start+3600000);
});
test('focused success and failure both wait a rolling two hours across clock-hour boundaries',async()=>{
 const at=start+59*60000;
 for(const succeeds of [true,false]){
  const store=memory();let calls=0;const fetchFn=async()=>{calls++;return succeeds?rss():new Response('offline',{status:503})};
  const first=await collectFocusedNews({},'power',{store,now:at,fetchFn});
  await collectFocusedNews({},'power',{store,now:at+2*60000,fetchFn});
  await collectFocusedNews({},'power',{store,now:at+7199999,fetchFn});assert.equal(calls,1);
  await collectFocusedNews({},'power',{store,now:at+7200000,fetchFn});assert.equal(calls,2);
  if(succeeds)assert.equal(Date.parse(first.expiresAt),at+7200000);
 }
});
test('busy deferrals never restart a rolling hour or block a first successful collection',async()=>{
 const store=memory({'google-rss:transport:v1':{nextAt:start+2000}});let calls=0;const fetchFn=async()=>{calls++;return rss()};
 assert.equal((await collectFocusedNews({},'power',{store,now:start,fetchFn})).status,'updating');
 assert.equal((await collectFocusedNews({},'power',{store,now:start+2001,fetchFn})).status,'ok');assert.equal(calls,1);
});
test('regional Google cache survives a new isolate for two hours and expires after twenty-four hours',async()=>{
 clearFeedMemory();const store=memory(),source=googleNewsSources()[1];let calls=0,fail=false;
 const xml='<rss><channel><item><title>한전 송전망 기술 사업 - 시험언론</title><link>https://news.google.com/rss/articles/abc</link><pubDate>'+new Date(start).toUTCString()+'</pubDate><source>시험언론</source></item></channel></rss>';
 const fetchFn=async()=>{calls++;return fail?new Response('offline',{status:503}):new Response(xml)};
 const get=now=>collectBriefing([],{sources:[source],store,now,fetchFn});
 assert.equal((await get(start)).items.length,1);clearFeedMemory();
 assert.equal((await get(start+GOOGLE_RSS_REFRESH_MS-1)).items.length,1);assert.equal(calls,1);
 fail=true;const cached=await get(start+GOOGLE_RSS_MAX_AGE_MS);assert.equal(cached.items.length,1);assert.equal(cached.sources[0].checkedAt,new Date(start).toISOString());
 clearFeedMemory();const expired=await get(start+GOOGLE_RSS_MAX_AGE_MS+1);assert.equal(expired.items.length,0);assert.equal(expired.sources[0].status,'error');assert.equal(calls,2);
});
test('central delivery expires only Google material by original collection time',()=>{
 const checkedAt=new Date(start).toISOString(),google={sourceId:'google-test',checkedAt,title:'한전'},official={sourceId:'official-test',checkedAt,title:'기관'};
 const payload={items:[google,official],sources:[{id:'google-test',checkedAt,status:'ok'},{id:'official-test',checkedAt,status:'ok'}]};
 assert.equal(limitGoogleNewsAge(payload,start+GOOGLE_RSS_MAX_AGE_MS).items.length,2);
 const expired=limitGoogleNewsAge(payload,start+GOOGLE_RSS_MAX_AGE_MS+1);assert.deepEqual(expired.items,[official]);assert.equal(expired.sources[0].status,'error');
});
test('serialized Google sources advance the shared clock and retain verified empty results',async()=>{
 clearFeedMemory();const store=memory(),sources=googleNewsSources().slice(0,2);let calls=0;
 const good=await collectBriefing([],{sources,store,now:start,fetchFn:async()=>{calls++;return rss()}});
 assert.equal(calls,2);assert.equal(good.coverage.successful,2);
 const cached=await collectBriefing([],{sources:[sources[0]],store,now:start+22*3600000,fetchFn:async()=>new Response('offline',{status:503})});
 assert.equal(cached.sources[0].status,'stale');assert.equal(cached.sources[0].itemCount,0);assert.equal(cached.sources[0].checkedAt,new Date(start).toISOString());
});
