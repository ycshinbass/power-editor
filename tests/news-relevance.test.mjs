import test from 'node:test';
import assert from 'node:assert/strict';
import {homeNews,newsValue,newsQuotaNotice,isRegionalNews} from '../frontend/logic.js';
import {googleNewsSources} from '../worker/google-news.mjs';
const now=Date.parse('2026-11-03T01:00:00Z');
const row=(id,title,scope='national',regions=[])=>({id,title,scope,regions,url:'https://example.test/'+id,publishedAt:new Date(now).toISOString(),regionEvidence:{type:'headline_location',url:'https://example.test/'+id,regions}});
test('foreign neighborhood and scheduled outages cannot displace domestic system changes',()=>{
 const rows=[row('a','Power outage on a city street','global'),row('b','Scheduled power outage for maintenance tomorrow','global'),row('c','한전 송전망 증설 착공'),row('d','전기요금 제도 개정 시행'),row('e','HVDC 변환설비 상용화'),row('f','전력수급 예비력 확보'),row('g','Nationwide blackout leaves millions without power','global')];
 const selected=homeNews(rows,[],null,now);assert.equal(selected.length,5);assert.ok(!selected.some(i=>['a','b'].includes(i.id)));assert.ok(selected.some(i=>i.id==='g'));
});
test('KEPCO floor does not elevate sports, stock promotion or ceremonial PR',()=>{
 const rejected=['한국전력 배구팀 연승 승점 선두','한전 사회공헌 봉사 캠페인','한전 전력망 협력 업무협약 체결','한전 주가 급등 종목추천'];
 for(const title of rejected)assert.equal(newsValue(row('x',title)).eligible,false,title);
 const selected=homeNews([...rejected.map((t,i)=>row('x'+i,t)),row('good','전력수급 예비력 확대')],[],null,now);assert.deepEqual(selected.map(i=>i.id),['good']);assert.match(newsQuotaNotice(selected,[],now),/한전 새 소식 확보 부족/);
 assert.equal(newsValue(row('tech','Power transformer manufacturer launches world-first 800kV equipment','global')).eligible,true);
});
test('local minimum overlaps relevant KEPCO; old or unrelated items never pad main five',()=>{
 const rows=[row('local1','한전 순천 배전망 설비 교체','local',['순천']),row('local2','여수 변전소 정비 공사','local',['여수']),row('common','전력수급 대응 정책 시행'),row('promo','순천 한전 기부 캠페인','local',['순천']),{...row('old','여수 정전 복구','local',['여수']),publishedAt:'2026-10-01T00:00:00Z'}];
 const selected=homeNews(rows,['순천','여수'],null,now).filter(i=>Date.parse(i.publishedAt)>now-72*3600000);assert.equal(selected.length,3);assert.equal(selected.filter(i=>isRegionalNews(i,['순천','여수'])).length,2);assert.equal(newsQuotaNotice(selected,['순천','여수'],now),'');
});
test('all original six regions fit into two bounded regional queries',()=>{
 const sources=googleNewsSources(['여수','순천','광양','구례','보성','고흥']);assert.equal(sources.length,5);
 const queries=sources.filter(s=>s.id.startsWith('google-local')).map(s=>new URL(s.url).searchParams.get('q')).join(' ');
 for(const name of ['여수','순천','광양','구례','보성','고흥'])assert.ok(queries.includes('"'+name+'"'));
});
