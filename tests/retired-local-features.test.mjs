import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handleLocalData} from '../worker/local-data.mjs';
for(const query of ['parts=roadWeather','parts=floodHistory','parts=weather,roadWeather','parts=airQuality,floodHistory','roadId=0250C00081','flood=1','parts=weather&roadId=','parts=weather&flood=0']){
 test(`retired local request is rejected before any provider or storage access: ${query}`,async()=>{
  let calls=0,reads=0;
  const response=await handleLocalData(new Request('https://example.test/api/local-data?city=순천&'+query),{PUBLIC_DATA_SERVICE_KEY:'fixture',KMA_API_HUB_KEY:'fixture',VWORLD_API_KEY:'fixture',LOCAL_OFFICIAL_CONTRACT_VERIFIED:'true'},{store:{read(){reads++;throw Error('unexpected storage')}},fetchFn(){calls++;throw Error('unexpected provider')}});
  assert.equal(response.status,410);assert.deepEqual(await response.json(),{error:'feature_removed'});assert.equal(calls,0);assert.equal(reads,0);
 });
}
test('default response has no retired fields and keeps supported domains',async()=>{
 const d=await(await handleLocalData(new Request('https://example.test/api/local-data'))).json();
 assert.equal('roadWeather'in d,false);assert.equal('floodHistory'in d,false);
 for(const key of ['weather','weatherForecast','airQuality','earthquake','administrativeMap'])assert.ok(key in d);
});
test('retired collectors, secret references and frontend controls cannot return',async()=>{
 const worker=await readFile(new URL('../worker/local-data.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(worker,/SAFEMAP_API_KEY|RoadWthrInfoService|IF_0092_WMS|ROAD_POINTS/);
 const app=await readFile(new URL('../frontend/app.js',import.meta.url),'utf8');
 assert.doesNotMatch(app,/roadWeather|floodHistory|roadId|includeFlood|officialRoadDetail|officialFloodDetail/);
 assert.match(app,/administrativeMap/);assert.match(worker,/env\.PUBLIC_DATA_SERVICE_KEY/);assert.match(worker,/env\.VWORLD_API_KEY/);
});
