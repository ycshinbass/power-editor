import test from 'node:test';
import assert from 'node:assert/strict';
import {REGION_CATALOG} from '../frontend/regions.js';
import {parseAirStations,scopeAirQuality} from '../worker/air-stations.mjs';
import {selectAirStation,airStationMarkup,airMunicipality} from '../frontend/air-location.js';

// Synthetic observations exercise every catalogue scope; these are not live readings.
const now=Date.parse('2026-11-12T03:00:00Z');
const leaves=REGION_CATALOG.filter(r=>['district','municipality'].includes(r.kind));
const gwangju=new Set(['동구','서구','남구','북구','광산구']);
const providerRegion=r=>r.province==='전남광주'?(gwangju.has(r.fullName)?'광주':'전남'):r.province;
const stationRows=leaves.flatMap((r,i)=>['가결측','나정상'].map(prefix=>({stationName:prefix+i,addr:r.provinceFull+' '+r.fullName.replace(/시(?=.+구$)/,'시 ')+' 검증로 1'})));
const metadata=parseAirStations({response:{header:{resultCode:'00'},body:{items:stationRows,totalCount:stationRows.length}}},now);
const readings=leaves.flatMap((r,i)=>['가결측','나정상'].map((prefix,j)=>({station:prefix+i,region:providerRegion(r),referenceAt:new Date(now).toISOString(),pm10:j?21:null,pm25:j?8:null,pm10Grade1h:1,pm25Grade1h:1})));

for(const region of REGION_CATALOG){
 test(`region ${region.id}: official address scope reaches a usable summary with GPS on or off`,()=>{
  const scoped=scopeAirQuality({status:'ok',items:readings},[region.id],metadata,now);
  assert.ok(scoped.items.some(r=>r.pm10===21),JSON.stringify(scoped.groups));
  for(const position of [null,{latitude:37.2636,longitude:127.0286}]){
   const selected=selectAirStation({...scoped,candidates:scoped.nearestCandidates,position,weatherCity:'수원시 영통구',now});
   assert.equal(selected.quality?.count,2);
   assert.ok(scoped.groups[0].items.some(r=>r.station===selected.row.station));
   assert.match(airStationMarkup(selected.row,now),/>21</);
   assert.match(airStationMarkup(selected.row,now),/>8</);
  }
 });
}

test('all province scopes and nationwide retain usable readings when metadata is unavailable',()=>{
 for(const region of [null,...REGION_CATALOG.filter(r=>['province','legacy-province'].includes(r.kind))]){
  const scoped=scopeAirQuality({status:'ok',items:readings},region?[region.id]:[],null,now);
  for(const position of [null,{latitude:37.2636,longitude:127.0286}]){
   const selected=selectAirStation({...scoped,candidates:scoped.nearestCandidates,position,now});
   assert.equal(selected.quality?.count,2,region?.id||'전국');
  }
 }
});

test('Sejong road-name addresses without a second municipality support district selection and GPS fallback',()=>{
 const items=[{stationName:'가측정소',addr:'세종특별자치시 한누리대로 2130',dmX:'36.48',dmY:'127.29'},{stationName:'나측정소',addr:'세종특별자치시 조치원읍 군청로 93',dmX:'36.49',dmY:'127.29'}];
 const meta=parseAirStations({response:{header:{resultCode:'00'},body:{items,totalCount:2}}},now);
 const data={status:'ok',items:items.map((r,i)=>({station:r.stationName,region:'세종',referenceAt:new Date(now).toISOString(),pm10:i?21:null,pm25:i?8:null}))};
 for(const region of ['세종','세종특별자치']){
  const scoped=scopeAirQuality(data,[region],meta,now);
  assert.equal(scoped.groups[0].receivedCount,2);
  const selected=selectAirStation({...scoped,candidates:scoped.nearestCandidates,position:{latitude:36.48,longitude:127.29},now});
  assert.equal(selected.row.station,'나측정소');assert.equal(selected.quality.count,2);
  assert.equal(airMunicipality(selected.row).city,'세종특별자치시');
 }
});

test('districts without matching station metadata report the gap and never borrow province values',()=>{
 const scoped=scopeAirQuality({status:'ok',items:readings},['수원시 영통구'],null,now);
 assert.equal(scoped.groups[0].status,'metadata_unavailable');
 assert.equal(selectAirStation({...scoped,now}).row,null);
});
