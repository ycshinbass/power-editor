import {REGION_CATALOG,getRegion,regionMatches,MAX_REGIONS} from './regions.js';
export function validDate(d){return typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d}
export function nearestCity(lat,lon,cities){if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return null;const rad=x=>x*Math.PI/180;let best=null;for(const[name,[a,b]]of Object.entries(cities)){const x=Math.sin(rad(a-lat)/2)**2+Math.cos(rad(lat))*Math.cos(rad(a))*Math.sin(rad(b-lon)/2)**2;const km=6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));if(!best||km<best.km)best={name,km}}return best&&best.km<=200?best:null}
export function validWeather(w){return !!w&&typeof w.city==='string'&&typeof w.checkedAt==='string'&&!Number.isNaN(Date.parse(w.checkedAt))&&Array.isArray(w.days)&&w.days.length>0&&w.days.length<=3&&w.days.every(d=>d&&validDate(d.date)&&['rainMm','gustMs','windMs','snowCm'].every(k=>d[k]===null||typeof d[k]==='number'&&Number.isFinite(d[k])&&d[k]>=0))}

// ponytail: headline heuristics reduce obvious repeats; editorial review handles semantic duplicates.
export function newsTopic(item){
 const title=item.title||'';
 const topics=[['incident',/정전|화재|사고|outage|blackout/i],['storage',/배터리|저장장치|ESS\b|battery|storage/i],['renewables',/태양광|풍력|재생|solar|wind|renewable/i],['demand',/수요|부하|data cent|large load|demand|peak load/i],['policy',/정책|요금|시장|제도|협력|proposal|market|tariff|cooperat/i],['grid',/변전|송전|배전|전력망|grid|transmission|substation/i],['generation',/원전|발전|nuclear|generation/i]];
 return topics.find(([,re])=>re.test(title))?.[0]||item.categoryId||'other';
}
export function isKepcoNews(item){return item.sourceId==='kepco'||/(?:^|[^가-힣A-Za-z0-9_])(?:한국전력(?!기술)|한전(?!KPS|KDN|기술|산업))|\bKEPCO\b(?!\s*(?:KPS|KDN|E&C))/i.test(item.title||'')}
export function freshNews(item,now=Date.now()){const age=now-Date.parse(item.publishedAt);return !item.stale&&item.freshness!=='older'&&Number.isFinite(age)&&age>=-600000&&age<=72*3600000}
export function verifiedNewsRegions(item){const e=item.regionEvidence;return e&&['official_metadata','original_review','publisher_metadata','headline_location'].includes(e.type)&&e.url===item.url&&(/^https:\/\//.test(e.url)||/^http:\/\/www\.gynet\.co\.kr\/news\/articleView\.html\?idxno=\d+$/.test(e.url))&&Array.isArray(e.regions)?e.regions:[]}
export function isRegionalNews(item,regions){return regions.length>0&&verifiedNewsRegions(item).some(tag=>regions.some(selected=>regionMatches(selected,tag)))}
// Candidate visibility can overlap a publisher province; quota evidence stays directional.
export function regionsOverlap(articleRegions,selectedRegions){return selectedRegions.some(selected=>articleRegions.some(tag=>regionMatches(selected,tag)||regionMatches(tag,selected)))}
export function broadRegionalNews(item,regions){return ['publisher_metadata','official_metadata'].includes(item.regionEvidence?.type)&&!isRegionalNews(item,regions)&&regionsOverlap(verifiedNewsRegions(item).filter(tag=>['province','legacy-province'].includes(getRegion(tag)?.kind)),regions)}
export function newsMatchesRegions(item,regions){return item.scope!=='local'||!regions.length||regions.some(selected=>(item.regions||[]).some(tag=>regionMatches(selected,tag)))||broadRegionalNews(item,regions)}
export function newsQuotaNotice(items,regions=[],now=Date.now()){const fresh=items.slice(0,5).filter(i=>freshNews(i,now)),local=fresh.filter(i=>isRegionalNews(i,regions)).length,kepco=fresh.filter(isKepcoNews).length;return [regions.length&&local<2?`관심지역 새 소식 ${local}건 · 제목·발행처의 명확한 지역 근거가 있는 기사 최소 2건 확보 부족`:null,kepco<1?'한전 새 소식 확보 부족 · 연결된 출처에서 확인된 새 기사만 배치':null].filter(Boolean).join(' / ')}
// Explicit headline evidence only; metadata scoring never writes an AI interpretation.
export function newsValue(item){
 const t=item.title||'',global=item.scope==='global',topic=newsTopic(item);
 const power=/전력|전기요금|한전|한국전력|전력거래소|정전(?!협정|협상|선언)|송전|변전|배전|변압기|발전소|원전|계통|HVDC|ESS\b|배터리|저장장치|태양광|해상풍력|electric|\bpower\b|\bgrid\b|transmission|substation|transformer|switchgear|battery storage|energy storage|\bKEPCO\b|\bPJM\b|\bNESO\b|\bERCOT\b/i.test(t);
 const noise=/정전협정|정전협상|정전선언|스포츠|배구|승점|감독|프로리그|축구|야구|종목추천|특징주|목표주가|주가.{0,8}(급등|상승|하락)|주식.{0,5}추천|stock price|share price|stock market|shares (rise|fall|jump)|price target/i.test(t);
 if(!power||noise)return {eligible:false,priority:9,topic,reason:'not_operational'};
 const outage=/정전|송전.{0,8}(고장|사고)|변전.{0,8}(고장|화재)|감전|power outage|blackout|grid emergency|power failure|electricity.{0,10}disrupt/i.test(t);
 const planned=/예정|계획정전|계획 정전|일시.{0,4}정전|planned|scheduled|maintenance|restoration schedule/i.test(t);
 const large=/대정전|대규모.{0,8}(정전|停電)|광역.{0,5}정전|전국.{0,8}정전|수만|수십만|수백만|수천만|millions?|massive|nationwide|countrywide|widespread|grid collapse|grid emergency|major blackout|blackout.{0,12}(Spain|Portugal|Europe)/i.test(t)||/[1-9]\d{2},\d{3}\s*(?:homes|customers|people|households)/i.test(t);
 const hardChange=/착공|준공|가동|상용|실증|개발|출시|설치|교체|정비|증설|확충|확대|연계|건설|도입|승인|시행|개정|의무화|규제|발효|입찰|수주|투입|deploy|commission|construct|build|launch|develop|install|upgrade|expand|approv|mandat|new rule|reform|regulat|record|세계 최초|world.first/i.test(t);
 const scale=/\d+(?:\.\d+)?\s*(?:GW|MW|kV|만\s*kW|억|조|billion)|대규모|초고압|초전도|HVDC|고장전류|친환경.{0,8}(개폐|변압|절연)|SF6|solid.state|world.first|first.ever/i.test(t);
 const promo=/협약|MOU|수상|시상|기부|봉사|캠페인|기념식|사회공헌|홍보|표창|award|donat|volunteer|sponsor|celebrat|partnership|memorandum|exhibition|showcase/i.test(t);
 if(promo&&!(hardChange&&scale))return {eligible:false,priority:8,topic,reason:'promotion_without_change'};
 if(global&&outage&&(!large||planned))return {eligible:false,priority:8,topic,reason:'overseas_routine_outage'};
 const equipment=/변압기|전력기기|개폐기|차단기|HVDC|power transformer|switchgear|circuit breaker/i.test(t);
 const globalUseful=large||hardChange&&(scale||/grid|transmission|substation|transformer|switchgear|electricity|power (demand|supply|capacity)|resource adequacy/i.test(t));
 if(global&&!globalUseful)return {eligible:false,priority:7,topic,reason:'overseas_impact_unclear'};
 let priority=outage?(large&&!planned?0:planned?4:2):equipment&&hardChange?1:/전기요금|전력수급|예비력|전력시장|전력정책|계통안정|수급|tariff|resource adequacy/i.test(t)?1:['grid','supply','demand','policy'].includes(topic)?2:3;
 if(global&&!large)priority+=1;
 return {eligible:true,priority,topic,reason:outage?'supply_incident':equipment?'equipment_change':['grid','supply','demand','policy'].includes(topic)?'system_change':'power_industry'};
}

export function diverseNews(items,regions=[],now=Date.now()){
 const seen=[],unique=items.filter(i=>{const key=String(i.title).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const grams=new Set(Array.from({length:Math.max(0,key.length-1)},(_,n)=>key.slice(n,n+2)));
 const duplicate=seen.some(x=>x.key===key||key.length>15&&JSON.stringify(i.regions||[])===x.regions&&[...grams].filter(g=>x.grams.has(g)).length/Math.max(grams.size,x.grams.size)>.82);
 if(duplicate)return false;seen.push({key,grams,regions:JSON.stringify(i.regions||[])});return true});
 const priority=i=>{const v=newsValue(i);return v.priority+(v.eligible?0:100)};
 const topicSeen=new Set(),firstTopics=[],repeatTopics=[];for(const item of unique){const topic=newsTopic(item);(topicSeen.has(topic)?repeatTopics:firstTopics).push(item);topicSeen.add(topic)}
 const fresh=[...firstTopics,...repeatTopics].filter(i=>freshNews(i,now)).sort((a,b)=>priority(a)-priority(b)||Date.parse(b.publishedAt)-Date.parse(a.publishedAt)),older=unique.filter(i=>!freshNews(i,now));
 const eligible=fresh.filter(i=>newsValue(i).eligible);
 const chosen=[],add=i=>{if(i&&!chosen.includes(i))chosen.push(i)};
 // Local KEPCO can satisfy both quotas; never promote old articles to satisfy either.
 add(eligible.find(i=>isKepcoNews(i)&&isRegionalNews(i,regions))||eligible.find(isKepcoNews));
 const locals=eligible.filter(i=>isRegionalNews(i,regions)),covered=new Set();
 for(const i of chosen)for(const r of regions)if(isRegionalNews(i,[r]))covered.add(r);
 while(chosen.filter(i=>isRegionalNews(i,regions)).length<2){const remaining=locals.filter(i=>!chosen.includes(i));const next=remaining.find(i=>regions.some(r=>!covered.has(r)&&isRegionalNews(i,[r])))||remaining[0];if(!next)break;add(next);for(const r of regions)if(isRegionalNews(next,[r]))covered.add(r)}
 while(chosen.length<5){const remaining=eligible.filter(i=>!chosen.includes(i));if(!remaining.length)break;const tier=priority(remaining[0]),peers=remaining.filter(i=>priority(i)===tier),topics=new Set(chosen.map(newsTopic));const incidentCount=chosen.filter(i=>newsTopic(i)==='incident').length;add(incidentCount>=2&&remaining.find(i=>newsTopic(i)!=='incident')||peers.find(i=>!topics.has(newsTopic(i)))||peers[0])}
 return [...chosen,...fresh.filter(i=>!chosen.includes(i)),...older];
}
// A saved edition is stable only for its confirmed region set; other regions never request more AI.
export function homeNews(items,regions=[],selection=null,now=Date.now()){
 selection=null; // No AI reservation may override current rule-based ranking.
 const ranked=diverseNews(items.filter(i=>newsValue(i).eligible),regions,now),same=selection&&JSON.stringify([...regions].sort())===JSON.stringify([...(selection.regions||[])].sort());
 if(!same)return ranked;
 const first=(selection.articles||[]).map(r=>ranked.find(i=>r.id===i.id&&r.url===i.url&&r.originalTitle===i.title&&r.publishedAt===i.publishedAt)).filter(Boolean);
 return [...first,...ranked.filter(i=>!first.includes(i))];
}
export function newsHasEditorial(item,home,selection){return false&&!!item.editorial&&home.slice(0,5).some(i=>i.id===item.id)&&(!selection||selection.articles?.some(i=>i.id===item.id&&i.url===item.url&&i.originalTitle===item.title&&i.publishedAt===item.publishedAt))}
export function editorPick(item){
 const raw=item.editorial?.selectionReason||item.reason||'';
 const sentences=raw.match(/[^.!?。]+[.!?。]?/g)||[];
 const useful=sentences.map(s=>s.trim()).filter(s=>s&&!/선정(?:했|한|하였|하였습)|선정합니다|제목(?:은|에|이)/.test(s));
 const text=useful.join(' ').replace(/참고할 가치가 있다\.?/g,'').trim()||'전력 분야 주요 변화. 적용 범위와 확정 여부 확인 필요.';
 return text.length>110?text.slice(0,107).trimEnd()+'…':text;
}

export function publicSignalState(s,now=Date.now()){
 const valid=s?.status==='ok'&&Number.isInteger(s.count)&&s.count>=0&&Number.isFinite(Date.parse(s.checkedAt));
 if(!valid)return {kind:'failed',label:'조회 실패 · 자료 없음'};
 const age=now-Date.parse(s.checkedAt);
 if(['weather','fire','landslide'].includes(s.id)&&s.stale&&['provider_fetch_failed','request_failed'].includes(s.reason)&&age>=0&&age<=3*3600000)return {kind:s.count?'present':'empty',fallback:true,label:s.count+'건'};
 if(s.stale||now-Date.parse(s.checkedAt)>=30*60000||Date.parse(s.checkedAt)>now+60000)return {kind:'stale',label:`자료 지연 · 이전 ${s.count}건`};
 return {kind:s.count?'present':'empty',label:s.count?`조회 성공 · 발표 ${s.count}건`:'조회 성공 · 발표 0건'};
}

// KMA separates administrative land zones and offshore marine zones:
// https://www.weather.go.kr/w/forecast/guide/wrn-area.do
// Warning zones are not administrative polygons. Ambiguous subzones stay unknown.
function warningAreaParts(text){
 const parts=[];let depth=0,start=0;
 for(let i=0;i<text.length;i++){if(text[i]==='(')depth++;else if(text[i]===')')depth--;else if(!depth&&/[,·ㆍ.]/.test(text[i])){parts.push(text.slice(start,i).trim());start=i+1}}
 parts.push(text.slice(start).trim());return parts.filter(Boolean);
}
function warningAreaCandidates(text,parent=null){
 const names=r=>[r.id,r.fullName,...(r.aliases||[])];
 const catalog=parent?REGION_CATALOG.filter(r=>regionMatches(parent.id,r.id)):REGION_CATALOG;
 const exact=catalog.filter(r=>names(r).includes(text));
 if(exact.length)return {places:exact,partial:false};
 // Also accept explicit administrative prefixes without parentheses.
 for(const r of catalog)for(const name of names(r))if(text.startsWith(name+' ')){
  const child=warningAreaCandidates(text.slice(name.length).trim(),r);if(child.places.length)return child;
 }
 const subzone=/^(?:북부|남부|중부|동부|서부|북동부?|북서부?|남동부?|남서부?|동북부?|서북부?|동남부?|서남부?|산지|산간|중산간|평지|내륙|해안|도서|동남권|동북권|서남권|서북권|일부)+$/;
 const places=catalog.filter(r=>names(r).some(n=>text.startsWith(n)&&subzone.test(text.slice(n.length).trim())));
 return {places,partial:true};
}
function weatherRegionMatch(region,selected){
 // Keep each province's child list and exclusions together. A parent province is
 // never evidence that all its municipalities belong to an explicit child list.
 const text=String(region||'').trim()
  .replace(/울릉도[.·ㆍ\s]*독도/g,'울릉군').replace(/흑산도[.·ㆍ\s]*홍도/g,'신안군').replace(/거문도[.·ㆍ\s]*초도/g,'여수시')
  .replace(/강원도/g,'강원특별자치도').replace(/전라북도|전북자치도/g,'전북특별자치도').replace(/제주도/g,'제주특별자치도')
  .replace(/영광낙월면/g,'영광군(낙월면)').replace(/인천영종/g,'인천 중구(영종)');
 const related=r=>selected.some(s=>regionMatches(s,r.id)||regionMatches(r.id,s));
 const combine=values=>values.includes(true)?true:values.includes(null)?null:false;
 function match(part,parent=null){
  const parts=warningAreaParts(part);if(parts.length>1)return combine(parts.map(p=>match(p,parent)));
  if(!part)return null;
  const open=part.indexOf('('),head=(open<0?part:part.slice(0,open)).trim(),body=open<0?null:part.endsWith(')')?part.slice(open+1,-1).trim():'';
  // Named island zones from KMA's official warning-area table.
  const islands={'울릉도':['울릉'],'독도':['울릉'],'서해5도':['옹진','강화']};
  if(islands[head.replace(/\s/g,'')])return islands[head.replace(/\s/g,'')].some(id=>related(getRegion(id)));
  if(/먼바다/.test(head))return false;
  if(/앞바다|해상/.test(head))return null;
  if(head==='광주'&&!parent)return null;
  const {places,partial}=warningAreaCandidates(head,parent);
  if(!places.length)return null;
  if(!places.some(related))return false; // Explicit unrelated areas stay outside, even with qualifiers.
  if(places.length!==1||partial)return null;
  const place=places[0];if(body===null)return true;
  if(!body)return null;
  // An exclusion is not a positive location mention. Only exact administrative
  // exclusions can settle coverage; mountain/partial exclusions remain uncertain.
  if(!/[()]/.test(body)&&/제외\s*$/.test(body)){
   const excluded=warningAreaParts(body.replace(/제외\s*$/,'')).map(p=>warningAreaCandidates(p,place));
   if(excluded.some(x=>x.partial||x.places.length!==1))return null;
   const areas=excluded.map(x=>x.places[0]);
   return combine(selected.filter(s=>regionMatches(s,place.id)||regionMatches(place.id,s)).map(s=>
    areas.some(r=>regionMatches(r.id,s))?false:areas.some(r=>regionMatches(s,r.id))?null:true));
  }
  return match(body,place);
 }
 return match(text);
}
// Forest incidents provide a street address, not KMA's parenthesized warning zones.
function fireRegionMatch(address,selected){
 let place=null;
 for(const part of String(address||'').trim().split(/\s+/)){
  const found=warningAreaCandidates(part,place);if(found.partial||found.places.length!==1)break;place=found.places[0];
 }
 if(!place)return null;
 const related=selected.some(s=>regionMatches(s,place.id)||regionMatches(place.id,s));
 return related?/province/.test(place.kind)?null:true:false;
}
function warningPhase(r,now){
 if(/예비/.test(r.level||''))return 'pending';
 if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.effective||''))return 'unknown';
 const t=Date.parse(r.effective.replace(' ','T')+':00+09:00');
 return Number.isFinite(t)?t>now?'pending':'active':'unknown';
}
export function scopedPublicSignal(s,regions=[],now=Date.now()){
 const state=publicSignalState(s,now),scope=regions.length?'관심지역':'전국';
 if(state.kind==='failed')return {...state,scope,label:scope+' 조회 실패',records:[],pendingRecords:[]};
 let count=s.count,records=s.records||[],unknown=false,pendingRecords=[],unknownReason='region',unmappedRecords=[],marineRecords=[],outsideRecords=[],outsidePendingRecords=[];
 if(s.id==='weather'&&count>0){
  if(records.length!==count){unknown=true;records=[];count=null;}
  else {
   const applicable=[];
   for(const r of records){const phase=warningPhase(r,now);if(regions.length&&r.type==='풍랑'){marineRecords.push(r);if(phase==='active')outsideRecords.push(r);else if(phase==='pending')outsidePendingRecords.push(r);continue;}const match=regions.length?weatherRegionMatch(r.region,regions):true;if(match===false){if(phase==='active')outsideRecords.push(r);else if(phase==='pending')outsidePendingRecords.push(r);continue;}
    if(phase==='pending'){if(match===true)pendingRecords.push(r);continue;}
    if(match===null){unknown=true;unmappedRecords.push(r);continue;}
    if(phase==='unknown'){unknown=true;unknownReason='time';continue;}
    applicable.push(r);
   }
   records=applicable;count=records.length;
  }
 }else if(s.id==='fire'&&regions.length&&count>0&&records.length===count){
  const applicable=[];for(const r of records){const match=fireRegionMatch(r.region,regions);if(match===true)applicable.push(r);else if(match===null)unknown=true;}records=applicable;count=records.length;
 }else if(regions.length&&count>0){unknown=true;records=[];count=null;}
 const prefix=state.kind==='stale'?(['provider_fetch_failed','request_failed'].includes(s.reason)?'갱신 실패 · 이전 ':'자료 지연 · 이전 '):'';
 return {...state,scope,count,records,pendingRecords,unmappedRecords,marineRecords,outsideRecords,outsidePendingRecords,unknown,unknownReason,label:unknown?prefix+scope+(unknownReason==='time'?' 발효시각 확인 불가':' 판별 실패'):prefix+scope+' '+count+'건'};
}

const koreaClockFormat=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function koreaClock(now=new Date()){
 const p=Object.fromEntries(koreaClockFormat.formatToParts(now).map(x=>[x.type,x.value]));
 return `${p.year}.${p.month}.${p.day} (${p.weekday}) ${p.hour}:${p.minute}:${p.second}`;
}
export function startKoreaClock(element,doc=document,timers=globalThis,now=()=>new Date()){
 let timer;
 const render=()=>{const date=now();element.textContent=koreaClock(date);element.dateTime=date.toISOString()};
 const resume=()=>{if(timer!==undefined)timers.clearInterval(timer);timer=undefined;if(!doc.hidden){render();timer=timers.setInterval(render,1000)}};
 doc.addEventListener('visibilitychange',resume);resume();
 return ()=>{if(timer!==undefined)timers.clearInterval(timer);doc.removeEventListener('visibilitychange',resume)};
}

export function toggleRegionChoice(choice,name){if(name==='전국')return {regions:[],nationwide:!choice.nationwide};if(!choice.regions.includes(name)&&choice.regions.length>=MAX_REGIONS)return {...choice,regions:[...choice.regions]};const regions=choice.regions.includes(name)?choice.regions.filter(x=>x!==name):[...choice.regions,name];return {regions,nationwide:false}}

// A positive verified count is attention-worthy, not a claim about event severity.
export function publicResultState(label){const count=String(label).match(/^(?:(?:관심지역|전국) )?(\d+)건$/);return count?(Number(count[1])>0?'active':'confirmed'):'unknown'}

// Reuse the bounded central briefing; a report is not an active outage incident.
export function outageNewsState(snapshot,regions=[],{now=Date.now(),loading=false,failed=false}={}){
 const scope=regions.length?regions.join(' · '):'전국';
 const base={scope,items:[],count:null,checkedAt:snapshot?.central?.checkedAt||snapshot?.checkedAt,notice:'기존 수집 언론의 최근 72시간 제목 기준 · 전체 언론·현재 정전 현황이 아닙니다.'};
 if(!snapshot)return {...base,kind:loading?'loading':'failed',label:loading?'보도 확인 중':'보도 확인 전'};
 if(snapshot.selection?.regions&&JSON.stringify([...snapshot.selection.regions].sort())!==JSON.stringify([...regions].sort()))return {...base,kind:loading?'loading':'failed',label:loading?'보도 확인 중':'선택 지역 보도 미확인'};
 const sources=(snapshot.sources||[]).filter(s=>s.kind==='press');
 const usable=sources.filter(s=>['ok','stale'].includes(s.status)&&Number.isFinite(Date.parse(s.checkedAt)));
 if(!usable.length)return {...base,kind:loading?'loading':'failed',label:loading?'보도 확인 중':'보도 확인 실패'};
 const sourceIds=new Set(usable.map(s=>s.id)),seen=new Set();let unmapped=0;
 const items=(snapshot.items||[]).filter(i=>{
  const age=now-Date.parse(i.publishedAt);
  if(i.sourceType!=='press'||!sourceIds.has(i.sourceId)||i.scope==='global'||!Number.isFinite(age)||age< -600000||age>72*3600000||!/정전(?!협정|협상|선언)|단전|전력.{0,8}(?:공급 중단|공급 장애)|power outages?|blackout/i.test(i.title||''))return false;
  if(regions.length&&!isRegionalNews(i,regions)){if(!verifiedNewsRegions(i).length)unmapped++;return false}
  const key=i.url,headline=(i.title||'').replace(/\s+/g,'').toLowerCase();
  if(!key||seen.has(key)||seen.has(headline))return false;seen.add(key);seen.add(headline);return true;
 }).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
 const old=failed||snapshot.stale||snapshot.status==='unavailable'||usable.some(s=>s.stale||s.status==='stale'||now-Date.parse(s.checkedAt)>18*3600000||Date.parse(s.checkedAt)>now+60000)||items.some(i=>i.stale);
 const partial=sources.some(s=>!usable.includes(s));
 const count=items.length,kind=old?'stale':partial?'partial':count?'present':'empty';
 const label=old?(count?`이전 보도 ${count}건 · 갱신 확인 필요`:'이전 자료 · 갱신 확인 필요'):partial?`일부 출처 · 보도 ${count}건`:count?`보도 ${count}건`:'확인된 보도 없음';
 return {...base,kind,label,items,count,unmapped,sources,notice:base.notice+(regions.length?' 지역 근거가 확인된 기사만 포함합니다.':' 국내 범위입니다.')+(unmapped?` 지역 근거 미확인 ${unmapped}건은 지역 집계에서 제외했습니다.`:'')};
}
