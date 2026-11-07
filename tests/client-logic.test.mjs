import test from 'node:test';import assert from 'node:assert/strict';import {validDate,nearestCity,validWeather} from '../frontend/logic.js';
test('dates reject normalized impossible dates',()=>{assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2026-02-28'),true);assert.equal(validDate('2028-02-29'),true)});test('optional local location matches city without sending coordinates',()=>{assert.equal(nearestCity(34.95,127.49,{순천:[34.95,127.49],서울:[37.57,126.98]}).name,'순천');assert.equal(nearestCity(0,0,{순천:[34.95,127.49]}),null);assert.equal(nearestCity(NaN,0,{}),null)});test('corrupt weather storage rejected',()=>{assert.equal(validWeather({days:['bad']}),false);assert.equal(validWeather({city:'순천',checkedAt:'2026-10-31T00:00:00Z',days:[{date:'2026-10-31',rainMm:0,gustMs:4,windMs:2,snowCm:0}]}),true)});

import {diverseNews as selectNews,editorPick,isKepcoNews,freshNews,isRegionalNews,newsQuotaNotice} from '../frontend/logic.js';
const testNow=Date.parse('2026-11-02T01:00:00Z');
const diverseNews=(items,regions=[])=>selectNews(items.map(i=>({...i,publishedAt:i.publishedAt||'2026-11-02T00:00:00Z',url:i.url||'https://official.test/'+i.id,...(i.scope==='local'?{regionEvidence:{type:'official_metadata',url:i.url||'https://official.test/'+i.id,regions:i.regions}}:{})})),regions,testNow);
test('five-story opening diversifies topics, reserves up to two matching regional items, no quota nationwide',()=>{
 const row=(id,title,extra={})=>({id,title,scope:'national',freshness:'recent',regions:[],...extra});
 const rows=[row('s1','Battery storage power project'),row('s2','New battery storage factory'),row('g','Transmission grid upgrade'),row('d','Peak electricity demand record'),row('p','Electricity tariff policy'),row('l1','순천 변전소 점검',{scope:'local',regions:['순천']}),row('l2','여수 전력수요 증가',{scope:'local',regions:['여수']}),row('old','광양 전력망 계획',{scope:'local',regions:['광양'],freshness:'older'})];
 const regional=diverseNews(rows,['순천','여수']).slice(0,5);assert.equal(regional.length,5);assert.deepEqual(regional.slice(0,2).map(i=>i.id),['l1','l2']);assert.ok(!regional.some(i=>i.id==='old'));assert.ok(!regional.some(i=>i.id==='s2'));
 assert.equal(diverseNews(rows,[]).length,rows.length);assert.equal(diverseNews(rows,['전남'])[0].id,'l1');assert.equal(diverseNews(rows,['서울']).length,rows.length);assert.equal(diverseNews(rows.slice(0,1),['순천']).length,1);
});
test('obvious repeat headlines collapse while distinct regions survive',()=>{
 const rows=[{title:'PJM announces major transmission grid upgrade',regions:[]},{title:'PJM announces major transmission grid upgrade today',regions:[]},{title:'순천 변전소 점검',regions:['순천']},{title:'여수 변전소 점검',regions:['여수']}];assert.equal(diverseNews(rows).length,3);
});
test('editor pick strips selection-process language and bounds old stored copy',()=>{
 const text=editorPick({editorial:{selectionReason:'공급 확보 제도 변화. 비교 사례로 선정했습니다.'}});assert.equal(text,'공급 확보 제도 변화.');assert.ok(editorPick({reason:'전력 변화 '.repeat(60)}).length<=110);assert.doesNotMatch(editorPick({reason:'제목에 전력망이 있어 선정했습니다.'}),/선정/);
});

test('regional minimum is not a maximum and older items do not silently pad the quota',()=>{
 const locals=['정전 사고','전력 수요','태양광 발전'].map((title,n)=>({id:n,title:'순천 '+title,scope:'local',regions:['순천'],freshness:'recent'}));
 const result=diverseNews([...locals,{title:'전국 요금 정책',scope:'national',freshness:'recent'},{title:'순천 송전망 계획',scope:'local',regions:['순천'],freshness:'older'}],['순천']);
 assert.equal(result.slice(0,4).filter(i=>i.scope==='local').length,3);assert.equal(result.at(-1).freshness,'older');
});

import {toggleRegionChoice} from '../frontend/logic.js';
test('region setup requires explicit nationwide choice and permits multiple regions',()=>{let c={regions:[],nationwide:false};c=toggleRegionChoice(c,'여수');c=toggleRegionChoice(c,'순천');assert.deepEqual(c,{regions:['여수','순천'],nationwide:false});c=toggleRegionChoice(c,'전국');assert.deepEqual(c,{regions:[],nationwide:true});c=toggleRegionChoice(c,'순천');assert.deepEqual(c,{regions:['순천'],nationwide:false});c=toggleRegionChoice(c,'순천');assert.deepEqual(c,{regions:[],nationwide:false});});

test('KEPCO floor overlaps verified local floor, spreads regions, and excludes stale fillers',()=>{
 const row=(id,title,regions=[],extra={})=>({id,title,url:'https://official.test/'+id,publishedAt:'2026-11-02T00:00:00Z',scope:'national',categoryId:'grid',freshness:'recent',regionEvidence:{type:'official_metadata',url:'https://official.test/'+id,regions},...extra});
 const rows=[row('a','한전 순천 배전망 정비',['순천']),row('b','순천 ESS 사업',['순천']),row('c','여수 전력수급 점검',['여수']),row('d','국내 송전망 확대'),row('e','해외 원전 정책',[],{scope:'global'}),row('old','한국전력 과거 요금',[],{publishedAt:'2026-10-01',freshness:'older'})];
 const result=selectNews(rows,['순천','여수'],testNow);assert.deepEqual(result.slice(0,2).map(i=>i.id),['a','c']);assert.equal(newsQuotaNotice(result,['순천','여수'],testNow),'');assert.equal(result.at(-1).id,'old');
 assert.equal(freshNews({...rows[0],stale:true},testNow),false);assert.equal(freshNews({...rows[0],publishedAt:'broken'},testNow),false);assert.equal(freshNews({...rows[0],publishedAt:'2026-10-29'},testNow),false);
});
test('title-only regional hints and unrelated subsidiary names cannot satisfy quotas',()=>{
 const hint={title:'여수 한전 배전망 개선',url:'https://official.test/a',scope:'local',regions:['여수'],publishedAt:'2026-11-02T00:00:00Z'};
 assert.equal(isRegionalNews(hint,['여수']),false);assert.match(newsQuotaNotice([hint],['여수'],testNow),/관심지역 새 소식 0건/);
 for(const title of ['한전KPS 발전설비 정비','한전KDN 정보시스템','한국전력기술 설계','KEPCO KPS maintenance','KEPCO E&C design'])assert.equal(isKepcoNews({title}),false,title);
 for(const title of ['한전 배전망 개선','한국전력 요금 발표','KEPCO grid upgrade','한전KDN, 한국전력과 협약'])assert.equal(isKepcoNews({title}),true,title);
 assert.match(newsQuotaNotice([{...hint,publishedAt:'2026-10-01'}],[],testNow),/한전 새 소식 확보 부족/);
});


test('KEPCO quota requires a name boundary, not the substring in 대한전선',()=>{
 for(const title of ['대한전선, 해저케이블 포설선 확보', '대한전선 해저케이블 포설선', '대한전선 전력망 사업 확대', '대한전선·LS전선 수주', '한전KPS 발전설비 정비', '한전KDN 정보시스템', '한전기술 설계', '한국전력기술 설계'])assert.equal(isKepcoNews({title}),false,title);
 for(const title of ['한국전력 배전망 개선', '한국전력공사 발표', '한전은 송전망을 확충', '한전·지자체 협약', '“한전” 요금 발표', '대한전선, 한국전력과 계약'])assert.equal(isKepcoNews({title}),true,title);
 const cable={title:'대한전선, 해저케이블 포설선 확보',sourceId:'etoday',publishedAt:'2026-11-02T00:00:00Z'};
 assert.match(newsQuotaNotice([cable],[],testNow),/한전 새 소식 확보 부족/);
 assert.equal(isKepcoNews({...cable,sourceId:'kepco'}),true,'direct official KEPCO source remains authoritative');
});
