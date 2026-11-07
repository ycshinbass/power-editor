// KMA 261019 guide: eight daily issues; API available ten minutes after issue.
// Source: https://www.data.go.kr/data/15084084/openapi.do (getVilageFcst).
const HOUR=3600000,DAY=24*HOUR;
const day=now=>new Date(now+9*HOUR).toISOString().slice(0,10);
export function forecastBase(now){
 const available=new Date(now+9*HOUR-10*60000),hour=available.getUTCHours();
 let baseHour=[2,5,8,11,14,17,20,23].filter(h=>h<=hour).at(-1);
 if(baseHour===undefined){available.setUTCDate(available.getUTCDate()-1);baseHour=23}
 return {base_date:available.toISOString().slice(0,10).replaceAll('-',''),base_time:String(baseHour).padStart(2,'0')+'00'};
}
function number(value,min,max){if(value===null||value===undefined||value===''||typeof value==='boolean')return null;const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:null}
function timestamp(date,time){
 if(!/^\d{8}$/.test(String(date))||!/^\d{4}$/.test(String(time)))throw Error('invalid_timestamp');
 const iso=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${time.slice(0,2)}:${time.slice(2)}:00+09:00`,n=Date.parse(iso);
 if(!Number.isFinite(n)||new Date(n+9*HOUR).toISOString().slice(0,16).replace(/[-:T]/g,'')!==date+time)throw Error('invalid_timestamp');return n;
}
function precipitation(value){
 // Preserve provider range text. Missing is never converted into zero.
 if(typeof value!=='string'&&typeof value!=='number')return null;
 const text=String(value).trim();if(text==='강수없음')return {text,rank:0};
 if(text==='0')return {text:'강수없음',rank:0};
 // Older numeric payloads use the guide's quantitative buckets.
 if(/^\d+(?:\.\d+)?$/.test(text)){const n=Number(text);if(n>=900)return null;return {text:n===0?'강수없음':n<1?'1mm 미만':n<30?text+'mm':n<50?'30.0~50.0mm':'50.0mm 이상',rank:n===0?0:n<1?.999:n<30?n:n<50?49.999:10050}}
 const match=text.match(/^(\d+(?:\.\d+)?)(?:\s*~\s*(\d+(?:\.\d+)?))?\s*mm(?:\s*(미만|이상))?$/);
 if(!match)return null;const bound=Number(match[2]||match[1]);if(bound>=900)return null;const rank=match[3]==='이상'?10000+bound:match[2]||match[3]==='미만'?bound-.001:bound;return {text,rank};
}
export function parseForecast(body,grid,now,base=forecastBase(now)){
 const response=body?.response,raw=response?.body?.items,rows=Array.isArray(raw)?raw:raw?.item;
 if(!['00','0','NORMAL_SERVICE'].includes(String(response?.header?.resultCode)))throw Error('provider_error');
 if(!Array.isArray(rows)||!rows.length||rows.length>2000||Number(response.body.totalCount)!==rows.length)throw Error('incomplete_series');
 const issued=timestamp(base.base_date,base.base_time);if(issued>now)throw Error('invalid_timestamp');
 const dates=Array.from({length:3},(_,i)=>day(now+i*DAY)),slots=new Map(dates.map(date=>[date,new Map()])),seen=new Set();
 for(const row of rows){
  if(Number(row.nx)!==grid.nx||Number(row.ny)!==grid.ny||String(row.baseDate)!==base.base_date||String(row.baseTime).padStart(4,'0')!==base.base_time)throw Error('invalid_series');
  const date=String(row.fcstDate),time=String(row.fcstTime).padStart(4,'0'),at=timestamp(date,time);
  if(at<issued||at>issued+6*DAY)throw Error('invalid_timestamp');
  const key=`${date}:${time}:${row.category}`;if(seen.has(key))throw Error('invalid_series');seen.add(key);
  const target=slots.get(day(at));if(!target)continue;
  const slot=target.get(time)||{};slot[row.category]=row.fcstValue;target.set(time,slot);
 }
 const conditions=dates.flatMap(date=>[...slots.get(date)].map(([time,v])=>({at:new Date(timestamp(date.replaceAll('-',''),time)).toISOString(),sky:[1,3,4].includes(number(v.SKY,1,4))?Number(v.SKY):null,precipitationType:[0,1,2,3,4].includes(number(v.PTY,0,4))?Number(v.PTY):null}))).sort((a,b)=>a.at.localeCompare(b.at)).slice(0,72);
 const days=dates.map(date=>{
  const entries=[...slots.get(date)].sort(([a],[b])=>a.localeCompare(b)),values=entries.map(([,v])=>v);
  const nums=(key,min,max)=>values.map(v=>number(v[key],min,max)).filter(v=>v!==null);
  const max=(key,min,max)=>{const a=nums(key,min,max);return a.length?Math.max(...a):null};
  const minValues=nums('TMN',-60,60),maxValues=nums('TMX',-60,60);
  if(new Set(minValues).size>1||new Set(maxValues).size>1)throw Error('invalid_series');
  const temperatureMin=minValues[0]??null,temperatureMax=maxValues[0]??null;
  if(temperatureMin!==null&&temperatureMax!==null&&temperatureMin>temperatureMax)throw Error('invalid_value');
  const rain=values.map(v=>precipitation(v.PCP)).filter(Boolean).sort((a,b)=>b.rank-a.rank);
  const ptys=nums('PTY',0,4),nearest=[...entries].sort(([a],[b])=>Math.abs(Number(a)-1200)-Math.abs(Number(b)-1200));
  const sky=nearest.length?number(nearest[0][1].SKY,1,4):null;
  // Any forecast precipitation wins over sky; noon-nearest sky otherwise.
  let icon=ptys.includes(2)?'sleet':ptys.includes(3)?'snow':ptys.some(p=>p===1||p===4)?'rain':ptys.length===values.length&&ptys.length?({1:'sun',3:'cloud-sun',4:'cloud'}[sky]||'unknown'):'unknown';
  const validHours=values.filter(v=>number(v.POP,0,100)!==null&&number(v.WSD,0,150)!==null&&precipitation(v.PCP)&&[0,1,2,3,4].includes(number(v.PTY,0,4))&&[1,3,4].includes(number(v.SKY,1,4))).length;
  const full=entries.length===24&&entries.every(([hour],i)=>hour===String(i).padStart(2,'0')+'00')&&validHours===24;
  return {date,temperatureMin,temperatureMax,precipitationProbabilityMax:max('POP',0,100),windSpeedMax:max('WSD',0,150),rainfallText:rain[0]?.text??null,icon,partial:!full||temperatureMin===null||temperatureMax===null,coverage:{firstHour:entries[0]?.[0]??null,lastHour:entries.at(-1)?.[0]??null,hours:entries.length,validHours}};
 });
 if(days.every(d=>!d.coverage.hours))throw Error('data_missing');
 return {status:'ok',kind:'forecast',source:'기상청 단기예보',sourceUrl:'https://www.data.go.kr/data/15084084/openapi.do',timezone:'Asia/Seoul',forecastIssuedAt:new Date(issued).toISOString(),checkedAt:new Date(now).toISOString(),date:dates[0],days,conditions,stale:false,grid,aggregation:'KST calendar days; max POP/WSD; highest hourly PCP original text; TMN/TMX only; any PTY then noon-nearest SKY',notice:'선택지역 대표격자 예보입니다. 강수확률·풍속은 제공시간 중 최댓값, 강수량은 시간당 최대 예보 구간(일합계 아님)입니다. 오늘은 남은 시간 예보이며 누락된 일최저·최고는 표시하지 않습니다.'};
}
export function alignForecast(data,now){
 if(data.status!=='ok')return data;
 const dates=Array.from({length:3},(_,i)=>day(now+i*DAY));
 const days=dates.map(date=>data.days.find(d=>d.date===date)||{date,temperatureMin:null,temperatureMax:null,precipitationProbabilityMax:null,windSpeedMax:null,rainfallText:null,icon:'unknown',partial:true,coverage:{firstHour:null,lastHour:null,hours:0,validHours:0}});
 return {...data,date:dates[0],days,stale:!!data.stale||data.date!==dates[0]||now-Date.parse(data.forecastIssuedAt)>4*HOUR};
}
export function fillMorningExtremes(latest,morning){
 if(!morning||morning.date!==latest.date||morning.grid?.nx!==latest.grid?.nx||morning.grid?.ny!==latest.grid?.ny)return latest;
 const earlier=morning.days?.find(d=>d.date===latest.date);
 if(!earlier||!Number.isFinite(earlier.temperatureMin)||!Number.isFinite(earlier.temperatureMax))return latest;
 return {...latest,days:latest.days.map(d=>d.date!==latest.date?d:{...d,temperatureMin:d.temperatureMin??earlier.temperatureMin,temperatureMax:d.temperatureMax??earlier.temperatureMax,temperatureIssuedAt:morning.forecastIssuedAt}),notice:latest.notice+' 오늘 일최저·최고 누락 시 같은 격자의 02시 발표 예측값으로 보완합니다. 관측 최저·최고가 아닙니다.'};
}
