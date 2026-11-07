import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFocusedNews} from '../worker/focused-news.mjs';
import {collectBriefing,clearFeedMemory,limitGoogleNewsAge} from '../worker/feed.mjs';
import {googleNewsSources} from '../worker/google-news.mjs';
import {GOOGLE_FALLBACK_KEY,GOOGLE_FALLBACK_URL,googleRssWithFallback} from '../worker/google-rss-fallback.mjs';
import {collect as relay} from '../cloudflare-news-fallback/worker.mjs';
import {lastGoodCache} from '../frontend/last-good.js';
import {readFile} from 'node:fs/promises';
const HOUR=3600000,start=Date.parse('2026-11-06T00:00:00Z'),iso=n=>new Date(n).toISOString();
const token='test-only-not-a-real-key-1234567890123456789';
const env={GOOGLE_NEWS_FALLBACK_URL:GOOGLE_FALLBACK_URL,GOOGLE_NEWS_FALLBACK_TOKEN:token};
const primaryKey='google-rss:transport:v1',categoryKey='focused-news:v1:power';
const rss='<rss><channel><item><title>한전 송전망 기술 사업 - 시험언론</title><link>https://news.google.com/rss/articles/test</link><pubDate>'+new Date(start).toUTCString()+'</pubDate><source>시험언론</source></item></channel></rss>';
function memory(initial={}){const rows=new Map(Object.entries(initial).map(([k,value])=>[k,{value,version:'0'}]));let n=0;return {rows,read:async k=>structuredClone(rows.get(k)||{value:null,version:null}),compareAndSwap:async(k,v,value)=>{if((rows.get(k)?.version||null)!==v)return {applied:false};const version=String(++n);rows.set(k,{value:structuredClone(value),version});return {applied:true,version};}};}
const success=()=>new Response(rss,{headers:{'content-type':'application/rss+xml'}});
const failed=()=>new Response('<title>Sorry...</title>automated queries',{status:503});
function network({primary=false,secondary=true}={}){const calls=[];return {calls,fetchFn:async(u,o)=>{calls.push(new URL(u).hostname);if(String(u)===GOOGLE_FALLBACK_URL){assert.equal(o.headers.Authorization,'Bearer '+token);const r=secondary?success():failed();r.headers.set('X-Power-News-Collector','1');return r;}return primary?success():failed();}};}
const good=(at,extra={})=>({status:'ok',category:'power',items:[],checkedAt:iso(at),...extra});

test('primary success is shared for two hours without calling fallback',async()=>{
 const store=memory(),n=network({primary:true});
 const first=await collectFocusedNews(env,'power',{store,now:start,fetchFn:n.fetchFn});
 assert.equal(first.collectionPath,'sites');assert.equal(first.items.length,1);
 await collectFocusedNews(env,'power',{store,now:start+2*HOUR-1,fetchFn:n.fetchFn});
 assert.deepEqual(n.calls,['news.google.com']);
});
test('primary failure with a twenty-four-hour valid snapshot never calls fallback, including verified empty results',async()=>{
 for(const age of [2*HOUR,24*HOUR]){
  const store=memory({[categoryKey]:{lastGood:good(start-age)}}),n=network();
  const d=await collectFocusedNews(env,'power',{store,now:start,fetchFn:n.fetchFn});
  assert.equal(d.status,'ok');assert.equal(d.refreshError,true);assert.equal(d.checkedAt,iso(start-age));assert.deepEqual(n.calls,['news.google.com']);
 }
});
test('cold failure uses fallback once, retains it for 24 hours and tries primary recovery after two hours',async()=>{
 const store=memory(),n=network();
 const first=await collectFocusedNews(env,'power',{store,now:start,fetchFn:n.fetchFn});
 assert.equal(first.collectionPath,'cloudflare-fallback');assert.equal(first.validUntil,iso(start+24*HOUR));
 const again=await collectFocusedNews(env,'power',{store,now:start+2*HOUR-1,fetchFn:()=>assert.fail('cached')});
 assert.equal(again.checkedAt,first.checkedAt);assert.equal(n.calls.length,2);
 const recovered=network({primary:true});
 const d=await collectFocusedNews(env,'power',{store,now:start+2*HOUR,fetchFn:recovered.fetchFn});
 assert.equal(d.collectionPath,'sites');assert.deepEqual(recovered.calls,['news.google.com']);
});
test('after two hours a primary failure retains fallback without renewing its original timestamp',async()=>{
 const store=memory(),n=network();
 await collectFocusedNews(env,'power',{store,now:start,fetchFn:n.fetchFn});
 const d=await collectFocusedNews(env,'power',{store,now:start+2*HOUR,fetchFn:n.fetchFn});
 assert.equal(d.collectionPath,'cloudflare-fallback');assert.equal(d.checkedAt,iso(start));assert.equal(d.validUntil,iso(start+24*HOUR));assert.equal(d.refreshError,true);assert.equal(n.calls.length,3);
});
test('both paths failing does not show expired fallback, reset primary cooldown, or stamp failure as success',async()=>{
 const last=good(start-24*HOUR,{collectionPath:'cloudflare-fallback',validUntil:iso(start),items:[{title:'한전 송전망 사업',publishedAt:iso(start),url:'https://news.google.com/rss/articles/a'}]});
 const store=memory({[categoryKey]:{lastGood:last},[primaryKey]:{blockedUntil:start+6*HOUR,failures:4,lastFailureAt:start}}),n=network({secondary:false});
 const d=await collectFocusedNews(env,'power',{store,now:start,fetchFn:n.fetchFn});
 assert.equal(d.status,'unavailable');assert.equal(d.items.length,0);assert.equal(d.fallbackAttempted,true);assert.equal(store.rows.get(primaryKey).value.blockedUntil,start+6*HOUR);assert.deepEqual(n.calls,[new URL(GOOGLE_FALLBACK_URL).hostname]);
 await collectFocusedNews(env,'power',{store,now:start+1000,fetchFn:()=>assert.fail('backoff')});
});
test('a newly connected fallback can run during existing primary cooldown without resetting it',async()=>{
 const store=memory({[categoryKey]:{lastRequestAt:start-1000,nextAttemptAt:start+6*HOUR,data:{status:'unavailable',failureCode:'google_rss_cooldown',retryAt:iso(start+6*HOUR),items:[]}},[primaryKey]:{blockedUntil:start+6*HOUR}}),n=network();
 const d=await collectFocusedNews(env,'power',{store,now:start,fetchFn:n.fetchFn});assert.equal(d.collectionPath,'cloudflare-fallback');assert.equal(n.calls.length,1);assert.equal(store.rows.get(primaryKey).value.blockedUntil,start+6*HOUR);
});
test('simultaneous visits share the category lease and do not fan out to fallback',async()=>{
 const store=memory();let release,count=0;const pending=new Promise(r=>release=r);
 const first=collectFocusedNews(env,'power',{store,now:start,fetchFn:async(u)=>{count++;if(String(u)===GOOGLE_FALLBACK_URL){await pending;const r=success();r.headers.set('X-Power-News-Collector','1');return r;}return failed();}});
 while(count<2)await new Promise(r=>setImmediate(r));
 const second=await collectFocusedNews(env,'power',{store,now:start+1,fetchFn:()=>assert.fail('lease')});assert.equal(second.status,'updating');release();assert.equal((await first).status,'ok');assert.equal(count,2);
});
test('a primary busy lease never initiates fallback; unconfigured destinations stay closed',async()=>{
 const url=googleNewsSources()[0].url;
 await assert.rejects(googleRssWithFallback(url,{}, {store:memory({[primaryKey]:{leaseUntil:start+15000}}),env,clock:()=>start,allowFallback:true,fetchFn:()=>assert.fail('busy')}),/google_rss_busy/);
 const n=network();await assert.rejects(googleRssWithFallback(url,{}, {store:memory(),env:{...env,GOOGLE_NEWS_FALLBACK_URL:'https://example.com/'},clock:()=>start,allowFallback:true,fetchFn:n.fetchFn}));assert.equal(n.calls.length,1);
});
test('legacy briefing uses the same fallback and expires secondary results on server and browser after twenty-four hours',async()=>{
 clearFeedMemory();const store=memory(),n=network(),sources=[googleNewsSources()[1]];
 const first=await collectBriefing([],{env,store,now:start,fetchFn:n.fetchFn,sources});
 assert.equal(first.sources[0].collectionPath,'cloudflare-fallback');assert.equal(first.items.length,1);assert.equal(first.items[0].collectionPath,'cloudflare-fallback');
 assert.equal(limitGoogleNewsAge(first,start+24*HOUR-1).items.length,1);assert.equal(limitGoogleNewsAge(first,start+24*HOUR).items.length,0);
 const app=await readFile(new URL('../frontend/app.js',import.meta.url),'utf8'),fn=app.slice(app.indexOf('function expireGoogleSnapshot('),app.indexOf('\nfunction fallbackSnapshot(')),expire=new Function(fn+';return expireGoogleSnapshot;')();
 assert.equal(expire(first,start+24*HOUR).items.length,0);
 clearFeedMemory();const failedBoth=network({secondary:false});
 const expired=await collectBriefing([],{env,store,now:start+24*HOUR,fetchFn:failedBoth.fetchFn,sources});assert.equal(expired.items.length,0);
});
test('browser last-good retention cannot extend fallback past its validUntil',()=>{
 const cache=lastGoodCache(24*HOUR),data=good(start,{collectionPath:'cloudflare-fallback',validUntil:iso(start+24*HOUR)});
 cache.resolve('power',data,start);assert.equal(cache.resolve('power',{status:'unavailable'},start+24*HOUR-1).status,'ok');assert.equal(cache.resolve('power',{status:'unavailable'},start+24*HOUR).status,'unavailable');
});
test('relay requires a secret, rejects non-Google destinations, follows no redirects and preserves 503',async()=>{
 const req=url=>new Request('https://collector.invalid/rss',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({url})});
 const valid=googleNewsSources()[0].url;
 assert.equal((await relay(req(valid),{},{fetchFn:()=>assert.fail('disabled')})).status,503);
 assert.equal((await relay(new Request('https://collector.invalid/rss',{method:'POST'}),{COLLECTOR_TOKEN:token},{fetchFn:()=>assert.fail('auth')})).status,403);
 for(const target of ['https://example.com/','https://news.google.com/rss/search?q=a','https://news.google.com@evil.invalid/rss/search'])assert.equal((await relay(req(target),{COLLECTOR_TOKEN:token},{fetchFn:()=>assert.fail('invalid url')})).status,400);
 const d=await relay(req(valid),{COLLECTOR_TOKEN:token},{fetchFn:async(u,o)=>{assert.equal(o.redirect,'manual');assert.equal(o.headers.Authorization,undefined);return failed();}});
 assert.equal(d.status,503);assert.equal(d.headers.get('X-Power-News-Collector'),'1');assert.match(await d.text(),/automated queries/);
 const redirect=await relay(req(valid),{COLLECTOR_TOKEN:token},{fetchFn:async()=>new Response('',{status:302,headers:{location:'https://example.com'}})});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),null);
});
test('fallback HTML never becomes a successful empty result, including misconfigured relay responses',async()=>{
 const store=memory(),d=await collectFocusedNews(env,'power',{store,now:start,fetchFn:async u=>String(u)===GOOGLE_FALLBACK_URL?new Response('<html>Hello</html>'):failed()});assert.equal(d.status,'unavailable');assert.equal(d.items.length,0);assert.equal(store.rows.get(GOOGLE_FALLBACK_KEY).value.failures,1);
});
