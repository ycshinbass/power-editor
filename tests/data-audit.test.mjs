import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePublicSignal} from '../worker/public-signals.mjs';
import {focusedNewsMatch,selectFocusedNews,collectFocusedNews as collectGuardedNews} from '../worker/focused-news.mjs';
const collectFocusedNews=(env,category,options)=>collectGuardedNews(env,category,{...options,transport:(u,o,{fetchFn})=>fetchFn(u,o)});
import {parseDemandPage} from '../worker/power-demand.mjs';
import {metCalendarDays} from '../worker/met-normalize.mjs';
import {modelForecastHTML} from '../frontend/weather-display.js';
const now=Date.parse('2026-11-03T06:00:00Z');
test('current-warning explicit outside-table empty is accepted, preliminary empty never is',()=>{
 const empty='<table id="current-warnings"><tbody></tbody></table>',message='<h3 class="tit">특보 내용</h3><p class="tit">o 없 음</p><p class="txt">o 없음</p>';
 assert.equal(parsePublicSignal('weather',message+empty).count,0);
 assert.throws(()=>parsePublicSignal('weather',empty+message));assert.throws(()=>parsePublicSignal('weather',empty));
});
test('resolved non-fire reports are not ongoing fires; unfamiliar status fails closed',()=>{
 const row={frfrPrgrsStcdNm:'산불외종료',frfrSttmnAddr:'울산광역시 울주군',frfrFrngDtm:'2026-11-03 06:00:00'};
 assert.equal(parsePublicSignal('fire',JSON.stringify({fireShowInfoList:[row]})).count,0);
 const live=parsePublicSignal('fire',JSON.stringify({fireShowInfoList:[{...row,frfrPrgrsStcdNm:'진화중'}]}));assert.equal(live.count,1);assert.equal(live.records[0].region,row.frfrSttmnAddr);
 assert.throws(()=>parsePublicSignal('fire',JSON.stringify({fireShowInfoList:[{...row,frfrPrgrsStcdNm:'새상태'}]})));
});
test('outage requires domestic actual-impact evidence, excludes armistice and future disconnection',()=>{
 for(const t of ['순천 아파트 정전 발생…300세대 불편','서울 전력 공급 중단…복구 완료','부산 변전설비 고장으로 정전 발생'])assert.equal(focusedNewsMatch(t,'outage'),true,t);
 for(const t of ['가자 정전 합의','한국 정전협정 73주년','홈플러스 한전 단전예고','서울 아파트 계획 정전 예정','미국 대정전 100만가구 피해','일본 정전…서울 기업도 피해','정전 발생 100가구 복구','순천 정전 대비 훈련'])assert.equal(focusedNewsMatch(t,'outage'),false,t);
});
test('KEPCO ticker requires company operations or policy, rejects incidental customer credit and stock stories',()=>{
 assert.equal(focusedNewsMatch('한전, 송전망 확충 사업 추진','kepco'),true);
 assert.equal(focusedNewsMatch('한국전력 3분기 영업이익 발표','kepco'),true);
 for(const t of ['홈플러스 한전으로부터 단전예고','한국전력 주가 상승…실적 기대','한국전력 배구 경기 승리','아파트 주민 한전 전기요금 미납'])assert.equal(focusedNewsMatch(t,'kepco'),false);
 const r={title:'한전, 송전망 확충 사업 추진',url:'https://news.google.com/rss/articles/abc',publishedAt:new Date(now).toISOString(),publisherName:'가상언론'};
 assert.equal(selectFocusedNews([r,r,{...r,title:'한전 투자 사업',publishedAt:new Date(now-73*3600000).toISOString()}],'kepco',now).length,1);
});
test('failed focused feed is cached for the hour and cannot trigger per-visitor repeated calls',async()=>{
 let saved=null,version=null,calls=0;const store={read:async()=>({value:saved,version}),compareAndSwap:async(k,v,value)=>{if(v!==version)return {applied:false};saved=value;version=String(Number(version||0)+1);return {applied:true,version};}};
 const fetchFn=async()=>{calls++;throw Error('offline')};
 const a=await collectFocusedNews({},'outage',{store,now,fetchFn}),b=await collectFocusedNews({},'outage',{store,now:now+1000,fetchFn});assert.equal(a.status,'unavailable');assert.equal(b.status,'unavailable');assert.equal(calls,1);
});
function demandPage(x=[60000,61000],times=[20261103000000,20261103000500]){return `function drawChart(par1, par2, par3){var x = [${x}];var y = [59000,58000];var t_time = [${times}];var y_time = [20261102000000,20261102000500];"name": "현재수요(전력시장)", "data": x;"name": "과거수요(전력시장)", "data": y;`}
test('RSS transient failure retains only eligible recent prior headlines with explicit old timestamp',async()=>{
 const item={title:'한전, 송전망 확충 사업 추진',url:'https://news.google.com/rss/articles/abc',publishedAt:new Date(now).toISOString(),publisherName:'가상언론'};
 let saved={slot:Math.floor(now/3600000)-3,data:{status:'ok',items:[item,{...item,title:'한전 투자 사업',publishedAt:new Date(now-74*3600000).toISOString()}],checkedAt:new Date(now-3*3600000).toISOString()}},version='1';
 const store={read:async()=>({value:saved,version}),compareAndSwap:async(k,v,value)=>{if(v!==version)return {applied:false};saved=value;version=String(Number(version)+1);return {applied:true,version}}};
 const d=await collectFocusedNews({},'kepco',{now,store,fetchFn:async()=>new Response('',{status:503})});
 assert.equal(d.items.length,1);assert.equal(d.stale,true);assert.equal(d.refreshError,true);assert.equal(d.checkedAt,new Date(now-3*3600000).toISOString());assert.equal(d.failureCode,'upstream_http_503');
});
test('focused collection recovers an expired or legacy abandoned reservation but respects active lease and attempt cap',async()=>{
 for(const initial of [{slot:Math.floor(now/3600000),attempts:1,data:null},{slot:Math.floor(now/3600000),attempts:1,data:null,leaseUntil:now-1}]){
  let saved=initial,version='1',calls=0;const store={read:async()=>({value:saved,version}),compareAndSwap:async(k,v,value)=>{if(v!==version)return {applied:false};saved=value;version=String(Number(version)+1);return {applied:true,version}}};
  const fetchFn=async()=>{calls++;throw Error('offline')};
  const result=await collectFocusedNews({},'kepco',{now,store,fetchFn});assert.equal(calls,1);assert.equal(result.status,'unavailable');assert.equal(saved.attempts,2);
  saved={...initial,leaseUntil:now+1000};await collectFocusedNews({},'kepco',{now,store,fetchFn});assert.equal(calls,1);
  saved={...initial,attempts:3};assert.equal((await collectFocusedNews({},'kepco',{now,store,fetchFn})).status,'unavailable');assert.equal(calls,1);
 }
});
test('official demand parser validates arrays, dates and definition without evaluating provider JavaScript',()=>{
 const d=parseDemandPage(demandPage(),now);assert.equal(d.today[1].mw,61000);assert.equal(d.scope,'national_market');assert.equal(d.stale,true);
 assert.throws(()=>parseDemandPage(demandPage([60000]),now));assert.throws(()=>parseDemandPage(demandPage([60000,61000],[20261102000000,20261102000500]),now));assert.throws(()=>parseDemandPage(demandPage().replace('現在','wrong').replace('目前','wrong').replace('현재수요(전력시장)','총수요 추정'),now));
});
test('model calendar rainfall never overlaps 1h and6h values and exposes partial coverage',()=>{
 const start=Date.parse('2026-11-03T15:00:00Z'),points=new Map();for(let i=0;i<24;i++)points.set(start+i*3600000,{data:{instant:{details:{wind_speed:3+i/10}},next_1_hours:{details:{precipitation_amount:1}},next_6_hours:{details:{precipitation_amount:99}}}});
 const d=metCalendarDays(points,now)[1];assert.equal(d.rainMm,24);assert.equal(d.rainCoverageHours,24);assert.equal(d.partial,false);
 points.delete(start);const partial=metCalendarDays(points,now)[1];assert.equal(partial.rainCoverageHours,23);assert.equal(partial.partial,true);
 const html=modelForecastHTML({status:'ok',city:'순천',sourceUpdatedAt:new Date(now).toISOString(),calendarDays:[d]},{city:'서울',now});assert.doesNotMatch(html,/24\.0/);assert.match(html,/자료 확인 필요/);
});
