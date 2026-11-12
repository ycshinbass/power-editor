import * as lastGood from '../frontend/last-good.js';
import * as weatherDisplay from '../frontend/weather-display.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as regionCatalog from '../frontend/regions.js';
import * as regionPicker from '../frontend/region-picker.js';
import {scopedPublicSignal,publicResultState} from '../frontend/logic.js';
const app=await readFile(new URL('../frontend/app.js',import.meta.url),'utf8');
function harness(savedRegions,fetch){
 const elements=new Map();
 const context=vm.createContext({naverPreview:false,naverSearchActive:()=>false,refreshLiveNaverNews:async()=>false,openNaverOutage:()=>false,renderPublicLayout(){},mountLocationChoice(){},restoreLocationChoice(){},mountNewsCategories(){},updatePreviewContext(){},weatherCity:'순천',newsCategory:'power',...lastGood,...weatherDisplay,...regionCatalog,...regionPicker,fetch,scopedPublicSignal,publicResultState,AbortSignal,$:id=>{if(!elements.has(id))elements.set(id,{textContent:'',dataset:{},classList:{toggle(){}},setAttribute(k,v){this[k]=v}});return elements.get(id)},localStorage:{getItem:()=>JSON.stringify({regions:savedRegions,regionConfirmed:true})}});
 // Run the actual persisted-region hydration and signal functions, not a duplicate implementation.
 vm.runInContext(app.slice(app.indexOf("const KEY="),app.indexOf('let bookmarks=' )).replace('const raw=readStore();','const raw=readStore();'),context);
 vm.runInContext(app.match(/let publicSignals=.*?;/)[0]+'\n'+app.slice(app.indexOf('function renderPublicSignals(){'),app.indexOf('function publicSignalSheet(')),context);
 return {elements,run:code=>vm.runInContext(code,context)};
}
const success=()=>({ok:true,json:async()=>({signals:['weather','fire','landslide'].map(id=>({id,status:'ok',checkedAt:new Date().toISOString(),count:0,records:[]}))})});
test('weather and fire render while landslide request is still unresolved',async()=>{
 let finish;const h=harness(['순천'],url=>String(url).endsWith('landslide')?new Promise(r=>finish=r):Promise.resolve(success()));
 const pending=h.run('refreshPublicSignals()');await new Promise(r=>setImmediate(r));
 assert.equal(h.elements.get('#warningCoverage').textContent,'발효 없음');assert.equal(h.elements.get('#fireCoverage').textContent,'0건');
 finish(success());await pending;
});
test('saved multiregion first load shows pending, then updates all cards without reselect',async()=>{
 let resolves=[],calls=0;const h=harness(['순천','여수','광양','구례','보성','고흥'],()=>{calls++;return new Promise(r=>resolves.push(r))});
 h.run('renderPublicSignals()');assert.equal(h.elements.get('#warningCoverage').textContent,'확인 중');
 const request=h.run('refreshPublicSignals()');const repeat=h.run('refreshPublicSignals()');assert.equal(request,repeat);await Promise.resolve();assert.equal(calls,3);
 resolves.splice(0).forEach(r=>r(success()));await request;
 assert.equal(h.elements.get('#warningCoverage')['aria-label'],'관심지역 0건');assert.equal(h.elements.get('#warningCoverage').dataset.resultState,'confirmed');
 for(const id of ['#warningCoverage','#fireCoverage','#landslideCoverage']){assert.equal(h.elements.get(id).textContent,id==='#warningCoverage'?'발효 없음':'0건');assert.equal(h.elements.get(id)['aria-busy'],'false')}
});
test('genuine rejection becomes failure and explicit retry recovers; it is never zero',async()=>{
 let calls=0;const h=harness(['순천'],async()=>{if(++calls===1)throw Error('network');return success()});
 await h.run('refreshPublicSignals()');assert.equal(h.elements.get('#warningCoverage').textContent,'확인 불가');assert.equal(h.elements.get('#warningCoverage').dataset.resultState,'unknown');assert.equal(h.elements.get('#warningCoverage')['aria-label'],'관심지역 조회 실패');
 await h.run('refreshPublicSignals()');assert.equal(h.elements.get('#warningCoverage').textContent,'발효 없음');assert.equal(calls,6);
});
test('late response uses current regions, including nationwide, not the earlier choice',async()=>{
 let resolves=[];const h=harness(['순천'],()=>new Promise(r=>resolves.push(r)));const request=h.run('refreshPublicSignals()');await Promise.resolve();
 h.run('regions=[];renderPublicSignals()');assert.equal(h.elements.get('#warningCoverage').textContent,'확인 중');resolves.splice(0).forEach(r=>r(success()));await request;assert.equal(h.elements.get('#warningCoverage').textContent,'발효 없음');
});
test('synchronous request failure releases single flight for a subsequent manual retry',async()=>{
 let calls=0;const h=harness([],()=>{if(++calls===1)throw Error('fetch unavailable');return Promise.resolve(success())});
 await h.run('refreshPublicSignals()');assert.equal(h.elements.get('#warningCoverage').textContent,'확인 불가');
 await h.run('refreshPublicSignals()');assert.equal(h.elements.get('#warningCoverage').textContent,'발효 없음');
});
test('news timestamp banner and city-level air mapping limits are explicitly scoped',()=>{
 assert.match(app,/뉴스 이전 저장/);assert.match(app,/data\.notice\?'뉴스 · '\+data\.notice/);
 assert.match(app,/공식 측정소 정보 연결을 확인하지 못했습니다/);
 assert.match(app,/시·군 값을 시·도 전체 값으로 대신하지 않습니다/);
});

import * as refreshControl from '../frontend/refresh-control.js';
import * as logic from '../frontend/logic.js';
import * as events from '../frontend/events.js';
import * as annual from '../frontend/plans.js';
import * as details from '../frontend/detail-layout.js';
import * as air from '../frontend/air-location.js';
import {bindOverlayHistory} from '../frontend/overlay-history.js';
function fullApp(signalFetch,newsFetch=null,resourceFetch=null,initialStore={regionConfirmed:true,regions:['순천','여수','광양','구례','보성','고흥']}){
 const elements=new Map(),calls=[];let saved=JSON.stringify(initialStore);
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',value:'',checked:true,open:false,dataset:{},classList:{toggle(){},add(){},remove(){}},setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},querySelectorAll(){return []},addEventListener(){},showModal(){this.open=true},close(){this.open=false}});return elements.get(id)};
 const fetch=async url=>{calls.push(String(url));if(resourceFetch&&(/\/api\/(power-flow|focused-news)/.test(String(url))))return resourceFetch(String(url));if(String(url).startsWith('/api/public-signals'))return signalFetch(url);if(String(url).startsWith('/api/briefing')&&newsFetch)return newsFetch(url);return {ok:true,json:async()=>url==='/api/events'?{events:[]}:String(url).startsWith('/api/briefing')?{status:'ok',items:[],sources:[],checkedAt:new Date().toISOString()}:{status:'unavailable'}}};
 const context=vm.createContext({naverPreview:false,naverSearchActive:()=>false,refreshLiveNaverNews:async()=>false,openNaverOutage:()=>false,renderPublicLayout(){},mountLocationChoice(){},restoreLocationChoice(){},mountNewsCategories(){},updatePreviewContext(){},weatherCity:'순천',newsCategory:'power',...lastGood,...weatherDisplay,...regionCatalog,...regionPicker,...logic,...events,...refreshControl,...annual,...details,...air,bindOverlayHistory,startKoreaClock(){},mountPowerFlow(){},pushAvailability:async()=>({enabled:false}),syncPushRegions:async()=>{},document:{getElementById:()=>true,querySelector:element,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}},window:{addEventListener(){},scrollTo(){},history:{state:null,pushState(s){this.state=s},replaceState(s){this.state=s},back(){this.state=null}}},navigator:{onLine:true},localStorage:{getItem:()=>saved,setItem(_k,v){saved=v}},fetch,URL,URLSearchParams,AbortSignal,AbortController,setTimeout:()=>0,clearTimeout(){}});
 vm.runInContext(app.replace(/^import .*;\r?\n/gm,''),context);
 return {elements,calls,run:code=>vm.runInContext(code,context)};
}
test('complete app boot hydrates six saved regions and asynchronously redraws without reselect',async()=>{
 let resolves=[];const h=fullApp(()=>new Promise(r=>resolves.push(r)));await Promise.resolve();
 assert.equal(h.elements.get('#regionCount').textContent,'6곳');assert.equal(h.elements.get('#sheet').open,false);
 assert.equal(h.elements.get('#warningCoverage').textContent,'확인 중');
 const request=h.run('publicSignalsRequest');resolves.splice(0).forEach(r=>r(success()));await request;
 assert.equal(h.elements.get('#warningCoverage').textContent,'발효 없음');
 assert.equal(h.calls.filter(u=>u.startsWith('/api/public-signals')).length,3);
 assert.ok(h.calls.some(u=>u.startsWith('/api/local-data?')&&new URL('https://site'+u).searchParams.get('regions')==='순천,여수,광양,구례,보성,고흥'));
});
test('actual region apply while loading coalesces calls and uses new scope; failed apply can retry',async()=>{
 let resolves=[],count=0;const h=fullApp(()=>{count++;return new Promise(r=>resolves.push(r))});await Promise.resolve();
 h.run('regionSheet();draft=[];draftNationwide=true;regionDraftConfirmed=true');h.elements.get('#applyRegions').onclick();await Promise.resolve();assert.equal(count,3);
 const first=h.run('publicSignalsRequest');resolves.splice(0).forEach(r=>r({ok:false}));await first;assert.equal(h.elements.get('#warningCoverage').textContent,'확인 불가');
 h.run('regionSheet()');h.elements.get('#applyRegions').onclick();await Promise.resolve();assert.equal(count,6);
 const retry=h.run('publicSignalsRequest');resolves.splice(0).forEach(r=>r(success()));await retry;assert.equal(h.elements.get('#warningCoverage').textContent,'발효 없음');
});
test('individual air setting requests only air data after initial request settles',async()=>{
 const h=fullApp(success);await h.run('localPromise');
 await h.run("refreshLocalData(['airQuality'])");
 const urls=h.calls.filter(u=>u.startsWith('/api/local-data?'));
 assert.equal(new URL('https://site'+urls[0]).searchParams.get('parts'),'administrativeMap,airQuality,earthquake,weather,weatherForecast,weatherWarning');
 assert.equal(new URL('https://site'+urls.at(-1)).searchParams.get('parts'),'airQuality');
});

test('only verified positive counts receive active styling, never unknown or failed',()=>{assert.equal(publicResultState('관심지역 2건'),'active');assert.equal(publicResultState('0건'),'confirmed');assert.equal(publicResultState('관심지역 조회 실패'),'unknown');assert.equal(publicResultState('미연동'),'unknown');});
test('old count labels are never promoted to confirmed zero',()=>{
 for(const label of ['이전 0건','관심지역 이전 0건','자료 지연 · 전국 2건','실패 0건'])assert.equal(publicResultState(label),'unknown');
 assert.equal(publicResultState('전국 2건'),'active');assert.equal(publicResultState('관심지역 0건'),'confirmed');
});
test('actual weather card keeps stale numeric readings but renders them neutral',()=>{
 const elements=new Map(),context=vm.createContext({naverPreview:false,naverSearchActive:()=>false,refreshLiveNaverNews:async()=>false,openNaverOutage:()=>false,renderPublicLayout(){},mountLocationChoice(){},restoreLocationChoice(){},mountNewsCategories(){},updatePreviewContext(){},weatherCity:'순천',newsCategory:'power',...weatherDisplay,stamp:s=>s,publicResultState,Number,renderAirLocation(){},connectionLabel:()=> '미연동',$:id=>{if(!elements.has(id))elements.set(id,{textContent:'',dataset:{},setAttribute(){}});return elements.get(id)}});
 vm.runInContext(app.match(/function renderLocalCards\(\).*\r?\n/)[0],context);
 for(const weather of [{city:'순천',temperature:18.2,stale:true},{city:'순천',temperature:18.2,reason:'provider_timeout'}]){
  context.localData={weather};vm.runInContext('renderLocalCards()',context);assert.equal(elements.get('#currentObservation').dataset.resultState,'unknown');assert.match(elements.get('#currentObservation').textContent,/18.2℃/);
 }
 context.localData={weather:{city:'순천',temperature:18.2}};vm.runInContext('renderLocalCards()',context);assert.equal(elements.get('#currentObservation').dataset.resultState,'confirmed');
});
test('public outage uses its dedicated feed and never substitutes central search results',async()=>{
 const h=fullApp(success);await h.run('localPromise');await h.run('focusedLoading');
 h.run("focusedCache.outage={status:'ok',items:[]};renderOutageNews()");assert.equal(h.elements.get('#outageState').textContent,'확인된 보도 없음');
 h.run("focusedCache.outage={status:'ok',items:[{title:'순천 아파트 정전 발생',url:'https://news.google.com/rss/articles/abc',publisherName:'가상언론',publishedAt:new Date().toISOString()}],notice:'현재 정전 수가 아님'};renderOutageNews()");
 assert.equal(h.elements.get('#outageState').textContent,'보도 1건');h.run('focusedNewsSheet("outage")');await new Promise(r=>setImmediate(r));assert.match(h.elements.get('#focusedNewsSheet').innerHTML,/순천 아파트 정전 발생/);
 h.run("focusedCache.outage={status:'unavailable',items:[]};renderOutageNews()");assert.equal(h.elements.get('#outageState').textContent,'보도 확인 필요');
});
test('failed public refresh never makes an earlier empty snapshot look current',async()=>{
 let fail=false;const h=fullApp(()=>fail?Promise.reject(Error('offline')):success());await h.run('publicSignalsRequest');
 assert.equal(h.elements.get('#fireCoverage').textContent,'0건');fail=true;await h.run('refreshPublicSignals()');
 assert.equal(h.elements.get('#fireCoverage').textContent,'0건');assert.equal(h.elements.get('#fireCoverage').dataset.resultState,'confirmed');assert.equal(h.run("publicSignals.find(s=>s.id==='fire').stale"),true);
});
test('settings X dismisses before first region confirmation while required region sheet remains protected',()=>{
 const f=fullApp(async()=>({ok:true,json:async()=>({signals:[]})}));
 f.run('regionConfirmed=false; settingsSheet()');assert.equal(f.elements.get('#sheet').open,true);assert.equal(f.elements.get('#closeSheet').hidden,false);
 f.elements.get('#closeSheet').onclick();assert.equal(f.elements.get('#sheet').open,false);
 const g=fullApp(async()=>({ok:true,json:async()=>({signals:[]})}));g.run('regionConfirmed=false;regionSheet()');assert.equal(g.elements.get('#closeSheet').hidden,true);
 g.elements.get('#closeSheet').onclick();assert.equal(g.elements.get('#sheet').open,true);
});

test('supply renders before pending generation and preserves its own cache after failure',async()=>{
 let release,failed=false;const graph=new Promise(r=>release=r),at=new Date().toISOString();
 const f=fullApp(async()=>({ok:true,json:async()=>({signals:[]})}),null,async url=>{
 if(url.includes('part=generation'))return graph;
 if(url.includes('part=supply')){if(failed)throw Error('temporary');return {ok:true,json:async()=>({supply:{status:'ok',checkedAt:at,referenceAt:at,reservePercent:42.5,reserveMw:10000,demandMw:30000}})}}
 return {ok:true,json:async()=>({status:'ok',checkedAt:at,items:[]})};});
 for(let i=0;i<20;i++)await Promise.resolve();assert.match(f.elements.get('#supplyRatio').innerHTML,/42.5/);
 release({ok:true,json:async()=>({status:'unavailable'})});await f.run('refreshSupply()');failed=true;await f.run('refreshSupply()');assert.match(f.elements.get('#supplyRatio').innerHTML,/42.5/);
});
test('failed outage can recover in the same hour without refetching successful categories',async()=>{
 let bad=true;const f=fullApp(async()=>({ok:true,json:async()=>({signals:[]})}),null,async url=>({ok:true,json:async()=>url.includes('focused-news')?{status:url.includes('outage')&&bad?'unavailable':'ok',checkedAt:new Date().toISOString(),items:[]}:{status:'unavailable'}}));
 await f.run('refreshFocusedHeadlines()');const before=f.calls.filter(u=>u.includes('category=kepco')).length;
 bad=false;f.run('focusedRuns.outage.due=0');await f.run('refreshFocusedHeadlines()');assert.equal(f.elements.get('#outageState').textContent,'확인된 보도 없음');assert.equal(f.calls.filter(u=>u.includes('category=kepco')).length,before);
});

test('settings expose only region, installation, sources and local storage without notification calls',async()=>{
 const f=fullApp(async()=>({ok:true,json:async()=>({signals:[]})}));
 f.run('settingsSheet()');const html=f.elements.get('#sheetBody').innerHTML;
 for(const text of ['관심지역','앱으로 사용하기','정보 출처','저장정보 관리'])assert.match(html,new RegExp(text));
 assert.doesNotMatch(html,/야간|알림|테스트|인증|서버 연결|editorialPreferenceStatus/);
 assert.equal(f.calls.some(u=>u.includes('/api/push/')),false);
});

test('first visit starts with six local regions and preserves existing nationwide or custom choices',()=>{
 const signal=async()=>({ok:true,json:async()=>({signals:[]})});
 const first=fullApp(signal,null,null,{});
 assert.deepEqual(JSON.parse(first.run('JSON.stringify(regions)')),['순천','여수','광양','구례','보성','고흥']);assert.equal(first.run('regionConfirmed'),true);
 for(const regions of [[],['서울'],['부산','순천']]){
 const existing=fullApp(signal,null,null,{regionConfirmed:true,regions});assert.deepEqual(JSON.parse(existing.run('JSON.stringify(regions)')),regions);
 }
 first.run('draft=["서울"];regionDraftConfirmed=true;regionSheet();draft=["서울"];regionDraftConfirmed=true');first.elements.get('#applyRegions').onclick();
 assert.deepEqual(JSON.parse(first.run('JSON.stringify(regions)')),['서울']);
});

test('default regions persist before providers respond and invalid saved regions cannot erase defaults',()=>{
 const waiting=()=>new Promise(()=>{}),defaults=['순천','여수','광양','구례','보성','고흥'];
 for(const initial of [{},{regions:[]},{regions:['not-a-region'],regionConfirmed:true}]){
  const first=fullApp(waiting,null,null,initial);
  const stored=JSON.parse(first.run('JSON.stringify(readStore())'));
  assert.deepEqual(stored.regions,defaults);assert.equal(stored.regionConfirmed,true);
  assert.equal(first.elements.get('#regionCount').textContent,'6곳');
  const next=fullApp(waiting,null,null,stored);
  assert.deepEqual(JSON.parse(next.run('JSON.stringify(regions)')),defaults);
 }
});

test('visible 10-minute refresh requests local data, supply numbers and demand',()=>{
 const timers=[],requests=[];
 const document={hidden:false,addEventListener(){}};
 const ctx=vm.createContext({document,clearTimeout(){},setTimeout(fn,delay){timers.push({fn,delay});},refreshLocalData:parts=>requests.push(Array.from(parts)),refreshPublicSignals:()=>requests.push('signals'),refreshSupply:({numbersOnly})=>requests.push(['supply',numbersOnly]),refreshDemand:()=>requests.push('demand')});
 vm.runInContext(app.slice(app.indexOf('let localRefreshTimer;'),app.indexOf('// Mount the current shell synchronously')),ctx);
 assert.equal(timers[0].delay,600000);
 timers[0].fn();
 assert.deepEqual(requests,[['weather','weatherForecast','airQuality'],'signals',['supply',true],'demand']);
 document.hidden=true;
 timers[1].fn();
 assert.equal(requests.length,4);
});
