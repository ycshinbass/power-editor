import test from 'node:test';import assert from 'node:assert/strict';import {scopedPublicSignal} from '../frontend/logic.js';import {warningSheetHTML} from '../frontend/weather-display.js';import {REGION_CATALOG,getRegion,regionMatches} from '../frontend/regions.js';
test('the three counted warnings appear first with explicit regions; outside and pending are separate',()=>{
 const now=Date.parse('2026-11-04T18:00:00Z'),r=(region,level='주의보')=>({type:'강풍',level,region,effective:'2026-11-05 01:00'});
 const s={id:'weather',status:'ok',checkedAt:new Date(now).toISOString(),count:5,records:[r('순천'),r('여수'),r('광양'),r('서울'),r('여수','예비')]},regions=['순천','여수','광양'],v=scopedPublicSignal(s,regions,now),html=warningSheetHTML(s,v,regions);
 assert.equal(v.count,3);assert.equal(v.outsideRecords.length,1);assert.equal(v.pendingRecords.length,1);assert.equal((html.match(/warning-detail-primary/g)||[]).length,3);
 assert.match(html,/관심지역 발효현황 · 3건/);assert.match(html,/관심지역 외 발효현황 · 1건/);assert.ok(html.indexOf('<h3>순천</h3>')<html.indexOf('관심지역 외 발효현황'));assert.ok(html.indexOf('<h3>서울</h3>')>html.indexOf('관심지역 외 발효현황'));
});
test('unknown state never invents a confirmed empty scope; text is escaped',()=>{const html=warningSheetHTML({}, {kind:'failed',unknown:true,records:[],unmappedRecords:[{region:'<script>x</script>',type:'강풍',level:'주의보'}]},['순천']);assert.doesNotMatch(html,/<script>/);assert.doesNotMatch(html,/현재 발효 중인 특보가 없습니다/);});

test('Jeju subareas are outside Jeonnam interests, not three unclassified local warnings',()=>{
 const now=Date.parse('2026-11-04T20:00:00Z'),s={id:'weather',status:'ok',checkedAt:new Date(now).toISOString(),count:3,records:['서귀포시동부','서귀포시중산간','서귀포시남부'].map(x=>({type:'호우',level:'주의보',region:'제주도('+x+')',effective:'2026-11-05 04:00'}))},v=scopedPublicSignal(s,['순천','여수'],now);
 assert.equal(v.unknown,false);assert.equal(v.count,0);assert.equal(v.outsideRecords.length,3);const html=warningSheetHTML(s,v,['순천','여수']);assert.match(html,/관심지역 외 발효현황 · 3건/);assert.match(html,/서귀포시동부/);
});

test('Jeju mountain warning stays outside non-Jeju interests',()=>{
 const now=Date.parse('2026-11-04T20:00:00Z');
 for(const region of ['제주도산지','제주도(제주도산지)','제주도 산지']){
  const s={id:'weather',status:'ok',checkedAt:new Date(now).toISOString(),count:1,records:[{type:'호우',level:'주의보',region,effective:'2026-11-05 04:00'}]};
  const v=scopedPublicSignal(s,['순천','여수'],now);assert.equal(v.unknown,false,region);assert.equal(v.count,0);assert.equal(v.outsideRecords.length,1);
  assert.equal(scopedPublicSignal(s,['제주'],now).unknown,true);
 }
});

test('unrelated island and provincial subzones stay outside while related ambiguity is preserved',()=>{
 const now=Date.parse('2026-11-05T13:30:00Z'),regions=['순천','여수','광양','구례','보성','고흥'];
 const signal=region=>({id:'weather',status:'ok',checkedAt:new Date(now).toISOString(),count:1,records:[{type:'강풍',level:'주의보',region,effective:'2026-11-05 21:30'}]});
 for(const region of ['서해5도(백령도.대청도,연평도.우도),인천광역시(옹진군)','서해5도','강원북부산지','경기북부','경상북도(산지 제외)','제주도산지','인천광역시(옹진군 제외)']){
  const v=scopedPublicSignal(signal(region),regions,now);assert.equal(v.unknown,false,region);assert.equal(v.count,0,region);assert.equal(v.outsideRecords.length,1,region);assert.equal(v.unmappedRecords.length,0,region);
 }
 assert.equal(scopedPublicSignal(signal('서해5도'),['인천'],now).count,1);
 assert.equal(scopedPublicSignal(signal('강원북부산지'),['강원'],now).unknown,true);
 assert.equal(scopedPublicSignal(signal('전라남도(일부 제외)'),regions,now).unknown,true);
 // An unrelated qualifier cannot contaminate a separately confirmed local area.
 assert.equal(scopedPublicSignal(signal('강원북부산지,순천'),regions,now).unknown,false);
 assert.equal(scopedPublicSignal(signal('강원북부산지,순천'),regions,now).count,1);
 const future=signal('서해5도');future.records[0].effective='2026-11-06 01:00';const v=scopedPublicSignal(future,regions,now);assert.equal(v.outsidePendingRecords.length,1);assert.equal(v.unknown,false);
});

const sixRegions=['순천','여수','광양','구례','보성','고흥'],warningNow=Date.parse('2026-11-06T00:32:24Z');
const warningSignal=region=>({id:'weather',status:'ok',checkedAt:new Date(warningNow).toISOString(),count:1,records:[{type:'강풍',level:'주의보',region,effective:'2026-11-06 06:00'}]});
test('reported live KMA island and nested county warning stay outside the six selected municipalities',()=>{
 for(const region of ['울릉도.독도','울릉도·독도','독도','전라남도(신안군(흑산면제외),진도군,영광낙월면)','전라남도(신안군,진도군,영광군)','전라남도(완도군,해남군북부,신안군(흑산면 제외))']){
  const s=warningSignal(region),v=scopedPublicSignal(s,sixRegions,warningNow),html=warningSheetHTML(s,v,sixRegions);
  assert.equal(v.count,0,region);assert.equal(v.unknown,false,region);assert.equal(v.unmappedRecords.length,0,region);assert.equal(v.outsideRecords.length,1,region);
  assert.doesNotMatch(html,/지역 적용 여부 확인/);assert.ok(html.indexOf('<h3>'+region+'</h3>')>html.indexOf('관심지역 외 발효현황'));
 }
 assert.equal(scopedPublicSignal(warningSignal('울릉도.독도'),['울릉'],warningNow).count,1);
 assert.equal(scopedPublicSignal(warningSignal('전라남도(신안군(흑산면제외),순천시)'),sixRegions,warningNow).count,1);
});
test('all catalog municipalities use their explicit scope, even within a selected parent province',()=>{
 for(const r of REGION_CATALOG.filter(r=>r.kind==='municipality')){
  const region=getRegion(r.parent).fullName+'('+r.fullName+'(일부 제외))',v=scopedPublicSignal(warningSignal(region),sixRegions,warningNow);
  const related=sixRegions.some(s=>regionMatches(s,r.id)||regionMatches(r.id,s));
  if(!related){assert.equal(v.unknown,false,region);assert.equal(v.outsideRecords.length,1,region);assert.equal(v.count,0,region)}
  else assert.equal(v.unknown,true,region);
 }
});
test('exclusions, mixed provinces and homonymous counties never broaden an explicit location',()=>{
 assert.equal(scopedPublicSignal(warningSignal('전라남도(순천시 제외)'),['순천'],warningNow).count,0);
 assert.equal(scopedPublicSignal(warningSignal('전라남도(순천시 제외)'),['여수'],warningNow).count,1);
 assert.equal(scopedPublicSignal(warningSignal('전라남도(순천시,여수시 제외)'),['순천','여수'],warningNow).unknown,false);
 assert.equal(scopedPublicSignal(warningSignal('전라남도(일부 제외)'),['순천'],warningNow).unknown,true);
 assert.equal(scopedPublicSignal(warningSignal('경기도(광주시),전라남도(신안군)'),['광주','순천'],warningNow).unknown,false);
 assert.equal(scopedPublicSignal(warningSignal('경기도(광주시),전라남도(신안군)'),['광주','순천'],warningNow).count,0);
 assert.equal(scopedPublicSignal(warningSignal('강원도(고성군산지)'),['경남 고성'],warningNow).unknown,false);
 assert.equal(scopedPublicSignal(warningSignal('강원도(고성군산지)'),['강원 고성'],warningNow).unknown,true);
 const pending=warningSignal('울릉도.독도');pending.records[0].level='예비';assert.equal(scopedPublicSignal(pending,sixRegions,warningNow).outsidePendingRecords.length,1);
});
test('forest incident street-address matching remains separate from warning qualifiers',()=>{
 for(const region of ['전라남도 순천시 별량면','전남광주통합특별시 순천시 별량면','순천시 별량면']){
  const s={...warningSignal(region),id:'fire'};
  assert.equal(scopedPublicSignal(s,['순천'],warningNow).count,1,region);
  assert.equal(scopedPublicSignal(s,['여수'],warningNow).unknown,false,region);
  assert.equal(scopedPublicSignal(s,['여수'],warningNow).count,0,region);
 }
});
