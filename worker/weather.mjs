import {REGION_POINTS} from '../frontend/regions.js';
export const WEATHER_CITIES=Object.fromEntries(Object.entries(REGION_POINTS).map(([id,r])=>[id,[r.latitude,r.longitude]]));
const weatherMemory=new Map();
export function koreaDay(at){const value=typeof at==='number'?at:Date.parse(at);return new Date(value+9*3600000).toISOString().slice(0,10)}
async function weatherText(r){if(Number(r.headers.get('content-length'))>40000)throw Object.assign(Error('weather_size'),{code:'body_limit'});const reader=r.body.getReader();const decoder=new TextDecoder();let total=0,text='';try{while(true){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>40000){await reader.cancel();throw Object.assign(Error('weather_size'),{code:'body_limit'})}text+=decoder.decode(value,{stream:true})}return text+decoder.decode()}finally{reader.releaseLock()}}

export function normalizeWeather(body,city,checkedAt=new Date().toISOString()){const d=body?.daily;const c=body?.current;const u=body?.daily_units;if(!d||!Array.isArray(d.time)||d.time.length<1||d.time.length>7||u?.precipitation_sum!=='mm'||u?.wind_gusts_10m_max!=='m/s'||u?.snowfall_sum!=='cm'||u?.wind_speed_10m_max!=='m/s'||body.timezone!=='Asia/Seoul'||d.time[0]!==koreaDay(checkedAt)||d.time.length>3||[d.precipitation_sum,d.wind_gusts_10m_max,d.wind_speed_10m_max,d.snowfall_sum].some(a=>!Array.isArray(a)||a.length!==d.time.length))throw Object.assign(Error('weather_schema'),{code:d?.time?.[0]&&d.time[0]!==koreaDay(checkedAt)?'date_mismatch':'schema_invalid'});const days=d.time.map((date,i)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Date.parse(date)!==Date.parse(d.time[0])+i*86400000)throw Object.assign(Error('weather_date'),{code:'date_invalid'});const values=[d.precipitation_sum?.[i],d.wind_gusts_10m_max?.[i],d.wind_speed_10m_max?.[i],d.snowfall_sum?.[i]];if(values.some(v=>v!==null&&(typeof v!=='number'||!Number.isFinite(v)||v<0)))throw Object.assign(Error('weather_value'),{code:'value_invalid'});return {date,rainMm:values[0],gustMs:values[1],windMs:values[2],snowCm:values[3]}});return {status:'ok',city,checkedAt,source:'Open-Meteo',sourceUrl:'https://open-meteo.com/',license:'CC BY 4.0',modelLabel:'모델 예보 · 공식 특보 아님',timezone:body.timezone,currentTime:typeof c?.time==='string'?c.time:null,days,officialWarning:'unavailable',wildfire:'unavailable',notice:'지역 중심 좌표의 모델 예보입니다. 실제 관측이나 현장별 예보가 아니며, 기상청 특보와 다를 수 있습니다.'}}
export async function handleWeather(request){
 const city=new URL(request.url).searchParams.get('city')||'순천';
 if(!WEATHER_CITIES[city])return Response.json({status:'unavailable',error:'지원하지 않는 지역입니다.'},{status:400});
 const cached=weatherMemory.get(city);
 if(cached&&Date.now()-cached.at<900000&&cached.data.days[0].date===koreaDay(Date.now()))return Response.json(cached.data,{headers:{'Cache-Control':'private,max-age=60'}});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);let stage='request',upstreamStatus;
 try{
  const [lat,lon]=WEATHER_CITIES[city],url=new URL('https://api.open-meteo.com/v1/forecast');
  for(const[k,v]of Object.entries({latitude:lat,longitude:lon,current:'temperature_2m,weather_code,wind_speed_10m',daily:'precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,snowfall_sum',timezone:'Asia/Seoul',wind_speed_unit:'ms',forecast_days:3}))url.searchParams.set(k,String(v));
  const r=await fetch(url,{signal:controller.signal,redirect:'manual',headers:{Accept:'application/json'}});
  upstreamStatus=r.status;
  if(!r.ok){await r.body?.cancel().catch(()=>{});throw Object.assign(Error('weather_http'),{code:'upstream_http'})}
  stage='body';const text=await weatherText(r);
  stage='json';const parsed=JSON.parse(text);
  stage='schema';const data=normalizeWeather(parsed,city);
  weatherMemory.set(city,{at:Date.now(),data});
  return Response.json(data,{headers:{'Cache-Control':'private,max-age=60'}});
 }catch(e){
  const allowed=new Set(['body_limit','date_mismatch','schema_invalid','date_invalid','value_invalid','upstream_http']);
  const errorCode=controller.signal.aborted?'timeout':allowed.has(e?.code)?e.code:({request:'upstream_unreachable',body:'body_invalid',json:'json_invalid',schema:'schema_invalid'})[stage];
  return Response.json({status:'unavailable',city,checkedAt:new Date().toISOString(),error:'예보를 확인할 수 없습니다. 공식 기상정보를 확인하세요.',errorCode,...(Number.isInteger(upstreamStatus)?{upstreamStatus}:{}),officialWarning:'unavailable',wildfire:'unavailable'},{status:200,headers:{'Cache-Control':'no-store'}});
 }finally{clearTimeout(timer)}
}
