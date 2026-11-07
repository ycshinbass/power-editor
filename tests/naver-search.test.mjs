import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createD1SnapshotStore} from '../worker/snapshot-d1.mjs';
import {handleNaverSearch,readNaverSearch,naverSearchTarget,validateNaverResult,cleanupNaverSearch} from '../worker/naver-search.mjs';
import {requestNaverNews,naverNewsStatus} from '../worker/naver-news.mjs';
import {naverMarkup,naverResultHTML} from '../frontend/naver-search.js';
const now=Date.parse('2026-11-03T06:00:00Z');
const credentials={NAVER_NEWS_ENABLED:'true',NAVER_NEWS_CLIENT_ID:'synthetic-id',NAVER_NEWS_CLIENT_SECRET:'synthetic-secret'};
function fixture(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE editor_snapshots(key TEXT PRIMARY KEY,version TEXT NOT NULL,value TEXT NOT NULL)');const DB={withSession(){return this;},prepare(q){const api=values=>({first:async()=>sql.prepare(q).get(...values)||null,all:async()=>({results:sql.prepare(q).all(...values)}),run:async()=>({success:true,meta:{changes:Number(sql.prepare(q).run(...values).changes)}})});return {bind:(...values)=>api(values),...api([])};}};return {sql,DB,store:createD1SnapshotStore(DB),env:{...credentials,DB}};}
const result=()=>({lastBuildDate:'Tue, 03 Nov 2026 15:00:00 +0900',start:1,total:15,display:5,items:Array.from({length:5},(_,n)=>({title:'합성 <b>시험</b> '+n,description:'시험 &quot;설명&quot; '+n,link:'https://example.test/naver/'+n,originallink:'https://example.test/original/'+n,pubDate:'Tue, 03 Nov 2026 14:00:00 +0900'}))});
test('official search contract is used and original content/order survives shared cache and races',async()=>{
 const f=fixture();let calls=0;const original=result(),target=naverSearchTarget('power');
 const fetchImpl=async(url,options)=>{calls++;assert.equal(url.hostname,'naverapihub.apigw.ntruss.com');assert.equal(url.searchParams.get('display'),'5');assert.equal(url.searchParams.get('sort'),'date');assert.equal(options.headers['X-NCP-APIGW-API-KEY'],'synthetic-secret');assert.equal(options.redirect,'manual');return Response.json(original);};
 try{const responses=await Promise.all(Array.from({length:12},()=>readNaverSearch({env:f.env,target,store:f.store,fetchImpl,now})));
 assert.equal(calls,1);assert.equal(responses.filter(r=>r.status==='ok').length,1);
 const cached=await readNaverSearch({env:f.env,target,store:f.store,fetchImpl,now:now+3000});assert.deepEqual(cached.result,original);assert.equal(calls,1);
 assert.doesNotMatch(JSON.stringify(cached),/synthetic-secret|synthetic-id/);
 await readNaverSearch({env:f.env,target,store:f.store,fetchImpl,now:now+3600000});assert.equal(calls,2);
 }finally{f.sql.close();}
});
test('hourly failed HTTP attempts are not retried and failed responses never masquerade as no news',async()=>{
 const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return new Response('down',{status:503});},target=naverSearchTarget('kepco');
 try{const first=await readNaverSearch({env:f.env,target,store:f.store,fetchImpl,now});assert.equal(first.status,'temporarily_unavailable');assert.equal(first.result,undefined);await readNaverSearch({env:f.env,target,store:f.store,fetchImpl,now:now+5000});assert.equal(calls,1);
 assert.equal((await f.store.read('api:naver:budget:2026-11')).value.total,1);
 }finally{f.sql.close();}
});
test('abandoned requests have one bounded recovery and a live request keeps its lease',async()=>{
 const f=fixture(),target=naverSearchTarget('power'),slot=Math.floor(now/3600000);let calls=0;
 try{await f.store.compareAndSwap(target.key,null,{...target,slot,status:'updating',startedAt:now,attempt:1,expiresAt:now+3600000,result:null});
 const fetchImpl=async()=>{calls++;return Response.json(result());};
 assert.equal((await readNaverSearch({env:f.env,target,store:f.store,fetchImpl,now:now+14000})).status,'updating');assert.equal(calls,0);
 assert.equal((await readNaverSearch({env:f.env,target,store:f.store,fetchImpl,now:now+16000})).status,'ok');assert.equal(calls,1);
 const prior=await f.store.read(target.key);await f.store.compareAndSwap(target.key,prior.version,{...prior.value,status:'updating',startedAt:now,attempt:2,result:null});
 assert.equal((await readNaverSearch({env:f.env,target,store:f.store,fetchImpl,now:now+35000})).status,'temporarily_unavailable');assert.equal(calls,1);
 }finally{f.sql.close();}
});
test('quota stops calls, provider pacing can recover, and expired result data is removed',async()=>{
 const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return Response.json(result());};
 try{await readNaverSearch({env:f.env,target:naverSearchTarget('power'),store:f.store,fetchImpl,now});
 const pacing=await readNaverSearch({env:f.env,target:naverSearchTarget('kepco'),store:f.store,fetchImpl,now:now+500});assert.equal(pacing.status,'updating');assert.equal(calls,1);
 const later=await readNaverSearch({env:f.env,target:naverSearchTarget('kepco'),store:f.store,fetchImpl,now:now+2000});assert.equal(later.status,'ok');assert.equal(calls,2);
 const limited=await readNaverSearch({env:{...f.env,NAVER_NEWS_DAILY_LIMIT:'2'},target:naverSearchTarget('local','순천'),store:f.store,fetchImpl,now:now+4000});assert.equal(limited.status,'usage_limited');assert.equal(calls,2);
 await cleanupNaverSearch(f.DB,now+3605000);assert.equal((await f.store.read(naverSearchTarget('power').key)).value,null);assert.ok((await f.store.read('api:naver:budget:2026-11')).value);
 }finally{f.sql.close();}
});
test('public route accepts only fixed searches and catalog regions; secret status is not public',async()=>{
 const f=fixture(),base='https://power-editor-design-1031.ycshinbass.chatgpt.site/api/naver-search';let calls=0;const fetchImpl=async()=>{calls++;return Response.json(result());};
 try{for(const suffix of ['?query=arbitrary','?category=local&region=unknown','?category=power&region=순천','?category=evil'])assert.equal((await handleNaverSearch(new Request(base+suffix),f.env,{now,fetchImpl})).status,400);
 assert.equal(calls,0);const config=await(await handleNaverSearch(new Request(base+'/config'),f.env,{now})).json();assert.equal(config.enabled,true);assert.equal(config.ai,false);assert.doesNotMatch(JSON.stringify(config),/synthetic|CLIENT/);
 const target=naverSearchTarget('local','순천');assert.equal(target.query,'순천 전력');
 const response=await handleNaverSearch(new Request(base+'?category=power'),f.env,{now,fetchImpl});assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).result.items.length,5);
 }finally{f.sql.close();}
});
test('missing keys, invalid budget and expired pricing review fail closed without networking',async()=>{
 assert.equal(naverNewsStatus({...credentials,NAVER_NEWS_CLIENT_SECRET:''},now).enabled,false);
 assert.equal(naverNewsStatus({...credentials,NAVER_NEWS_DAILY_LIMIT:'invalid'},now).enabled,false);
 let calls=0;await assert.rejects(requestNaverNews({env:credentials,requestId:'expired',query:'시험',now:Date.parse('2026-12-01'),fetchImpl:()=>{calls++;}}),/pricing_review/);assert.equal(calls,0);
});
test('display safely retains highlighting, original passage, links and provider order',()=>{
 const input=result();input.items[0].title='<b>시험</b> &lt;img src=x onerror=alert(1)&gt;';
 const html=naverResultHTML(input);assert.match(html,/<b>시험<\/b>/);assert.doesNotMatch(html,/<img|<script|onclick=/);assert.match(html,/&lt;img/);assert.match(html,/&quot;설명&quot;/);
 for(let i=1;i<4;i++)assert.ok(html.indexOf('original/'+i)<html.indexOf('original/'+(i+1)));
 assert.equal(naverMarkup('&amp; &quot; &#39;'),'&amp; &quot; &#39;');assert.throws(()=>validateNaverResult({...result(),items:[{...result().items[0],link:'javascript:alert(1)'}]}));
});

