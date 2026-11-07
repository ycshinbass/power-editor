import test from 'node:test';
import assert from 'node:assert/strict';
import {CALENDAR_SOURCES as sources,parseCalendarPage,normalizeCalendarItems,mergeCalendarItems,collectCalendarSource,handleCalendar,clearCalendarMemory} from '../worker/calendar.mjs';
const now=Date.parse('2026-11-02T10:00:00Z'),env={PUBLIC_DATA_SERVICE_KEY:'fixture%2Bonly%3D'},request=year=>new Request('https://fixture.test/api/calendar?year='+year);
const row={locdate:'20260301',dateName:'삼일절',isHoliday:'Y'};
const page=(items,total=items.length,pageNo=1,code='00')=>JSON.stringify({response:{header:{resultCode:code},body:{items:{item:items},totalCount:total,pageNo}}});
const fetcher=async url=>new Response(new URL(url).pathname.includes('CommonCode')?page([{sgName:'제9회 전국동시지방선거',sgVotedate:'20260603'}],1,1,'INFO-00'):page([row]));
function store(){const records=new Map();let seq=0;return {records,async read(k){return structuredClone(records.get(k)||{version:null,value:null})},async compareAndSwap(k,v,value){if((records.get(k)?.version||null)!==v)return {applied:false};const version=String(++seq);records.set(k,{version,value:structuredClone(value)});return {applied:true,version}}}}
test('XML/JSON exact metadata, entities, errors and dates',()=>{
 const xml='<response><header><resultCode>00</resultCode></header><body><items><item><locdate>20260301</locdate><dateName>A &amp; B</dateName><isHoliday>N</isHoliday></item></items><totalCount>1</totalCount><pageNo>1</pageNo></body></response>';
 assert.equal(parseCalendarPage(xml).items[0].dateName,'A & B');assert.equal(parseCalendarPage(page([],0,1,'INFO-00')).total,0);
 for(const code of ['20','30'])assert.throws(()=>parseCalendarPage(page([],0,1,code)),{code:'auth_required'});
 assert.throws(()=>parseCalendarPage(page([],0,1,'22')),{code:'rate_limited'});
 assert.throws(()=>parseCalendarPage('<OpenAPI_ServiceResponse><returnReasonCode>30</returnReasonCode></OpenAPI_ServiceResponse>'),{code:'auth_required'});
 for(const locdate of ['20260230','20261301','2026011','oops'])assert.throws(()=>normalizeCalendarItems([{...row,locdate}],sources[0],''));
 assert.throws(()=>parseCalendarPage('<response><resultCode>00</resultCode><body><pageNo>1</pageNo></body></response>'));
});
test('duplicate holiday flags merge; distinct same-day and historical/future dates survive',()=>{
 const items=[...normalizeCalendarItems([row],sources[0],''),...normalizeCalendarItems([row],sources[1],''),...normalizeCalendarItems([{...row,dateName:'별개 행사'}],sources[2],''),...normalizeCalendarItems([{...row,locdate:'20270101'}],sources[1],'')];
 const merged=mergeCalendarItems(items,2026);assert.equal(merged.length,2);assert.deepEqual(merged.find(i=>i.title==='삼일절').types,['national_holiday','public_holiday']);assert.equal(mergeCalendarItems(items,2027).length,1);
});
test('bounded official annual requests encode key once and reject redirects',async()=>{
 let calls=0;await collectCalendarSource(sources[0],2026,env.PUBLIC_DATA_SERVICE_KEY,async(url,options)=>{calls++;const u=new URL(url);assert.equal(u.origin,'https://apis.data.go.kr');assert.equal(u.searchParams.get('ServiceKey'),'fixture+only=');assert.equal(u.searchParams.get('solYear'),'2026');assert.equal(u.searchParams.has('solMonth'),false);assert.equal(options.redirect,'manual');return new Response(page([row]))},now);assert.equal(calls,1);
 await assert.rejects(collectCalendarSource(sources[0],2026,'fixture',async()=>new Response(null,{status:302,headers:{Location:'https://bad.test'}})),{code:'redirect_rejected'});
 calls=0;await assert.rejects(collectCalendarSource(sources[3],2026,'fixture',async()=>{calls++;return new Response(page([],501))}),{code:'pagination_limit'});assert.equal(calls,1);
 calls=0;const rows=await collectCalendarSource(sources[0],2026,'fixture',async()=>{calls++;return new Response(page([row],2,calls))});assert.equal(calls,2);assert.equal(rows.length,2);
});
test('D1 last good survives cooldown and no secrets returned; NEC cache shared across years',async()=>{
 clearCalendarMemory();const db=store();let calls=0;const fetchFn=async(...args)=>{calls++;return fetcher(...args)};
 let data=await (await handleCalendar(request(2026),env,{store:db,now,fetchFn})).json();assert.equal(data.status,'ok');assert.equal(calls,4);assert.ok(data.items.some(i=>i.date==='2026-06-03'));
 clearCalendarMemory();await handleCalendar(request(2026),env,{store:db,now:now+1000,fetchFn});assert.equal(calls,4);
 data=await (await handleCalendar(request(2026),env,{store:db,now:now+86400001,fetchFn:async()=>{calls++;return new Response('sensitive fixture',{status:403})}})).json();assert.equal(data.status,'partial');assert.equal(data.sources[0].status,'stale');assert.equal(data.sources[0].checkedAt,new Date(now).toISOString());assert.equal(data.sources[0].failureCode,'auth_required');assert.equal(data.items.length,2);assert.equal(JSON.stringify(data).includes('sensitive'),false);
 await handleCalendar(request(2026),env,{store:db,now:now+86400002,fetchFn});assert.equal(calls,8);
 await handleCalendar(request(2027),env,{store:db,now:now+86400003,fetchFn});assert.equal(calls,11);
});
test('missing key and invalid years never call provider; concurrent requests use lease',async()=>{
 clearCalendarMemory();let calls=0;const fetchFn=async(...args)=>{calls++;await new Promise(r=>setTimeout(r,5));return fetcher(...args)};
 const missing=await (await handleCalendar(request(2026),{},{now,fetchFn})).json();assert.equal(calls,0);assert.equal(missing.status,'unavailable');assert.equal(missing.sources[0].failureCode,'missing_key');
 for(const year of ['2024','2028','2026.0','2026&year=2027'])assert.equal((await handleCalendar(request(year),env,{now,fetchFn})).status,400);
 clearCalendarMemory();const db=store();await Promise.all(Array.from({length:5},()=>handleCalendar(request(2026),env,{store:db,now,fetchFn})));assert.equal(calls,4);
});
