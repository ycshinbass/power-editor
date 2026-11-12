import {usesLastGood} from '../frontend/last-good.js';
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {selectAirStation,airSelectionDetail,nearestAirStations,validStationCoordinates,airMeasurementText,airStationText,airStationMarkup} from '../frontend/air-location.js';import {parseAirStations,scopeAirQuality,AIR_STATION_FALLBACK} from '../worker/air-stations.mjs';
const a={station:'가까운 결측소',latitude:34.95,longitude:127.49,pm10:null,pm25:null},b={station:'먼 관측소',latitude:35,longitude:127.5,pm10:10,pm25:5};
test('distance order uses exact coordinates and keeps nearest missing measurements',()=>{const ranked=nearestAirStations({latitude:34.95,longitude:127.49},[b,a]);assert.equal(ranked[0].station,a.station);assert.equal(ranked[0].distanceKm,0);assert.equal(ranked[0].pm10,null);assert.ok(ranked[1].distanceKm>5);assert.equal(a.distanceKm,undefined)});
test('invalid or unavailable coordinates are excluded, never address-guessed',()=>{assert.deepEqual(nearestAirStations(null,[a]),[]);assert.deepEqual(nearestAirStations({latitude:NaN,longitude:127},[a]),[]);assert.equal(validStationCoordinates({latitude:127,longitude:35}),false);assert.equal(nearestAirStations({latitude:35,longitude:127},[{station:'주소만',address:'순천시'},a]).length,1)});
test('official default WGS84 dmX latitude / dmY longitude preserved and attached to candidates',()=>{const now=Date.parse('2026-11-02T02:00:00Z'),metadata=parseAirStations({response:{header:{resultCode:'00'},body:{totalCount:1,items:[{stationName:'신대',addr:'전라남도 순천시 매안로 162',dmX:'34.95',dmY:'127.49'}]}}},now);assert.equal(metadata.items[0].latitude,34.95);assert.equal(metadata.items[0].longitude,127.49);const scoped=scopeAirQuality({status:'ok',items:[]},['여수'],metadata,now);assert.equal(scoped.nearestCandidates.length,1);assert.equal(scoped.nearestCandidates[0].missing,true);assert.equal(scoped.nearestCandidates[0].pm10,null)});
test('location remains opt-in and no precise coordinates are persisted or queried',async()=>{const app=await readFile(new URL('../frontend/app.js',import.meta.url),'utf8');const persist=app.match(/function persist\(\).*?\n/s)?.[0]||'';assert.doesNotMatch(persist,/airPosition|latitude|longitude/);const request=app.slice(app.indexOf('async function refreshLocalData'),app.indexOf('function renderLocalCards'));assert.doesNotMatch(request,/latitude|longitude|airPosition/);assert.match(app,/nearestAirButton'\).onclick=requestAirLocation/);assert.doesNotMatch(app,/watchPosition/);assert.match(app,/내 주변 대기질을 보려면 위치를 허용해 주세요/)});
import vm from 'node:vm';
test('actual geolocation controls are explicit, recover from denial/timeout, and clear old nearest values',async()=>{
 const app=await readFile(new URL('../frontend/app.js',import.meta.url),'utf8'),els=new Map(),callbacks=[];
 const $=id=>{if(!els.has(id))els.set(id,{textContent:'',disabled:false});return els.get(id)};
 const ctx=vm.createContext({selectAirStation,weatherCity:'순천',nearestCity:()=>null,CITY_CENTERS:{},nearestAirStations,airStationText,airStationMarkup,$,navigator:{geolocation:{getCurrentPosition(ok,error,options){callbacks.push({ok,error,options})}}},Number,stamp:()=> '09:00',localData:{airQuality:{items:[{...a,address:'전라남도 순천시 테스트',municipality:'순천시'}],nearestCandidates:[{...a,address:'전라남도 순천시 테스트',municipality:'순천시'},b],coordinateCoverage:'partial'}}});
 vm.runInContext("let airPosition=null,airLocationPending=false,airLocationMessage='내 주변 대기질을 보려면 위치를 허용해 주세요';\n"+app.slice(app.indexOf('function currentAirSelection()'),app.indexOf('function nearestAirContent()'))+"\nfunction renderLocalCards(){$('#currentAir').textContent='관심지역';renderAirLocation()}",ctx);
 assert.equal(callbacks.length,0);vm.runInContext('requestAirLocation();requestAirLocation()',ctx);assert.equal(callbacks.length,1);assert.equal($('#nearestAirButton').disabled,true);
 callbacks[0].ok({coords:{latitude:34.95,longitude:127.49,accuracy:800}});assert.match($('#currentAir').textContent,/가까운 결측소.*미확인/s);assert.match($('#airLocationNote').textContent,/일부 측정소 기준/);assert.equal($('#nearestAirButton').disabled,false);
 vm.runInContext('requestAirLocation()',ctx);callbacks[1].error({code:1});assert.match($('#currentAir').textContent,/가까운 결측소/);assert.match($('#airLocationNote').textContent,/대표 측정소/);assert.match($('#airLocationNote').textContent,/사이트 설정/);
 vm.runInContext('requestAirLocation()',ctx);callbacks[2].error({code:3});assert.match($('#currentAir').textContent,/가까운 결측소/);assert.match($('#airLocationNote').textContent,/대표 측정소/);assert.match($('#airLocationNote').textContent,/시간 초과/);assert.equal(vm.runInContext('airPosition',ctx),null);
});

test('verified official fallback coordinates cover only the explicit 23 stations',()=>{assert.equal(AIR_STATION_FALLBACK.items.length,23);assert.ok(AIR_STATION_FALLBACK.items.every(validStationCoordinates));assert.match(AIR_STATION_FALLBACK.coordinateSource.url,/airkorea.or.kr/);const result=scopeAirQuality({items:[]},[],null,Date.parse('2026-11-02T02:00:00Z'));assert.equal(result.coordinateCoverage,'partial');assert.equal(result.nearestCandidates.length,23);assert.ok(result.nearestCandidates.every(r=>r.missing));});
test('nonfinite, zero coordinates and empty lists cannot fabricate nearest station',()=>{for(const latitude of [0,NaN,Infinity,-Infinity])assert.equal(validStationCoordinates({latitude,longitude:127}),false);assert.deepEqual(nearestAirStations({latitude:34,longitude:Infinity},[a]),[]);assert.deepEqual(nearestAirStations({latitude:34,longitude:127},[]),[])});

test('official one-hour grades 1 through 4 become Korean text; missing/invalid never become good',()=>{
 const now=Date.parse('2026-11-02T02:00:00Z'),row={station:'시험소',referenceAt:new Date(now).toISOString(),pm10:0,pm25:17};
 for(const [i,label]of ['좋음','보통','나쁨','매우 나쁨'].entries())assert.equal(airMeasurementText({...row,pm10Grade1h:i+1},'pm10',now),label+' · 0 µg/m³');
 for(const grade of [undefined,null,0,5,1.5,'1',NaN])assert.match(airMeasurementText({...row,pm10Grade1h:grade},'pm10',now),/^등급 미확인/);
 assert.match(airStationText({...row,pm10Grade1h:1,pm25:null},now),/미세먼지 좋음.*\n초미세먼지 측정 미확인/);
});
test('stale, flagged, missing and future observations cannot show current grades',()=>{
 const now=Date.parse('2026-11-02T02:00:00Z'),row={referenceAt:new Date(now).toISOString(),pm10:30,pm10Grade1h:1};
 for(const change of [{pm10:null},{pm10:NaN},{pm10:-1},{pm10Flag:'통신장애'},{missing:true}])assert.equal(airMeasurementText({...row,...change},'pm10',now),'측정 미확인');
 for(const change of [{stale:true},{referenceAt:null},{referenceAt:new Date(now-7200001).toISOString()},{referenceAt:new Date(now+300001).toISOString()}])assert.match(airMeasurementText({...row,...change},'pm10',now),/^자료 지연/);
 assert.match(airMeasurementText({...row,referenceAt:new Date(now-7200000).toISOString()},'pm10',now),/^좋음/);
});
test('compact air markup escapes station and preserves grades, neutral stale status and intact units',()=>{
 const now=Date.now(),row={station:'<img src=x onerror=alert(1)>',referenceAt:new Date(now).toISOString(),pm10:21,pm25:80,pm10Grade1h:1,pm25Grade1h:4};
 const html=airStationMarkup(row,now);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(html,/air-grade-1/);assert.match(html,/air-grade-4/);assert.match(html,/<small>µg\/m³<\/small>/);assert.equal((html.match(/µg\/m³/g)||[]).length,1);
 const stale=airStationMarkup({...row,stale:true},now);assert.doesNotMatch(stale,/air-grade-[1-4]/);assert.match(stale,/자료 지연/);
 const missing=airStationMarkup({...row,missing:true},now);assert.match(missing,/측정 미확인/);assert.doesNotMatch(missing,/air-number/);
});

const now=Date.parse('2026-11-02T06:00:00Z'),pos={latitude:34.95,longitude:127.49};
const station=(name,delta=0,extra={})=>({station:name,address:'전라남도 순천시 시험로 '+name,municipality:'순천시',latitude:pos.latitude+delta,longitude:pos.longitude,referenceAt:new Date(now).toISOString(),pm10:20,pm25:8,...extra});
const choose=(rows,options={})=>selectAirStation({position:pos,items:rows,candidates:rows,now,...options});
test('Busan-wide readings remain visible from Suwon without station coordinates or a nearby station',()=>{
 const missing={station:'가동',region:'부산',referenceAt:new Date(now).toISOString(),pm10:null,pm25:null};
 const good={...missing,station:'광복동',pm10:21,pm25:8};
 const outside={...good,station:'수원',region:'경기'};
 for(const candidates of [[],[{...good,latitude:35.1,longitude:129.03}]]){
  const result=selectAirStation({position:{latitude:37.2636,longitude:127.0286},items:[missing,good,outside],candidates,groups:[{region:'부산',items:[missing,good]}],weatherCity:'수원시 영통구',now});
  assert.equal(result.row.station,'광복동');assert.equal(result.quality.count,2);
  assert.equal(result.mode,'representative');assert.equal(result.scope,'부산광역시');
  assert.match(airSelectionDetail(result),/부산광역시 선택 범위.*지역 전체 평균 아님/);
 }
 const empty=selectAirStation({position:pos,items:[outside],groups:[{region:'부산',items:[]}],now});
 assert.equal(empty.row,null);
});
test('nearest invalid falls back by distance ONLY inside verified same province and municipality',()=>{
 const a=station('가',0,{pm10Flag:'통신장애',pm25:null}),other=station('여수',.001,{municipality:'여수시',address:'전라남도 여수시 시험로'}),b=station('나',.01),c=station('다',.02),foreign=station('동명',.002,{address:'경기도 순천시 시험로'});
 const out=choose([c,other,foreign,b,a]);assert.equal(out.row.station,'나');assert.equal(out.anchor.station,'가');assert.equal(out.fallback,true);assert.match(airSelectionDetail(out),/통신장애.*나 대체/);assert.equal(out.ranked[1].station,'여수');
});
test('freshness, flags, missing and finite nonnegative readings gate complete fallback; grade alone does not',()=>{
 for(const extra of [{missing:true},{stale:true},{referenceAt:'bad'},{referenceAt:new Date(now+1).toISOString()},{referenceAt:new Date(now-7200001).toISOString()},{pm10:-1},{pm10:Infinity},{pm25Flag:'점검'}]){assert.equal(choose([station('가',0,extra),station('나',.01)]).row.station,'나')}
 assert.equal(choose([station('가',0,{pm10Grade1h:null})]).quality.count,2);
 assert.equal(choose([station('가',0,{referenceAt:new Date(now-7200000).toISOString()})]).quality.count,2);
});
test('partial metrics stay at one station, complete is preferred and usable partial retained',()=>{
 const a=station('가',0,{pm25:null}),b=station('나',.01,{pm10:null});assert.equal(choose([a,b]).row.station,'가');assert.equal(choose([a,b,station('다',.02)]).row.station,'다');
 const out=choose([station('가',0,{missing:true}),b]);assert.equal(out.row.station,'나');assert.equal(out.row.pm10,null);assert.equal(out.quality.count,1);
});
test('all same city invalid remains explicit even with valid neighboring city; 50km guard retained',()=>{
 const a=station('가',0,{missing:true}),b=station('나',.01,{stale:true}),other=station('여수',.001,{municipality:'여수시',address:'전라남도 여수시 시험'});
 assert.equal(choose([a,b,other]).row.station,'가');assert.equal(choose([a,station('먼 곳',1)]).row.station,'가');assert.equal(choose([station('먼 곳',1)]).row,null);
});
test('unknown city never permits fallback and unlocated same-city rows are labeled representative',()=>{
 const a=station('가',0,{missing:true,municipality:null}),b=station('나',.01);assert.equal(choose([a],{position:null}).row.station,'가');assert.equal(choose([a],{position:null}).fallback,false);assert.equal(choose([a,b]).row.station,'가');assert.equal(choose([a,b]).fallback,false);
 const out=choose([station('가',0,{missing:true}),{...b,latitude:null,longitude:null}]);assert.equal(out.row.station,'나');assert.equal(out.mode,'representative');assert.match(airSelectionDetail(out),/거리순 아님/);
});
test('GPS off prefers weather city within scope, never searches another selected city for valid data',()=>{
 const y=station('여수',0,{municipality:'여수시',address:'전라남도 여수시 시험'}),a=station('가',0,{missing:true}),b=station('나',.01);
 assert.equal(choose([y,a,b],{position:null,weatherCity:'순천'}).row.station,'나');
 const out=choose([y,a],{position:null,weatherCity:'순천'});assert.equal(out.row.station,'가');assert.equal(out.mode,'representative');
 assert.equal(choose([y],{position:null,weatherCity:'순천'}).row.station,'여수');
 assert.equal(choose([y,a,b],{items:[a,b]}).row.station,'나');
});

test('empty preferred or first selected municipality never silently changes city without GPS',()=>{
 const y=station('여수',0,{municipality:'여수시',address:'전라남도 여수시 시험'});
 for(const weatherCity of ['순천','서울'])assert.equal(choose([y],{position:null,weatherCity,groups:[{region:'순천',items:[]},{region:'여수',items:[y]}]}).row,null);
});

import {staleLocal} from '../frontend/refresh-control.js';
test('actual selection propagates top-level provider/cache failure to every row and GPS candidate',async()=>{
 const app=await readFile(new URL('../frontend/app.js',import.meta.url),'utf8'),rows=[station('가',0,{missing:true}),station('나',.01)];
 for(const failure of [{stale:true},{refreshError:'request_failed'}])for(const position of [null,pos]){
 const ctx=vm.createContext({usesLastGood,selectAirStation,staleLocal,weatherCity:'순천',airPosition:position,localData:{airQuality:{items:rows,nearestCandidates:rows,groups:[{region:'순천',items:rows}],...failure}}});
 vm.runInContext(app.slice(app.indexOf('function currentAirSelection()'),app.indexOf('function nearbyAir()')),ctx);
 const selected=vm.runInContext('currentAirSelection()',ctx);assert.equal(selected.quality.count,0);assert.equal(selected.fallback,false);assert.equal(selected.row.stale,true);
 }
});
