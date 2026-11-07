import test from 'node:test';import assert from 'node:assert/strict';
import {createSnapshotService,validateSnapshotPayload} from '../worker/snapshots.mjs';
const T=Date.parse('2026-10-31T18:00:00Z');
function payload(time=T){return {version:1,checkedAt:new Date(time).toISOString(),status:'ok',stale:false,items:[{id:'x',scope:'global',title:'전력 소식',url:'https://www.eia.gov/x',publishedAt:'2026-10-30'}],sources:[{id:'eia',status:'ok',checkedAt:new Date(time).toISOString()}]};}
function memoryStore(){let value=null,version=null,n=0;return {async read(){return {version,value:structuredClone(value)};},async compareAndSwap(_key,expected,next){if(expected!==version)return {applied:false,version};value=structuredClone(next);version=String(++n);return {applied:true,version};}};}
const service=(store,collect,extras={})=>createSnapshotService({store,collect,authorize:async ctx=>ctx==='allowed',now:()=>T,...extras});
test('authorization fails closed before reading or collecting',async()=>{let touched=0;const s=service({read:()=>{touched++;},compareAndSwap:()=>{}},()=>{touched++;});await assert.rejects(s.refresh({requestId:'1',authContext:'denied'}),{code:'unauthorized'});assert.equal(touched,0);const throwing=service(memoryStore(),()=>payload(),{authorize:()=>{throw Error('secret');}});await assert.rejects(throwing.refresh({requestId:'1'}),{code:'unauthorized'});});
test('stores payload with distinct publication/check times; idempotent duplicate',async()=>{let calls=0;const s=service(memoryStore(),()=>{calls++;return payload();});assert.equal((await s.readSnapshot()).status,'missing');let r=await s.refresh({requestId:'one',authContext:'allowed'});assert.equal(r.outcome,'stored');assert.equal((await s.refresh({requestId:'one',authContext:'allowed'})).duplicate,true);assert.equal(calls,1);const view=await s.readSnapshot();assert.equal(view.status,'fresh');assert.equal(view.snapshot.items[0].publishedAt,'2026-10-30');assert.equal(view.checkedAt,new Date(T).toISOString());});
test('failed, unavailable or malformed collection preserves last good',async()=>{const store=memoryStore();await service(store,()=>payload()).refresh({requestId:'ok',authContext:'allowed'});for(const [id,collect]of [['error',()=>{throw Error('credential must not leak');}],['empty',()=>({...payload(),status:'unavailable',items:[]})],['bad',()=>({secret:'not allowed'})]]){const s=service(store,collect);const result=await s.refresh({requestId:id,authContext:'allowed'});assert.equal(result.outcome,'retained');assert.ok(!JSON.stringify(result).includes('credential'));const view=await s.readSnapshot();assert.equal(view.snapshot.items.length,1);assert.equal(view.status,'stale');assert.ok(view.staleReasons.includes('last_refresh_failed'));}});
test('age and upstream stale are explicit; no success snapshot if initial refresh fails',async()=>{const store=memoryStore();await service(store,()=>payload()).refresh({requestId:'ok',authContext:'allowed'});assert.equal((await service(store,()=>payload(),{now:()=>T+16*60000}).readSnapshot()).status,'stale');const missing=service(memoryStore(),()=>{throw Error('offline');});await missing.refresh({requestId:'first',authContext:'allowed'});assert.equal((await missing.readSnapshot()).status,'missing');});
test('CAS racing duplicate commits one logical request; new older result cannot replace newer',async()=>{const store=memoryStore();let releases=[];const s=service(store,()=>new Promise(resolve=>releases.push(resolve)));const a=s.refresh({requestId:'same',authContext:'allowed'}),b=s.refresh({requestId:'same',authContext:'allowed'});await new Promise(resolve=>setImmediate(resolve));releases.forEach(resolve=>resolve(payload()));const results=await Promise.all([a,b]);assert.equal(results.filter(x=>x.duplicate).length,1);assert.equal((await store.read()).value.requests.length,1);const older=await service(store,()=>payload(T-60000)).refresh({requestId:'older',authContext:'allowed'});assert.equal(older.outcome,'superseded');assert.equal((await s.readSnapshot()).checkedAt,new Date(T).toISOString());});
test('schema bounded, future checks rejected, request IDs bounded, missing CAS refused',async()=>{assert.throws(()=>validateSnapshotPayload({...payload(),unknown:'x'},T),{code:'schema_key'});assert.throws(()=>validateSnapshotPayload({...payload(),items:Array(101).fill(payload().items[0])},T),{code:'schema_invalid'});assert.throws(()=>validateSnapshotPayload(payload(T+11*60000),T),{code:'schema_invalid'});assert.throws(()=>createSnapshotService({store:{read(){},put(){}},authorize:()=>true,collect:()=>payload()}),{code:'configuration_invalid'});await assert.rejects(service(memoryStore(),()=>payload()).refresh({requestId:'../bad',authContext:'allowed'}),{code:'request_id_invalid'});});
test('idempotency window is bounded and expired identifiers can be reused',async()=>{const store=memoryStore();const s=service(store,()=>payload(),{retainRequests:2});for(const requestId of ['a','b','c'])await s.refresh({requestId,authContext:'allowed'});assert.deepEqual((await store.read()).value.requests.map(x=>x.requestId),['b','c']);assert.equal((await s.refresh({requestId:'a',authContext:'allowed'})).duplicate,false);});
test('persistent contention bounded, corrupted stores fail rather than overwritten',async()=>{const store={read:async()=>({value:null,version:null}),compareAndSwap:async()=>({applied:false,version:null})};await assert.rejects(service(store,()=>payload(),{maxConflicts:2}).refresh({requestId:'a',authContext:'allowed'}),{code:'write_conflict'});const corrupt={read:async()=>({value:{schemaVersion:9},version:'v1'}),compareAndSwap:async()=>{throw Error('must not write');}};await assert.rejects(service(corrupt,()=>payload()).refresh({requestId:'a',authContext:'allowed'}),{code:'store_corrupt'});});

test('nested private fields are rejected instead of leaking into public snapshots',()=>{
  for(const mutate of [p=>p.items[0].secret='private',p=>p.sources[0].token='private',p=>p.items[0].editorial={headlineKo:'제목',token:'private'},p=>p.sourcePolicy={description:'policy',deferred:[{name:'source',secret:'private'}]}]){const p=payload();mutate(p);assert.throws(()=>validateSnapshotPayload(p,T),{code:'schema_key'});}
});

test('new item push intent commits atomically with snapshot and is replayable',async()=>{
  const store=memoryStore();const first=await service(store,()=>payload()).refresh({requestId:'baseline',authContext:'allowed'});assert.deepEqual(first.newItemIds,[]);
  const next=payload();next.items.push({id:'new',scope:'global',title:'새 전력 소식',url:'https://www.eia.gov/new',publishedAt:new Date(T-60000).toISOString()},{id:'old',scope:'global',title:'과거 소식',url:'https://www.eia.gov/old',publishedAt:new Date(T-4*86400000).toISOString()},{id:'future',scope:'global',title:'미래 시각',url:'https://www.eia.gov/future',publishedAt:new Date(T+60000).toISOString()});
  const s=service(store,()=>next);const result=await s.refresh({requestId:'second',authContext:'allowed'});assert.deepEqual(result.newItemIds,['new']);
  const retry=await s.refresh({requestId:'second',authContext:'allowed'});assert.equal(retry.duplicate,true);assert.deepEqual(retry.newItemIds,['new']);assert.equal(retry.snapshotCheckedAt,result.snapshotCheckedAt);
  const persisted=(await store.read()).value.requests.find(r=>r.requestId==='second');assert.deepEqual(persisted.newItemIds,['new']);
});

test('next hourly refresh recovers persisted intents, public view omits intent payload',async()=>{
  const store=memoryStore();await service(store,()=>payload()).refresh({requestId:'baseline',authContext:'allowed'});
  const next=payload();next.items.push({id:'later',scope:'global',title:'신규 소식',url:'https://www.eia.gov/later',publishedAt:new Date(T-60000).toISOString()});
  await service(store,()=>next).refresh({requestId:'crashed-after-commit',authContext:'allowed'});
  const s=service(store,()=>({...next,checkedAt:new Date(T+3600000).toISOString()}),{now:()=>T+3600000});
  await s.refresh({requestId:'next-hour',authContext:'allowed'});
  assert.deepEqual((await s.readPendingNotificationIntents()).map(x=>x.requestId),['crashed-after-commit']);
  assert.equal('newItemIds'in (await s.readSnapshot()).lastAttempt,false);
  assert.deepEqual(await service(store,()=>next,{now:()=>T+25*3600000}).readPendingNotificationIntents(),[]);
});

test('partial source loss and recovery do not re-notify recently known articles',async()=>{
  const store=memoryStore();const full=payload();full.items.push({id:'other-source',scope:'local',regions:['순천'],title:'다른 출처 기사',url:'https://www.eia.gov/second',publishedAt:new Date(T-60000).toISOString()});
  await service(store,()=>full).refresh({requestId:'full',authContext:'allowed'});
  const partial={...payload(T+3600000),status:'partial',items:[full.items[0]]};
  await service(store,()=>partial,{now:()=>T+3600000}).refresh({requestId:'partial',authContext:'allowed'});
  const recovered={...full,checkedAt:new Date(T+7200000).toISOString()};
  const result=await service(store,()=>recovered,{now:()=>T+7200000}).refresh({requestId:'recovered',authContext:'allowed'});
  assert.deepEqual(result.newItemIds,[]);assert.ok((await store.read()).value.seenRecent.some(x=>x.id==='other-source'));
  const view=await service(store,()=>full,{now:()=>T+7200000}).readSnapshot();assert.equal('seenRecent'in view,false);
});
test('history expires after four days, accepts legacy missing history and rejects malformed history',async()=>{
  const store=memoryStore();await service(store,()=>payload()).refresh({requestId:'one',authContext:'allowed'});let row=await store.read();delete row.value.seenRecent;await store.compareAndSwap('ignored',row.version,row.value);
  assert.equal((await service(store,()=>payload()).readSnapshot()).status,'fresh');
  await service(store,()=>payload(T+5*86400000),{now:()=>T+5*86400000}).refresh({requestId:'later',authContext:'allowed'});assert.equal((await store.read()).value.seenRecent.length,0);
  row=await store.read();row.value.seenRecent=[{id:'bad',publishedAt:'invalid'}];await store.compareAndSwap('ignored',row.version,row.value);
  await assert.rejects(service(store,()=>payload(),{now:()=>T+5*86400000}).readSnapshot(),{code:'store_corrupt'});
});

test('push intents preserve scoped national/global/local metadata for per-device filtering',async()=>{const store=memoryStore();await service(store,()=>payload()).refresh({requestId:'base',authContext:'allowed'});const p=payload();p.items.push(...['national','global','local','unknown'].map((scope,i)=>({id:'scope'+i,scope,title:'전력망 소식',url:'https://www.eia.gov/'+i,publishedAt:new Date(T-60000).toISOString(),regions:scope==='local'?['부산']:[]})));const s=service(store,()=>p);const r=await s.refresh({requestId:'next',authContext:'allowed'});assert.deepEqual(r.newItemIds,['scope0','scope1','scope2']);assert.equal(r.audience,'scoped-v1');assert.deepEqual(r.newItems,[{id:'scope0',scope:'national',regions:[]},{id:'scope1',scope:'global',regions:[]},{id:'scope2',scope:'local',regions:['부산']}]);assert.deepEqual((await s.readPendingNotificationIntents())[0].newItems,r.newItems);assert.deepEqual((await s.refresh({requestId:'next',authContext:'allowed'})).newItems,r.newItems);assert.equal('newItems' in (await s.readSnapshot()).lastAttempt,false)});

test('legacy unscoped intents are never replayed and malformed scoped metadata fails closed',async()=>{
 const store=memoryStore();await service(store,()=>payload()).refresh({requestId:'baseline',authContext:'allowed'});
 let row=await store.read();row.value.requests[0].newItemIds=['legacy'];delete row.value.requests[0].newItems;row.value.requests[0].audience='common';
 await store.compareAndSwap('ignored',row.version,row.value);
 assert.deepEqual(await service(store,()=>payload()).readPendingNotificationIntents(),[]);
 row=await store.read();row.value.requests[0].audience='scoped-v1';row.value.requests[0].newItems=[{id:'legacy',scope:'unknown',regions:[]}];
 await store.compareAndSwap('ignored',row.version,row.value);
 await assert.rejects(service(store,()=>payload()).readPendingNotificationIntents(),{code:'store_corrupt'});
});
