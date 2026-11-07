import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseApiSupply,parseGeneration,boundedProvider} from '../worker/local-data.mjs';
import {parseTodayDemand} from '../worker/demand-api.mjs';
import {renderPowerFlow} from '../frontend/power-flow.js';

const now=Date.parse('2026-11-07T18:45:00+09:00');
const wrap=rows=>({response:{header:{resultCode:'00'},body:{totalCount:rows.length,items:{item:rows}}}});
// Public provider values captured from the rejected production row on Nov 7.
const generation={baseDatetime:'20261107175500',fuelPwrTot:63554.5,fuelPwr1:478.04,fuelPwr2:184.406,fuelPwr3:18493.2,fuelPwr4:19814.9,fuelPwr5:3309.02,fuelPwr6:16531.7,fuelPwr7:0.021972,fuelPwr8:4743.57,fuelPwr9:-0.472773};
const keys=Array.from({length:9},(_,i)=>({key:'fuelPwr'+(i+1),label:i===8?'태양광':'분류'+i}));
const demand={baseDatetime:'20261107120000',currPwrTot:40000,suppAbility:90000,suppReservePwr:50000,suppReserveRate:125};
function memory(value){let version=0,entry=value?{version:'0',value}:null;return {read:async()=>entry||{version:null,value:null},compareAndSwap:async(k,v,value)=>{if(v!==(entry?.version??null))return {applied:false};entry={version:String(++version),value};return {applied:true,version:entry.version}}}}

test('a reserve ratio above 100 percent is valid when the demand and reserve arithmetic agree',()=>{
 assert.equal(parseApiSupply(wrap([demand]),now).reservePercent,125);
 const data=parseTodayDemand(wrap([demand]),now);assert.equal(data.today[0].mw,40000);assert.equal(data.maxReserve.percent,125);
 for(const patch of [{suppReserveRate:120},{suppReservePwr:40000},{currPwrTot:0}])assert.throws(()=>parseApiSupply(wrap([{...demand,...patch}]),now));
});
test('real negative solar measurement survives parsing and charting with its sign and total intact',()=>{
 const today=parseGeneration(wrap([generation]),'2026-11-07',keys,now);
 assert.equal(today[0].fuels.fuelPwr9,-0.472773);assert.equal(today[0].total,63554.5);
 const chart=renderPowerFlow({seriesValidated:true,unit:'MW',date:'2026-11-07',fuelKeys:keys,today,previous:[]},{now});
 assert.equal(chart.hasData,true);assert.equal(chart.rows.length,1);assert.match(chart.svg,/data-fuel="fuelPwr9" data-sign="-1"/);
 assert.equal(chart.rows[0].fuels.find(f=>f.label==='태양광').value,-0.472773);
 for(const v of [null,'',true,' ',NaN,Infinity,-10000001])assert.throws(()=>parseGeneration(wrap([{...generation,fuelPwr9:v}]),'2026-11-07',keys,now));
 assert.throws(()=>parseGeneration(wrap([{...generation,fuelPwrTot:1}]),'2026-11-07',keys,now));
});
test('recovery revision retries once, preserves quotas and never overrides a live lease',async()=>{
 for(const leaseUntil of [0,now+45000]){
  const initial={day:'2026-11-07',used:98,nextFetchAt:now+1800000,leaseUntil,data:{status:'unavailable',reason:'schema_mismatch',diagnosticVersion:2}};
  const store=memory(initial);let calls=0;
  const fetchData=async()=>{calls++;throw Error('invalid_value')};
  await boundedProvider(store,'generation',now,1,fetchData,{diagnostics:3});
  await boundedProvider(store,'generation',now+1000,1,fetchData,{diagnostics:3});
  assert.equal(calls,leaseUntil?0:1);assert.equal((await store.read()).value.used,leaseUntil?98:99);
 }
 const store=memory({day:'2026-11-07',used:100,nextFetchAt:now+1800000,leaseUntil:0,data:{status:'unavailable',reason:'schema_mismatch',diagnosticVersion:2}});
 const result=await boundedProvider(store,'generation',now,1,()=>assert.fail('daily cap must be preserved'),{diagnostics:3});assert.equal(result.reason,'daily_limit');
});
test('assembled production bundle binds the new diagnostic helper and restores today demand',async()=>{
 const code=await readFile(new URL('../worker/index.js',import.meta.url),'utf8');
 const {DemandApi}=await import('data:text/javascript;base64,'+Buffer.from(code+'\nexport {DemandApi};').toString('base64'));
 const data=await DemandApi.publicDemandApi({PUBLIC_DATA_SERVICE_KEY:'test-secret'},{now,store:memory(),fetchFn:async()=>Response.json(wrap([demand]))});
 assert.equal(data.status,'ok');assert.equal(data.today[0].mw,40000);assert.equal(data.maxReserve.percent,125);
 const invalid=await DemandApi.publicDemandApi({PUBLIC_DATA_SERVICE_KEY:'test-secret'},{now,store:memory(),fetchFn:async()=>Response.json(wrap([{...demand,suppReserveRate:120}]))});
 assert.equal(invalid.reason,'inconsistent_values');assert.equal(invalid.powerRowDiagnostic.values.suppReserveRate,120);assert.doesNotMatch(JSON.stringify(invalid),/test-secret/);
});
