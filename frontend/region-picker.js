import {REGION_CATALOG,getRegion,MAX_REGIONS} from './regions.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function regionLabel(id){return getRegion(id)?.label||id}
export function regionPickerHTML({regions=[],nationwide=false,query='',openGroups=[]}={}){
 const terms=query.trim().split(/\s+/).filter(Boolean),selected=new Set(regions);
 const matches=r=>terms.every(q=>[r.id,r.label,r.province,r.provinceFull,...(r.aliases||[])].join(' ').includes(q));
 const chip=(r,label=r.label)=>`<button type="button" class="chip" data-region="${esc(r.id)}" aria-pressed="${selected.has(r.id)}" ${!selected.has(r.id)&&regions.length>=MAX_REGIONS?'disabled':''}>${esc(label)}</button>`;
 const groups=new Map();
 for(const r of REGION_CATALOG){const key=r.province||r.id;if(!groups.has(key))groups.set(key,[]);if(matches(r))groups.get(key).push(r)}
 const visible=[...groups].filter(([,rows])=>rows.length);
 return `<div class="region-selection"><button type="button" class="chip" data-region="전국" aria-pressed="${nationwide}">전국</button><p class="caption" role="status">${nationwide?'전국 선택':`선택 ${regions.length} / ${MAX_REGIONS}곳`}${regions.length>=MAX_REGIONS?' · 다른 지역을 고르려면 먼저 선택을 해제해 주세요.':''}</p>${regions.length?'<div class="chips region-selected" aria-label="현재 선택 · 누르면 해제">'+regions.map(id=>chip(getRegion(id)||{id,label:id},regionLabel(id)+' ×')).join('')+'</div>':''}</div><p class="caption">${terms.length?`검색 결과 ${visible.reduce((n,[,rows])=>n+rows.length,0)}개`:'시·도를 펼쳐 시·군·구를 선택하세요. 광역 전체도 선택할 수 있습니다.'}</p><div class="region-groups">${visible.map(([province,rows])=>`<details class="region-group" data-province="${esc(province)}" ${terms.length||openGroups.includes(province)?'open':''}><summary>${esc(regionLabel(province))}<span>${rows.length}개</span></summary><div class="chips">${rows.map(r=>chip(r,r.kind==='province'?r.label+' 전체':r.label)).join('')}</div></details>`).join('')||'<p class="region-no-results">검색한 지역이 없습니다. 시·군·구 이름 또는 시·도 이름으로 다시 검색해 주세요.</p>'}</div>`;
}
