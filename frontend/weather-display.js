import {LAST_GOOD_MS,usesLastGood,withinGrace} from './last-good.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number.isFinite(value)?String(value):'—';
export function forecastDates(now=Date.now()){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));const today=parts.year+'-'+parts.month+'-'+parts.day;return [0,1,2].map(i=>new Date(Date.parse(today+'T00:00:00+09:00')+i*86400000+9*3600000).toISOString().slice(0,10))}
const iconLabels={sun:'맑음','cloud-sun':'구름많음',cloud:'흐림',rain:'비',snow:'눈',sleet:'비 또는 눈',unknown:'하늘상태 미확인'};
export function weatherIcon(kind,{night=false,compact=false}={}){kind=Object.hasOwn(iconLabels,kind)?kind:'unknown';const sun=night?'<path d="M19 17A9 9 0 0 1 7 5a9 9 0 1 0 12 12Z" fill="currentColor"/>':'<circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>';const cloud='<path d="M7 18h11a5 5 0 0 0 .5-10 7 7 0 0 0-13-1A5.6 5.6 0 0 0 7 18Z" fill="var(--weather-cloud,#d9e5e9)"/>';const rain='<path d="m8 22-1 3m7-3-1 3m7-3-1 3"/>';const snow='<path d="M9 22v5m-2.5-2.5h5M19 22v5m-2.5-2.5h5"/>';const content=kind==='sun'?sun:kind==='unknown'?'<path d="M10 9a3 3 0 1 1 5 2c-2 1-3 2-3 4m0 3v1"/>':(kind==='cloud-sun'?'<g transform="translate(0 -2) scale(.7)">'+sun+'</g>':'')+cloud+(kind==='rain'?rain:kind==='snow'?snow:kind==='sleet'?'<path d="m8 22-1 3M18 22v5m-2.5-2.5h5"/>':'');return `<svg class="weather-icon icon-${kind}" viewBox="${compact?(['cloud','cloud-sun'].includes(kind)?'0 -2 26 22':kind==='sun'?'0 0 24 24':'0 0 26 29'):'0 0 28 30'}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">${content}</svg>`}
export function forecastHTML(data,{now=Date.now(),stamp=s=>s||'미확인'}={}){const dates=forecastDates(now),available=data&&['ok','partial'].includes(data.status);return `<div class="forecast-heading"><h3>3일 날씨 <span>예보</span></h3><span>${esc(data?.city||'선택 지점')} · 대표격자</span></div>${!available?'<p class="forecast-state">'+(data?'예보 확인 불가':'예보 확인 중')+' · 미확인 값은 —로 표시합니다.</p>':''}${data?.stale||data?.refreshError?'<p class="quality-warning">이전 예보 · 최신 갱신 확인 필요</p>':''}<div class="forecast-days">${dates.map((date,i)=>{const d=available?data.days?.find(d=>d.date===date):null;const icon=d?.icon||'unknown';return `<article class="forecast-day"><div class="forecast-day-title"><strong>${['오늘','내일','모레'][i]}</strong><time datetime="${date}">${Number(date.slice(5,7))}.${Number(date.slice(8))}</time></div><div class="forecast-sky">${weatherIcon(icon)}<span>${esc(iconLabels[icon]||iconLabels.unknown)}</span></div><div class="forecast-temperatures"><span class="temp-low">${number(d?.temperatureMin)}</span><span aria-hidden="true"> / </span><span class="temp-high">${number(d?.temperatureMax)}</span><small> ℃</small></div><p class="forecast-temp-label">최저 / 최고</p><dl><div><dt>최대강수확률 <small>%</small></dt><dd>${number(d?.precipitationProbabilityMax)}</dd></div><div><dt>시간당 강수 최대</dt><dd>${esc(d?.rainfallText||'—')}</dd></div><div><dt>최대풍속 <small>m/s</small></dt><dd>${number(d?.windSpeedMax)}</dd></div></dl><p class="forecast-coverage">${d?.partial?(i===0?'남은 시간 예보':'일부 시간 예보'):d?'하루 예보':'자료 미확인'}</p></article>`}).join('')}</div><details class="forecast-metadata"><summary>예보 발표·범위 확인</summary><p>기상청 단기예보 · 발표 ${esc(stamp(data?.forecastIssuedAt))}<br>조회 ${esc(stamp(data?.checkedAt))}</p><p>${esc(data?.notice||'한국시간 날짜 기준. 시간당 강수 최대는 하루 합계가 아닙니다. 최저·최고기온 미제공 시 —로 표시합니다.')}</p>${dates.map(date=>{const d=data?.days?.find(d=>d.date===date);return d?.temperatureIssuedAt?`<p>${date} 최저·최고: ${esc(stamp(d.temperatureIssuedAt))} 발표 예측</p>`:d?.coverage?`<p>${date} · ${esc(d.coverage.firstHour??'—')}–${esc(d.coverage.lastHour??'—')}시 · ${esc(d.coverage.hours??0)}개 예보 시간</p>`:''}).join('')}</details>`}
export function earthquakeSummary(data){if(!data||data.status!=='ok'||(data.stale||data.refreshError)&&!usesLastGood(data)||!Array.isArray(data.items))return '확인 불가';const domestic=data.items.filter(r=>r.type==='domestic').length,overseas=data.items.filter(r=>r.type==='overseas').length;if(domestic)return `국내 ${domestic}건`;if(overseas)return `해외 ${overseas}건`;return data.count===0&&data.items.length===0?'없음':'확인 불가'}
export function warningSummary(view,{loading=false}={}){if(loading)return '확인 중';if(view.kind==='failed')return '확인 불가';if(view.unknown)return '판별 불가';if(view.kind==='stale')return '이전 자료 · '+(view.count??'—')+'건';return view.count===0?'발효 없음':`발효 ${view.count}건`}
export function warningDetailsHTML(view){const records=view.records||[],pending=view.pendingRecords||[];return `${records.length?'<div class="warning-active-list">'+records.map(r=>`<p><strong>${esc(r.type)} ${esc(r.level)}</strong> · ${esc(r.region)}<span>발효 ${esc(r.effective)} KST</span></p>`).join('')+'</div>':''}${pending.length?`<p class="warning-pending">예비·발효 예정 ${pending.length}건 · 상세 확인</p>`:''}`}

const observedTypes={1:['rain','비'],2:['sleet','비·눈'],3:['snow','눈'],5:['rain','빗방울'],6:['sleet','빗방울·눈날림'],7:['snow','눈날림']};
const forecastTypes={1:['rain','비'],2:['sleet','비·눈'],3:['snow','눈'],4:['rain','소나기']};
const skyTypes={1:['sun','맑음'],3:['cloud-sun','구름많음'],4:['cloud','흐림']};
const current=d=>!d.stale&&!d.refreshError&&(!d.reason||d.reason==='refresh_pending');
const weatherTime=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function previousWeatherLabel(label,at){
 const time=Date.parse(at);
 return Number.isFinite(time)?label+' '+weatherTime.format(time):label;
}

// Use current data first, then a recent condition from the same point.
export function currentWeatherCondition(observation,forecast,now=Date.now()){
 const age=now-Date.parse(observation?.referenceAt);
 const observed=observation?.status==='ok'&&current(observation)&&age>=-600000&&age<=7200000;
 const rain=observedTypes[observation?.precipitationType];
 if(observed&&rain)return {icon:rain[0],label:rain[1],basis:'관측',at:observation.referenceAt};

 const issuedAge=now-Date.parse(forecast?.forecastIssuedAt);
 const samePoint=!!forecast?.city&&forecast.city===observation?.city;
 const usableForecast=forecast?.status==='ok'&&samePoint&&issuedAge>=0;
 const slots=(usableForecast?forecast.conditions||[]:[]).map(slot=>({
  at:slot.at,time:Date.parse(slot.at),
  value:(observed&&observation.precipitationType===0?null:forecastTypes[slot.precipitationType])||skyTypes[slot.sky]
 })).filter(slot=>slot.value&&Number.isFinite(slot.time));

 if(usableForecast&&current(forecast)&&issuedAge<=14400000){
  const slot=slots.filter(s=>Math.abs(s.time-now)<=3600000)
   .sort((a,b)=>Math.abs(a.time-now)-Math.abs(b.time-now)||a.time-b.time)[0];
  if(slot)return {icon:slot.value[0],label:slot.value[1],basis:'시간대 예보',at:slot.at};
 }

 const recentForecast=withinGrace(forecast,now)?slots.filter(s=>s.time<=now&&now-s.time<=LAST_GOOD_MS)
  .sort((a,b)=>b.time-a.time)[0]:null;
 const recentRain=observation?.status==='ok'&&observation.city&&rain&&age>=0&&age<=LAST_GOOD_MS;
 if(recentRain&&(!recentForecast||Date.parse(observation.referenceAt)>=recentForecast.time)){
  return {icon:rain[0],label:rain[1],basis:'이전 관측',at:observation.referenceAt};
 }
 if(recentForecast)return {icon:recentForecast.value[0],label:recentForecast.value[1],basis:'이전 예보',at:recentForecast.at};
 return {icon:'unknown',label:'날씨 —',basis:'',at:null};
}
function observationState(data,now){
 if(usesLastGood(data,now)||(data?.stale&&data?.status==='ok'))return previousWeatherLabel('이전 관측',data.referenceAt);
 return data?.refreshError||data?.reason&&data.reason!=='refresh_pending'?'갱신 확인 필요':data?.stale?'이전 관측':'';
}
function weatherState(data,forecast,condition,now){
 const label=observationState(data,now);
 if(condition.basis==='이전 관측')return previousWeatherLabel('이전 관측',condition.at);
 if(condition.basis==='이전 예보')return [previousWeatherLabel('이전 예보',condition.at),label].filter(Boolean).join(' · ');
 if(condition.icon==='unknown'){
  const waiting=(!data&&!forecast)||data?.reason==='refresh_pending'||forecast?.reason==='refresh_pending';
  return [waiting?'날씨 확인 중':'날씨 정보 없음',label].filter(Boolean).join(' · ');
 }
 return label;
}
export function observedPrecipitation(data,condition){
 if(condition?.basis!=='관측'||!['rain','snow','sleet'].includes(condition.icon)||!Number.isFinite(data?.rainfall)||data.rainfall<0)return null;
 const text=data.rainfall.toLocaleString('ko-KR',{maximumFractionDigits:1})+'mm';
 return {text,title:'최근 1시간 강수량 '+text+' · 비·눈 포함 물 환산량 · 관측 '+(data.referenceAt||'')};
}
export function currentWeatherText(data,forecast,now=Date.now()){const c=currentWeatherCondition(data,forecast,now);return [data?.city||'선택 지점',number(data?.temperature)+'℃','습도 '+number(data?.humidity)+'%','풍속 '+number(data?.windSpeed)+'m/s',c.label,c.basis,observedPrecipitation(data,c)?.title,weatherState(data,forecast,c,now)].filter(Boolean).join(' · ')}
export function currentWeatherHTML(data,forecast,now=Date.now()){
 const c=currentWeatherCondition(data,forecast,now),hour=new Date(now+9*3600000).getUTCHours(),night=hour<6||hour>=18,p=observedPrecipitation(data,c),state=weatherState(data,forecast,c,now);
 return '<span class="weather-now-identity">'+(c.icon==='unknown'?'':weatherIcon(c.icon,{night,compact:true}))+(p?'<span class="weather-now-precip" title="'+esc(p.title)+'" aria-label="'+esc(p.title)+'">'+esc(p.text)+'</span>':'')+'<span>'+esc(data?.city||'선택 지점')+'<small>'+esc(c.label)+(c.basis==='시간대 예보'?' <span class="weather-basis">예보</span>':'')+'</small></span></span><span class="weather-now-temp">'+number(data?.temperature)+'<small>°C</small></span><span class="weather-now-metrics"><span class="weather-now-humidity"><svg viewBox="0 0 16 20" aria-hidden="true"><path d="M8 1C6 5 2 9 2 13a6 6 0 0 0 12 0c0-4-4-8-6-12Z" fill="currentColor"/></svg><strong>'+number(data?.humidity)+'<small>%</small></strong><span class="weather-unit-label">습도</span></span><span class="weather-now-wind">바람 '+number(data?.windSpeed)+' m/s</span></span>'+(state?'<span class="weather-now-state">'+esc(state)+'</span>':'');
}

export function modelForecastHTML(data,{city,now=Date.now(),stamp=v=>v||'—'}={}){
 const valid=data?.status==='ok'&&data.city===city&&(!data.stale||usesLastGood(data,now))&&now-Date.parse(data.sourceUpdatedAt)<=36*3600000;
 const num=v=>Number.isFinite(v)?v.toFixed(1):'—';
 return '<section class="model-forecast"><h3>강수·풍속 모델 예보 <small>MET Norway</small></h3><p class="caption">한국시간 날짜별 · 오늘은 남은 시간 · 기상청 예보와 별도 참고값</p><div class="model-days">'+forecastDates(now).map((date,i)=>{const d=valid?data.calendarDays?.find(x=>x.date===date):null;return '<article><strong>'+['오늘','내일','모레'][i]+'</strong><dl><div><dt>예상 강수량</dt><dd>'+num(d?.rainMm)+'<small> mm</small></dd></div><div><dt>예상 최대풍속</dt><dd>'+num(d?.windMs)+'<small> m/s</small></dd></div></dl><p class="caption">'+(d?d.rainCoverageHours+'/'+d.expectedHours+'시간 강수 합계':'자료 확인 필요')+'</p></article>';}).join('')+'</div><p class="caption">강수량은 겹치지 않는 1·6시간 예보 구간의 합계입니다. 빠진 구간은 0으로 채우지 않으며 일부 시간만 있으면 하루 총량이 아닙니다. 풍속은 제공 시각 중 최댓값이며 돌풍이 아닙니다.</p><p class="caption">모델 갱신 '+esc(stamp(data?.sourceUpdatedAt))+'</p><a href="https://api.met.no/weatherapi/locationforecast/2.0/documentation" target="_blank" rel="noopener noreferrer">MET Norway</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></section>';
}

export function warningSheetHTML(signal,view,regions=[],{stamp=String}={}){
 const current=view.records||[],outside=view.outsideRecords||[],pending=view.pendingRecords||[];
 const scopeReview=!current.length&&!!view.unmappedRecords?.length;const headline=scopeReview?'지역 적용 여부 확인':regions.length?'관심지역 발효현황':'전국 발효현황';const primary=scopeReview?view.unmappedRecords:current;
 const card=(r,i,primary=false)=>`<article class="warning-detail-card${primary?' warning-detail-primary':''}"><div class="warning-detail-type"><span>${primary?i+1+'. ':''}${esc(r.type)} ${esc(r.level)}</span></div><h3>${esc(r.region)}</h3><p>발효 ${esc(r.effective)} KST</p>${r.releaseEstimate?'<p>해제예고 '+esc(r.releaseEstimate)+'</p>':''}</article>`;
 const section=(title,rows,primary=false)=>`<section class="warning-detail-section"><h3 class="warning-detail-section-title">${esc(title)} · ${rows.length}건</h3>${rows.map((r,i)=>card(r,i,primary)).join('')}</section>`;
 const failed=view.kind==='failed',limited=view.unknown||failed;
 return `<div class="warning-detail"><div class="warning-detail-summary"><strong>${headline} · ${failed?'미확인':primary.length+'건'}</strong><p>${regions.length?regions.map(esc).join(' · '):'전국 범위'}</p><p>첫 화면에 표시된 건수에 해당하는 특보입니다.</p></div>${limited?'<p class="warning-detail-notice">일부 특보의 지역·발효시각 또는 수집 상태가 미확정입니다. 확인된 항목과 구분하여 아래에 표시합니다.</p>':''}${view.kind==='stale'||view.fallback?'<p class="warning-detail-notice">이전 정상 자료 · 아래 조회시각 기준입니다.</p>':''}${section(headline,primary,true)}${!limited&&!current.length?'<p>확인된 관심 범위에 현재 발효 중인 특보가 없습니다.</p>':''}${pending.length?section('관심지역 예비·발효 예정',pending):''}${regions.length?'<details class="warning-detail-other"><summary>관심지역 외 발효현황 · '+outside.length+'건</summary>'+outside.map((r,i)=>card(r,i)).join('')+(outside.length?'':'<p>현재 확인된 항목이 없습니다.</p>')+'</details>':''}${view.outsidePendingRecords?.length?'<details class="warning-detail-other"><summary>관심지역 외 예비·발효 예정 · '+view.outsidePendingRecords.length+'건</summary>'+view.outsidePendingRecords.map((r,i)=>card(r,i)).join('')+'</details>':''}${!scopeReview&&view.unmappedRecords?.length?section('지역 적용 여부 미확정',view.unmappedRecords):''}<p class="caption">마지막 정상 조회 ${esc(signal?.checkedAt?stamp(signal.checkedAt):'미확인')}</p>${signal?.sourceUrl&&/^https:\/\/www\.weather\.go\.kr\//.test(signal.sourceUrl)?'<a href="'+esc(signal.sourceUrl)+'" target="_blank" rel="noopener noreferrer">기상청 공식 원문 ↗</a>':''}</div>`;
}
