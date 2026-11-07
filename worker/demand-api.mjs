import {boundedProvider,kpxItems,parseApiSupply,koreaDay,withPowerRowDiagnostic} from './local-data.mjs';
// Documented public gateway, independent of the KPX website's denied HTML route.
// https://www.data.go.kr/data/15158703/openapi.do — response units are MW.
const TODAY='https://apis.data.go.kr/B552115/Sukub5mToday/getSukub5mToday';
const FORECAST='https://apis.data.go.kr/B552115/SmpWithForecastDemand/getSmpWithForecastDemand';
export function parseTodayDemand(body,now=Date.now()){
 const date=koreaDay(now),seen=new Set();let maxReserve=null;
 const today=kpxItems(body).map(row=>{
  const supply=withPowerRowDiagnostic(row,()=>parseApiSupply({response:{header:{resultCode:'00'},body:{totalCount:1,items:{item:row}}}},now));
  const at=supply.referenceAt;
  if(!maxReserve||supply.reservePercent>maxReserve.percent)maxReserve={at,percent:supply.reservePercent,demandMw:supply.demandMw,capacityMw:supply.capacityMw,reserveMw:supply.reserveMw};
  if(koreaDay(Date.parse(at))!==date||Date.parse(at)%300000||seen.has(at))throw Error('invalid_series');
  seen.add(at);return {at,mw:supply.demandMw};
 }).sort((a,b)=>a.at.localeCompare(b.at));
 if(!today.length||today.length>288)throw Error('data_missing');
 return {status:'ok',date,today,maxReserve,previous:[],referenceAt:today.at(-1).at,checkedAt:new Date(now).toISOString(),stale:now-Date.parse(today.at(-1).at)>3600000,source:'전력거래소',sourceUrl:'https://www.data.go.kr/data/15158703/openapi.do',scope:'national_market',unit:'MW',intervalMinutes:5,notice:'KPX 오늘전력수급현황 공개 API의 5분 수요입니다. 수신되지 않은 시각은 보간하지 않습니다.'};
}
async function gateway(endpoint,key,fetchFn,params={}){
 const u=new URL(endpoint);u.search=new URLSearchParams({serviceKey:key,pageNo:'1',numOfRows:'1000',dataType:'json',...params});
 const r=await fetchFn(u.href,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
 if([401,403].includes(r.status))throw Error('authentication_failed');
 if(r.status===429)throw Error('rate_limited');
 if(r.status>=300&&r.status<400)throw Error('redirect_blocked');
 if(!r.ok)throw Object.assign(Error('provider_http_error'),{httpStatus:r.status});
 if(Number(r.headers.get('content-length'))>1000000)throw Error('invalid_json');
 const reader=r.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000)throw Error('invalid_json');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 const text=new TextDecoder().decode(bytes);
 const providerCode=text.match(/<(?:returnAuthMsg|errMsg|resultMsg)>\s*([A-Z_]{3,80})\s*<\//)?.[1];
 if(/SERVICE_ACCESS_DENIED|SERVICE_KEY_IS_NOT_REGISTERED|UNREGISTERED|SERVICE_KEY_IS_NULL/.test(text))throw Object.assign(Error('authentication_failed'),{providerCode});
 if(/INVALID_REQUEST_PARAMETER_ERROR|NO_MANDATORY_REQUEST_PARAMETERS_ERROR/.test(text))throw Object.assign(Error('provider_rejected'),{providerCode});
 if(/LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(text))throw Error('rate_limited');
 let body;try{body=JSON.parse(text)}catch{throw Error('invalid_json')}
 const code=String(body?.response?.header?.resultCode??'');
 if(['20','21','30','31','32','33'].includes(code))throw Error('authentication_failed');
 if(code==='22')throw Error('rate_limited');
 return body;
}
export async function publicDemandApi(env,{store,now=Date.now(),fetchFn=fetch,waitUntil}={}){
 if(!env.PUBLIC_DATA_SERVICE_KEY||!store)return {status:'unavailable',reason:'credentials_or_storage_missing'};
 const data=await boundedProvider(store,'demandToday',now,1,async()=>parseTodayDemand(await gateway(TODAY,env.PUBLIC_DATA_SERVICE_KEY,fetchFn),now),{diagnostics:3,waitUntil,accessRevision:env.KPX_TODAY_ACCESS_APPROVAL});
 if(data.status==='ok'&&data.date!==koreaDay(now))return {status:'unavailable',reason:'date_rollover'};
 return data;
}

// API field definitions: data.go.kr/data/15131225/openapi.do.
// The official mainland/Jeju day-ahead tables specify MW and hour-end intervals.
// Area rows may repeat the same forecasts alongside their different SMP values;
// they must agree, and are never added together a second time.
export function parseForecastDemand(body,date,now=Date.now()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||![koreaDay(now),koreaDay(now-86400000)].includes(date))throw Error('invalid_timestamp');
 const hours=new Map(),seen=new Set();
 const number=value=>{if(!/^(?:\d+)(?:\.\d+)?$/.test(String(value)))throw Error('invalid_value');const n=Number(value);if(n<=0||n>200000)throw Error('invalid_value');return n};
 for(const r of kpxItems(body)){
  const hour=Number(r.hour),area=String(r.areaName);
  if(String(r.date)!==date.replaceAll('-','')||!Number.isInteger(hour)||hour<1||hour>24||!['육지','제주'].includes(area)||seen.has(hour+':'+area))throw Error('invalid_series');
  seen.add(hour+':'+area);
  const mainland=number(r.mlfd),jeju=number(r.jlfd),mw=number(r.slfd);
  if(Math.abs(mainland+jeju-mw)>3)throw Error('incompatible_components');
  const old=hours.get(hour);
  if(old&&(old.mainland!==mainland||old.jeju!==jeju||old.mw!==mw))throw Error('incompatible_components');
  hours.set(hour,{hour,mw,mainland,jeju});
 }
 const points=[...hours.values()].sort((a,b)=>a.hour-b.hour);
 if(points.length!==24||points.some((p,i)=>p.hour!==i+1))throw Error('incomplete_series');
 return {status:'ok',date,scope:'mainland_plus_jeju',unit:'MW',intervalMinutes:60,points,checkedAt:new Date(now).toISOString(),source:'전력거래소',sourceUrls:['https://www.data.go.kr/data/15131225/openapi.do'],notice:'KPX 하루전 발전계획용 공식 수요예측(육지·제주 합계). 시간은 1시간 구간의 종료시각이며 5분 실측값과 구분합니다.'};
}
export async function publicForecastApi(env,{store,now=Date.now(),fetchFn=fetch,waitUntil}={}){
 if(!env.PUBLIC_DATA_SERVICE_KEY||!store)return {status:'unavailable',reason:'credentials_or_storage_missing'};
 if(env.KPX_FORECAST_API_VERIFIED!=='true')return {status:'unavailable',reason:'contract_validation_pending'};
 const date=koreaDay(now),previousDate=koreaDay(now-86400000),cacheKey='public:official-api:demandForecast',snapshot=await store.read(cacheKey),saved=snapshot.value?.data;
 // Upgrade the old cache once without resetting its quota or an active lease.
 if(saved?.status==='ok'&&saved.date===date&&!Object.hasOwn(saved,'previousTail')&&!(snapshot.value.leaseUntil>now))await store.compareAndSwap(cacheKey,snapshot.version,{...snapshot.value,nextFetchAt:now,leaseUntil:0,data:{...saved,previousTail:null}});
 // Reuse the last interval already collected yesterday, or today's cached tail.
 // This fixed-size cache rolls over; no per-day forecast archive accumulates.
 const candidate=saved?.status==='ok'&&saved.date===previousDate?saved.points?.at(-1):saved?.previousTail;
 const tailDate=saved?.date===previousDate?previousDate:candidate?.date;
 const previousTail=tailDate===previousDate&&candidate?.hour===24&&Number.isFinite(candidate.mw)&&candidate.mw>0&&candidate.mw<=200000?{date:previousDate,hour:24,mw:candidate.mw}:null;
 const data=await boundedProvider(store,'demandForecast',now,previousTail?1:2,async()=>{
  const today=parseForecastDemand(await gateway(FORECAST,env.PUBLIC_DATA_SERVICE_KEY,fetchFn,{date:date.replaceAll('-','')}),date,now);
  let tail=previousTail;
  if(!tail)try{const yesterday=parseForecastDemand(await gateway(FORECAST,env.PUBLIC_DATA_SERVICE_KEY,fetchFn,{date:previousDate.replaceAll('-','')}),previousDate,now);tail={date:previousDate,hour:24,mw:yesterday.points.at(-1).mw};}catch{ /* Yesterday must not suppress a valid forecast for today. */ }
  return {...today,previousTail:tail};
 },{diagnostics:true,waitUntil,accessRevision:env.KPX_FORECAST_ACCESS_APPROVAL});
 return data.status==='ok'&&data.date!==date?{status:'unavailable',reason:'date_rollover'}:data;
}
