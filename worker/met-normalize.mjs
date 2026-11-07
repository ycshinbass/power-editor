// MET Locationforecast next_1_hours is precipitation over [time,time+1h).
// Never turn six-hour periods, absent values or missing points into hourly zeros.
const HOUR=3600000;
function invalid(code='schema_invalid'){throw Object.assign(Error('met_weather_'+code),{code});}
function timestamp(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))invalid('date_invalid');const ms=Date.parse(value);if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,19)!==value.slice(0,19))invalid('date_invalid');return ms;}
const nonnegative=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export function metCalendarDays(points,now){
 const midnight=Date.parse(new Date(now+9*HOUR).toISOString().slice(0,10)+'T00:00:00+09:00');
 return [0,1,2].map(index=>{
  const dayStart=midnight+index*24*HOUR,end=dayStart+24*HOUR,start=Math.max(dayStart,Math.ceil(now/HOUR)*HOUR);
  let cursor=start,rain=0,covered=0;const samples=[...points].filter(([t])=>t>=start&&t<end);
  while(cursor<end){const d=points.get(cursor)?.data;let hours=0,value=null;
   for(const h of [1,6]){const v=d?.['next_'+h+'_hours']?.details?.precipitation_amount;if(cursor+h*HOUR<=end&&nonnegative(v)){hours=h;value=v;break;}}
   if(hours){rain+=value;covered+=hours;cursor+=hours*HOUR;}else cursor+=HOUR;
  }
  const winds=samples.map(([,p])=>p.data?.instant?.details?.wind_speed).filter(nonnegative);
  return {date:new Date(dayStart+9*HOUR).toISOString().slice(0,10),periodStart:new Date(start).toISOString(),periodEnd:new Date(end).toISOString(),rainMm:covered?Math.round(rain*100)/100:null,windMs:winds.length?Math.max(...winds):null,rainCoverageHours:covered,expectedHours:Math.max(0,(end-start)/HOUR),windSamples:winds.length,partial:covered!==(end-start)/HOUR||index===0};
 });
}
export function normalizeMet(body,city,checkedAtISO,asOfISO=checkedAtISO){
 const fetched=timestamp(checkedAtISO),now=timestamp(asOfISO),properties=body?.properties,units=properties?.meta?.units;
 if(fetched>now+10*60000)invalid('date_invalid');
 if(typeof city!=='string'||!city.trim()||city.length>80||!units||units.air_temperature!=='celsius'||units.wind_speed!=='m/s'||units.precipitation_amount!=='mm')invalid();
 const updated=timestamp(properties.meta.updated_at);
 if(updated>now+10*60000||now-updated>36*HOUR)invalid('stale_source');
 const series=properties.timeseries;
 if(!Array.isArray(series)||!series.length||series.length>300)invalid();
 let previous=-Infinity;const points=new Map();
 for(const point of series){const at=timestamp(point?.time);if(at<=previous)invalid('date_invalid');previous=at;points.set(at,point);}
 const minimum=Math.ceil(now/HOUR)*HOUR;
 const start=[...points.keys()].find(at=>at>=minimum&&at%HOUR===0);
 if(start===undefined)invalid('forecast_missing');
 const days=Array.from({length:3},(_,index)=>{
  const from=start+index*24*HOUR,to=from+24*HOUR,rows=Array.from({length:24},(_,hour)=>points.get(from+hour*HOUR));
  const precipitation=rows.map(p=>p?.data?.next_1_hours?.details?.precipitation_amount),wind=rows.map(p=>p?.data?.instant?.details?.wind_speed);
  const coverageHours=precipitation.filter(nonnegative).length;
  return {
   date:new Date(from+9*HOUR).toISOString().slice(0,10),
   periodStart:new Date(from).toISOString(),periodEnd:new Date(to).toISOString(),
   rainMm:coverageHours===24?Math.round(precipitation.reduce((a,b)=>a+b,0)*100)/100:null,
   windMs:wind.every(nonnegative)?Math.max(...wind):null,gustMs:null,snowCm:null,coverageHours
  };
 });
 return {status:'ok',city,checkedAt:checkedAtISO,source:'MET Norway',sourceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',license:'CC BY 4.0',modelLabel:'모델 예보 · 연속 24시간 구간 · 공식 특보 아님',timezone:'Asia/Seoul',periodKind:'rolling24h',sourceUpdatedAt:properties.meta.updated_at,currentTime:null,days,calendarDays:metCalendarDays(points,now),officialWarning:'unavailable',wildfire:'unavailable',notice:'지역 중심 좌표의 모델 예보입니다. 날짜는 각 24시간 구간의 한국시간 시작일이며 자정 기준 일합계가 아닙니다. 강수는 24개 시간값이 모두 있을 때만 합산합니다. 풍속은 지상 10m의 10분 평균풍속 예보 중 최댓값이며 돌풍이 아닙니다. 적설·돌풍·공식 특보는 제공하지 않습니다.'};
}
