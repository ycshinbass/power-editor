import {airMeasurementText} from './air-location.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Remove only a provably redundant leading administrative prefix. Never guess a building.
export function stationLocation(row,group){
 const original=String(row.address||'').trim();if(!original)return '';
 const parts=original.split(/\s+/),canonical=s=>String(s||'').replace(/[시군]$/,'');
 const province=/^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도|전남광주통합특별시)$/;
 const offset=province.test(parts[0])?1:0;
 if(parts[offset]&&canonical(parts[offset])===canonical(group)&&parts.length>offset+1)return parts.slice(offset+1).join(' ');
 // A metropolitan municipality may itself be the group heading.
 if(offset&&canonical(parts[0].replace(/특별자치시$|특별시$|광역시$/,'시'))===canonical(group)&&parts.length>1)return parts.slice(1).join(' ');
 return original;
}
export function airTable(rows,{group='',stamp=String,now=Date.now(),nearby=false}={}){
 const list=rows.slice(0,100),times=list.map(r=>r.referenceAt||''),counts=new Map();for(const t of times)if(t)counts.set(t,(counts.get(t)||0)+1);const common=[...counts].sort((a,b)=>b[1]-a[1])[0],shared=common&&(common[1]>1||list.length===1)?common[0]:null,mixed=!shared||times.some(t=>t!==shared);
 return `<div class="observation-table air-table"><table><caption>PM10 · PM2.5 공통 단위: µg/m³ · 공식 1시간 등급${shared?' · 측정 '+esc(stamp(shared)):''}</caption><thead><tr><th scope="col">측정소 · 장소</th>${mixed?'<th scope="col">'+(shared?'다른 측정시각':'측정시각')+'</th>':''}<th scope="col">PM10</th><th scope="col">PM2.5</th><th scope="col">상태</th></tr></thead><tbody>${list.map(r=>{
 const location=stationLocation(r,group),suffix='('+String(r.station||'').trim()+')',address=location.endsWith(suffix)&&location.length>suffix.length?location.slice(0,-suffix.length).trim():location,state=r.measurementStatus||[r.pm10Flag,r.pm25Flag,(r.pm10==null||r.pm25==null)?'결측 포함':'',r.stale?'자료 지연':''].filter(Boolean).join(' / ')||'정상';
 return `<tr><th scope="row">${esc(r.station)}${nearby?' <small>약 '+Number(r.distanceKm).toFixed(1)+'km</small>':address?'<small>'+esc(address)+'</small>':''}</th>${mixed?shared&&r.referenceAt===shared?'<td aria-label="표 공통 측정시각">—</td>':'<td>'+esc(r.referenceAt?stamp(r.referenceAt):'시각 미제공')+'</td>':''}${['pm10','pm25'].map(k=>'<td>'+esc(airMeasurementText(r,k,now).replace(' µg/m³',''))+'</td>').join('')}<td>${esc(state)}</td></tr>`;
 }).join('')}</tbody></table></div>${list.some(r=>r.address)?`<details class="detail-meta"><summary>측정소 원주소</summary>${list.filter(r=>r.address).map(r=>'<p><b>'+esc(r.station)+'</b> · '+esc(r.address)+'</p>').join('')}</details>`:''}`;
}
export function metadataDisclosure(title,html){return `<details class="detail-meta"><summary>${esc(title)}</summary>${html}</details>`}
