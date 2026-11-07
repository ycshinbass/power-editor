// One-time reviewed public registry. Not a live national calendar.
import {validDate,validWeather} from './logic.js';
export function seoulDate(now=Date.now()){return new Date(now+9*3600000).toISOString().slice(0,10)}
export function validOfficialEvent(e,now=Date.now()){return e&&['title','editorReason','factualNote','statusLabel','checkedAt','sourceUrl'].every(k=>typeof e[k]==='string')&&Number.isFinite(Date.parse(e.checkedAt))&&Date.parse(e.checkedAt)<=now+600000&&validDate(e.suggestedReviewAt)&&validDate(e.startDate)&&validDate(e.endDate)&&e.endDate>=e.startDate&&e.scope==='national'&&e.timezone==='Asia/Seoul'&&e.allDay===true&&Number.isFinite(Date.parse(e.expiresAt))&&/^https:\/\/www\.(?:moe|nec)\.go\.kr\//.test(e.sourceUrl)}
export function upcomingEvents(registry,now=Date.now()){
 const day=seoulDate(now);return (Array.isArray(registry?.events)?registry.events:[]).filter(e=>validOfficialEvent(e,now)&&Date.parse(e.expiresAt)>now&&e.endDate>=day).map(e=>({...e,daysUntil:Math.max(0,Math.round((Date.parse(e.startDate+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000)),needsReview:day>=e.suggestedReviewAt})).sort((a,b)=>a.startDate.localeCompare(b.startDate));
}
export function attentionSignal({registry,weather,now=Date.now()}={}){
 const events=upcomingEvents(registry,now),reasons=[];const missing=['공식 특보는 별도 공개현황에서 확인','산불 세부 상황·설비 영향 자동 판단 안 함','전체 행사 일정 미수집'];
 for(const e of events.filter(e=>e.status!=='cancelled'&&e.daysUntil<=7))reasons.push({kind:'event',text:`${e.title} ${e.daysUntil===0?'오늘':`D-${e.daysUntil}`} · 담당 시설의 일정과 대비 계획 확인`,sourceUrl:e.sourceUrl,checkedAt:e.checkedAt});
 const fresh=validWeather(weather)&&Date.parse(weather.checkedAt)<=now+600000&&now-Date.parse(weather.checkedAt)<=6*3600000;
 const rolling=weather?.periodKind==='rolling24h';const d=fresh?(rolling?weather.days.find(d=>Date.parse(d.periodStart)>=now-3600000&&Date.parse(d.periodStart)<=now+3600000&&Date.parse(d.periodEnd)-Date.parse(d.periodStart)===86400000):weather.days.find(d=>d.date===seoulDate(now))):null;
 if(!d)missing.push('당일 모델 예보 미확인 또는 오래됨');
 else {for(const key of ['gustMs','rainMm','snowCm'])if(d[key]===null)missing.push(`${weather.city} ${key==='gustMs'?'돌풍':key==='rainMm'?'강수':'적설'} 예보 누락`);for(const[key,limit,name,unit]of[['gustMs',14,'최대 돌풍','m/s'],['rainMm',30,rolling?'향후 24시간 강수':'하루 강수','mm'],['snowCm',3,'하루 적설','cm']])if(d[key]!==null&&d[key]>=limit)reasons.push({kind:'forecast',text:`${weather.city} ${name} ${d[key]}${unit} · 예보 상세 확인 기준 ${limit}${unit} 이상`,checkedAt:weather.checkedAt,sourceUrl:rolling?'https://api.met.no/weatherapi/locationforecast/2.0/documentation':'https://open-meteo.com/en/docs'});}
 return {label:reasons.length?'확인할 항목 있음':'정보 범위 제한',reasons,missing,ruleNote:'편집상 확인 순서 안내입니다. 강수 30mm/일·돌풍 14m/s·적설 3cm/일은 시험용 표시 기준이며 평균풍속을 돌풍 대신 사용하지 않습니다. 이는 공식 특보·설비 위험 기준이 아닙니다. 항목이 없다고 안전을 뜻하지 않습니다.'};
}
