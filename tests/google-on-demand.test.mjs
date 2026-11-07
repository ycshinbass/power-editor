import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {collectFocusedNews} from '../worker/focused-news.mjs';
import {collectBriefing,clearFeedMemory} from '../worker/feed.mjs';
import {googleNewsSources} from '../worker/google-news.mjs';
const hour=3600000,start=Date.parse('2026-11-05T01:00:00Z');
const rss=()=>new Response('<rss><channel></channel></rss>',{headers:{'Content-Type':'application/xml'}});
function memory(initial={}){const rows=new Map(Object.entries(initial).map(([k,value])=>[k,{value,version:'0'}]));let n=0;return {rows,read:async k=>structuredClone(rows.get(k)||{value:null,version:null}),compareAndSwap:async(k,v,value)=>{if((rows.get(k)?.version||null)!==v)return {applied:false};const version=String(++n);rows.set(k,{value:structuredClone(value),version});return {applied:true,version};}};}

test('a visit reuses even empty successful results younger than two hours and starts a cold collection immediately',async()=>{
 let calls=0;const fetchFn=async()=>{calls++;return rss()},store=memory();
 assert.equal((await collectFocusedNews({},'power',{store,now:start,fetchFn})).status,'ok');assert.equal(calls,1);
 const value=store.rows.get('focused-news:v1:power').value;delete value.data; // A recent lastGood alone is sufficient.
 assert.equal((await collectFocusedNews({},'power',{store,now:start+2*hour-1,fetchFn})).status,'ok');assert.equal(calls,1);
 assert.equal((await collectFocusedNews({},'power',{store,now:start+2*hour,fetchFn})).status,'ok');assert.equal(calls,2);
});

test('simultaneous legacy briefing visits make one Google request and cannot overwrite the successful cache',async()=>{
 clearFeedMemory();const source=googleNewsSources()[0],store=memory();let calls=0,release;
 const pending=new Promise(r=>release=r),fetchFn=async()=>{calls++;await pending;return rss()};
 const first=collectBriefing([],{sources:[source],store,now:start,fetchFn});
 while(!calls)await new Promise(r=>setImmediate(r));
 const second=await collectBriefing([],{sources:[source],store,now:start+1,fetchFn});assert.equal(calls,1);assert.equal(second.sources[0].fromCache,true);
 release();assert.equal((await first).sources[0].status,'ok');clearFeedMemory();
 const cached=await collectBriefing([],{sources:[source],store,now:start+2*hour-1,fetchFn:()=>assert.fail('fresh shared cache must not fetch')});assert.equal(cached.sources[0].status,'ok');
});

test('a failed visit retains the original success for twenty-four hours without making it younger',async()=>{
 const good={status:'ok',category:'power',checkedAt:new Date(start).toISOString(),items:[]},store=memory({'focused-news:v1:power':{lastGood:good}});let calls=0;
 const failed=await collectFocusedNews({},'power',{store,now:start+2*hour,fetchFn:async()=>{calls++;return new Response('offline',{status:503})}});
 assert.equal(calls,1);assert.equal(failed.status,'ok');assert.equal(failed.refreshError,true);assert.equal(failed.checkedAt,good.checkedAt);
 const gate=store.rows.get('google-rss:transport:v1').value;gate.blockedUntil=start+26*hour;
 const expired=await collectFocusedNews({},'power',{store,now:start+24*hour+1,fetchFn:()=>assert.fail('must respect provider cooldown')});assert.equal(expired.status,'unavailable');assert.deepEqual(expired.items,[]);
});

test('browser-saved legacy Google material expires by source collection time while official material remains',async()=>{
 const s=await readFile(new URL('../frontend/app.js',import.meta.url),'utf8'),fn=s.slice(s.indexOf('function expireGoogleSnapshot('),s.indexOf('\nfunction fallbackSnapshot('));
 const expire=new Function(fn+';return expireGoogleSnapshot;')(),checkedAt=new Date(start).toISOString();
 const google={sourceId:'google-national'},official={sourceId:'official'},value={items:[google,official],sources:[{id:'google-national',checkedAt}]};
 assert.equal(expire(value,start+24*hour-1).items.length,2);assert.deepEqual(expire(value,start+24*hour).items,[official]);
});

test('the hour timer requests only visible live news and never starts the unused legacy briefing',async()=>{
 const s=await readFile(new URL('../frontend/app.js',import.meta.url),'utf8'),line=s.split('\n').find(l=>l.startsWith('const armFocusedRefresh='));
 for(const [hidden,preview,naver,expected]of [[true,false,true,[0,0]],[false,true,false,[0,0]],[false,false,true,[1,0]],[false,false,false,[1,1]]]){
  let tick,focused=0,legacy=0;
  vm.runInNewContext(line,{document:{hidden},naverPreview:preview,naverSearchActive:()=>naver,refreshFocusedHeadlines:()=>focused++,refresh:()=>legacy++,clearTimeout(){},setTimeout:fn=>{tick=fn},Date});
  tick();assert.deepEqual([focused,legacy],expected);
 }
});
