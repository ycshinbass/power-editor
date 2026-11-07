import {scopedPublicSignal} from '../frontend/logic.js';
import test from 'node:test';import assert from 'node:assert/strict';import {parsePublicSignal,handlePublicSignals,clearPublicSignalMemory} from '../worker/public-signals.mjs';
test('individual signal route never waits for or fetches another provider',async()=>{
 clearPublicSignalMemory();let calls=0;
 const result=await handlePublicSignals(new Request('https://test/api/public-signals?part=fire'),{}, {now:1000,fetchFn:async url=>{calls++;assert.match(String(url),/fd\.forest/);return Response.json({fireShowInfoList:[]})}});
 assert.equal(calls,1);assert.deepEqual((await result.json()).signals.map(s=>s.id),['fire']);
 const bad=await handlePublicSignals(new Request('https://test/api/public-signals?part=bad'),{}, {fetchFn:()=>{throw Error('must not fetch')}});assert.equal(bad.status,400);clearPublicSignalMemory();
});
const html='<table id="current-warnings"><tr data-type="V" data-level="2"><td>풍랑</td><td><span>주의보</span></td><td>제주 먼바다</td><td>2026-11-01 16:00</td><td>2026-11-01 18:00</td><td>3일 새벽</td></tr></table>';
test('official public table preserves future/fuzzy effective time without active inference',()=>{const v=parsePublicSignal('weather',html);assert.equal(v.count,1);assert.equal(v.records[0].effective,'2026-11-01 18:00');assert.equal(v.records[0].active,undefined);assert.throws(()=>parsePublicSignal('weather','<html>error</html>'));assert.throws(()=>parsePublicSignal('weather','<table id="current-warnings"></table>'));});
test('empty fire and landslide envelopes require explicit valid arrays and totals',()=>{assert.equal(parsePublicSignal('fire','{"fireShowInfoList":[]}').count,0);assert.equal(parsePublicSignal('landslide','{"success":true,"list":[],"totalCount":0}').count,0);assert.throws(()=>parsePublicSignal('landslide','{"success":false,"list":[]}'));assert.throws(()=>parsePublicSignal('fire','{}'));});
test('public signal collectors cache and isolate failures with unknown safety',async()=>{clearPublicSignalMemory();let n=0;const fetchFn=async url=>{n++;return new Response(url.includes('weather.go.kr')?html:url.includes('fd.forest')?'{"fireShowInfoList":[]}':'bad')};const req=new Request('https://test/api/public-signals');const a=await(await handlePublicSignals(req,{}, {now:1000,fetchFn})).json();assert.deepEqual(a.signals.map(s=>s.status),['ok','ok','unavailable']);assert.ok(a.signals.every(s=>s.safetyConclusion==='unknown'));await handlePublicSignals(req,{}, {now:2000,fetchFn});assert.equal(n,3);clearPublicSignalMemory();});
test('failed fresh fetch retains old success as explicitly stale, never fresh empty',async()=>{clearPublicSignalMemory();const req=new Request('https://test/api/public-signals');const ok=async url=>new Response(url.includes('weather')?html:url.includes('fd.forest')?'{"fireShowInfoList":[]}':'{"success":true,"list":[],"totalCount":0}');await handlePublicSignals(req,{}, {now:1000,fetchFn:ok});const result=await(await handlePublicSignals(req,{}, {now:602000,fetchFn:async()=>{throw Error('offline')}})).json();assert.ok(result.signals.every(s=>s.status==='ok'&&s.stale===true&&s.checkedAt===new Date(1000).toISOString()&&s.attemptedAt===new Date(602000).toISOString()));clearPublicSignalMemory();});

test('leased refresh preserves recent successful snapshot without alarming delay; long-aged/missing/failure remain distinct',async()=>{
 const now=Date.parse('2026-11-02T03:00:00Z'),req=new Request('https://test/api/public-signals');
 for(const fixture of [
  {age:15,stale:false},{age:29,stale:false},{age:30,stale:true},{age:31,stale:true},
  {age:15,failed:true,stale:true},{age:15,invalid:true,stale:true},{missing:true}
 ]){
  const checkedAt=fixture.invalid?'invalid':new Date(now-(fixture.age||0)*60000).toISOString();
  const data=fixture.missing?null:{status:'ok',count:0,records:[],checkedAt,stale:!!fixture.failed,...(fixture.failed?{reason:'provider_fetch_failed'}:{})};
  const store={read:async()=>({version:'1',value:{data,nextFetchAt:0,leaseUntil:now+1000}})};let calls=0;
  const result=await(await handlePublicSignals(req,{}, {now,store,fetchFn:()=>{calls++;throw Error('must not fetch')}})).json();
  assert.equal(calls,0);
  for(const signal of result.signals){
   if(fixture.missing){assert.equal(signal.status,'unavailable');assert.equal(signal.count,null)}
   else {assert.equal(signal.stale,fixture.stale);assert.equal(signal.checkedAt,checkedAt);assert.equal(signal.count,0);assert.equal(signal.refreshPending,true)}
   assert.equal(signal.reason,fixture.failed?'provider_fetch_failed':'refresh_pending');
  }
 }
});

test('fire timeout retries once and caches only a verified successful response',async()=>{clearPublicSignalMemory();let calls=0;const req=new Request('https://test/api/public-signals?part=fire');const fetchFn=async()=>{if(++calls===1)throw new DOMException('timeout','TimeoutError');return Response.json({fireShowInfoList:[]})};const d=await(await handlePublicSignals(req,{}, {now:1000,fetchFn})).json();assert.equal(calls,2);assert.equal(d.signals[0].stale,false);assert.equal(d.signals[0].count,0);await handlePublicSignals(req,{}, {now:2000,fetchFn});assert.equal(calls,2);clearPublicSignalMemory();});
test('fire exhausted timeout remains unavailable rather than zero',async()=>{clearPublicSignalMemory();let calls=0;const d=await(await handlePublicSignals(new Request('https://test/api/public-signals?part=fire'),{}, {now:1000,fetchFn:async()=>{calls++;throw new DOMException('timeout','TimeoutError')}})).json();assert.equal(calls,2);assert.equal(d.signals[0].count,null);assert.equal(d.signals[0].failureCode,'upstream_timeout');clearPublicSignalMemory();});
test('official island zones map to their municipality; marine records remain separately visible',()=>{
 const now=Date.parse('2026-11-04T16:20:00Z'),s={id:'weather',status:'ok',checkedAt:new Date(now).toISOString(),count:2,records:[{type:'강풍',level:'주의보',region:'흑산도.홍도',effective:'2026-11-05 01:00'},{type:'풍랑',level:'주의보',region:'서해남부먼바다',effective:'2026-11-05 01:00'}]};
 assert.equal(scopedPublicSignal(s,['순천'],now).unknown,false);assert.equal(scopedPublicSignal(s,['순천'],now).count,0);assert.equal(scopedPublicSignal(s,['신안'],now).count,1);assert.equal(scopedPublicSignal(s,['순천'],now).marineRecords.length,1);
});
