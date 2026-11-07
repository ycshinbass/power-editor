import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFocusedNews,restoreFocusedSnapshot,selectFocusedNews} from '../worker/focused-news.mjs';
const HOUR=3600000,start=Date.parse('2026-11-06T00:00:00Z'),iso=t=>new Date(t).toISOString();
const key='focused-news:v1:power',gate='google-rss:transport:v1';
const snapshot={status:'ok',category:'power',checkedAt:iso(start),items:[{title:'한전 송전망 기술 사업',url:'https://news.google.com/rss/articles/example',publisherName:'시험 출처',publishedAt:iso(start)}]};
function memory(initial={}){const rows=new Map(Object.entries(initial).map(([k,value])=>[k,{value,version:'0'}]));let n=0;return {rows,read:async k=>structuredClone(rows.get(k)||{value:null,version:null}),compareAndSwap:async(k,v,value)=>{if((rows.get(k)?.version||null)!==v)return {applied:false};const version=String(++n);rows.set(k,{value:structuredClone(value),version});return {applied:true,version};}};}
test('one-time recovery restores headlines without a Google request or resetting cooldown',async()=>{
 const blocked={blockedUntil:start+6*HOUR,failures:4,lastFailureAt:start};
 const prior={data:{status:'unavailable',items:[]},nextAttemptAt:start+6*HOUR,lastRequestAt:start-1000};
 const store=memory({[key]:prior,[gate]:blocked});
 const result=await collectFocusedNews({},'power',{store,now:start+1000,localSnapshot:snapshot,fetchFn:()=>assert.fail('must reuse snapshot')});
 assert.equal(result.status,'ok');assert.equal(result.items.length,1);assert.equal(result.collectionPath,'operator-laptop');assert.equal(result.checkedAt,snapshot.checkedAt);
 assert.deepEqual(store.rows.get(gate).value,blocked);assert.equal(store.rows.get(key).value.nextAttemptAt,prior.nextAttemptAt);
});
test('recovery never renews its timestamp, retains failed refreshes, and stops after twenty-four hours',async()=>{
 const store=memory({[gate]:{blockedUntil:start+40*HOUR}}),opts={store,localSnapshot:snapshot,fetchFn:()=>assert.fail('provider cooldown')};
 await collectFocusedNews({},'power',{...opts,now:start});
 const later=await collectFocusedNews({},'power',{...opts,now:start+3*HOUR});assert.equal(later.status,'ok');assert.equal(later.checkedAt,snapshot.checkedAt);assert.equal(later.refreshError,true);
 const expired=await collectFocusedNews({},'power',{...opts,now:start+24*HOUR+1});assert.equal(expired.status,'unavailable');assert.deepEqual(expired.items,[]);
});
test('newer server collection wins and an active collection is not overwritten',async()=>{
 for(const prior of [{lastGood:{...snapshot,checkedAt:iso(start+1000),collectionPath:'sites'}},{leaseUntil:start+10000,data:{status:'updating'}}]){
  const store=memory({[key]:prior});const original=await store.read(key);
  assert.deepEqual(await restoreFocusedSnapshot(store,key,'power',snapshot,start+2000),original);assert.deepEqual(await store.read(key),original);
 }
});
test('existing phone, server and fallback snapshots adopt 24h validity without changing receipt time',async()=>{
 for(const collectionPath of ['android-phone','sites','cloudflare-fallback']){
  const previous={...snapshot,collectionPath,validUntil:iso(start+(collectionPath==='cloudflare-fallback'?2:12)*HOUR)};
  const store=memory({[key]:{data:previous,lastGood:previous,lastRequestAt:start+12*HOUR}});
  const result=await collectFocusedNews({},'power',{store,now:start+13*HOUR,fetchFn:()=>assert.fail('reuse within request cooldown')});
  assert.equal(result.checkedAt,iso(start));assert.equal(result.validUntil,iso(start+24*HOUR));assert.equal(result.items.length,1);
 }
});
test('future, expired, wrong-category, and non-Google snapshots cannot populate shared news',async()=>{
 for(const incoming of [{...snapshot,checkedAt:iso(start+1)},{...snapshot,checkedAt:iso(start-24*HOUR)},{...snapshot,category:'kepco'},{...snapshot,items:[{...snapshot.items[0],url:'https://example.org/article'}]}]){
  const store=memory();assert.deepEqual(await restoreFocusedSnapshot(store,key,'power',incoming,start),{value:null,version:null});assert.equal(store.rows.size,0);
 }
});
test('actual domestic outage reports exclude a manual or drill even when the title says outage accident',()=>{
 const items=['전남광주 황금동 상가 일대 정전…3시간 만에 복구','성동구, 성동소방서와 아파트 정전사고 대응 매뉴얼 마련','부산 아파트 정전사고 대응 훈련 실시'].map(title=>({...snapshot.items[0],title}));
 assert.deepEqual(selectFocusedNews(items,'outage',start).map(i=>i.title),[items[0].title]);
});
