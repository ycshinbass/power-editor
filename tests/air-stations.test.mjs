import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAirStations,scopeAirQuality,AIR_STATION_FALLBACK} from '../worker/air-stations.mjs';
import {boundedProvider,handleLocalData} from '../worker/local-data.mjs';
const now=Date.parse('2026-11-02T01:00:00Z');
const wrap=items=>({response:{header:{resultCode:'00'},body:{items,totalCount:items.length}}});
const raw=[{stationName:'신대',addr:'전남광주통합특별시 순천시 해룡면 신대로 118'}, {stationName:'중동',addr:'전남광주통합특별시 광양시 중마중앙로 100'}, {stationName:'중동',addr:'경기도 부천시 중동 1'}, {stationName:'장천동',addr:'전라남도 순천시 장천동 1'}];
const metadata=()=>parseAirStations(wrap(raw),now);
const reading=(station,region='전남',extra={})=>({station,region,referenceAt:'2026-11-02T00:00:00Z',pm10:0,pm25:12,pm10Flag:null,pm25Flag:null,...extra});
const data=items=>({status:'ok',items,count:items.length});
test('official full metadata preserves original strings and separates derived municipality',()=>{const m=metadata();assert.equal(m.items[0].address,raw[0].addr);assert.equal(m.items[0].municipality,'순천시');assert.equal(m.complete,true);const body=wrap(raw);body.response.body.totalCount=1001;assert.throws(()=>parseAirStations(body,now),/incomplete_series/);assert.throws(()=>parseAirStations(wrap([]),now),/incomplete_series/)});
test('multicity matching uses official address and province; duplicate names never cross provinces',()=>{const d=scopeAirQuality(data([reading('신대'),reading('중동'),reading('중동','경기')]),['순천','광양'],metadata(),now);assert.deepEqual(d.groups.map(g=>g.region),['순천','광양']);assert.equal(d.groups[0].items.length,2);assert.equal(d.groups[1].items.length,1);assert.equal(d.groups[1].items[0].address,raw[1].addr);assert.equal(d.groups[0].items[0].pm10,0);assert.equal(d.groups[0].items[1].missing,true);assert.equal(d.groups[0].items[1].pm10,null)});
test('nationwide and province selection still work when separate metadata service is unauthorized',()=>{const rows=[reading('신대'),reading('중동','경기')];const m={status:'unavailable',reason:'authentication_failed'};assert.equal(scopeAirQuality(data(rows),[],m,now).items.length,2);assert.equal(scopeAirQuality(data(rows),['전남'],m,now).items.length,1);const d=scopeAirQuality(data(rows),['순천'],m,now);assert.equal(d.status,'partial');assert.equal(d.stationMetadata.mode,'verified_public_list');assert.equal(d.stationMetadata.coverage,'partial');assert.equal(d.stationMetadata.reason,'authentication_failed');assert.equal(d.groups[0].stationCount,5)});
test('complete list absence, unrecognized region, missing observations and stale metadata differ',()=>{const m=metadata();assert.equal(scopeAirQuality(data([]),['여수'],m,now).groups[0].status,'no_station');assert.equal(scopeAirQuality(data([]),['미등록'],m,now).groups[0].status,'region_unmatched');assert.equal(scopeAirQuality(data([]),['순천'],m,now).groups[0].status,'data_missing');assert.equal(scopeAirQuality(data([]),['순천'],m,now+31*86400000).groups[0].status,'metadata_unavailable')});
test('same province duplicate station candidates fail closed rather than select arbitrary city',()=>{const m=parseAirStations(wrap([...raw,{stationName:'신대',addr:'전남광주통합특별시 여수시 신대길 1'}]),now);const d=scopeAirQuality(data([reading('신대')]),['순천'],m,now);assert.equal(d.groups[0].receivedCount,0);assert.equal(d.items[0].pm10,null)});
test('communication flags/nulls/stale observations remain distinct, never averages',()=>{const d=scopeAirQuality(data([reading('신대','전남',{pm10:null,pm10Flag:'통신장애'}),reading('장천동','전남',{referenceAt:'2026-11-01T00:00:00Z'})]),['순천'],metadata(),now);assert.equal(d.missingCount,1);assert.match(d.items[0].measurementStatus,/통신장애/);assert.equal(d.items[1].stale,true);assert.equal(d.average,undefined)});
test('station metadata successful or failed lookup is cached one day without retries or quota inflation',async()=>{let saved={version:null,value:null},calls=0;const store={read:async()=>saved,compareAndSwap:async(_k,v,value)=>{if(v!==saved.version)return {applied:false};saved={version:'v'+calls+Math.random(),value};return {applied:true,version:saved.version}}};const fn=async()=>{calls++;throw Error('authentication_failed')};await boundedProvider(store,'airStationMetadata',now,1,fn);await boundedProvider(store,'airStationMetadata',now+3600000,1,fn);assert.equal(calls,1);assert.equal(saved.value.used,1)});

test('partial fallback never infers absence and preserves verified source facts without station aliases',()=>{const d=scopeAirQuality(data([reading('여천동')]),['여수'],null,now);assert.equal(d.groups[0].status,'data_missing');assert.equal(d.items.find(x=>x.station==='여천동(여수)').pm10,null);assert.equal(d.stationMetadata.coverage,'partial');assert.equal(AIR_STATION_FALLBACK.items.length,23);assert.equal(AIR_STATION_FALLBACK.complete,false)});
test('combined administrative label does not borrow a same-named Gwangju station for Suncheon',()=>{const d=scopeAirQuality(data([reading('신대','광주')]),['순천'],metadata(),now);assert.equal(d.groups[0].receivedCount,0);assert.ok(d.items.every(r=>r.pm10===null))});
test('real handler requests only official metadata once and maps cached readings on authorization failure',async()=>{
 const entries=new Map(),put=(k,data)=>entries.set('public:official-api:'+k,{version:k,value:{day:'2026-11-02',used:1,nextFetchAt:now+86400000,data}});
 put('airQuality:time-v2',data([reading('신대')]));put('weatherWarning',{status:'ok',items:[]});let version=0,calls=0;
 const store={read:async k=>entries.get(k)||{version:null,value:null},compareAndSwap:async(k,v,value)=>{if((entries.get(k)?.version||null)!==v)return {applied:false};const next='v'+(++version);entries.set(k,{version:next,value});return {applied:true,version:next}}};
 const env={PUBLIC_DATA_SERVICE_KEY:'fixture-secret',LOCAL_OFFICIAL_CONTRACT_VERIFIED:'true'};
 const fetchFn=async(url,opt)=>{calls++;const u=new URL(url);assert.equal(u.origin,'https://apis.data.go.kr');assert.equal(u.pathname,'/B552584/MsrstnInfoInqireSvc/getMsrstnList');assert.equal(u.searchParams.get('numOfRows'),'1000');assert.equal(opt.redirect,'manual');return Response.json({response:{header:{resultCode:'30',resultMsg:'SERVICE_KEY_IS_NOT_REGISTERED_ERROR'}}})};
 const req=new Request('https://site/api/local-data?regions=순천');
 const first=await(await handleLocalData(req,env,{now,store,fetchFn})).json();const second=await(await handleLocalData(req,env,{now:now+1000,store,fetchFn})).json();
 assert.equal(calls,1);assert.equal(first.airQuality.groups[0].receivedCount,1);assert.equal(first.airQuality.groups[0].items.find(r=>r.station==='신대').pm10,0);assert.equal(second.airQuality.stationMetadata.coverage,'partial');assert.equal(JSON.stringify(first).includes(env.PUBLIC_DATA_SERVICE_KEY),false);
});
test('indexed GPS and regional joins retain ambiguity and identical-name province boundaries',()=>{
 const meta=parseAirStations(wrap(raw.map((m,i)=>({...m,dmX:34.9+i/100,dmY:127.5}))),now);
 const d=scopeAirQuality(data([reading('신대'),reading('신대'),reading('중동'),reading('중동','경기')]),['순천','광양','경기'],meta,now);
 assert.equal(d.groups[0].receivedCount,0);
 assert.equal(d.groups[0].items[0].measurementStatus,'측정소 중복 확인 필요');
 assert.equal(d.nearestCandidates[0].measurementStatus,'측정소 중복 확인 필요');
 assert.equal(d.groups[1].items[0].address,raw[1].addr);
 assert.equal(d.groups[2].items[0].address,raw[2].addr);
 assert.equal(d.nearestCandidates[1].region,'전남');
 assert.equal(d.nearestCandidates[2].region,'경기');
});

test('nationwide city/county/district scopes use exact province and administrative address, not substrings',()=>{
 const locations=[['동명','서울특별시 중구 세종대로 1','서울'],['동명','부산광역시 중구 중앙대로 1','부산'],['장안','경기도 수원시 장안구 정조로 1','경기'],['영통','경기도 수원시 영통구 광교로 1','경기'],['광주','경기도 광주시 중앙로 1','경기'],['광주','전남광주통합특별시 동구 중앙로 1','광주'],['담양','전라남도 담양군 중앙로 1','전남'],['성산','제주특별자치도 서귀포시 성산읍 1','제주']];
 const meta=parseAirStations(wrap(locations.map(([stationName,addr])=>({stationName,addr}))),now);
 const readings=data(locations.map(([name,_addr,province])=>reading(name,province)));
 const scope=ids=>scopeAirQuality(readings,ids,meta,now);
 assert.deepEqual(scope(['서울 중구']).items.map(r=>r.address),[locations[0][1]]);
 assert.deepEqual(scope(['부산 중구']).items.map(r=>r.address),[locations[1][1]]);
 assert.deepEqual(scope(['수원시 장안구']).items.map(r=>r.station),['장안']);
 assert.deepEqual(scope(['수원']).items.map(r=>r.station),['장안','영통']);
 assert.deepEqual(scope(['경기 광주']).items.map(r=>r.address),[locations[4][1]]);
 assert.deepEqual(scope(['광주 동구']).items.map(r=>r.address),[locations[5][1]]);
 assert.deepEqual(scope(['담양']).items.map(r=>r.station),['담양']);
 assert.deepEqual(scope(['서귀포']).items.map(r=>r.station),['성산']);
 assert.deepEqual(scope(['전남광주']).items.map(r=>r.region),['광주','전남']);
});
