import test from 'node:test';
import {usesLastGood} from '../frontend/last-good.js';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('NAVER design uses only labelled fixtures, switches scope, and never calls the API',()=>{
  const elements=new Map(),buttons=['power','local','kepco'].map(scope=>({dataset:{naverScope:scope},setAttribute(){}}));
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{dataset:{},value:selector==='select'?'sim':'',setAttribute(){},querySelector:element,querySelectorAll:()=>buttons});
    return elements.get(selector);
  };
  let banners=0;
  element('.masthead').after=()=>banners++;
  const context=vm.createContext({usesLastGood,URLSearchParams,location:{search:'?news-preview=naver',hash:''},document:{documentElement:{classList:{add(){}}},getElementById:()=>null,querySelector:element,createElement:()=>({})},MutationObserver:class {observe(){}},fetch(){throw Error('Preview must not call any API')}});
  const code=readFileSync(new URL('../frontend/naver-preview.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
  vm.runInContext(code+'\nrenderNaverPreview();',context);
  assert.doesNotMatch(element('#newsList').innerHTML,/AI 해설 없음|AI 분석·요약/);
  const results=()=>element('#naverPreviewResults').innerHTML;
  assert.equal((results().match(/<article /g)||[]).length,5);
  assert.match(results(),/\[가상\]/);
  assert.doesNotMatch(results(),/href=/);
  buttons[1].onclick();assert.match(results(),/순천 산업단지/);
  element('select').value='date';element('select').onchange();
  assert.match(results().split('</article>')[0],/09:25/);
  vm.runInContext('renderNaverPreview()',context);
  assert.equal(banners,1);
  assert.match(results().split('</article>')[0],/09:25/);
});

test('preview hides internal wording without converting missing/stale signals to zero',()=>{
  const code=readFileSync(new URL('../frontend/naver-preview.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
  const ctx=vm.createContext({usesLastGood,URLSearchParams,location:{search:''}});vm.runInContext(code,ctx);
  for(const label of ['갱신 실패 · 이전 판별 실패','관심지역 조회 실패','자료 지연 · 이전 0건']){
    assert.equal(vm.runInContext('previewSignalLabel('+JSON.stringify(label)+')',ctx),'현황 확인 필요');
  }
  assert.equal(vm.runInContext("previewSignalLabel('0건')",ctx),'0건');
  assert.equal(vm.runInContext("previewSignalLabel('2건')",ctx),'2건');
  assert.equal(vm.runInContext("previewFlowLabel('2026-11-03 · 당일 126개 · 전일 288개 확인 · 미수집 구간은 공백')",ctx),'');
  assert.equal(vm.runInContext("previewFlowLabel('2026-11-03 · 당일 126개 확인 · 갱신 실패 · 이전 자료')",ctx),'이전 자료 · 기준시각 확인');
  assert.equal(vm.runInContext("previewFlowLabel('하루 추이 연동 대기')",ctx),'자료 확인 필요');
});

test('demand comparisons reject missing future actuals and invalid baselines',()=>{
  const code=readFileSync(new URL('../frontend/naver-preview.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
  const ctx=vm.createContext({usesLastGood,URLSearchParams,location:{search:''}});vm.runInContext(code,ctx);
  assert.equal(vm.runInContext('demandDelta(78.4,76).mw',ctx),2400);
  assert.equal(vm.runInContext('demandDelta(78.4,77.8).mw',ctx),600);
  assert.equal(vm.runInContext('demandDelta(78.4,76).percent.toFixed(1)',ctx),'3.2');
  for(const expression of ['demandDelta(undefined,87.4)','demandDelta(null,87.4)','demandDelta(78,0)','demandDelta(78,NaN)'])assert.equal(vm.runInContext(expression,ctx),null);
  assert.equal(vm.runInContext('demandExample.actual[12]',ctx),undefined);
  assert.equal(vm.runInContext('demandExample.forecast.indexOf(Math.max(...demandExample.forecast))+1',ctx),18);
});

test('daylight uses the date and coordinates, including season, longitude and invalid inputs',()=>{
  const code=readFileSync(new URL('../frontend/naver-preview.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
  const ctx=vm.createContext({usesLastGood,URLSearchParams,location:{search:''}});vm.runInContext(code,ctx);
  const solar=(date,lat=37.5665,lon=126.978)=>JSON.parse(vm.runInContext('JSON.stringify(solarDaylight('+JSON.stringify(date)+','+lat+','+lon+'))',ctx));
  const summer=solar('2026-06-21'),winter=solar('2026-12-21');
  // Seoul summer sunrise around 05:10, sunset around 19:57 KST; winter 07:43 / 17:17.
  assert.ok(Math.abs(summer.sunrise-(5+10/60))<.15);assert.ok(Math.abs(summer.sunset-(19+57/60))<.15);
  assert.ok(Math.abs(winter.sunrise-(7+43/60))<.15);assert.ok(Math.abs(winter.sunset-(17+17/60))<.15);
  const west=solar('2026-11-03',35,126),east=solar('2026-11-03',35,130);
  assert.ok(east.sunrise<west.sunrise);assert.ok(east.sunset<west.sunset);
  assert.notEqual(solar('2026-11-03').sunrise,solar('2026-11-04').sunrise);
  assert.ok(solar('2024-02-29'));assert.equal(solar('2026-02-29'),null);
  for(const expr of ["solarDaylight('bad',35,127)","solarDaylight('2026-11-03',undefined,127)","solarDaylight('2026-11-03',35,NaN)","solarDaylight('2026-11-03',90,127)","solarDaylight('2026-06-21',80,0)"])assert.equal(vm.runInContext(expr,ctx),null);
});

test('solar elevation is below the horizon at night and follows the date-specific daylight curve',()=>{
  const code=readFileSync(new URL('../frontend/naver-preview.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
  const ctx=vm.createContext({usesLastGood,URLSearchParams,location:{search:''}});vm.runInContext(code,ctx);
  const altitude=(date,hour)=>vm.runInContext(`solarElevation('${date}',34.95,127.49,${hour})`,ctx);
  assert.ok(altitude('2026-11-03',0)<-50);assert.ok(altitude('2026-11-03',12)>30);assert.ok(altitude('2026-11-03',20)<0);
  assert.ok(altitude('2026-06-21',12)>altitude('2026-12-21',12)+40);
  const rise=vm.runInContext("solarDaylight('2026-11-03',34.95,127.49).sunrise",ctx);
  assert.ok(Math.abs(altitude('2026-11-03',rise)+.833)<.02);
  assert.ok(Math.abs(altitude('2026-11-03',24)-altitude('2026-11-04',0))<.02);
  assert.equal(altitude('invalid',12),null);assert.equal(altitude('2026-11-03',25),null);
});

test('briefing emphasis separates current active, zero, pending and unverified signals',()=>{
  const code=readFileSync(new URL('../frontend/naver-preview.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
  const ctx=vm.createContext({usesLastGood,URLSearchParams,location:{search:''}});vm.runInContext(code,ctx);
  const state=(view,options={})=>JSON.parse(vm.runInContext('JSON.stringify(previewSignalState('+JSON.stringify(view)+','+JSON.stringify(options)+'))',ctx));
  assert.equal(state({kind:'empty',count:0}).state,'empty');
  assert.equal(state({kind:'empty',count:0}).label,'0건');
  assert.equal(state({kind:'present',count:2}).state,'active');
  for(const v of [{kind:'stale',count:2},{kind:'failed',count:0},{kind:'present',count:null,unknown:true}])assert.equal(state(v).state,'unknown');
  assert.equal(state({kind:'present',count:2},{loading:true}).state,'unknown');
  assert.equal(state({kind:'present',count:0,records:[],pendingRecords:[{type:'강풍'}]},{weather:true}).state,'empty');
  const partial=state({kind:'present',count:1,records:[{type:'강풍'}],unknown:true},{weather:true});
  assert.equal(partial.state,'active');assert.match(partial.label,/일부 미확인/);
});

test('preview earthquakes show only verified domestic occurrences within 24 hours',()=>{
  const code=readFileSync(new URL('../frontend/naver-preview.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
  const ctx=vm.createContext({usesLastGood,URLSearchParams,location:{search:''}});vm.runInContext(code,ctx);
  const now=Date.parse('2026-11-03T04:00:00Z');
  const recent={type:'domestic',occurredAt:'2026-11-03T02:00:00Z',location:'국내 예시'};
  const state=data=>JSON.parse(vm.runInContext('JSON.stringify(previewDomesticEarthquakes('+JSON.stringify(data)+','+now+'))',ctx));
  assert.equal(state({status:'ok',items:[{...recent,type:'overseas'}]}).state,'empty');
  const value=state({status:'ok',items:[recent,{...recent,type:'overseas'},{...recent,occurredAt:'2026-11-01T02:00:00Z'},{...recent,occurredAt:'2026-11-04T02:00:00Z'}]});
  assert.equal(value.state,'active');assert.equal(value.items.length,1);
  for(const data of [{status:'unavailable',items:[recent]},{status:'ok',stale:true,items:[recent]},{status:'ok',refreshError:'failed',items:[recent]},{status:'ok',items:[{...recent,occurredAt:null}]}])assert.equal(state(data).state,'unknown');
});
