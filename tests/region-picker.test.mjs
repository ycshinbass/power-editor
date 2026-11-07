import test from 'node:test';
import assert from 'node:assert/strict';
import {REGION_CATALOG,normalizeRegions,MAX_REGIONS,getRegion} from '../frontend/regions.js';
import {regionPickerHTML} from '../frontend/region-picker.js';
import {toggleRegionChoice,isRegionalNews,scopedPublicSignal} from '../frontend/logic.js';
test('full picker supports qualified search, current choice, no results and 30-cap',()=>{
 const html=regionPickerHTML({regions:['순천'],query:'경기 광주'});
 assert.match(html,/순천시 ×/);assert.match(html,/data-region="경기 광주"/);assert.doesNotMatch(html,/data-region="광주"/);
 assert.match(regionPickerHTML({query:'존재하지않는시군'}),/검색한 지역이 없습니다/);
 const selected=REGION_CATALOG.slice(0,MAX_REGIONS).map(r=>r.id);
 assert.match(regionPickerHTML({regions:selected}),/선택 30 \/ 30곳/);assert.match(regionPickerHTML({regions:selected}),/disabled/);
 assert.deepEqual(toggleRegionChoice({regions:selected,nationwide:false},'강릉').regions,selected);
 assert.equal(toggleRegionChoice({regions:selected,nationwide:false},selected[0]).regions.length,29);
});
test('saved selections retain legacy IDs and all thirty choices',()=>{
 assert.deepEqual(normalizeRegions(['순천','여수','전남','광주','경기 광주']),['순천','여수','전남','광주','경기 광주']);
 assert.equal(normalizeRegions(REGION_CATALOG.slice(0,30).map(r=>r.id)).length,30);
 assert.equal(getRegion('수원').latitude,null);
});
test('news evidence respects municipality specificity and same-name distinction',()=>{
 const article=tag=>({url:'https://official.test/a',regionEvidence:{type:'official_metadata',url:'https://official.test/a',regions:[tag]}});
 assert.equal(isRegionalNews(article('경기 광주'),['광주']),false);
 assert.equal(isRegionalNews(article('경기'),['경기 광주']),false);
 assert.equal(isRegionalNews(article('순천'),['전남']),true);
});
test('ambiguous warning geography stays unknown; exact new municipality works',()=>{
 const now=Date.parse('2026-11-02T00:00:00Z');
 const signal=region=>({id:'weather',status:'ok',checkedAt:new Date(now).toISOString(),count:1,records:[{region,effective:'2026-11-02 08:00'}]});
 for(const region of ['강원북부산지','강릉시(산지 제외)','광주'])assert.equal(scopedPublicSignal(signal(region),['강릉'],now).unknown,true,region);
 // Both homonymous counties are outside Gangneung; ambiguity is relevant only
 // when one possible administrative location overlaps the selected region.
 assert.equal(scopedPublicSignal(signal('고성군'),['강릉'],now).unknown,false);
 assert.equal(scopedPublicSignal(signal('고성군'),['강원 고성'],now).unknown,true);
 assert.equal(scopedPublicSignal(signal('강릉시'),['강릉'],now).count,1);
 assert.equal(scopedPublicSignal(signal('경기도 광주시'),['광주'],now).count,0);
 assert.equal(scopedPublicSignal(signal('경기도 광주시'),['경기 광주'],now).count,1);
});
