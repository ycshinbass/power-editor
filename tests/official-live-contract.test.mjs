import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGenerationWindow,parseAirQuality,parseEarthquake,parseObservation,handleLocalData,OBSERVATION_GRIDS,boundedProvider} from '../worker/local-data.mjs';
import {renderPowerFlow} from '../frontend/power-flow.js';
const now=Date.parse('2026-11-02T09:00:00+09:00');
const wrap=items=>({response:{header:{resultCode:'00'},body:{items,totalCount:items.length}}});
test('archive window uses actual timestamps and retains signed pumping in both days',()=>{
 const fields=[{key:'fuelPwr1',label:'수력'},{key:'fuelPwr5',label:'양수'}];
 const row=baseDatetime=>({baseDatetime,fuelPwr1:100,fuelPwr5:-20,fuelPwrTot:80});
 const body=wrap([row('20261102000000'),row('20261101000500'),row('20261101000000'),row('20261031235500')]);body.response.body.totalCount=376133;
 const d=parseGenerationWindow(body,'2026-11-02',fields,now);assert.equal(d.today.length,1);assert.equal(d.previous.length,2);assert.equal(d.today[0].fuels.fuelPwr5,-20);
 const chart=renderPowerFlow({...d,seriesValidated:true,fuelKeys:fields,unit:'MW'},{now});assert.equal(chart.rows.length,1);assert.match(chart.svg,/data-sign="-1"/);assert.match(chart.svg,/data-comparison="previous"/);assert.equal(chart.rows[0].total,80);
 body.response.body.items=body.response.body.items.slice(0,2);assert.throws(()=>parseGenerationWindow(body,'2026-11-02',fields,now),/incomplete_series/);
});
test('one station without a timestamp or with a quality flag cannot become a numeric zero',()=>{
 const body=wrap([{stationName:'A',sidoName:'전남',dataTime:null,pm10Value:'12',pm25Value:'3'}, {stationName:'B',sidoName:'전남',dataTime:'2026-11-02 08:00',pm10Value:'12',pm10Flag:'장비점검',pm25Value:'0'}]);
 const d=parseAirQuality(body,now);assert.equal(d.count,2);assert.equal(d.items[0].pm10,null);assert.equal(d.items[1].pm10,null);assert.equal(d.items[1].pm25,0);
});
test('official Suncheon grid and signed temperature are validated independently of model forecasts',()=>{
 assert.deepEqual([OBSERVATION_GRIDS['순천'].nx,OBSERVATION_GRIDS['순천'].ny],[70,70]);
 const rows=[['T1H','-3'],['REH','70'],['RN1','0'],['WSD','2']].map(([category,obsrValue])=>({category,obsrValue,nx:70,ny:70,baseDate:'20261102',baseTime:'0800'}));
 assert.equal(parseObservation(wrap(rows),OBSERVATION_GRIDS['순천'],now).temperature,-3);rows[0].nx=73;assert.throws(()=>parseObservation(wrap(rows),OBSERVATION_GRIDS['순천'],now));
});
test('overseas latest earthquake keeps event time, negative latitude and correct field alignment',()=>{
 const d=parseEarthquake('2|202611012107|1282|20261101204703.000|6.0|-14.1700|165.8200|국외 해역||참고||=',now);
 assert.equal(d.items[0].magnitude,6);assert.equal(d.items[0].latitude,-14.17);assert.equal(d.items[0].type,'overseas');assert.throws(()=>parseEarthquake('인증 오류',now));
});
test('missing storage and unmapped regions never call a keyed provider',async()=>{
 let calls=0;const d=await(await handleLocalData(new Request('https://site/api/local-data?city=광주&regions=순천'),{PUBLIC_DATA_SERVICE_KEY:'not-a-live-key',LOCAL_OFFICIAL_CONTRACT_VERIFIED:'true'},{now,fetchFn:()=>{calls++;throw Error()}})).json();
 assert.equal(calls,0);assert.equal(d.weather.reason,'region_unmatched');assert.equal(d.airQuality.reason,'shared_storage_missing');
});
test('abandoned fetch lease recovers without erasing consumed quota, and background work completes',async()=>{
 let version='old',value={day:'2026-11-02',used:1,nextFetchAt:now+1800000-60000,data:null};
 const store={read:async()=>({version,value}),compareAndSwap:async(_k,v,next)=>{if(v!==version)return {applied:false};value=next;version+='x';return {applied:true,version}}};
 let held;const d=await boundedProvider(store,'generation',now,1,async()=>({status:'ok',today:[]}),{waitUntil:p=>held=p});
 await held;assert.equal(d.status,'ok');assert.equal(value.used,2);assert.equal(value.leaseUntil,0);assert.equal(value.data.status,'ok');
});
