import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTodayDemand,publicDemandApi,parseForecastDemand,publicForecastApi} from '../worker/demand-api.mjs';
import {handlePowerDemand} from '../worker/power-demand.mjs';
const now=Date.parse('2026-11-03T06:00:00Z');
const row=t=>({baseDatetime:t,currPwrTot:'60000',suppAbility:'90000',suppReservePwr:'30000',suppReserveRate:'50'});
const wrap=rows=>({response:{header:{resultCode:'00'},body:{totalCount:rows.length,items:{item:rows}}}});
function memory(){let n=0;const entries=new Map();return {entries,read:async k=>entries.get(k)||{version:null,value:null},compareAndSwap:async(k,v,value)=>{if((entries.get(k)?.version||null)!==v)return {applied:false};const version=String(++n);entries.set(k,{version,value});return {applied:true,version}}}}
test('gateway series preserves measured demand and gaps, rejects wrong date, duplicates and inconsistent reserve',()=>{
 const rows=[row('20261103145000'),row('20261103144000')],d=parseTodayDemand(wrap(rows),now);
 assert.deepEqual(d.today.map(p=>p.mw),[60000,60000]);assert.equal(d.today.length,2);assert.equal(d.previous.length,0);assert.equal(d.unit,'MW');
 assert.throws(()=>parseTodayDemand(wrap([rows[0],rows[0]]),now));assert.throws(()=>parseTodayDemand(wrap([row('20261102145000')]),now));assert.throws(()=>parseTodayDemand(wrap([{...rows[0],suppReservePwr:1000}]),now));
});
test('denied official API access is cached for a day, credentials never returned and no HTML retry occurs',async()=>{
 const store=memory();let calls=0;const fetchFn=async url=>{calls++;assert.equal(new URL(url).hostname,'apis.data.go.kr');return new Response('<errMsg>SERVICE_ACCESS_DENIED_ERROR</errMsg>')};
 const a=await publicDemandApi({PUBLIC_DATA_SERVICE_KEY:'secret-fixture'},{store,fetchFn,now});
 assert.equal(a.reason,'authentication_failed');assert.doesNotMatch(JSON.stringify(a),/secret-fixture/);
 await publicDemandApi({PUBLIC_DATA_SERVICE_KEY:'secret-fixture'},{store,fetchFn,now:now+3600000});assert.equal(calls,1);
});
test('shared quota reservation precedes demand request and cache prevents repeated reads',async()=>{
 const store=memory();let calls=0;const fetchFn=async()=>{calls++;assert.equal(store.entries.get('public:official-api:demandToday').value.used,1);return Response.json(wrap([row('20261103145000')]))};
 const opts={store,fetchFn,now};assert.equal((await publicDemandApi({PUBLIC_DATA_SERVICE_KEY:'fixture'},opts)).status,'ok');await publicDemandApi({PUBLIC_DATA_SERVICE_KEY:'fixture'},opts);assert.equal(calls,1);
});

test('confirmed approval retries auth once without resetting quota or bypassing 100/day cap',async()=>{
 const store=memory(),key='public:official-api:demandToday';let calls=0;
 await store.compareAndSwap(key,null,{day:'2026-11-03',used:98,nextFetchAt:now+86400000,leaseUntil:0,data:{status:'unavailable',reason:'authentication_failed'}});
 const env={PUBLIC_DATA_SERVICE_KEY:'fixture',KPX_TODAY_ACCESS_APPROVAL:'approval-fixture'},fetchFn=async()=>{calls++;return new Response('<errMsg>SERVICE_ACCESS_DENIED_ERROR</errMsg>')};
 await publicDemandApi(env,{store,now,fetchFn});await publicDemandApi(env,{store,now:now+1000,fetchFn});
 assert.equal(calls,1);assert.equal(store.entries.get(key).value.used,99);
 assert.equal(store.entries.get(key).value.accessRevision,'approval-fixture');
 // A later approval revision still cannot erase calls already used that day.
 await publicDemandApi({...env,KPX_TODAY_ACCESS_APPROVAL:'approval-fixture-2'},{store,now:now+2000,fetchFn});
 const capped=await publicDemandApi({...env,KPX_TODAY_ACCESS_APPROVAL:'approval-fixture-3'},{store,now:now+3000,fetchFn});
 assert.equal(calls,2);assert.equal(capped.reason,'daily_limit');
});
test('invalid request parameters are not misreported as missing approval',async()=>{
 const result=await publicDemandApi({PUBLIC_DATA_SERVICE_KEY:'fixture'},{store:memory(),now,fetchFn:async()=>new Response('<errMsg>INVALID_REQUEST_PARAMETER_ERROR</errMsg>')});
 assert.equal(result.reason,'provider_rejected');assert.equal(result.providerCode,'INVALID_REQUEST_PARAMETER_ERROR');
});
const forecastRows=(date='20261103')=>Array.from({length:24},(_,i)=>['육지','제주'].map(areaName=>({date,hour:String(i+1),areaName,mlfd:'60000',jlfd:'600',slfd:'60600'}))).flat();
test('official forecast keeps 24 hour-end totals and does not double-count paired area rows',()=>{
 const data=parseForecastDemand(wrap(forecastRows()),'2026-11-03',now);
 assert.equal(data.points.length,24);assert.deepEqual(data.points[0],{hour:1,mw:60600,mainland:60000,jeju:600});assert.equal(data.points.at(-1).hour,24);assert.equal(data.unit,'MW');
});
test('forecast rejects partial days, contradictory duplicate areas, missing components and wrong dates',()=>{
 const parse=rows=>parseForecastDemand(wrap(rows),'2026-11-03',now),rows=forecastRows();
 assert.throws(()=>parse(rows.slice(2)));assert.throws(()=>parse([rows[0],...rows]));
 assert.throws(()=>parse(rows.map((r,i)=>i===1?{...r,mlfd:'60001',slfd:'60601'}:r)));
 for(const patch of [{date:'20261102'},{hour:'25'},{mlfd:''},{slfd:'70000'},{areaName:'unknown'}])assert.throws(()=>parse([{...rows[0],...patch},...rows.slice(1)]));
});
test('forecast access requires a verified contract and shares an hourly server cache',async()=>{
 const store=memory();let calls=0;const fetchFn=async url=>{calls++;const u=new URL(url);assert.equal(u.pathname,'/B552115/SmpWithForecastDemand/getSmpWithForecastDemand');assert.ok(['20261103','20261102'].includes(u.searchParams.get('date')));assert.equal(u.searchParams.get('dataType'),'json');return Response.json(wrap(forecastRows(u.searchParams.get('date'))))};
 const env={PUBLIC_DATA_SERVICE_KEY:'fixture'};
 assert.equal((await publicForecastApi(env,{store,now,fetchFn})).reason,'contract_validation_pending');assert.equal(calls,0);
 env.KPX_FORECAST_API_VERIFIED='true';assert.equal((await publicForecastApi(env,{store,now,fetchFn})).status,'ok');
 await publicForecastApi(env,{store,now:now+3599000,fetchFn});assert.equal(calls,2);
 await publicForecastApi(env,{store,now:now+3600000,fetchFn});assert.equal(calls,3);
});

test('yesterday forecast tail is fetched once, reused hourly and rolled forward without growing an archive',async()=>{
 const store=memory(),dates=[],env={PUBLIC_DATA_SERVICE_KEY:'fixture',KPX_FORECAST_API_VERIFIED:'true'};
 const fetchFn=async url=>{const date=new URL(url).searchParams.get('date');dates.push(date);return Response.json(wrap(forecastRows(date).map(r=>date==='20261102'?{...r,mlfd:'70000',slfd:'70600'}:r)))};
 const first=await publicForecastApi(env,{store,now,fetchFn});
 assert.deepEqual(first.previousTail,{date:'2026-11-02',hour:24,mw:70600});
 await publicForecastApi(env,{store,now:now+3600000,fetchFn});
 const next=await publicForecastApi(env,{store,now:Date.parse('2026-11-04T00:00:00+09:00'),fetchFn});
 assert.deepEqual(next.previousTail,{date:'2026-11-03',hour:24,mw:60600});
 assert.deepEqual(dates,['20261103','20261102','20261103','20261104']);assert.equal(store.entries.size,1);
 assert.throws(()=>parseForecastDemand(wrap(forecastRows('20261101')),'2026-11-01',now));
});

test('cache upgrade preserves quota and a failed yesterday request never hides today or causes repeated fetches',async()=>{
 const store=memory(),key='public:official-api:demandForecast',today=parseForecastDemand(wrap(forecastRows()),'2026-11-03',now);let calls=0;
 await store.compareAndSwap(key,null,{day:'2026-11-03',used:98,nextFetchAt:now+3600000,leaseUntil:0,data:today});
 const fetchFn=async url=>{calls++;return new URL(url).searchParams.get('date')==='20261103'?Response.json(wrap(forecastRows())):new Response('Temporary failure',{status:503})};
 const env={PUBLIC_DATA_SERVICE_KEY:'fixture',KPX_FORECAST_API_VERIFIED:'true'};
 const result=await publicForecastApi(env,{store,now,fetchFn});assert.equal(result.status,'ok');assert.equal(result.points.length,24);assert.equal(result.previousTail,null);
 await publicForecastApi(env,{store,now:now+1000,fetchFn});await publicForecastApi(env,{store,now:now+3600000,fetchFn});
 assert.equal(calls,2);assert.equal(store.entries.get(key).value.used,100);
});
test('public route combines independent official APIs while leaving blocked HTML and missing history alone',async()=>{
 const store=memory();await store.compareAndSwap('power:demand:official:v1',null,{data:{status:'unavailable',failureCode:'access_blocked'}});
 for(const date of ['2026-10-27','2026-10-20','2026-10-13','2026-10-06'])await store.compareAndSwap('demand:history:v1:'+date,null,{failureCode:'access_blocked',data:null});
 await store.compareAndSwap('demand:forecast:v1:2026-11-03',null,{failureCode:'access_blocked',data:null});
 const urls=[],lifetimes=[];const fetchFn=async url=>{urls.push(url);assert.equal(new URL(url).hostname,'apis.data.go.kr');return Response.json(wrap(url.includes('SmpWithForecastDemand')?forecastRows(new URL(url).searchParams.get('date')):[row('20261103144000'),row('20261103144500')]))};
 const result=await(await handlePowerDemand(new Request('https://example.test/api/power-demand'),{PUBLIC_DATA_SERVICE_KEY:'fixture',KPX_FORECAST_API_VERIFIED:'true'},{store,now,fetchFn,waitUntil:p=>lifetimes.push(p)})).json();
 await Promise.all(lifetimes);assert.equal(urls.length,3);assert.equal(result.status,'ok');assert.equal(result.today.length,2);assert.equal(result.forecast.points.length,24);assert.deepEqual(result.previous,[]);assert.equal(result.comparison,null);assert.doesNotMatch(JSON.stringify(result),/fixture/);
});

test('transient diagnostic cooldown recovers without resetting quota',async()=>{
 const store=memory(),key='public:official-api:demandToday';let calls=0;
 await store.compareAndSwap(key,null,{day:'2026-11-03',used:4,nextFetchAt:now+80000000,leaseUntil:0,data:{status:'ok',date:'2026-11-02',reason:'invalid_series'}});
 const data=await publicDemandApi({PUBLIC_DATA_SERVICE_KEY:'fixture'},{store,now,fetchFn:async()=>{calls++;return Response.json(wrap([row('20261103145000')]))}});
 assert.equal(data.status,'ok');assert.equal(data.date,'2026-11-03');assert.equal(calls,1);assert.equal(store.entries.get(key).value.used,5);
});
test('forecast survives a missing current actual series',async()=>{
 const store=memory();await store.compareAndSwap('power:demand:official:v1',null,{data:{status:'unavailable',failureCode:'access_blocked'}});
 await store.compareAndSwap('demand:forecast:v1:2026-11-03',null,{failureCode:'access_blocked',data:null});
 const fetchFn=async url=>Response.json(wrap(url.includes('SmpWithForecastDemand')?forecastRows():[]));
 const data=await(await handlePowerDemand(new Request('https://example.test/api/power-demand'),{PUBLIC_DATA_SERVICE_KEY:'fixture',KPX_FORECAST_API_VERIFIED:'true'},{store,now,fetchFn})).json();
 assert.equal(data.status,'unavailable');assert.equal(data.forecast.points.length,24);
});
