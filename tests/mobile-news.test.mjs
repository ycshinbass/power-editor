import test from 'node:test';import assert from 'node:assert/strict';import {handleMobileNews} from '../worker/mobile-news.mjs';
const now=Date.parse('2026-11-06T01:00:00Z'),token='t'.repeat(48);
const hash=async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(b=>b.toString(16).padStart(2,'0')).join('');
function memory(initial={}){const slots=new Map(Object.entries(initial));let revision=0;return {slots,async read(k){return slots.get(k)||{value:null,version:null}},async compareAndSwap(k,version,value){if((slots.get(k)?.version??null)!==version)return {applied:false};const next=String(++revision);slots.set(k,{value,version:next});return {applied:true,version:next}}}}
const req=(path,body={},auth=token)=>new Request('https://site.test/api/mobile-news/'+path,{method:'POST',headers:{Authorization:'Bearer '+auth},body:JSON.stringify(body)});
const active=()=>({'mobile-news:v1':{version:'v',value:{lastVisitAt:now-1000}}});
test('mobile endpoint denies wrong credentials and bootstraps missing news without visitors',async()=>{
 const env={MOBILE_NEWS_TOKEN_HASH:await hash()},store=memory();
 assert.equal((await handleMobileNews(req('claim',{},'x'.repeat(48)),env,{store,now})).status,401);
 assert.equal((await (await handleMobileNews(req('claim'),env,{store,now})).json()).jobs.length,3);
});
test('mobile lease is atomic, bounded to stale categories, and has a two-hour attempt floor',async()=>{
 const env={MOBILE_NEWS_TOKEN_HASH:await hash()},store=memory({...active(),'focused-news:v2:kepco':{version:'good',value:{lastGood:{status:'ok',checkedAt:new Date(now-60000).toISOString()}}}});
 const d=await (await handleMobileNews(req('claim'),env,{store,now})).json();assert.deepEqual(d.jobs.map(j=>j.category),['power','outage']);
 for(const j of d.jobs)assert.equal(new URL(j.url).hostname,'news.google.com');
 assert.deepEqual(await (await handleMobileNews(req('claim'),env,{store,now})).json(),{jobs:[]});
 assert.equal((await handleMobileNews(req('result',{leaseId:'fake',category:'power',xml:'<rss/>'}),env,{store,now})).status,409);
 await handleMobileNews(req('result',{leaseId:d.leaseId,category:'power',error:'http_503'}),env,{store,now});
 assert.deepEqual(await (await handleMobileNews(req('claim'),env,{store,now:now+HOUR})).json(),{jobs:[]});
});
const HOUR=3600000;
const snapshotRows=(age)=>Object.fromEntries(['kepco','power','outage'].map(category=>['focused-news:'+(category==='kepco'?'v2:':'v1:')+category,{version:'good-'+category,value:{lastGood:{status:'ok',checkedAt:new Date(now-age).toISOString(),items:[]}}}]));
test('without visitors reuse good news until 20h, then refresh before its 24h expiry',async()=>{
 const env={MOBILE_NEWS_TOKEN_HASH:await hash()};
 for(const visit of [null,now-2*HOUR])for(const age of [2*HOUR,12*HOUR,20*HOUR-1,20*HOUR,23*HOUR,25*HOUR]){
  const store=memory({...snapshotRows(age),'mobile-news:v1':{version:'v',value:{lastVisitAt:visit}}});
  const d=await (await handleMobileNews(req('claim'),env,{store,now})).json();
  assert.equal(d.jobs.length,age<20*HOUR?0:3,`visit=${visit}, age=${age}`);
 }
});
test('unattended refresh selects only old or missing categories; renewed empty success also counts',async()=>{
 const env={MOBILE_NEWS_TOKEN_HASH:await hash()},rows=snapshotRows(19*HOUR);
 rows['focused-news:v1:power'].value.lastGood.checkedAt=new Date(now-20*HOUR).toISOString();
 delete rows['focused-news:v1:outage'];
 const store=memory(rows),d=await (await handleMobileNews(req('claim'),env,{store,now})).json();
 assert.deepEqual(d.jobs.map(j=>j.category),['power','outage']);
 for(const category of ['power','outage'])assert.equal((await handleMobileNews(req('result',{leaseId:d.leaseId,category,xml:'<rss><channel/></rss>'}),env,{store,now})).status,200);
 const fresh=store.slots.get('focused-news:v1:power').value.lastGood;
 assert.equal(fresh.validUntil,new Date(now+24*HOUR).toISOString());
 assert.equal(fresh.checkedAt,new Date(now).toISOString());
 const next=await (await handleMobileNews(req('claim'),env,{store,now:now+2*HOUR})).json();
 assert.deepEqual(next.jobs.map(j=>j.category),['kepco']);
});
test('unattended failures preserve original news and the two-hour retry floor',async()=>{
 const env={MOBILE_NEWS_TOKEN_HASH:await hash()},store=memory(snapshotRows(20*HOUR));
 const original=structuredClone(store.slots.get('focused-news:v1:power'));
 const first=await (await handleMobileNews(req('claim'),env,{store,now})).json();
 await handleMobileNews(req('result',{leaseId:first.leaseId,category:'power',error:'http_503'}),env,{store,now});
 assert.deepEqual(store.slots.get('focused-news:v1:power'),original);
 assert.equal((await (await handleMobileNews(req('claim'),env,{store,now:now+HOUR})).json()).jobs.length,0);
 assert.equal((await (await handleMobileNews(req('claim'),env,{store,now:now+2*HOUR})).json()).jobs.length,3);
});
test('recent visitors retain two-hour refresh and simultaneous unattended claims share a lease',async()=>{
 const env={MOBILE_NEWS_TOKEN_HASH:await hash()};
 for(const age of [2*HOUR-1,2*HOUR]){
  const d=await (await handleMobileNews(req('claim'),env,{store:memory({...active(),...snapshotRows(age)}),now})).json();
  assert.equal(d.jobs.length,age<2*HOUR?0:3);
 }
 const store=memory(snapshotRows(20*HOUR));
 const claims=await Promise.all([1,2].map(async()=> (await handleMobileNews(req('claim'),env,{store,now})).json()));
 assert.deepEqual(claims.map(d=>d.jobs.length).sort(),[0,3]);
});
test('phone RSS is parsed and filtered on server; failures preserve last good and replay is refused',async()=>{
 const env={MOBILE_NEWS_TOKEN_HASH:await hash()},store=memory(active());
 const d=await (await handleMobileNews(req('claim'),env,{store,now})).json();
 const xml='<rss><channel><item><title>순천 아파트 300세대 정전 발생 - 테스트신문</title><link>https://news.google.com/rss/articles/phone-test</link><pubDate>'+new Date(now-60000).toUTCString()+'</pubDate><source url="https://example.com">테스트신문</source></item></channel></rss>';
 const r=await handleMobileNews(req('result',{leaseId:d.leaseId,category:'outage',xml}),env,{store,now});const answer=await r.json();assert.equal(r.status,200);assert.equal(answer.count,1);
 const good=(await store.read('focused-news:v1:outage')).value.lastGood;assert.equal(good.collectionPath,'android-phone');assert.equal(good.checkedAt,new Date(now).toISOString());
 assert.equal((await handleMobileNews(req('result',{leaseId:d.leaseId,category:'outage',xml}),env,{store,now})).status,409);
 await handleMobileNews(req('result',{leaseId:d.leaseId,category:'power',error:'http_503'}),env,{store,now});assert.deepEqual((await store.read('focused-news:v1:outage')).value.lastGood,good);
});
test('mobile upload rejects expired leases, malformed RSS, oversized streaming body and wrong methods',async()=>{
 const env={MOBILE_NEWS_TOKEN_HASH:await hash()},store=memory(active()),d=await (await handleMobileNews(req('claim'),env,{store,now})).json();
 assert.equal((await handleMobileNews(req('result',{leaseId:d.leaseId,category:'power',xml:'<html>Sorry</html>'}),env,{store,now})).status,400);
 assert.equal((await handleMobileNews(req('result',{leaseId:d.leaseId,category:'power',xml:'x'.repeat(1000001)}),env,{store,now})).status,400);
 assert.equal((await handleMobileNews(req('result',{leaseId:d.leaseId,category:'power',xml:'<rss/>'}),env,{store,now:now+11*60000})).status,409);
 assert.equal((await handleMobileNews(new Request('https://site.test/api/mobile-news/claim'),env,{store,now})).status,405);
});
