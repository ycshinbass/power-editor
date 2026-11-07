const grace=(row,now)=>row?.fallback&&Number.isFinite(Date.parse(row.fallbackCheckedAt))&&now-Date.parse(row.fallbackCheckedAt)>=0&&now-Date.parse(row.fallbackCheckedAt)<=3*3600000;
// Location is passed by the page in memory only. No storage or network here.
export function validStationCoordinates(s){return s&&Number.isFinite(s.latitude)&&Number.isFinite(s.longitude)&&s.latitude>=32&&s.latitude<=40&&s.longitude>=124&&s.longitude<=132}
export function nearestAirStations(position,candidates){
 if(!position||!Number.isFinite(position.latitude)||!Number.isFinite(position.longitude)||Math.abs(position.latitude)>90||Math.abs(position.longitude)>180)return [];
 const rad=x=>x*Math.PI/180,lat=rad(position.latitude);
 return (Array.isArray(candidates)?candidates:[]).filter(validStationCoordinates).map(s=>{const dlat=rad(s.latitude-position.latitude),dlon=rad(s.longitude-position.longitude),a=Math.sin(dlat/2)**2+Math.cos(lat)*Math.cos(rad(s.latitude))*Math.sin(dlon/2)**2;return {...s,distanceKm:6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)))}}).sort((a,b)=>a.distanceKm-b.distanceKm||a.station.localeCompare(b.station,'ko'));
}

// Use only AirKorea's supplied one-hour grade, never infer CAI or a forecast.
export function airMeasurementText(row,key,now=Date.now()){
 const value=row?.[key],at=Date.parse(row?.referenceAt),grade=row?.[key+'Grade1h'];
 if(row?.missing||!Number.isFinite(value)||value<0||row?.[key+'Flag'])return '측정 미확인';
 const reading=String(value)+' µg/m³';
 if(!grace(row,now)&&(row.stale||!Number.isFinite(at)||now-at>7200000||at>now))return '자료 지연 · '+reading;
 const label=Number.isInteger(grade)&&grade>=1&&grade<=4?['좋음','보통','나쁨','매우 나쁨'][grade-1]:'등급 미확인';
 return label+' · '+reading;
}
export function airStationText(row,now=Date.now(),fallback=false){
 return `${row.station}${fallback?' · 대체':''} · 측정소 기준\n미세먼지 ${airMeasurementText(row,'pm10',now)}\n초미세먼지 ${airMeasurementText(row,'pm25',now)}`;
}

// Presentation only: retain the same official grade and freshness rules as detail text.
export function airStationMarkup(row,now=Date.now(),fallback=false){
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return `<span class="air-station">${escape(row.station)}${fallback?' · 대체':''} · <small>µg/m³</small></span>`+[['pm10','미세먼지'],['pm25','초미세먼지']].map(([key,name])=>{
  const [label,reading]=airMeasurementText(row,key,now).split(' · '),grade=['좋음','보통','나쁨','매우 나쁨'].indexOf(label)+1;
  return `<span class="air-reading"><span class="air-label">${name}</span><span class="air-grade${grade?' air-grade-'+grade:''}">${escape(label)}</span>${reading?`<span class="air-number">${escape(reading.replace(' µg/m³',''))}</span>`:''}</span>`;
 }).join('');
}

// Municipality comes only from attached official station metadata, never GPS inference.
export function airMunicipality(row){
 const parts=String(row?.address||'').trim().split(/\s+/),city=row?.municipality;
 const provinces={'서울특별시':'서울','부산광역시':'부산','대구광역시':'대구','인천광역시':'인천','광주광역시':'광주','대전광역시':'대전','울산광역시':'울산','세종특별자치시':'세종','경기도':'경기','강원도':'강원','강원특별자치도':'강원','충청북도':'충북','충청남도':'충남','전라북도':'전북','전북특별자치도':'전북','전라남도':'전남','전남광주통합특별시':'전남광주','경상북도':'경북','경상남도':'경남','제주특별자치도':'제주'};
 return city&&parts[1]===city&&provinces[parts[0]]?{key:provinces[parts[0]]+'|'+city,label:parts[0]+' '+city,city}:null;
}
export function airReadingQuality(row,now=Date.now()){
 const at=Date.parse(row?.referenceAt),fresh=grace(row,now)||Number.isFinite(at)&&at<=now&&now-at<=7200000&&!row?.stale;
 const usable=key=>fresh&&!row?.missing&&Number.isFinite(row?.[key])&&row[key]>=0&&!row[key+'Flag'];
 const count=Number(usable('pm10'))+Number(usable('pm25'));
 const reason=row?.missing?'측정자료 미연결':!fresh?'측정시각 미확인·지연':row?.pm10Flag||row?.pm25Flag|| (count<2?'일부 측정 미확인':'');
 return {count,reason};
}
export function selectAirStation({position=null,items=[],candidates=[],groups=[],weatherCity='',now=Date.now()}={}){
 const cities=new Set(items.map(r=>airMunicipality(r)?.key).filter(Boolean));
 const ranked=nearestAirStations(position,candidates.filter(r=>cities.has(airMunicipality(r)?.key)||items.some(item=>item.station===r.station&&item.address===r.address)));
 const stable=rows=>[...rows].sort((a,b)=>String(a.station).localeCompare(String(b.station),'ko')||String(a.address).localeCompare(String(b.address),'ko'));
 // Keep the selected region scope. Weather city is preferred only if present in it.
 const group=groups.find(g=>g.region===weatherCity)||groups[0],representatives=group?(group.items||[]):items;
 const preferred=representatives.find(r=>airMunicipality(r)?.city.replace(/[시군]$/,'')===weatherCity);
 const anchor=position?ranked[0]:stable(representatives.filter(r=>airMunicipality(r)?.key===(airMunicipality(preferred||representatives[0])?.key)))[0]||representatives[0];
 if(!anchor)return {row:null,anchor:null,ranked,reason:'연결 측정소 미확인',mode:position?'distance':'representative'};
 const municipality=airMunicipality(anchor),mode=position?'distance':'representative';
 if(position&&anchor.distanceKm>50)return {row:null,anchor,ranked,municipality,mode,reason:'50km 이내 연결 측정소 없음'};
 const same=r=>municipality&&airMunicipality(r)?.key===municipality.key;
 const known=position?ranked.filter(r=>same(r)&&r.distanceKm<=50):stable(items.filter(same));
 const unknown=position?stable(items.filter(r=>same(r)&&!validStationCoordinates(r))):[];
 const pool=[...known,...unknown];
 // Prefer both pollutants from one fresh station; retain a usable partial if none is complete.
 const quality=airReadingQuality(anchor,now);
 const row=quality.count===2?anchor:pool.find(r=>airReadingQuality(r,now).count===2)||(quality.count?anchor:pool.find(r=>airReadingQuality(r,now).count>0))||anchor;
 const fallback=row.station!==anchor.station||row.address!==anchor.address;
 return {row,anchor,ranked,municipality,mode:position&&Number.isFinite(row.distanceKm)?'distance':'representative',fallback,quality:airReadingQuality(row,now),reason:quality.reason};
}
export function airSelectionDetail(selection,stamp=String){
 const {row,anchor,municipality,mode,fallback,quality,reason}=selection;
 if(!row)return reason+' · 다른 시·군 자료로 대체하지 않습니다.';
 const basis=municipality?municipality.label+' 측정소 기준':'측정소 행정구역 미확인 · 대체하지 않음';
 const change=fallback?`${anchor.station}(${reason} · 측정 ${anchor.referenceAt?stamp(anchor.referenceAt):'시각 미확인'}) → ${row.station} 대체 · ${mode==='distance'?'같은 시·군의 다음 유효 측정소':'같은 시·군 대표 측정소 · 거리순 아님'}`:`${row.station} · ${mode==='distance'?'거리순 연결 측정소':'대표 측정소 · 거리순 아님'}`;
 return `${basis}. ${change}. 측정 ${row.referenceAt?stamp(row.referenceAt):'시각 미확인'}${quality?.count<2?' · '+(quality.reason||'일부 측정 미확인'):''}. ${selection.ranked.length?'GPS의 실제 행정구역을 판정한 것은 아닙니다.':''}`;
}
