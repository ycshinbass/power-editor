import {mountMaterial3} from './material3.js';
import {usesLastGood} from './last-good.js';
import {compactChartFrame,koreaDay} from '/power-flow.js';
import {getRegion} from '/regions.js';
// Design-only fixtures. These are invented examples, never NAVER response data.
export const naverPreview=new URLSearchParams(location.search).get('news-preview')==='naver';
// Public layout shares the approved design; invented fixtures remain query-gated.
export function previewSignalLabel(label){
  if(/갱신 실패|자료 지연|이전 |판별 실패|조회 실패|확인 불가/.test(label))return '현황 확인 필요';
  return label;
}
export function previewFlowLabel(label){
  if(/당일 \d+개/.test(label))return /이전 자료|자료 지연/.test(label)?'이전 자료 · 기준시각 확인':'';
  if(/연동 대기|응답 지연|미연동|연결 후|연결 실패/.test(label))return '자료 확인 필요';
  if(/미수집 구간은|그래프에서 시간을 가리키면/.test(label))return '';
  return label;
}
// Layout fixtures only. No KPX forecast, model, weather API or collector is activated.
export const demandExample={
  forecast:[65,64,63,62,63,65,70,75,79,80,79,77.8,76,77,79,82,85,87.4,87,84,80,75,71,68],
  actual:[65.3,64.2,63.1,62.2,63.2,65.4,70.2,75.5,79.2,80.5,79.5,78.4],
  usual:[64,63,62,61,62,64,68,73,77,78,77,76,74,75,77,80,83,85,84,81,77,73,69,66],
  yesterday:[65,64,63,62,63,65,69,74,78,79,78,77.2,75,76,78,81,84,86,85,82,78,74,70,67]
};
export function demandDelta(actual,reference){
  if(!Number.isFinite(actual)||!Number.isFinite(reference)||reference<=0)return null;
  return {mw:Math.round((actual-reference)*1000),percent:(actual-reference)/reference*100};
}
// NOAA solar equations, apparent sunrise/set at a level horizon (90.833° zenith).
// Local calculation only; no location permission, AI or external API request.
// https://gml.noaa.gov/grad/solcalc/solareqns.PDF
function solarTerms(date,hour=12){
  const stamp=Date.parse(date+'T12:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date||!Number.isFinite(hour)||hour<0||hour>24)return null;
  const year=new Date(stamp).getUTCFullYear(),days=(Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000;
  const day=Math.floor((stamp-Date.UTC(year,0,1))/86400000)+1,g=2*Math.PI/days*(day-1+(hour-12)/24);
  return {eq:229.18*(.000075+.001868*Math.cos(g)-.032077*Math.sin(g)-.014615*Math.cos(2*g)-.040849*Math.sin(2*g)),dec:.006918-.399912*Math.cos(g)+.070257*Math.sin(g)-.006758*Math.cos(2*g)+.000907*Math.sin(2*g)-.002697*Math.cos(3*g)+.00148*Math.sin(3*g)};
}
function solarCoordinates(latitude,longitude){return Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<90&&Math.abs(longitude)<=180;}
export function solarElevation(date,latitude,longitude,hour){
  const terms=solarTerms(date,hour);if(!terms||!solarCoordinates(latitude,longitude))return null;
  const rad=Math.PI/180,angle=(hour*60+terms.eq+4*longitude-540)/4-180;
  const sin=Math.sin(latitude*rad)*Math.sin(terms.dec)+Math.cos(latitude*rad)*Math.cos(terms.dec)*Math.cos(angle*rad);
  return Math.asin(Math.max(-1,Math.min(1,sin)))/rad;
}
export function solarDaylight(date,latitude,longitude){
  if(!solarTerms(date)||!solarCoordinates(latitude,longitude))return null;
  const rad=Math.PI/180;
  const event=sign=>{
    let hour=12;
    for(let i=0;i<3;i++){
      const terms=solarTerms(date,hour);if(!terms)return null;const {eq,dec}=terms;
      const cosHour=Math.cos(90.833*rad)/(Math.cos(latitude*rad)*Math.cos(dec))-Math.tan(latitude*rad)*Math.tan(dec);
      if(Math.abs(cosHour)>1)return null;
      hour=(720-4*(longitude+sign*Math.acos(cosHour)/rad)-eq+540)/60;
    }
    return hour;
  };
  const sunrise=event(1),sunset=event(-1);
  return Number.isFinite(sunrise)&&Number.isFinite(sunset)&&sunrise>=0&&sunrise<sunset&&sunset<=24?{sunrise,sunset}:null;
}
// Present only verified current signals as active. Missing data is never a zero.
export function previewSignalState(view,{loading=false,weather=false}={}){
  if(loading)return {state:'unknown',label:'확인 중',count:null};
  const fresh=['present','empty'].includes(view?.kind);
  const count=weather?(view?.records||[]).length:view?.count;
  if(fresh&&Number.isInteger(count)&&count>0&&(weather||!view.unknown))return {state:'active',count,label:(weather?'발효 ':'')+count+'건'+(view.unknown?' · 일부 미확인':'')};
  if(fresh&&weather&&view?.unknown&&view.unmappedRecords?.length)return {state:'unknown',count:null,label:'지역 확인 '+view.unmappedRecords.length+'건'};
  if(!fresh||view?.unknown||!Number.isInteger(count))return {state:'unknown',count:null,label:view?.kind==='stale'?'최신 확인 필요':'확인 필요'};
  return {state:'empty',count:0,label:weather?'발효 0건':'0건'};
}
export function previewDomesticEarthquakes(data,now=Date.now()){
  if(!data||data.status!=='ok'||(data.stale||data.refreshError||(data.reason&&data.reason!=='refresh_pending'))&&!usesLastGood(data,now)||!Array.isArray(data.items))return {state:'unknown',items:[]};
  const domestic=data.items.filter(r=>r.type==='domestic');
  const items=domestic.filter(r=>{const age=now-Date.parse(r.occurredAt);return Number.isFinite(age)&&age>=0&&age<=86400000});
  return {state:items.length?'active':domestic.some(r=>!Number.isFinite(Date.parse(r.occurredAt)))?'unknown':'empty',items};
}

// Display-only, shape-preserving cubic interpolation of official hourly knots.
// Every knot is retained; controls stay inside each adjacent pair's value range.
// Gaps are separate paths, never synthetic observations or extrapolated hours.
export function forecastDisplayPath(points,x,y){
 const segments=[];let segment=[],priorHour=null;
 for(const point of points||[]){
  const hour=point.hour,value=point.mw/1000;
  if(!Number.isInteger(hour)||hour<0||hour>24||!Number.isFinite(value)||value<=0){if(segment.length)segments.push(segment);segment=[];priorHour=null;continue;}
  const p={x:x(hour),y:y(value)};
  if(!Number.isFinite(p.x)||!Number.isFinite(p.y)){if(segment.length)segments.push(segment);segment=[];priorHour=null;continue;}
  if(priorHour!==null&&(hour-priorHour!==1||p.x<=segment.at(-1).x)){segments.push(segment);segment=[];}
  segment.push(p);priorHour=hour;
 }
 if(segment.length)segments.push(segment);
 const position=p=>p.x.toFixed(3)+','+p.y.toFixed(3);
 return segments.map(knots=>{
  let path='M'+position(knots[0]);if(knots.length===1)return path;
  const widths=knots.slice(1).map((p,i)=>p.x-knots[i].x),slopes=knots.slice(1).map((p,i)=>(p.y-knots[i].y)/widths[i]);
  const tangents=knots.map((_,i)=>{
   if(!i)return slopes[0];if(i===knots.length-1)return slopes.at(-1);
   const a=slopes[i-1],b=slopes[i];if(a*b<=0)return 0;
   const w1=2*widths[i]+widths[i-1],w2=widths[i]+2*widths[i-1];return (w1+w2)/(w1/a+w2/b);
  });
  for(let i=0;i<knots.length-1;i++){
   const a=knots[i],b=knots[i+1],width=widths[i]/3,delta=slopes[i];
   const bounded=m=>delta*m>0?Math.sign(delta)*Math.min(Math.abs(m),3*Math.abs(delta)):0;
   path+=' C'+position({x:a.x+width,y:a.y+bounded(tangents[i])*width})+' '+position({x:b.x-width,y:b.y-bounded(tangents[i+1])*width})+' '+position(b);
  }
  return path;
 }).join(' ');
}
export function liveDemandDrawing(data,frame,{mini=false,now=Date.now()}={}){
 const actual=data?.status==='ok'&&data.date===koreaDay(now)&&Array.isArray(data.today)&&data.today.length>=2;
 const forecast=data?.forecast?.status==='ok'&&data.forecast.date===koreaDay(now)&&data.forecast.points?.length===24;
 if(!actual&&(mini||!forecast))return '';
 data={...data,today:actual?data.today:[],previous:actual?(data.previous||[]):[],forecast:forecast?data.forecast:null};
 const tail=data.forecast?.previousTail,previousDate=koreaDay(now-86400000);
 const previousTail=!mini&&tail?.date===previousDate&&tail.hour===24&&Number.isFinite(tail.mw)&&tail.mw>0&&tail.mw<=200000?{hour:0,mw:tail.mw}:null;
 const forecastPoints=previousTail?[previousTail,...data.forecast.points]:data.forecast?.points||[];
 const all=[...data.today,...(data.previous||[]),...(mini?[]:forecastPoints)].map(p=>p.mw/1000).filter(Number.isFinite);if(!all.length)return '';
 const low=Math.floor(Math.min(...all)/10)*10,high=Math.max(low+10,Math.ceil(Math.max(...all)/10)*10);
 const {left,right,top,bottom}=frame,x=h=>left+h/24*(right-left),y=v=>bottom-(v-low)/(high-low)*(bottom-top);
 const paths=(points,gap=300000)=>{let prior=null;return (points||[]).map(p=>{const t=Date.parse(p.at),d=new Date(t+32400000),h=p.hour??(d.getUTCHours()+d.getUTCMinutes()/60),v=p.mw/1000;if((p.hour===undefined&&!Number.isFinite(t))||!Number.isFinite(v)){prior=null;return '';}const position=p.hour===undefined?t:p.hour*3600000;const command=prior!==null&&position-prior<=gap?'L':'M';prior=position;return command+x(h).toFixed(3)+','+y(v).toFixed(3);}).join(' ');};
 const ticks=mini?'':Array.from({length:(high-low)/10+1},(_,i)=>low+i*10).map(v=>'<line class="demand-grid" x1="'+left+'" x2="'+right+'" y1="'+y(v)+'" y2="'+y(v)+'"/><text x="'+(left-4)+'" y="'+(y(v)+4)+'" text-anchor="end" font-size="13">'+v+'</text>').join('')+[0,6,12,18,24].map(h=>'<text x="'+x(h)+'" y="'+(frame.height-7)+'" text-anchor="'+(h===0?'start':h===24?'end':'middle')+'" font-size="13">'+String(h).padStart(2,'0')+(h===24?'시':'')+'</text>').join('')+'<text x="'+left+'" y="14" text-anchor="start" font-size="13">GW</text>';
 // KPX hour h represents (h-1,h]; place its interval value at the midpoint,
 // rather than treating the hour-end label as an instantaneous observation.
 // Yesterday's 24h interval is centered at -00:30. Clip its connecting curve
 // to today's plot, so the visible forecast begins at 00:00 by interpolation.
 return '<title>전력거래소 전국 전력시장 수요 · 5분 순시값'+(data.stale?' · 이전 자료':'')+'</title>'+ticks+(mini||!forecastPoints.length?'':'<defs><clipPath id="demand-forecast-clip"><rect x="'+left+'" y="'+top+'" width="'+(right-left)+'" height="'+(bottom-top)+'"/></clipPath></defs><path d="'+forecastDisplayPath(forecastPoints,h=>x(h-.5),y)+'" class="demand-line predicted" clip-path="url(#demand-forecast-clip)"><title>공식 시간별 예측값 · 해당 1시간 구간의 중앙에 표시'+(previousTail?' · 00시는 전날 마지막 구간과 오늘 첫 구간 사이 표시용 보간':'')+' · 구간 사이는 표시용 보간</title></path>')+'<path d="'+paths(data.previous)+'" class="demand-line baseline"/><path d="'+paths(data.today)+'" class="demand-line actual"/>';
}

let previewContext={},refreshBriefing=()=>{},refreshDemand=()=>{},refreshHeadlines=()=>{};
export function updatePreviewContext(patch){const previousCity=previewContext.weatherCity;Object.assign(previewContext,patch);refreshBriefing();refreshHeadlines();if(previousCity!==previewContext.weatherCity||Object.hasOwn(patch,'powerDemand'))refreshDemand();}
function renderCompactTheme(){
  const choice=document.querySelector('.theme-choice');
  if(!choice||document.getElementById('previewThemeToggle'))return;
  choice.hidden=true;
  const button=document.createElement('button');button.id='previewThemeToggle';button.type='button';
  const sync=()=>{const dark=document.documentElement.dataset.theme==='dark';button.textContent=dark?'DARK':'LIGHT';button.setAttribute('aria-label',(dark?'DARK':'LIGHT')+' · '+(dark?'주간':'야간')+' 모드로 전환');};
  button.onclick=()=>choice.querySelector('[data-theme-choice="'+(document.documentElement.dataset.theme==='dark'?'light':'dark')+'"]').click();
  choice.after(button);new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});sync();
}
function startHeadlineTicker(button,pause){
  const track=button.querySelector('.headline-track');
  let titles=[];const getTitles=()=>{if(naverPreview)return examples.kepco.map(row=>({title:row[0],label:'한전'}));const kepco=(previewContext.kepcoHeadlines||[]).map(title=>({title,label:'한전'})),power=(previewContext.powerHeadlines||[]).map(item=>{const selected=(previewContext.regions||[]).map(r=>getRegion(r)).filter(Boolean);const region=selected.find(r=>(item.regions||[]).includes(r.id));return {title:item.title,label:region?region.label:'전력'};});return Array.from({length:Math.max(kepco.length,power.length)},(_,i)=>[kepco[i],power[i]]).flat().filter(Boolean);};let signature='';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let index=0,timer=null,finish=null,paused=false,hover=false,turn=0;
  const show=()=>{turn++;track.classList.remove('is-turning');track.replaceChildren();const line=document.createElement('span');line.textContent=titles[index].title;track.append(line);button.querySelector('b').textContent=titles[index].label;button.title=(naverPreview?'[가상 예시] ':'')+titles[index].title;button.setAttribute('aria-label',titles[index].label+' 뉴스 · '+titles[index].title+' · 목록 보기');};
  const stop=()=>{clearTimeout(timer);timer=null;};
  const schedule=()=>{stop();if(titles.length>1&&!paused&&!hover&&!document.hidden&&!button.contains(document.activeElement))timer=setTimeout(advance,6000);};
  const advance=()=>{
    const next=(index+1)%titles.length;
    if(reduced.matches){index=next;show();schedule();return;}
    const line=document.createElement('span');line.textContent=titles[next].title;track.append(line);
    const token=++turn;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{if(token===turn)track.classList.add('is-turning');}));
    finish=setTimeout(()=>{finish=null;index=next;show();schedule();},500);
  };
  pause.onclick=()=>{paused=!paused;pause.textContent=paused?'▶':'Ⅱ';pause.setAttribute('aria-label','한전 헤드라인 자동 넘김 '+(paused?'재생':'일시정지'));schedule();};
  button.addEventListener('pointerenter',()=>{hover=true;stop();});button.addEventListener('pointerleave',()=>{hover=false;schedule();});
  button.addEventListener('focus',stop);button.addEventListener('blur',schedule);
  document.addEventListener('visibilitychange',schedule);
  window.addEventListener('pagehide',()=>{stop();clearTimeout(finish);});
  window.addEventListener('pageshow',()=>{show();schedule();});
  refreshHeadlines=()=>{const next=getTitles(),key=JSON.stringify(next);if(key===signature)return;signature=key;titles=next.length?next:[{title:'확인된 최신 소식 없음',label:'전력'}];index=0;clearTimeout(finish);pause.hidden=titles.length<2;show();schedule();};
  refreshHeadlines();
}
function renderBriefingPreview(){
  const title=document.getElementById('situationTitle');
  if(!title||document.getElementById('previewBriefbar'))return;
  const text=(element,value)=>{if(element&&element.textContent!==value)element.textContent=value;};
  const html=(element,value)=>{if(element&&element.innerHTML!==value)element.innerHTML=value;};
  renderCompactTheme();
  const locationButton=document.getElementById('nearestAirButton');if(locationButton){locationButton.classList.add('header-location');document.querySelector('.masthead .brand').after(locationButton);locationButton.title='현재 위치에서 가까운 대기질 측정소 찾기';}
  const headerAlerts=document.createElement('details');headerAlerts.id='briefAlerts';headerAlerts.className='header-alerts';headerAlerts.hidden=true;
  headerAlerts.innerHTML='<summary aria-label="기상특보·재난 상세 목록"><span class="header-alert-label"></span><span aria-hidden="true">⌄</span></summary><div class="header-alert-menu" aria-label="기상특보·재난 상세 목록" aria-live="polite"></div>';
  document.querySelector('.masthead .brand').after(headerAlerts);
  document.addEventListener('click',event=>{if(!headerAlerts.contains(event.target))headerAlerts.open=false;});
  headerAlerts.addEventListener('keydown',event=>{if(event.key==='Escape'){headerAlerts.open=false;headerAlerts.querySelector('summary').focus();}});
  const airNote=document.getElementById('airLocationNote');if(airNote)airNote.hidden=true;
  title.textContent='우리지역 대기질·특보·재난';
  document.querySelectorAll('.tier-kicker,.demand-eyebrow,.attention-top>.caption,.brand>span').forEach(el=>el.remove());
  const grid=title.closest('.attention').querySelector('.compact-signals');
  const disaster=document.createElement('section');disaster.className='local-card preview-disasters';
  disaster.innerHTML='<h3>산불·산사태·지진</h3><button type="button" id="disasterSummary" class="disaster-summary" hidden>현황 확인 중</button><div class="preview-disaster-rows"></div><p class="preview-disaster-note"></p>';
  grid.append(disaster);
  for(const [id,label]of [['fireCoverage','산불'],['landslideCoverage','산사태'],['earthquakeCoverage','국내 지진']]){
    const button=document.getElementById(id),old=button.closest('.local-card');
    const row=document.createElement('div');row.className='preview-disaster-row';row.dataset.signal=id;
    const name=document.createElement('span');name.textContent=label;row.append(name,button);disaster.querySelector('.preview-disaster-rows').append(row);old.remove();
  }
  const bar=document.createElement('aside');bar.id='previewBriefbar';bar.className='preview-briefbar';bar.setAttribute('aria-label','지역과 전력 핵심 요약');
  bar.innerHTML='<div class="briefbar-inner"><div class="briefbar-main"><div class="briefbar-region"></div><div class="briefbar-weather"></div><button class="briefbar-power" type="button" aria-label="공급예비율과 수요 그래프 보기"><span><small>공급예비율</small><strong id="briefReserve">—</strong><small id="briefReserveState"></small></span><span class="brief-mini"><svg id="briefDemandGraph" viewBox="0 0 100 28" role="img" aria-label="가상 수요 예시"></svg><small>수요 예시</small></span></button></div><div class="briefbar-news"><button id="briefKepco" type="button"><b>한전</b><span class="headline-window"><span class="headline-track"></span></span><small>예시</small></button><button id="briefNewsPause" type="button" aria-label="한전 헤드라인 자동 넘김 일시정지">Ⅱ</button></div></div>';
  document.querySelector('main').before(bar);
  const region=document.getElementById('regionButton');bar.querySelector('.briefbar-region').append(region);
  region.childNodes[0].textContent='';const regionName=document.createElement('span');regionName.id='briefRegionName';region.prepend(regionName);
  bar.querySelector('.briefbar-weather').append(document.getElementById('currentWeatherDetail'));
  const clock=document.querySelector('.home-clock');document.getElementById('operationsTitle').closest('.tier-heading').append(clock);
  const outage=document.getElementById('outageCoverage');outage.className='brief-outage';outage.querySelector('h3').textContent='정전 보도';bar.querySelector('.briefbar-news').append(outage);
  bar.querySelector('.briefbar-power').onclick=()=>document.getElementById('power-data-preview').scrollIntoView({block:'start',behavior:'smooth'});
  document.getElementById('briefKepco').onclick=()=>{document.querySelector('[data-naver-scope="kepco"]')?.click();document.getElementById('naver-preview').scrollIntoView({block:'start',behavior:'smooth'});};
  if(!naverPreview){bar.querySelector('.brief-mini small').textContent='수요';bar.querySelector('#briefDemandGraph').setAttribute('aria-label','전국 전력시장 수요 추이');bar.querySelector('#briefKepco>small').remove();document.getElementById('briefKepco').onclick=()=>{document.querySelector('[data-public-scope="kepco"]')?.click();document.getElementById('news').scrollIntoView({block:'start',behavior:'smooth'});};}
  startHeadlineTicker(document.getElementById('briefKepco'),document.getElementById('briefNewsPause'));
  const point=(v,i)=>`${2+i/23*96},${26-(v-60)/30*22}`;
  if(naverPreview)bar.querySelector('#briefDemandGraph').innerHTML='<polyline class="mini-predicted" points="'+demandExample.forecast.map(point).join(' ')+'"/><polyline class="mini-actual" points="'+demandExample.actual.map(point).join(' ')+'"/>';
  const measure=()=>document.documentElement.style.setProperty('--briefbar-height',Math.ceil(bar.getBoundingClientRect().height)+'px');
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(measure).observe(bar);measure();
  const signalTargets={weather:'warningCoverage',fire:'fireCoverage',landslide:'landslideCoverage'};
  refreshBriefing=()=>{
    const selected=previewContext.regions||[];
    text(regionName,'관심지역');
    region.setAttribute('aria-label','관심지역 변경 · '+(selected.join(', ')||'전국'));
    const alerts=[],uncertain=[];
    for(const [kind,id]of Object.entries(signalTargets)){
      const view=previewContext.publicViews?.[kind],state=previewSignalState(view,{weather:kind==='weather',loading:previewContext.publicLoading});
      const button=document.getElementById(id);text(button,state.label);button.dataset.resultState=state.state;
      button.setAttribute('aria-label',({weather:'기상특보',fire:'산불',landslide:'산사태'})[kind]+' · '+state.label+' · 상세보기');
      if(kind==='weather')document.getElementById('weatherWarningCard').classList.toggle('has-active-warning',state.state==='active');
      if(state.state==='unknown')uncertain.push(kind);
      if(state.state==='active'){
        const types=kind==='weather'?[...new Set((view.records||[]).map(r=>[r.type,r.level].filter(Boolean).join(' ')))].join(' · '):'';
        alerts.push({id,count:state.count,label:(kind==='weather'?(types||'기상특보')+' '+state.count+'건':(kind==='fire'?'산불':'산사태 경보')+' '+state.count+'건')+(view.unknown?' · 일부 확인 필요':'')});
      }
    }
    const quake=previewDomesticEarthquakes(previewContext.earthquake),q=document.getElementById('earthquakeCoverage');
    q.closest('.preview-disaster-row').hidden=false;q.dataset.resultState=quake.state;text(q,quake.state==='unknown'?'확인 필요':quake.items.length+'건');
    if(quake.state==='active'){
      text(q,quake.items.length+'건');q.setAttribute('aria-label','국내 지진 최근 24시간 수집 발표 '+quake.items.length+'건 · 상세보기');
      alerts.push({id:'earthquakeCoverage',count:quake.items.length,label:'국내 지진 '+quake.items.length+'건 · 최근 발표'});
    }else if(quake.state==='unknown')uncertain.push('earthquake');
    const combined=alerts.filter(a=>a.id!=='warningCoverage');
    const result=document.getElementById('disasterSummary');text(result,combined.length?combined.map(a=>a.label.replace(' · 최근 발표','')).join(' · '):uncertain.some(x=>x!=='weather')?'현황 확인 필요':'현재 발표 0건');result.dataset.resultState=combined.length?'active':uncertain.some(x=>x!=='weather')?'unknown':'empty';
    text(disaster.querySelector('.preview-disaster-note'),combined.length&&uncertain.some(x=>x!=='weather')?'일부 자료 확인 필요':'공식 공개현황 · 상세보기');
    const alertBox=document.getElementById('briefAlerts');
    const alertMarkup=alerts.map(a=>'<button type="button" aria-haspopup="dialog" data-alert-target="'+a.id+'">'+a.label.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'</button>').join('');
    html(alertBox.querySelector('.header-alert-menu'),alertMarkup);alertBox.hidden=!alerts.length;if(!alerts.length)alertBox.open=false;
    const alertLabel=alerts.length===1?alerts[0].label.replace(/ · (최근 발표|일부 확인 필요)/g,''):alerts.length?'특보·재난 '+alerts.reduce((sum,a)=>sum+a.count,0)+'건':'';
    text(alertBox.querySelector('.header-alert-label'),alertLabel);alertBox.querySelector('summary').setAttribute('aria-label',alerts.map(a=>a.label).join(' · ')+' · 상세 목록');
    html(document.getElementById('briefReserve'),document.getElementById('supplyRatio').innerHTML);
    if(!naverPreview){const mini=document.getElementById('briefDemandGraph'),drawing=liveDemandDrawing(previewContext.powerDemand,{left:2,right:98,top:2,bottom:26,width:100,height:28},{mini:true});html(mini,drawing||'<text x="50" y="17" text-anchor="middle" font-size="12">—</text>');mini.parentElement.querySelector('small').textContent=drawing?(previewContext.powerDemand.stale?'이전 수요':'수요'):'수요 확인 중';}
    const status=document.getElementById('supplyStatus').textContent;const old=!/조회 완료/.test(status);
    text(document.getElementById('briefReserveState'),old?(/이전|지연/.test(status)?'이전 자료':'확인 필요'):'');
    bar.querySelector('.briefbar-power').title=document.getElementById('supplyCaption').textContent;
    const outageState=document.getElementById('outageState'),label=outageState.textContent;if(/^보도 \d+건$/.test(label))text(outageState,label.replace(/^보도 /,''));
    if(/실패|미확인|확인 전/.test(label))text(outageState,'확인 필요');
    else if(label==='확인된 보도 없음')text(outageState,'0건');
    outage.dataset.active=String(outageState.dataset.resultState==='active');
  };
  document.getElementById('briefAlerts').onclick=event=>{const button=event.target.closest('[data-alert-target]');if(button){headerAlerts.open=false;document.getElementById(button.dataset.alertTarget)?.click();}};
  refreshBriefing();
}
function renderDemandPreview(){
  const title=document.getElementById('operationsTitle');
  if(!title)return;
  const operations=title.closest('.operations'),panel=operations.querySelector('.supply-panel');
  if(!panel||operations.dataset.demandPreview)return;
  operations.dataset.demandPreview='true';operations.id='power-data-preview';
  const overview=document.createElement('div');overview.className='demand-overview';
  const live=document.createElement('div');live.className='demand-live';
  live.innerHTML='<div class="demand-live-heading"></div>';
  const metrics=panel.querySelector('.supply-metrics');
  const supporting=document.createElement('div');supporting.className='demand-support';
  const demand=document.getElementById('supplyDemand').parentElement;
  demand.querySelector('span').textContent='수요';demand.title='현재수요(전력시장)';
  const reserve=document.getElementById('supplyReserve').parentElement;reserve.querySelector('span').textContent='예비';reserve.title='공급예비력';
  supporting.append(demand,document.getElementById('supplyReserve').parentElement);
  for(const id of ['supplyDemand','supplyReserve']){const value=supporting.querySelector('#'+id);if(value.textContent.includes('—'))value.innerHTML='—<small>GW</small>';}
  live.append(metrics,supporting,document.getElementById('supplyCaption'));
  live.querySelector('.demand-live-heading').append(document.getElementById('supplyStatus'));
  const difference=document.createElement('div');difference.className='demand-difference';
  difference.innerHTML='<span id="demandCompareTitle">수요 증감</span><strong id="demandCompareValue"></strong><p id="demandCompareCaption"><span>전일 동시간 대비</span><strong id="demandCompareAmount"></strong></p>';
  const overviewNote=document.createElement('p');overviewNote.className='demand-overview-note';overviewNote.hidden=true;
  overview.append(live,difference,overviewNote);panel.before(overview);
  const outlook=document.createElement('section');outlook.className='demand-outlook';outlook.setAttribute('aria-labelledby','demandOutlookTitle');
  outlook.innerHTML=`<div class="demand-topline"><div><h3 id="demandOutlookTitle">오늘의 수요 전망</h3></div><span class="demand-example-badge">가상 예시</span></div>
    <p class="demand-fixture-note">수요 증감·전망은 배치 검토용 가상 값입니다. KPX 예측 API 연결 전입니다.</p>
    <div class="demand-peak"><span>하루전 예측 피크</span><strong>87.4 <small>GW</small></strong><b>17–18시</b></div>
    <svg id="demandExampleChart" viewBox="0 0 360 220" role="img" aria-label="시간별 수요 그래프"><g id="demandSolarTrack" role="img" aria-label="태양의 일일 고도 곡선"></g></svg>
    <div class="demand-legend"><span class="actual">실적</span><span class="predicted">하루전 예측</span><span class="baseline" id="demandBaselineLegend">어제</span></div>
    <div class="demand-solar-meta"><p class="demand-solar-note" id="demandSolarNote" hidden></p><button type="button" id="demandSolarLive" hidden>현재</button></div>
    <div class="demand-chart-readout" id="demandExampleReadout" aria-live="polite"></div>
    <label class="demand-time-slider">시간 살펴보기<input id="demandExampleHour" type="range" min="1" max="24" step="1" value="12" aria-label="가상 수요 확인 시간"></label>
    <p class="demand-chart-caption" id="demandExampleBasis"></p>
    <details class="demand-method"><summary>데이터 활용안 · 비교 기준</summary><div>
      <p><b>공식 예측부터 활용</b> · KPX 하루전 발전계획용 시간별 수요예측을 표시하고, 피크 시간과 비교값은 프로그램으로 계산하는 안입니다. 운영 모델의 코드·학습값 재사용 허용은 확인되지 않았습니다.</p>
      <p><b>비교할 때</b> · 이 예시는 육지·동일 수요 정의의 1시간 평균으로 맞춘 가정입니다. 실제 연동에서는 육지/제주, 전력시장/총수요, 발전단/송전단, 시간 단위를 먼저 대조합니다. 일치하지 않으면 예측 오차를 표시하지 않습니다.</p>
      <p><b>평소의 의미</b> · 최근 4주 같은 요일의 같은 시간 평균. 공휴일·결측은 제외하고, 부족하면 비교를 보류합니다. 날씨 효과를 제거한 값은 아닙니다.</p>
      <p><b>지역별 자료</b> · 현재 날씨는 페이지 맨 위에 표시합니다. 지역 사용량은 한전의 공개 통계 범위부터 검토하고, 지역 발전량은 수요와 구분합니다. 지역 시간별 수요와 공식 예측이 확인되기 전에는 오늘·내일 지역 MW를 표시하지 않습니다.</p>
      <p><b>발표 시점</b> · 하루전 예측은 실시간 수정 전망과 구분하고, 대상일·발표시각을 함께 보관합니다. 시안은 예시일 12시까지 실적, 전일 23시 예측 발표를 가정합니다.</p>
      <p><b>태양 고도·낮과 밤</b> · 상단 날씨 지역의 대표 좌표와 한국시간 오늘 날짜로 계산합니다. 곡선은 하루 태양 고도이며 낮에는 태양, 밤에는 달 모양으로 현재 위치를 표시합니다. 달은 밤을 나타내는 표식으로 실제 달 고도·위상이 아닙니다. 시간 슬라이더로 선택 시각을 살펴보고 ‘현재’로 돌아올 수 있습니다. 전국 수요에 대한 지역별 일조 참고이며 발전량 예측이 아닙니다. 평지 기준 근사값으로 산지·건물·구름은 반영하지 않습니다. <a href="https://gml.noaa.gov/grad/solcalc/solareqns.PDF" target="_blank" rel="noopener noreferrer">NOAA 계산식 ↗</a></p>
      <div class="demand-source-links"><a href="https://www.data.go.kr/data/15131225/openapi.do" target="_blank" rel="noopener noreferrer">KPX 수요예측 API ↗</a><a href="https://www.kpx.or.kr/menu.es?mid=a10404090100" target="_blank" rel="noopener noreferrer">KPX 하루전 예측 ↗</a></div>
    </div></details>`;
  panel.before(outlook);
  panel.classList.add('demand-generation');
  const dateControl=document.getElementById('flowDate');dateControl.closest('label').hidden=true;dateControl.disabled=true;
  panel.querySelector('.supply-heading').append(panel.querySelector('.flow-controls'));
  document.getElementById('supplyTitle').textContent='오늘의 발전출력';
  const actualLabel=document.createElement('span');actualLabel.className='demand-generation-label';actualLabel.textContent='실제 수집자료';
  panel.querySelector('.supply-heading').append(actualLabel);
  const fuelDetail=document.createElement('details');fuelDetail.className='demand-fuel-detail';
  fuelDetail.innerHTML='<summary>선택 시각 발전원별 수치</summary>';
  const tooltip=document.getElementById('flowTooltip');tooltip.before(fuelDetail);fuelDetail.append(tooltip);
  if(!naverPreview){
    outlook.querySelector('.demand-example-badge').textContent='자료 준비 중';
    outlook.querySelector('.demand-fixture-note').textContent='공식 시간별 수요·예측 자료 연결 전입니다.';
    outlook.querySelector('.demand-peak').hidden=true;
    for(const cls of ['.demand-legend','.demand-chart-readout','.demand-time-slider','.demand-chart-caption'])outlook.querySelector(cls).hidden=true;
    outlook.querySelector('.demand-method').innerHTML='<summary>자료 기준·출처</summary><div><p>실적은 KPX 전국 전력시장 5분 수요, 하루전 예측은 KPX 육지·제주 시간별 예측 합산값입니다. 예측은 1시간 구간별 24개 공식값입니다. 원자료의 시간은 구간 종료시각이며(06시=05~06시), 실측선과 겹쳐 볼 때는 각 구간 중앙(05:30)에 배치합니다. 전날 마지막 구간(23:30)과 오늘 첫 구간(00:30)을 연결하여 00시부터 표시하며, 00시의 곡선값은 표시용 보간입니다. 전날 예측자료를 받지 못하면 이 경계 구간은 만들지 않습니다. 이는 표시 위치이며 공식 예측시각이나 예측값을 변경한 것이 아닙니다. 공식값을 지나는 형상보존 곡선으로 연결하고, 시간 사이 곡선은 표시용 보간으로 추가 공식 예측값이 아닙니다. 실측은 5분 간격이며 누락 구간은 연결하지 않습니다. 수요증감은 오늘 최신 실측과 전일 동일 시각의 5분 실측을 비교합니다. 자료는 최초 저장 후48시간 동안 보존하며 만료 자료는 정기 갱신 시 삭제합니다. 공휴일·날씨 보정은 하지 않습니다. 발전출력은 수요와 구분합니다.</p><p>태양 고도는 상단 날씨 지역의 대표 좌표로 계산한 일조 참고선입니다. GW 값이나 발전량 예측이 아니며, 밤의 달은 실제 달 위치가 아닌 표식입니다.</p><a href="https://www.kpx.or.kr/menu.es?mid=a10404090100" target="_blank" rel="noopener noreferrer">전력거래소 공식 수요예측 ↗</a> · <a href="https://gml.noaa.gov/grad/solcalc/solareqns.PDF" target="_blank" rel="noopener noreferrer">태양 계산식 ↗</a></div>';
  }
  let hour=12,solarLive=true,solarTrackKey='';
  const number=value=>value.toFixed(1);
  const signed=value=>(value>0?'+':'')+number(value);
  const draw=()=>{
    const baseline=naverPreview?demandExample.yesterday:[];
    // The chart compares yesterday; the headline delta retains the four-week usual baseline.
    const comparison=previewContext.powerDemand?.comparison;
    const delta=naverPreview?demandDelta(demandExample.actual[11],demandExample.usual[11]):comparison?{mw:comparison.deltaMw,percent:comparison.percent}:null;
    difference.querySelector('#demandCompareValue').innerHTML=delta?(delta.percent>0?'+':'')+delta.percent.toFixed(1)+'<small>%</small>':'—<small>%</small>'; 
    difference.querySelector('#demandCompareAmount').textContent=delta?signed(delta.mw/1000)+' GW':'자료 준비 중';
    difference.title=naverPreview?'가상 예시':comparison?'전일 동일 시각 5분 실측 대비 · '+comparison.previousAt:'비교자료 수신 전';
    outlook.querySelector('#demandExampleBasis').textContent='어제: 전일 같은 시간 평균 · 시간은 구간 종료시각 · 예시일 12시 기준';
    const plot=outlook.querySelector('#demandExampleChart'),track=outlook.querySelector('#demandSolarTrack');
    const frame=compactChartFrame(plot.getBoundingClientRect().width||360,plot.getBoundingClientRect().height||220);
    plot.setAttribute('viewBox',`0 0 ${frame.width} ${frame.height}`);
    const x=h=>frame.left+h/24*(frame.right-frame.left),y=v=>frame.bottom-(v-50)/40*(frame.bottom-frame.top);
    const axis=(value,x,y,anchor='middle')=>`<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="13">${value}</text>`;
    const line=values=>values.map((v,i)=>`${x(i+1).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const region=getRegion(previewContext.weatherCity),date=koreaDay();
    const solar=solarDaylight(date,region?.latitude,region?.longitude);
    const solarNote=outlook.querySelector('#demandSolarNote');
    const clock=new Date(Date.now()+32400000),solarHour=solarLive?clock.getUTCHours()+clock.getUTCMinutes()/60:hour;
    solarNote.textContent=solar?'태양 고도 · '+region.label+' · '+(solarLive?'현재':String(hour).padStart(2,'0')+'시 선택'):'태양 고도 기준 지역 확인 필요';
    solarNote.title=solar?date+' · 일출·일몰 계산값 · 평지 기준':'';
    const shade=(start,end,kind)=>`<rect x="${x(start)}" y="${frame.top}" width="${x(end)-x(start)}" height="${frame.bottom-frame.top}" class="demand-solar-${kind}"/>`;
    const daylight=solar?shade(0,solar.sunrise,'night')+shade(solar.sunrise,solar.sunset,'day')+shade(solar.sunset,24,'night'):'';
    const solarMarkers=solar?[solar.sunrise,solar.sunset].map(h=>`<line x1="${x(h)}" x2="${x(h)}" y1="${frame.top}" y2="${frame.bottom}" class="demand-solar-boundary"/>`).join(''):'';
    plot.innerHTML=`<title>${naverPreview?'가상 육지 수요 예시: 17–18시 예측 최대 87.4GW':'공식 시간별 수요 자료 준비 중'}</title><desc>세로선은 일출과 일몰이며 밝은 음영이 낮입니다. ${naverPreview?'점선은 전일 같은 시간 평균입니다.':'확인되지 않은 수요와 예측 수치는 표시하지 않습니다.'}</desc>
      ${daylight}
      ${[50,60,70,80,90].map(v=>`<line x1="${frame.left}" x2="${frame.right}" y1="${y(v)}" y2="${y(v)}" class="demand-grid"/>`+(naverPreview?axis(v,frame.left-4,y(v)+4,'end'):'')).join('')}
      ${[0,6,12,18,24].map(h=>axis(String(h).padStart(2,'0')+(h===24?'시':''),x(h),frame.height-7,h===0?'start':h===24?'end':'middle')).join('')}
      ${naverPreview?axis('GW',frame.left-4,14,'end'):''}
      ${solarMarkers}
      ${naverPreview?`<polyline points="${line(baseline)}" class="demand-line baseline"/><path d="${forecastDisplayPath(demandExample.forecast.map((v,i)=>({hour:i+1,mw:v*1000})),x,y)}" class="demand-line predicted"/><polyline points="${line(demandExample.actual)}" class="demand-line actual"/>
      <line x1="${x(hour)}" x2="${x(hour)}" y1="${frame.top}" y2="${frame.bottom}" class="demand-cursor"/>
      <circle cx="${x(hour)}" cy="${y(demandExample.forecast[hour-1])}" r="4" class="demand-forecast-dot"/>
      <circle cx="${x(18)}" cy="${y(87.4)}" r="5" class="demand-peak-dot"/><text x="${x(18)}" y="${y(87.4)-13}" text-anchor="middle" class="demand-peak-label">피크 87.4</text>`:`<text x="${(frame.left+frame.right)/2}" y="${frame.top+55}" text-anchor="middle" font-size="12">공식 수요·예측 자료 준비 중</text>`}`;
    if(!naverPreview){const drawing=liveDemandDrawing(previewContext.powerDemand,frame);if(drawing){plot.innerHTML=daylight+solarMarkers+drawing;outlook.querySelector('.demand-example-badge').textContent=previewContext.powerDemand.stale?'이전 자료':'시장수요';outlook.querySelector('.demand-fixture-note').textContent=previewContext.powerDemand.forecast?'전국 실적 · KPX 하루전 예측(육지+제주)':'전국 전력시장 5분 수요';outlook.querySelector('.demand-legend').hidden=false;outlook.querySelector('.demand-legend .predicted').hidden=!previewContext.powerDemand.forecast;outlook.querySelector('#demandBaselineLegend').hidden=!previewContext.powerDemand.previous?.length;}else{outlook.querySelector('.demand-example-badge').textContent='자료 확인 필요';outlook.querySelector('.demand-fixture-note').textContent='공식 수요 자료를 확인하지 못했습니다.';outlook.querySelector('.demand-legend').hidden=true;}}
    // Preserve the moving marker when redrawing the main chart. Overlay stays inside its plot.
    plot.append(track);track.removeAttribute('transform');
    const key=[date,region?.id,frame.width,Boolean(solar)].join('|');
    const elevation=h=>solar&&h>solar.sunrise&&h<solar.sunset?Math.sin(Math.PI*(h-solar.sunrise)/(solar.sunset-solar.sunrise)):0,sy=v=>frame.bottom-11-v*20;
    track.style.display=solar?'block':'none';
    if(solar){
      if(solarTrackKey!==key){
        solarTrackKey=key;
        const path=(start,end)=>Array.from({length:49},(_,i)=>{const h=start+(end-start)*i/48;return (i?'L':'M')+x(h).toFixed(2)+','+sy(elevation(h)).toFixed(2)}).join(' ');
        track.innerHTML=`<title>오늘 태양 고도 · ${region.label}</title><desc>수요 그래프 안쪽 하단, 같은 00시부터 24시 시간축. 별도 축척의 태양 고도 참고선이며 GW 값이 아닙니다. 달 모양은 밤 표식이며 실제 달의 위치가 아닙니다.</desc><line x1="${frame.left}" x2="${frame.right}" y1="21" y2="21" class="solar-horizon"/><path d="${path(0,solar.sunrise)}" class="solar-orbit night"/><path d="${path(solar.sunrise,solar.sunset)}" class="solar-orbit day"/><path d="${path(solar.sunset,24)}" class="solar-orbit night"/><g class="solar-current-marker" role="img"></g>`;
      }
      const isDay=solarHour>=solar.sunrise&&solarHour<solar.sunset,marker=track.querySelector('.solar-current-marker');
      marker.setAttribute('aria-label',(solarLive?'현재':'선택 시각')+' · '+(isDay?'낮 · 태양':'밤 · 달 표식'));
      if(marker.dataset.kind!==(isDay?'sun':'moon')){marker.dataset.kind=isDay?'sun':'moon';marker.innerHTML='<circle r="10" class="solar-marker-disc"/>'+(isDay?'<g class="demand-solar-icon sunrise"><circle r="3.2"/><path d="M0-7v1.4M0 5.6V7M-7 0h1.4M5.6 0H7M-5-5l1 1M4 4l1 1M5-5L4-4M-4 4l-1 1"/></g>':'<g class="demand-solar-icon sunset"><path d="M-2-7a7 7 0 1 0 9 9 7 7 0 0 1-9-9Z"/></g>');}
      marker.style.transform=`translate(${x(solarHour)}px,${sy(elevation(solarHour))}px)`;
    }else{solarTrackKey='';track.replaceChildren();}
    outlook.querySelector('#demandSolarLive').hidden=solarLive||!solar;
    if(!naverPreview)return;
    const actual=demandExample.actual[hour-1],forecast=demandExample.forecast[hour-1],deviation=demandDelta(actual,forecast);
    outlook.querySelector('#demandExampleReadout').innerHTML=`<b>${String(hour-1).padStart(2,'0')}–${String(hour).padStart(2,'0')}시</b><span>실적 <strong>${actual===undefined?'집계 전':number(actual)+' GW'}</strong></span><span>예측 <strong>${number(forecast)} GW</strong></span><span>${deviation?'예측 대비 <strong>'+signed(deviation.mw/1000)+' GW</strong>':'<strong>예측 구간</strong>'}</span>`;
  };
  outlook.querySelector('#demandExampleHour').addEventListener('input',event=>{hour=Number(event.target.value);solarLive=false;draw();scheduleSolar();});
  outlook.querySelector('#demandSolarLive').onclick=()=>{solarLive=true;draw();scheduleSolar();};
  refreshDemand=draw;
  draw();
  // Local marker once a minute while visible/live; no network or background loop.
  let solarTimer;
  const scheduleSolar=()=>{clearTimeout(solarTimer);if(document.hidden)return;const delay=solarLive?60000-Date.now()%60000:Date.parse(koreaDay()+'T00:00:00+09:00')+86400000-Date.now();solarTimer=setTimeout(()=>{draw();scheduleSolar();},Math.max(1000,delay+100));};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)draw();scheduleSolar();});scheduleSolar();
  if(typeof ResizeObserver!=='undefined'){let previousWidth=0;new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(Math.abs(width-previousWidth)>.5){previousWidth=width;draw();}}).observe(outlook.querySelector('#demandExampleChart'));}
}
function simplifyPreview(){
  document.documentElement.classList.add('naver-design-preview');
  if(document.getElementById('todayView')&&!document.getElementById('previewSiteFooter')){
    const footer=document.createElement('footer');footer.id='previewSiteFooter';
    footer.innerHTML='<p>시스템 문의 : 한국전력공사 순천전력지사 신영철(<a href="mailto:ycshinbass@gmail.com">ycshinbass@gmail.com</a>)</p><small>페이지 버전 · '+(naverPreview?'시안 v134':'v134')+' <span aria-hidden="true">·</span> 업데이트 <time datetime="2026-11-07T18:45:12+09:00">2026.11.07 18:45:12 KST</time></small>';
    document.querySelector('main').append(footer);
  }
  renderDemandPreview();
  renderBriefingPreview();
  const updateText=(element,text)=>{if(element&&element.textContent!==text)element.textContent=text;};
  const simplify=()=>{
    for(const id of ['flowState','flowTooltip']){const el=document.getElementById(id);if(el)updateText(el,previewFlowLabel(el.textContent));}
    const legend=document.getElementById('flowLegend');
    if(legend)for(const item of legend.children)if(item.textContent.includes('합계 (음수 포함)'))updateText(item,item.textContent.replace(' (음수 포함)',''));
    const caption=document.getElementById('supplyCaption');
    if(caption){const value=caption.textContent;const match=value.match(/수급 기준 ([^·]+)/);if(match)updateText(caption,'자료 기준 '+match[1].trim());}
    refreshBriefing();
  };
  const targets=['flowState','flowTooltip','flowLegend','supplyCaption','supplyRatio','supplyStatus','outageState'].map(id=>document.getElementById(id)).filter(Boolean);
  const observer=new MutationObserver(simplify);
  for(const target of targets)observer.observe(target,{childList:true,characterData:true,subtree:true});
  simplify();
}
const examples={
  power:[
    ['전력수급 전망과 계통 운영 대책 발표','수급 전망과 운영 대책에 관한 검색결과 설명이 이 자리에 표시됩니다.','sample-a.example','09:20'],
    ['한국전력, 주요 송전망 보강 사업 추진','사업 범위와 추진 일정에 관한 검색결과 설명이 표시되는 자리입니다.','sample-b.example','08:40'],
    ['변압기 상태진단 기술 현장 적용 확대','설비 진단 기술에 관한 검색결과 설명이 표시되는 자리입니다.','sample-c.example','09:00'],
    ['에너지 기업, 신제품 설명회 개최','검색어와 관련된 홍보성 소식도 검색결과에 들어올 수 있음을 보여주는 가상 사례입니다.','sample-d.example','09:30'],
    ['해외 계통 운영기관, 전력망 투자계획 공개','해외 전력망 계획에 관한 검색결과 설명이 표시되는 자리입니다.','sample-e.example','07:50'],
  ],
  local:[
    ['순천 산업단지 전력설비 정비 일정 안내','선택 지역과 전력 검색어가 포함된 검색결과 설명 자리입니다.','sample-a.example','09:10'],
    ['광양 송전망 보강 계획 설명회 개최','지역명이 포함된 사업 안내가 검색되는 상황을 표현한 가상 문장입니다.','sample-b.example','08:50'],
    ['여수 전력설비 점검 활동 진행','설비 점검에 관한 검색결과 설명이 표시되는 자리입니다.','sample-c.example','08:10'],
    ['한국전력 지역본부, 정전 예방 대책 안내','한전 관련 지역 기사가 포함되는 상황을 보여주는 가상 문장입니다.','sample-d.example','09:25'],
    ['지역 에너지 기업, 신규 사업계획 소개','지역 검색에서도 전력 현업의 중요도와 다른 결과가 나올 수 있습니다.','sample-e.example','07:30'],
  ],
  kepco:[
    ['한국전력, 전력망 운영계획 공개','한전 검색어에 대한 검색결과 설명이 표시되는 자리입니다.','sample-a.example','08:50'],
    ['한국전력, 송전설비 진단 기술 실증','기술 실증에 관한 검색결과 설명이 표시되는 자리입니다.','sample-b.example','09:15'],
    ['한국전력 지역본부, 현장 안전점검 진행','지역본부의 안전점검 소식이 검색되는 가상 사례입니다.','sample-c.example','07:40'],
    ['한국전력, 신규 사업 설명회 안내','안내성 기사도 검색결과에 포함될 수 있음을 표현한 가상 문장입니다.','sample-d.example','09:35'],
    ['한국전력, 계통 연계 관련 절차 안내','계통 연계 절차에 관한 검색결과 설명이 표시되는 자리입니다.','sample-e.example','08:20'],
  ],
};
const queries={power:'전력 계통 송전 변전',local:'순천 광양 여수 전력',kepco:'한국전력 한전'};
export function renderNaverPreview(){
  const section=document.querySelector('.news.section');
  if(!naverPreview||section.dataset.naverPreview)return;
  section.dataset.naverPreview='true';section.id='naver-preview';
  simplifyPreview();
  document.title='전력 데이터·뉴스 배치 시안 · 전력에디터';
  const notice=document.createElement('div');notice.className='naver-preview-banner';
  notice.innerHTML='<div><strong>검토용 시안</strong><span>수요 비교·전망·뉴스는 예시</span></div><a href="/">기존 화면 ↗</a>';
  document.querySelector('.masthead').after(notice);
  section.querySelector('h2').textContent='전력 뉴스 검색';
  section.querySelector('.feed-filters').hidden=true;
  section.querySelector('.briefing-cadence').textContent='';
  for(const selector of ['.update-line','#pressSearch','#regionalNewsNote','#moreNews'])section.querySelector(selector).hidden=true;
  const list=section.querySelector('#newsList');list.setAttribute('aria-busy','false');
  list.innerHTML=`<div class="naver-search-panel">
    <div class="naver-search-heading"><strong><span class="naver-mark" aria-hidden="true">N</span> 네이버 뉴스 검색결과 <small>배치 예시</small></strong></div>
    <div class="naver-search-controls"><div role="group" aria-label="검색 범위 시안"><button type="button" data-naver-scope="power" aria-pressed="true">전력 전반</button><button type="button" data-naver-scope="local" aria-pressed="false">우리지역</button><button type="button" data-naver-scope="kepco" aria-pressed="false">한전</button></div><label>정렬 <select id="naverPreviewSort"><option value="sim">정확도순</option><option value="date">최신순</option></select></label></div>
    <p class="naver-query" id="naverPreviewQuery"></p><p class="naver-fixture-note">아래 제목·설명·시각·도메인은 모두 화면 검토용 가상 값입니다. 실제 검색 순위나 수집 품질을 나타내지 않습니다.</p>
    <div id="naverPreviewResults" aria-live="polite"></div>
    <p class="naver-result-foot">제목·검색 설명·출처를 확인하고 원문으로 이어지는 구성입니다.</p>
  </div>
  <details class="naver-comparison"><summary>뉴스 구성 검토안</summary><dl>
    <div><dt>네이버 중심의 카테고리</dt><dd>전력 전반·우리지역·한전을 나누어 보는 구성입니다. 실제 연동과 수집 결과의 품질 검증은 이후 단계입니다.</dd></div>
    <div><dt>구글 뉴스 병기</dt><dd>기본 목록에는 함께 섞지 않는 안입니다. 해외·누락 기사 보완은 동일 조건의 결과를 비교한 뒤 별도로 검토합니다.</dd></div>
    <div><dt>정전 관련 소식</dt><dd>네이버 검색을 우선 검토합니다. 뉴스 검색 결과는 실제 정전 발생·복구 현황과 구분합니다.</dd></div>
  </dl></details>`;
  let scope='power';
  const draw=()=>{
    list.querySelector('#naverPreviewQuery').textContent='검색어 예시: '+queries[scope]+' · '+(list.querySelector('select').value==='date'?'API 최신순 응답 가정':'API 정확도순 응답 가정');
    const rows=[...examples[scope]];if(list.querySelector('select').value==='date')rows.sort((a,b)=>b[3].localeCompare(a[3]));
    list.querySelector('#naverPreviewResults').innerHTML=rows.map(([title,description,domain,time],index)=>`<article class="news-card naver-result"><div class="naver-result-meta"><span>가상 결과 ${index+1}</span><time>예시 ${time}</time></div><h3>[가상] ${title}</h3><p class="naver-description">${description}</p><div class="naver-result-bottom"><span>원문 출처 자리 · ${domain}</span><span class="naver-link-placeholder">원문 보기 ↗ <small>시안</small></span></div></article>`).join('');
    list.querySelectorAll('[data-naver-scope]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.naverScope===scope)));
  };
  list.querySelectorAll('[data-naver-scope]').forEach(b=>{b.onclick=()=>{scope=b.dataset.naverScope;draw()}});
  list.querySelector('select').onchange=draw;draw();
  if(location.hash==='#naver-preview')requestAnimationFrame(()=>section.scrollIntoView({block:'start'}));
  if(location.hash==='#power-data-preview')requestAnimationFrame(()=>document.getElementById('power-data-preview')?.scrollIntoView({block:'start'}));
}

export function renderPublicLayout(){
  if(naverPreview||document.documentElement.classList.contains('public-release'))return;
  document.documentElement.classList.add('public-release');simplifyPreview();mountMaterial3();
}
