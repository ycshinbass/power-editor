import test from 'node:test';
import assert from 'node:assert/strict';
import {latestRequest,mergeLocal,staleLocal,onVisibleRefresh} from '../frontend/refresh-control.js';
import {airMeasurementText} from '../frontend/air-location.js';
test('same URL single flight, changed request aborts previous and rejects late result',async()=>{
 const pending=[];const client=latestRequest((url,options)=>new Promise(resolve=>pending.push({url,options,resolve})));
 const first=client.run('/a');assert.equal(first,client.run('/a'));await Promise.resolve();
 const second=client.run('/b');await Promise.resolve();assert.equal(pending.length,2);assert.equal(pending[0].options.signal.aborted,true);
 pending[1].resolve({ok:true,json:async()=>({value:2})});assert.deepEqual(await second,{value:2});
 pending[0].resolve({ok:true,json:async()=>({value:1})});await assert.rejects(first,/superseded/);
});
test('timeout and cleanup cancel outstanding request',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let signal;const client=latestRequest((_url,options)=>{signal=options.signal;return new Promise(()=>{})},20000);
 client.run('/a');await Promise.resolve();t.mock.timers.tick(19999);assert.equal(signal.aborted,false);t.mock.timers.tick(1);assert.equal(signal.aborted,true);client.cancel();
});
test('partial failure preserves unrequested data and marks all air candidates stale',()=>{
 const item={station:'순천',pm10:10,pm10Grade1h:1,referenceAt:new Date().toISOString()};const previous={weather:{status:'ok',temperature:12},airQuality:{status:'ok',items:[item],nearestCandidates:[item],groups:[{items:[item]}]}};
 const next=mergeLocal(previous,{airQuality:{status:'unavailable',reason:'timeout'}});
 assert.equal(next.weather,previous.weather);assert.equal(next.airQuality.items[0].stale,true);assert.equal(next.airQuality.groups[0].items[0].stale,true);
 assert.match(airMeasurementText(next.airQuality.nearestCandidates[0],'pm10'),/자료 지연/);assert.doesNotMatch(airMeasurementText(next.airQuality.items[0],'pm10'),/좋음/);
 assert.equal(previous.airQuality.items[0].stale,undefined);assert.equal(staleLocal(null),null);
});
test('visibility return refreshes only after15min, no intervals or hidden refresh, listener cleaned',()=>{
 let now=0,calls=0,listener;const doc={visibilityState:'visible',addEventListener(_name,fn){listener=fn},removeEventListener(_name,fn){assert.equal(fn,listener);listener=null}};
 const stop=onVisibleRefresh(doc,()=>calls++,900000,()=>now);now=900000;doc.visibilityState='hidden';listener();assert.equal(calls,0);doc.visibilityState='visible';listener();assert.equal(calls,1);listener();assert.equal(calls,1);now+=899999;listener();assert.equal(calls,1);now++;listener();assert.equal(calls,2);stop();assert.equal(listener,null);
});
test('brief weather collection lease keeps recent observation neutral, not stale; failure and old readings remain distinct',()=>{
 const weather={status:'ok',referenceAt:new Date().toISOString(),temperature:18.2};
 const pending={weather:{status:'unavailable',reason:'refresh_pending'}};
 assert.equal(mergeLocal({weather},pending).weather.stale,undefined);
 assert.equal(mergeLocal({weather},pending).weather.refreshPending,true);
 assert.equal(mergeLocal({weather:{...weather,stale:true}},pending).weather.stale,true);
 assert.equal(mergeLocal({weather:{...weather,referenceAt:'2000-01-01T00:00:00Z'}},pending).weather.stale,true);
 assert.equal(mergeLocal({weather},{weather:{status:'unavailable',reason:'provider_timeout'}}).weather.stale,true);
});
