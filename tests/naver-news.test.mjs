import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createD1SnapshotStore} from '../worker/snapshot-d1.mjs';
import {naverLimits,naverNewsStatus,reserveNaverBudget,requestNaverNews} from '../worker/naver-news.mjs';
import {handleRuntime,compactAutomationSummary} from '../worker/runtime.mjs';
import {SOURCES} from '../worker/feed.mjs';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE editor_snapshots(key TEXT PRIMARY KEY,version TEXT NOT NULL,value TEXT NOT NULL)');
 const DB={withSession(){return this;},prepare(query){return {bind(...values){return {first:async()=>sql.prepare(query).get(...values)||null,run:async()=>({success:true,meta:{changes:Number(sql.prepare(query).run(...values).changes)}})};}};}};
 return {sql,store:createD1SnapshotStore(DB)};
}
const at=Date.parse('2026-11-02T14:59:57Z');
test('hard caps cannot be increased by env; invalid configuration fails closed',()=>{
 assert.deepEqual(naverLimits({NAVER_NEWS_DAILY_LIMIT:'25000',NAVER_NEWS_MONTHLY_LIMIT:'775000'}),{daily:20000,monthly:620000});
 for(const value of ['0','-1','1.5','NaN',''])assert.throws(()=>naverLimits({NAVER_NEWS_DAILY_LIMIT:value}));
});
test('durable CAS enforces concurrency, deduplication and KST day/month budgets',async()=>{
 const {sql,store}=fixture(),env={NAVER_NEWS_DAILY_LIMIT:'2',NAVER_NEWS_MONTHLY_LIMIT:'3'};
 try{
  assert.equal((await reserveNaverBudget(store,'one',{env,now:at})).reserved,true);
  const concurrent=await Promise.all(Array.from({length:20},(_,i)=>reserveNaverBudget(store,'race-'+i,{env,now:at+1000})));
  assert.equal(concurrent.filter(r=>r.reserved).length,1);
  assert.equal((await reserveNaverBudget(store,'one',{env,now:at+2000})).reason,'duplicate_request');
  assert.equal((await reserveNaverBudget(store,'daily-over',{env,now:at+2000})).reason,'quota_exhausted');
  assert.equal((await reserveNaverBudget(store,'tomorrow',{env,now:at+3000})).reserved,true);
  assert.equal((await reserveNaverBudget(store,'monthly-over',{env,now:at+4000})).reason,'quota_exhausted');
  const saved=(await store.read('api:naver:budget:2026-11')).value;
  assert.deepEqual(saved.days,{'2026-11-02':2,'2026-11-03':1});
  assert.equal((await reserveNaverBudget(store,'new-month',{env,now:Date.parse('2026-11-30T15:00:00Z')})).reserved,true);
 }finally{sql.close();}
});
test('reservations survive process restart and unused/failed attempts are never refunded',async()=>{
 const {sql,store}=fixture();try{
  await reserveNaverBudget(store,'failed-http',{now:at});
  assert.equal((await reserveNaverBudget(store,'failed-http',{now:at+1000})).reason,'duplicate_request');
  assert.equal((await store.read('api:naver:budget:2026-11')).value.total,1);
  assert.equal((await reserveNaverBudget(store,'too-fast',{now:at+500})).reason,'rate_limited');
  await assert.rejects(reserveNaverBudget(store,'clock-back',{now:at-1}),/naver_clock_invalid/);
 }finally{sql.close();}
});
test('missing/corrupt/conflicting durable store cannot grant a request',async()=>{
 await assert.rejects(reserveNaverBudget(null,'one',{now:at}),/unavailable/);
 await assert.rejects(reserveNaverBudget({read:async()=>({value:{month:'2026-11',requestIds:[],days:{'2026-11-02':2}}}),compareAndSwap(){}},'one',{now:at}),/corrupt/);
 await assert.rejects(reserveNaverBudget({read:async()=>({value:null,version:null}),compareAndSwap:async()=>({applied:false})},'one',{now:at}),/conflict/);
});
test('disabled env cannot spend quota or call API; curated and AI collection stay disconnected',async()=>{
 let calls=0;const env={NAVER_NEWS_ENABLED:'false',NAVER_NEWS_CLIENT_ID:'fixture-id',NAVER_NEWS_CLIENT_SECRET:'fixture-secret'};
 await assert.rejects(requestNaverNews({env,query:'synthetic',requestId:'test',now:at,store:{read(){calls++;},compareAndSwap(){calls++;}},fetchImpl(){calls++;}}),/naver_disabled/);
 assert.equal(calls,0);assert.equal(naverNewsStatus(env).enabled,false);
 assert.equal(SOURCES.some(s=>s.id.startsWith('naver')),false);
});
test('status is private metadata, contains no secrets and never returns news',async()=>{
 const req=new Request('https://power-editor-design-1031.keenibis32.chatgpt.site/api/naver-news/status');
 assert.equal((await handleRuntime(req,{})).status,403);
 const result=await handleRuntime(req,{DB:{},PRIVATE_UPDATER_ENABLED:'true',NAVER_NEWS_CLIENT_ID:'fixture-id',NAVER_NEWS_CLIENT_SECRET:'fixture-secret'}),text=await result.text();
 assert.equal(result.status,200);assert.doesNotMatch(text,/fixture-id|fixture-secret/);
 const data=JSON.parse(text);assert.equal(data.credentialsConfigured,true);assert.equal(data.aiConnected,false);assert.equal(data.scheduleConnected,false);
});
test('old injected NAVER selection metadata cannot enter the AI summary',()=>{
 const article={id:'n1',sourceId:'naver-news',url:'https://example.test/article',title:'restricted synthetic headline',publishedAt:'2026-11-02'};
 const summary=compactAutomationSummary({snapshot:{items:[article],sources:[]},checkedAt:new Date(at).toISOString()},{requestId:'test',newItemIds:['n1']},{records:[]},{events:[]},at,{requestId:'test',articles:[article],reviewable:[article]});
 assert.deepEqual(summary.candidates,[]);assert.equal(summary.editorialSelection.articles[0].metadataRedacted,true);
 assert.doesNotMatch(JSON.stringify(summary),/restricted synthetic headline|example\.test/);
});
test('same Site current origin works; cross-origin and foreign hosts stay blocked',async()=>{
 const origin='https://power-editor-design-1031.ycshinbass.chatgpt.site',env={DB:{},PRIVATE_UPDATER_ENABLED:'true'};
 assert.equal((await handleRuntime(new Request(origin+'/api/naver-news/status'),env)).status,200);
 assert.equal((await handleRuntime(new Request(origin+'/api/naver-news/status',{headers:{Origin:'https://foreign.test'}}),env)).status,403);
 assert.equal((await handleRuntime(new Request('https://foreign.test/api/naver-news/status'),env)).status,403);
});

test('20,000/day and620,000/month stop at the boundary without resetting migrated usage',async()=>{
 const {sql,store}=fixture(),now=Date.parse('2026-11-05T03:00:00Z');
 try{
  const key='api:naver:budget:2026-11';await store.compareAndSwap(key,null,{month:'2026-11',days:{'2026-11-05':19999},total:19999,seen:{},lastAttemptAt:null});
  assert.equal((await reserveNaverBudget(store,'last',{now})).daily,20000);
  assert.equal((await reserveNaverBudget(store,'over',{now:now+1000})).reason,'quota_exhausted');
  sql.prepare('DELETE FROM editor_snapshots').run();
  await store.compareAndSwap(key,null,{month:'2026-11',days:{'2026-11-04':2},requestIds:['legacy1','legacy2'],lastAttemptAt:null});
  assert.equal((await reserveNaverBudget(store,'new',{now})).monthly,3);
  assert.equal((await reserveNaverBudget(store,'legacy1',{now:now+1000})).reason,'duplicate_request');
 }finally{sql.close()}
});
