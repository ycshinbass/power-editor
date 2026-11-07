import {validDate} from './logic.js';
import {upcomingEvents,seoulDate,validOfficialEvent} from './events.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function annualPlans({registry,calendar,includeCommemorations=false,plans=[],year,now=Date.now()}={}){
 const day=seoulDate(now),currentYear=Number(day.slice(0,4));
 year=Number.isInteger(year)&&year>=1&&year<=9999?year:currentYear;
 const prefix=String(year).padStart(4,'0'),start=prefix+'-01-01',end=prefix+'-12-31';
 const api=groupCalendarEvents(calendarEvents(calendar,year,now).filter(e=>includeCommemorations||e.type!=='commemoration'||e.isHoliday));
 const archive=(Array.isArray(registry?.events)?registry.events:[]).filter(e=>validOfficialEvent(e,now)&&e.endDate<day).map(e=>({...e,daysUntil:0,needsReview:true}));
 const official=[...upcomingEvents(registry,now),...archive,...api].filter(e=>e.startDate<=end&&e.endDate>=start).sort((a,b)=>a.startDate.localeCompare(b.startDate));
 const personal=plans.filter(p=>p&&typeof p.id==='string'&&typeof p.title==='string'&&validDate(p.date)&&p.date>=start&&p.date<=end).slice().sort((a,b)=>a.date.localeCompare(b.date));
 const months=Array.from({length:12},(_,index)=>{const month=index+1,key=prefix+'-'+String(month).padStart(2,'0'),next=month===12?String(year+1).padStart(4,'0')+'-01-01':prefix+'-'+String(month+1).padStart(2,'0')+'-01';return {month,current:day.startsWith(key),official:official.filter(e=>e.startDate<next&&e.endDate>=key+'-01'),personal:personal.filter(p=>p.date.startsWith(key))}});
 return {year,day,currentYear,currentMonth:Number(day.slice(5,7)),official,personal,months,upcoming:official.filter(e=>e.status!=='cancelled'&&e.endDate>=day).length+personal.filter(p=>!p.done&&!p.cancelled&&p.date>=day).length};
}
export function annualGridHTML(model,selectedMonth){return model.months.map(m=>{
 const names=m.official.map(e=>`<span class="month-event${e.endDate<model.day?' ended':''}"><time>${esc(eventDateLabel(e))}</time><span>${esc(e.title)}</span><small>${eventPhase(e,model.day)}</small></span>`).join('');
 return `<button type="button" class="month-tile${m.current?' current-month':''}" data-plan-month="${m.month}" aria-label="${m.month}월 · 전국 ${m.official.length}건 · 개인 ${m.personal.length}건" aria-pressed="${m.month===selectedMonth}"><strong>${m.month}월${m.current?'<small>이번 달</small>':''}</strong><span class="month-events">${names||'<span class="month-empty">표시할 전국 일정 없음</span>'}${m.personal.length?`<small>개인 ${m.personal.length}건</small>`:''}</span><span aria-hidden="true">›</span></button>`;
}).join('')}
function eventPhase(e,day=seoulDate()){return e.status==='cancelled'?'취소':e.endDate<day?'종료':e.startDate<=day?'진행 중':'예정'}
export function officialPlanHTML(events,{stale=false,stamp=s=>s,day=seoulDate()}={}){return events.length?events.map(e=>`<article class="annual-item${e.status==='cancelled'?' plan-cancelled':''}"><span class="plan-date">${esc(e.typeLabel||'전국 공식')} · ${esc(eventDateLabel(e))} · ${eventPhase(e,day)}</span><h3>${esc(e.title)}</h3>${e.needsReview?'<p class="plan-warning">원문 재확인 권장</p>':''}${(e.api?e.stale:stale)?'<p class="plan-warning">저장본 · 최신 변경 미확인</p>':''}<details><summary>${e.members?(e.typeLabel==='선거'?'같은 날 선거 종류':'세부 날짜')+' · 출처':e.api?'공식 출처':'준비사항 · 출처'}</summary>${e.members?e.members.map(item=>`<p><b>${esc(item.title)}</b> · ${esc(item.startDate)}<br><a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(item.sourcePublisher||'공식')} 원문 ↗</a> · 확인 ${esc(stamp(item.checkedAt))}${item.stale?' · 저장본':''}</p>`).join(''):''}${e.editorReason?`<p>${esc(e.editorReason)}</p>`:''}${e.factualNote?`<p>${esc(e.factualNote)}</p>`:''}<p class="caption">${esc(e.statusLabel)} · 확인 ${esc(stamp(e.checkedAt))}</p><a href="${esc(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(e.sourcePublisher||'공식')} 원문 ↗</a></details></article>`).join(''):'<p class="empty-state">표시할 등록 일정 없음 · 수집 상태는 위 안내 참고</p>'}
const calendarTypes={national_holiday:'국경일',public_holiday:'공휴일',commemoration:'기념일',election:'선거'};
function calendarTypeLabel(e){return e.type==='election'?'선거':['삼일절','3·1절','제헌절','광복절','개천절','한글날'].includes(e.title)?'국경일':e.isHoliday?'공휴일':e.type==='commemoration'?'기념일':'공식 일정'}
export function eventDateLabel(e){return e.startDate.slice(5)+(e.endDate===e.startDate?'':' ~ '+(e.endDate.slice(0,7)===e.startDate.slice(0,7)?e.endDate.slice(8):e.endDate.slice(5)))}
// Display groups only: original API rows, names and provenance remain in members.
export function groupCalendarEvents(events){
 const result=[],elections=new Map(),ranges=new Map();
 const electionDates=new Set(events.filter(e=>e.source==='nec'&&e.type==='election').map(e=>e.startDate));
 for(const e of [...events].sort((a,b)=>a.startDate.localeCompare(b.startDate))){
  const election=e.source==='nec'&&e.type==='election'||e.source==='kasi'&&e.isHoliday&&/선거$/.test(e.title)&&electionDates.has(e.startDate);
  if(election){let group=elections.get(e.startDate);if(!group){group={...e,members:[e],typeLabel:'선거'};elections.set(e.startDate,group);result.push(group)}else{group.members.push(e);group.stale ||= e.stale;group.isHoliday ||= e.isHoliday}continue}
  const key=e.source+'|'+e.title,prior=ranges.get(key);
  if(e.source==='kasi'&&e.isHoliday){if(prior&&Date.parse(e.startDate)-Date.parse(prior.endDate)===86400000){prior.members ||= [{...prior}];prior.members.push(e);prior.endDate=e.endDate;prior.stale ||= e.stale;continue}const group={...e};ranges.set(key,group);result.push(group)}else result.push(e);
 }
 for(const group of elections.values()){if(group.members.length>1){const named=group.members.find(e=>e.source==='nec'&&/^제\d+회 전국동시지방선거$/.test(e.title));group.title=named?named.title+' 등':Number(group.startDate.slice(5,7))+'월 '+Number(group.startDate.slice(8))+'일 선거'}else delete group.members}
 return result;
}
function calendarURL(value,source){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(source==='kasi'?/(^|\.)kasi\.re\.kr$/.test(u.hostname)||u.hostname==='www.data.go.kr':source==='nec'?/(^|\.)nec\.go\.kr$/.test(u.hostname)||u.hostname==='www.data.go.kr':false)}catch{return false}}
export function calendarEvents(calendar,year,now=Date.now()){
 if(calendar?.year!==year||!Array.isArray(calendar.items))return [];
 const merged=new Map();
 for(const e of calendar.items){if(!e||!validDate(e.date)||Number(e.date.slice(0,4))!==year||typeof e.title!=='string'||!e.title.trim()||!calendarTypes[e.type]||!calendarURL(e.sourceUrl,e.source)||!Number.isFinite(Date.parse(e.checkedAt))||Date.parse(e.checkedAt)>now+600000)continue;
 const key=e.source+'|'+e.date+'|'+e.title;const prior=merged.get(key);if(prior){prior.isHoliday ||= e.isHoliday===true;continue}
 const source=calendar.sources?.find(s=>s.id===e.sourceId)||calendar.sources?.find(s=>s.id===(e.source==='nec'?'nec-elections':e.type==='commemoration'?'kasi-anniversaries':e.type==='national_holiday'?'kasi-holidays':'kasi-rest'));
 merged.set(key,{...e,api:true,startDate:e.date,endDate:e.date,sourcePublisher:e.publisher,typeLabel:calendarTypeLabel(e),statusLabel:'공식 API',stale:source?.status==='stale'||calendar.sources?.some(s=>e.sourceIds?.includes(s.id)&&s.status==='stale'),daysUntil:Math.max(0,Math.round((Date.parse(e.date)-Date.parse(seoulDate(now)))/86400000))});
 }return [...merged.values()];
}
export function calendarStatus(calendar,{loading=false,error=false,outOfRange=false}={}){
 if(outOfRange)return '공식 API는 올해 전후 1년 지원 · 개인 일정과 등록 자료만 표시';
 if(loading)return '공식 일정 불러오는 중… · 등록 자료는 계속 표시';
 if(error)return '공식 일정 조회 실패 · 불러온 자료만 표시, 일정이 없다는 뜻이 아닙니다';
 if(!calendar)return '공식 일정 조회 전';
 const names={'kasi-holidays':'특일','kasi-rest':'공휴일','kasi-anniversaries':'기념일','nec-elections':'선거'};
 return (calendar.sources||[]).map(s=>`${names[s.id]||s.publisher||'공식'} ${s.status==='ok'?(Number.isFinite(Date.parse(s.checkedAt))?'확인':'확인 시점 미확인'):s.status==='stale'?'저장본 · 최신 변경 미확인':/APPROV|AUTH|KEY|ACCESS|DENIED|SERVICE/i.test(s.failureCode||'')?'승인 필요':'조회 실패'}`).join(' · ')||'수집 상태 미확인';
}
// One request per year per visit; independent slots prevent a slow prior year replacing the selected year.
export function calendarLoader(fetcher=fetch){const slots=new Map();return year=>{if(slots.has(year))return slots.get(year);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);const promise=(async()=>{try{const response=await fetcher('/api/calendar?year='+year,{signal:controller.signal});if(!response.ok)throw Error('calendar unavailable');const data=await response.json();if(data?.year!==year||!Array.isArray(data.items)||!Array.isArray(data.sources))throw Error('invalid calendar');return data}finally{clearTimeout(timer)}})();slots.set(year,promise);return promise}}
export function personalPlanHTML(plans){return plans.length?plans.map(p=>`<article class="annual-item${p.done?' plan-done':p.cancelled?' plan-cancelled':''}"><span class="plan-date">개인 · ${esc(p.date.slice(5))}${p.cancelled?' · 취소':p.done?' · 완료':''}</span><h3>${esc(p.title)}</h3>${p.note?`<details><summary>메모</summary><p>${esc(p.note)}</p></details>`:''}<div class="plan-actions"><button data-plan-toggle="${esc(p.id)}">${p.done?'완료 해제':'완료'}</button><button data-plan-cancel="${esc(p.id)}">${p.cancelled?'일정 복원':'일정 취소'}</button><button data-plan-edit="${esc(p.id)}">수정</button><button class="delete" data-plan-delete="${esc(p.id)}">삭제</button></div></article>`).join(''):'<p class="empty-state">이 달 개인 계획 없음</p>'}
