import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastBase,parseForecast,alignForecast} from '../worker/kma-forecast.mjs';
import {handleLocalData,boundedProvider} from '../worker/local-data.mjs';
const now=Date.parse('2026-11-02T03:00:00Z'),grid={nx:73,ny:70},base=forecastBase(now);
const wrap=rows=>({response:{header:{resultCode:'00'},body:{totalCount:rows.length,items:{item:rows}}}});
function fixture(){const rows=[];for(let d=2;d<=4;d++)for(let h=d===2?12:0;h<24;h++)for(const [category,fcstValue] of Object.entries({POP:'20',PCP:'강수없음',WSD:'2.5',SKY:'1',PTY:'0',...(h===6?{TMN:'3'}:{}),...(h===15?{TMX:'13'}:{})}))rows.push({baseDate:base.base_date,baseTime:base.base_time,fcstDate:`2026110${d}`,fcstTime:String(h).padStart(2,'0')+'00',category,fcstValue,...grid});return wrap(rows)}
function memory(){let n=0;const entries=new Map();return {entries,async read(k){return entries.get(k)||{version:null,value:null}},async compareAndSwap(k,v,value){if((entries.get(k)?.version||null)!==v)return {applied:false};const version=String(++n);entries.set(k,{version,value:structuredClone(value)});return {applied:true,version}}}}
test('latest published cycle respects :10 availability and KST rollover',()=>{
 assert.deepEqual(forecastBase(Date.parse('2026-11-01T17:09:59Z')),{base_date:'20261101',base_time:'2300'});
 assert.deepEqual(forecastBase(Date.parse('2026-11-01T17:10:00Z')),{base_date:'20261102',base_time:'0200'});
 assert.deepEqual(forecastBase(now),{base_date:'20261102',base_time:'1100'});
});
test('three KST calendar days use only TMN/TMX; today remaining hours is partial',()=>{
 const data=parseForecast(fixture(),grid,now);assert.equal(data.forecastIssuedAt,'2026-11-02T02:00:00.000Z');assert.equal(data.referenceAt,undefined);
 assert.deepEqual(data.days.map(d=>d.date),['2026-11-02','2026-11-03','2026-11-04']);
 assert.equal(data.days[0].temperatureMin,null);assert.equal(data.days[0].partial,true);
 assert.equal(data.days[1].temperatureMin,3);assert.equal(data.days[1].temperatureMax,13);assert.equal(data.days[1].partial,false);
 assert.equal(data.days[1].precipitationProbabilityMax,20);assert.equal(data.days[1].windSpeedMax,2.5);assert.equal(data.days[1].icon,'sun');
 assert.equal(data.conditions[0].at,'2026-11-02T03:00:00.000Z');assert.equal(data.conditions[0].sky,1);assert.equal(data.conditions[0].precipitationType,0);assert.ok(data.conditions.length<=72);
});
test('PCP preserves ranges; PTY takes precedence over sun; no sum',()=>{
 const body=fixture(),rows=body.response.body.items.item;
 for(const r of rows)if(r.fcstDate==='20261103'&&r.fcstTime==='1700'){if(r.category==='PCP')r.fcstValue='30.0~50.0mm';if(r.category==='PTY')r.fcstValue='1';if(r.category==='POP')r.fcstValue='90'}
 const d=parseForecast(body,grid,now).days[1];assert.equal(d.rainfallText,'30.0~50.0mm');assert.equal(d.icon,'rain');assert.equal(d.precipitationProbabilityMax,90);assert.equal(d.rainfallSum,undefined);
 for(const r of rows)if(r.category==='PCP')r.fcstValue='1mm 미만';assert.equal(parseForecast(body,grid,now).days[1].rainfallText,'1mm 미만');
});
test('missing/sentinel values stay unknown, not zero or synthetic extrema',()=>{
 const body=fixture();for(const r of body.response.body.items.item)r.fcstValue=['SKY','PTY','PCP'].includes(r.category)?null:'-999';
 const d=parseForecast(body,grid,now).days[1];for(const k of ['temperatureMin','temperatureMax','precipitationProbabilityMax','windSpeedMax','rainfallText'])assert.equal(d[k],null);assert.equal(d.icon,'unknown');assert.equal(d.partial,true);
});
test('wrong grid, cycle, duplicate, incomplete page, impossible date fail closed',()=>{
 for(const mutate of [b=>b.response.body.items.item[0].nx=99,b=>b.response.body.items.item[0].baseTime='0800',b=>b.response.body.items.item[0].fcstDate='20260230',b=>b.response.body.totalCount++,b=>{b.response.body.items.item.push(b.response.body.items.item[0]);b.response.body.totalCount++}]){const body=fixture();mutate(body);assert.throws(()=>parseForecast(body,grid,now))}
});
test('last good rollover keeps date identity and marks missing new third day',()=>{
 const d=alignForecast(parseForecast(fixture(),grid,now),now+86400000);assert.equal(d.stale,true);assert.equal(d.days[0].date,'2026-11-03');assert.equal(d.days[2].date,'2026-11-05');assert.equal(d.days[2].temperatureMax,null);
});
test('forecast reserves both latest and morning requests; shared cache survives clients',async()=>{
 const store=memory(),env={PUBLIC_DATA_SERVICE_KEY:'test-fixture-only',LOCAL_OFFICIAL_CONTRACT_VERIFIED:'true'};let calls=0;
 const req=new Request('https://example.test/api/local-data?parts=weatherForecast&city='+encodeURIComponent('순천'));
 const fetchFn=async(url,opts)=>{calls++;const u=new URL(url);assert.equal(u.pathname,'/1360000/VilageFcstInfoService_2.0/getVilageFcst');assert.equal(u.searchParams.get('numOfRows'),'2000');assert.equal(opts.redirect,'manual');const body=fixture(),rows=body.response.body.items.item;if(u.searchParams.get('base_time')==='0200'){rows.push({...rows[0],category:'TMN',fcstTime:'0600',fcstValue:'3'});body.response.body.totalCount++;}for(const row of rows){row.nx=Number(u.searchParams.get('nx'));row.ny=Number(u.searchParams.get('ny'));row.baseTime=u.searchParams.get('base_time')}return Response.json(body)};
 const d=await(await handleLocalData(req,env,{now,store,fetchFn})).json();assert.equal(d.weatherForecast.status,'ok');assert.equal(d.weather,undefined);assert.equal(JSON.stringify(d).includes(env.PUBLIC_DATA_SERVICE_KEY),false);
 assert.equal(d.weatherForecast.days[0].temperatureMin,3);assert.equal(d.weatherForecast.days[0].temperatureIssuedAt,'2026-11-01T17:00:00.000Z');assert.equal(store.entries.get('public:official-quota:weatherForecast').value.used,2);
 await handleLocalData(req,env,{now:now+3599000,store,fetchFn});assert.equal(calls,2);
});
test('service-global 100/day cap spans forecast grids and failure returns last good stale',async()=>{
 const store=memory();await store.compareAndSwap('public:official-quota:weatherForecast',null,{day:'2026-11-02',used:100});let calls=0;
 assert.equal((await boundedProvider(store,'weatherForecast:1:1',now,1,()=>calls++)).reason,'daily_limit');assert.equal(calls,0);
 const second=memory();await boundedProvider(second,'weatherForecast:1:1',now,1,async()=>({status:'ok',days:[]}));const d=await boundedProvider(second,'weatherForecast:1:1',now+3600000,1,async()=>{throw Error('provider_network_error')});assert.equal(d.status,'ok');assert.equal(d.stale,true);
});

test('open-ended heavy-rain bucket outranks bounded rain and numeric PCP follows guide',()=>{const b=fixture();const rows=b.response.body.items.item;const p=rows.filter(r=>r.category==='PCP'&&r.fcstDate==='20261103');p[0].fcstValue='30.0~50.0mm';p[1].fcstValue='50.0mm 이상';assert.equal(parseForecast(b,grid,now).days[1].rainfallText,'50.0mm 이상');p[1].fcstValue='6.2';p[0].fcstValue='1mm 미만';assert.equal(parseForecast(b,grid,now).days[1].rainfallText,'6.2mm')});
