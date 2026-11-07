// Isolated search display: no AI, ranking, article-body requests or disk storage.
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function decode(s){return s.replace(/&(amp|quot|apos|lt|gt|#39|#\d+|#x[0-9a-f]+);/gi,(raw,key)=>{const named={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>', '#39':"'"};if(Object.hasOwn(named,key))return named[key];const code=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return code>0&&code<=0x10ffff?String.fromCodePoint(code):raw;});}
export function naverMarkup(s){return String(s??'').split(/(<\/?b>)/gi).map(part=>/^<\/?b>$/i.test(part)?part.toLowerCase():escape(decode(part))).join('');}
export function naverLink(s){try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
export function naverResultHTML(result){return (result?.items||[]).map(i=>{
  const original=naverLink(i.originallink)||naverLink(i.link),link=naverLink(i.link);
  return `<article class="news-card naver-result"><h3><a href="${escape(link)}" target="_blank" rel="noopener noreferrer">${naverMarkup(i.title)}</a></h3><p class="naver-passage">${naverMarkup(i.description)}</p><div class="news-source"><a href="${escape(original)}" target="_blank" rel="noopener noreferrer">${escape(new URL(original).hostname)} · 원문 ↗</a><time>${escape(i.pubDate)}</time></div></article>`;
}).join('');}

const searchCache=new Map();
export function permittedSearchFallback(previous,next,now=Date.now()){return next?.status==='ok'?next:previous?.status==='ok'&&Number(previous.expiresAt)>now&&now-Date.parse(previous.checkedAt)>=0&&now-Date.parse(previous.checkedAt)<=3*3600000?{...previous,fallback:true}:next;}
let active=false,configPromise,category='power',selectedRegion='',regionOptions=[],host=null,current=null,controller,sequence=0,lastSlot=-1,retryTimer;
export const naverSearchActive=()=>active;
const labels={power:'전력 전반',local:'우리지역',kepco:'한전'};
const stamp=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
async function configured(){
  if(!configPromise)configPromise=fetch('/api/naver-search/config',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(v=>!!v?.enabled).catch(()=>false);
  return configPromise;
}
export function renderLiveNaverNews(regions=[]){
  if(!active)return;
  const signature=JSON.stringify(regions),changed=signature!==JSON.stringify(regionOptions);regionOptions=[...regions];
  if(!regionOptions.includes(selectedRegion))selectedRegion=regionOptions[0]||'';
  const section=document.getElementById('news');section.classList.add('naver-live');
  section.querySelector('h2').textContent='전력 뉴스';
  for(const selector of ['.feed-filters','.briefing-cadence','.update-line','#pressSearch','#regionalNewsNote','#newsList','#moreNews','#publicNewsCategories']){const e=section.querySelector(selector);if(e)e.hidden=true;}
  if(!host){host=document.createElement('div');host.id='naverLiveSearch';section.append(host);}
  const regionSelect=category==='local'&&regionOptions.length?`<label class="naver-region-label">지역 <select id="naverSearchRegion">${regionOptions.map(r=>`<option value="${escape(r)}"${r===selectedRegion?' selected':''}>${escape(r)}</option>`).join('')}</select></label>`:'';
  host.innerHTML=`<div class="naver-search-controls"><div role="group" aria-label="뉴스 검색 분류">${Object.entries(labels).map(([key,label])=>`<button data-public-scope="${key}" aria-pressed="${category===key}">${label}</button>`).join('')}</div>${regionSelect}</div><p class="naver-search-label">네이버™ 뉴스 검색 <span>최신순 · 5건</span></p><p class="caption naver-query" id="naverQuery"></p><div id="naverResults" aria-live="polite"></div><div class="naver-attribution"><a href="https://www.ncloud.com/product/applicationService/naverApiHub" target="_blank" rel="noopener noreferrer">Powered by NAVER Open API</a><small>네이버™는 NAVER®의 등록상표입니다.</small></div>`;
  host.querySelectorAll('[data-public-scope]').forEach(button=>button.onclick=()=>{category=button.dataset.publicScope;current=null;renderLiveNaverNews(regionOptions);void loadResults();});
  const select=host.querySelector('select');if(select)select.onchange=()=>{selectedRegion=select.value;current=null;renderLiveNaverNews(regionOptions);void loadResults();};
  paint();
  const outage=document.getElementById('outageState');if(outage){outage.textContent='보도 보기 ↗';outage.dataset.resultState='unknown';outage.setAttribute('aria-label','국내 전력공급 장애 보도 보기');}
  const note=document.getElementById('outageNote');if(note)note.textContent='국내 전력공급 장애 보도 · 현재 사고 수와 다름';
  if(changed&&category==='local'){current=null;void loadResults();}
}
function paint(){
  if(!host)return;const results=host.querySelector('#naverResults'),query=host.querySelector('#naverQuery');
  if(category==='local'&&!selectedRegion){query.textContent='';results.innerHTML='<p class="empty-state">관심지역을 설정하면 해당 지역의 전력 뉴스를 검색합니다. 전국 소식은 전력 전반에서 확인하세요.</p>';return;}
  query.textContent=current?.query?`검색어: ${current.query}${current.checkedAt?' · '+stamp(current.checkedAt)+' 확인':''}`:'';
  if(current?.status==='ok'){results.innerHTML=(current.fallback?'<p class="caption">이전 정상 조회 결과 · '+stamp(current.checkedAt)+'</p>':'')+naverResultHTML(current.result)||'<p class="empty-state">검색 결과가 없습니다.</p>';results.setAttribute('aria-busy','false');}
  else {const text=current?.status==='usage_limited'?'오늘의 뉴스 조회 한도에 도달했습니다. 한도 초기화 후 다시 확인할 수 있습니다.':current?.status==='temporarily_unavailable'?'뉴스 검색 연결이 잠시 지연되고 있습니다. 잠시 후 다시 확인해 주세요.':'뉴스 검색결과를 불러오고 있습니다…';results.innerHTML=`<p class="empty-state">${text}</p>`;results.setAttribute('aria-busy',String(!current||current.status==='updating'));}
}
async function loadResults(retry=0){
  clearTimeout(retryTimer);const id=++sequence;controller=new AbortController();
  const key=category+':'+selectedRegion;current=permittedSearchFallback(searchCache.get(key),null);paint();if(category==='local'&&!selectedRegion)return;
  const params=new URLSearchParams({category,...(category==='local'?{region:selectedRegion}:{})});
  try{const r=await fetch('/api/naver-search?'+params,{cache:'no-store',signal:controller.signal});const value=await r.json();if(id!==sequence)return;current=permittedSearchFallback(searchCache.get(key),value);if(value.status==='ok')searchCache.set(key,value);lastSlot=Math.floor(Date.now()/3600000);paint();
    if(value.status==='updating'){if(retry<4)retryTimer=setTimeout(()=>void loadResults(retry+1),Math.min(15,Math.max(2,current.retryAfter||5))*1000);else{current=permittedSearchFallback(searchCache.get(key),{status:'temporarily_unavailable'});paint();}}
  }catch(e){if(id!==sequence||e.name==='AbortError')return;current=permittedSearchFallback(searchCache.get(key),{status:'temporarily_unavailable'});paint();}
}
export async function refreshLiveNaverNews(regions=[],{renderPublicLayout}={}){
  if(!await configured())return false;
  active=true;renderPublicLayout?.();renderLiveNaverNews(regions);await loadResults();
  const banner=document.getElementById('statusBanner');if(banner)banner.hidden=true;
  const updated=document.getElementById('updated');if(updated)updated.textContent=current?.checkedAt?'뉴스 검색 · '+stamp(current.checkedAt):'뉴스 검색';
  return true;
}
export function openNaverOutage(){if(!active)return false;category='outage';current=null;renderLiveNaverNews(regionOptions);void loadResults();document.getElementById('news').scrollIntoView({behavior:'smooth'});return true;}
// No timed or visibility-triggered NAVER collection. Page load, reload and
// explicit category/region choice are the only search triggers.
