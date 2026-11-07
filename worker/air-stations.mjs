import {getRegion} from '../frontend/regions.js';
// Official AirKorea station metadata (15073877). Keep original name/address;
// municipality is a separate derived lookup, never a substitute measurement.
export const AIR_STATION_SOURCE={url:'https://www.data.go.kr/data/15073877/openapi.do',publisher:'한국환경공단 에어코리아',license:'공공누리 제3유형 · 출처표시 · 변경금지'};
export const AIR_STATION_FALLBACK={"status":"ok","complete":false,"checkedAt":"2026-11-02T00:55:56.799809+00:00","source":{"url":"https://www.airkorea.or.kr/web/stationInfo?pMENU_NO=93","publisher":"한국환경공단 에어코리아","license":"공공누리 제3유형 · 출처표시 · 변경금지"},"sourceSha256":"b256c1dcf7408e5d3aa3667a9028f4cb06841351bf94a1737f272abdac9f94e4","items":[{"station":"고흥읍","address":"전남광주통합특별시 고흥군 고흥읍 터미널길 11 고흥읍사무소","province":"전남광주","municipality":"고흥군","latitude":34.6062119,"longitude":127.2805391},{"station":"광양읍","address":"전남광주통합특별시 광양시 광양읍 인덕로 1100(칠성리) 광양읍 2청사 옥상","province":"전남광주","municipality":"광양시","latitude":34.980817,"longitude":127.583116},{"station":"구례읍","address":"전남광주통합특별시 구례군 구례읍 동편제길 30 구례읍 측정소","province":"전남광주","municipality":"구례군","latitude":35.215918,"longitude":127.461282},{"station":"덕충동","address":"전남광주통합특별시 여수시 덕충안길 95 만덕동주민자치센터","province":"전남광주","municipality":"여수시","latitude":34.7539,"longitude":127.7468},{"station":"문수동","address":"전남광주통합특별시 여수시 여문1로 71(문수동) 문수동주민센터 옥상","province":"전남광주","municipality":"여수시","latitude":34.754549,"longitude":127.70276},{"station":"벌교읍","address":"전남광주통합특별시 보성군 벌교읍 체육공원길 35 벌교읍 측정소","province":"전남광주","municipality":"보성군","latitude":34.8419256,"longitude":127.3477777},{"station":"보성읍","address":"전남광주통합특별시 보성군 보성읍 현충로 42-36 원봉3구회관(노인당) 옥상","province":"전남광주","municipality":"보성군","latitude":34.76479,"longitude":127.078068},{"station":"봉강면","address":"전남광주통합특별시 광양시 봉강면 조양길 46 봉강면사무소 옥상","province":"전남광주","municipality":"광양시","latitude":35.0113888889,"longitude":127.5811111111},{"station":"빛가람동","address":"전남광주통합특별시 나주시 빛가람로 719 빛가람동 주민센터 옥상","province":"전남광주","municipality":"나주시","latitude":35.02174,"longitude":126.790413},{"station":"삼일동","address":"전남광주통합특별시 여수시 상암로 601-1 상암보건지소 (상암동)","province":"전남광주","municipality":"여수시","latitude":34.824764,"longitude":127.731615},{"station":"서강동","address":"전남광주통합특별시 여수시 서교1길 28-1 서강동주민자치센터 (서교동)","province":"전남광주","municipality":"여수시","latitude":34.741301,"longitude":127.725967},{"station":"순천만","address":"전남광주통합특별시 순천시 순천만길 513-25(대대동) 순천만 자연생태관 옥상","province":"전남광주","municipality":"순천시","latitude":34.885971,"longitude":127.50903},{"station":"신대","address":"전남광주통합특별시 순천시 해룡면 매안로 162 순천시립신대도서관","province":"전남광주","municipality":"순천시","latitude":34.9363617,"longitude":127.5485334},{"station":"여천동(여수)","address":"전남광주통합특별시 여수시 여천동 681-52 여천동 종합대기측정소","province":"전남광주","municipality":"여수시","latitude":34.766301,"longitude":127.657507},{"station":"연향동","address":"전남광주통합특별시 순천시 연향번영길 54(연향동) 연향도서관 옥상","province":"전남광주","municipality":"순천시","latitude":34.947102,"longitude":127.518575},{"station":"월내동","address":"전남광주통합특별시 여수시 여수산단로 1201(월내동) 여수산단 월내 폐수종말처리장","province":"전남광주","municipality":"여수시","latitude":34.850083,"longitude":127.731933},{"station":"율촌면","address":"전남광주통합특별시 여수시 율촌면 동산개길 2 율촌면 보건지소","province":"전남광주","municipality":"여수시","latitude":34.881925,"longitude":127.578783},{"station":"장천동","address":"전남광주통합특별시 순천시 장명로 30(장천동) 순천시청 별관 옥상","province":"전남광주","municipality":"순천시","latitude":34.950357,"longitude":127.487189},{"station":"중동","address":"전남광주통합특별시 광양시 중마중앙로 109 광양소방서 옥상","province":"전남광주","municipality":"광양시","latitude":34.937342,"longitude":127.693427},{"station":"진월면","address":"전남광주통합특별시 광양시 진월면 선소중앙길 31 진월면사무소 옥상","province":"전남광주","municipality":"광양시","latitude":34.978355,"longitude":127.758004},{"station":"태인동","address":"전남광주통합특별시 광양시 태인길 376(태인동) 태인폐정수장 사무실","province":"전남광주","municipality":"광양시","latitude":34.941868,"longitude":127.757069},{"station":"호두리","address":"전남광주통합특별시 순천시 해룡면 호두리 276-9 호두정수장","province":"전남광주","municipality":"순천시","latitude":34.892081,"longitude":127.572745},{"station":"화양면","address":"전남광주통합특별시 여수시 화양면 평촌길 2-6 화동경로당","province":"전남광주","municipality":"여수시","latitude":34.685678,"longitude":127.597412}],"coordinateSource":{"url":"https://www.airkorea.or.kr/web/mRealAirInfoAjax?itemCode=10008","checkedAt":"2026-11-02T01:14:05.513182+00:00","note":"공식 제공 좌표 · 다른 공식 지도와 위치 차이가 있어 거리는 근사 직선거리"}};
// AirKorea getMsrstnList default WGS84 fields: dmX latitude, dmY longitude.
function officialCoordinates(x){const latitude=Number(x.dmX),longitude=Number(x.dmY);return x.dmX!==null&&x.dmY!==null&&String(x.dmX).trim()&&String(x.dmY).trim()&&Number.isFinite(latitude)&&Number.isFinite(longitude)&&latitude>=32&&latitude<=40&&longitude>=124&&longitude<=132?{latitude,longitude}:{};}
const provinces={서울특별시:'서울',부산광역시:'부산',대구광역시:'대구',인천광역시:'인천',광주광역시:'광주',대전광역시:'대전',울산광역시:'울산',세종특별자치시:'세종',경기도:'경기',강원도:'강원',강원특별자치도:'강원',충청북도:'충북',충청남도:'충남',전라북도:'전북',전북특별자치도:'전북',전라남도:'전남',전남광주통합특별시:'전남광주',경상북도:'경북',경상남도:'경남',제주특별자치도:'제주',제주도:'제주'};
const gwangjuDistricts=new Set(['동구','서구','남구','북구','광산구']);
function addressParts(address){
 const [prefix,municipality,district]=address.trim().split(/\s+/),record=getRegion(prefix);
 const province=provinces[prefix]||(['province','legacy-province'].includes(record?.kind)?record.id:null);
 const valid=province&&/^[가-힣]+[시군구]$/.test(municipality);
 return {province,municipality:valid?municipality:null,fullName:valid?municipality+(/시$/.test(municipality)&&/^[가-힣]+구$/.test(district)?district:''):null};
}
function legacyProvince(meta){return meta.province==='전남광주'?(gwangjuDistricts.has(meta.municipality)?'광주':'전남'):meta.province}
function stationInRegion(record,meta){
 const province=record.province||record.id;
 if(province==='전남광주'){if(legacyProvince(meta)!==(gwangjuDistricts.has(record.fullName)?'광주':'전남'))return false;}
 else if(province!==meta.province)return false;
 return record.kind==='city-group'?record.fullName===meta.municipality:record.fullName===(meta.fullName||meta.municipality);
}
export function parseAirStations(body,now){
 const r=body?.response,b=r?.body,rows=b?.items;
 if(!['00','0'].includes(String(r?.header?.resultCode)))throw Error('provider_error');
 if(!Array.isArray(rows)||!Number.isInteger(Number(b.totalCount))||Number(b.totalCount)!==rows.length||!rows.length||rows.length>1000)throw Error('incomplete_series');
 const items=rows.map(x=>{if(typeof x.stationName!=='string'||!x.stationName.trim()||x.stationName.length>40||typeof x.addr!=='string'||!x.addr.trim()||x.addr.length>300||/[<>\u0000-\u001f]/.test(x.stationName+x.addr))throw Error('invalid_value');return {station:x.stationName,address:x.addr,...officialCoordinates(x),...addressParts(x.addr)}});
 return {status:'ok',items,count:items.length,complete:true,checkedAt:new Date(now).toISOString(),source:AIR_STATION_SOURCE};
}
function provinceMatches(row,meta){return row.region===meta.province||row.region===legacyProvince(meta)||(row.region==='전남광주'&&['전남','광주'].includes(meta.province))}
function rowStatus(r){return r.missing?'측정자료 미연결':[r.pm10Flag,r.pm25Flag,(r.pm10===null||r.pm25===null)?'결측 포함':null,r.stale?'자료 지연':null].filter(Boolean).join(' · ')||'정상'}
export function scopeAirQuality(data,wanted,metadata,now){
 if(!Array.isArray(data.items))return data;
 const scope=[...new Set(wanted)],liveMetadataValid=metadata?.status==='ok'&&metadata.complete===true&&Array.isArray(metadata.items)&&now-Date.parse(metadata.checkedAt)<7*86400000;
 const selectedMetadata=liveMetadataValid?metadata:now-Date.parse(AIR_STATION_FALLBACK.checkedAt)<30*86400000?AIR_STATION_FALLBACK:null;
 const metaValid=!!selectedMetadata,complete=selectedMetadata?.complete===true;
 const metaRows=(selectedMetadata?.items||[]).map(m=>({...m,...addressParts(m.address)})),byName=new Map();for(const m of metaRows){const list=byName.get(m.station)||[];list.push(m);byName.set(m.station,list)}
 const rows=data.items.map(r=>{const matches=(byName.get(r.station)||[]).filter(m=>provinceMatches(r,m));const m=matches.length===1?matches[0]:null;const item={...r,stale:!r.referenceAt||now-Date.parse(r.referenceAt)>7200000,...(m?{address:m.address,municipality:m.municipality,...(Number.isFinite(m.latitude)&&Number.isFinite(m.longitude)?{latitude:m.latitude,longitude:m.longitude}:{})}:{})};return {...item,measurementStatus:rowStatus(item)}});
 // Build exact-match indexes once; keep arrays to reject ambiguous duplicates.
 const rowsByStation=new Map();
 const append=(index,key,value)=>{const list=index.get(key)||[];list.push(value);index.set(key,list)};
 const stationKey=r=>JSON.stringify([r.station,r.address]);
 for(const row of rows)append(rowsByStation,stationKey(row),row);
 const nearestCandidates=metaRows.filter(m=>Number.isFinite(m.latitude)&&Number.isFinite(m.longitude)).map(m=>{const matches=(rowsByStation.get(stationKey(m))||[]);return matches.length===1?matches[0]:{station:m.station,address:m.address,municipality:m.municipality,latitude:m.latitude,longitude:m.longitude,referenceAt:null,pm10:null,pm25:null,missing:true,measurementStatus:matches.length?'측정소 중복 확인 필요':'측정자료 미연결'}});
 const group=region=>{
  const record=getRegion(region);
  if(!record)return {region,status:'region_unmatched',items:[],stationCount:null,receivedCount:0};
  if(record.kind==='province'||['전남','광주'].includes(record.id)){
   const ids=record.id==='전남광주'?['전남광주','전남','광주']:[record.id];
   const items=rows.filter(r=>ids.includes(r.region)||(r.region==='전남광주'&&r.address&&legacyProvince(addressParts(r.address))===record.id));
   return {region,status:items.length?'ok':'data_missing',items,stationCount:null,receivedCount:items.length};
  }
  if(!metaValid)return {region,status:'metadata_unavailable',items:[],stationCount:null,receivedCount:0};
  const stations=metaRows.filter(m=>stationInRegion(record,m));
  // A complete current official station list can prove only absence in that list.
  if(!stations.length)return {region,status:complete?'no_station':'metadata_unavailable',items:[],stationCount:complete?0:null,receivedCount:0};
  const items=stations.map(m=>{const match=(rowsByStation.get(stationKey(m))||[]);if(match.length===1)return match[0];return {station:m.station,address:m.address,municipality:m.municipality,region,referenceAt:null,pm10:null,pm25:null,pm10Flag:null,pm25Flag:null,stale:true,missing:true,measurementStatus:match.length?'측정소 중복 확인 필요':'측정자료 미연결'}});
  const receivedCount=items.filter(r=>!r.missing).length;return {region,status:receivedCount?(complete?'ok':'partial'):'data_missing',items,stationCount:stations.length,receivedCount};
 };
 const groups=scope.length?scope.map(group):[{region:'전국',status:rows.length?'ok':'data_missing',items:rows,stationCount:null,receivedCount:rows.length}];
 const unique=new Map();for(const g of groups)for(const r of g.items)unique.set([r.region,r.station,r.address||''].join('|'),r);
 const items=[...unique.values()],unmatchedRegions=groups.filter(g=>['region_unmatched','metadata_unavailable'].includes(g.status)).map(g=>g.region);
 const hasProblem=groups.some(g=>g.status!=='ok'),hasValues=items.some(r=>!r.missing);
 return {...data,items,count:items.length,groups,nearestCandidates,coordinateCoverage:complete&&nearestCandidates.length===metaRows.length?'complete':'partial',status:hasProblem?(hasValues?'partial':'unavailable'):data.status,reason:unmatchedRegions.length?(groups.some(g=>g.status==='metadata_unavailable')?'station_metadata_unavailable':'region_unmatched'):groups.some(g=>g.status==='data_missing')?'station_data_missing':groups.some(g=>g.status==='no_station')?'no_station':data.reason,unmatchedRegions,missingCount:items.filter(r=>r.pm10===null||r.pm25===null).length,stale:!!data.stale||items.length>0&&items.every(r=>r.stale),stationMetadata:{status:metaValid?'ok':'unavailable',coverage:complete?'complete':'partial',mode:liveMetadataValid?'official_api':'verified_public_list',checkedAt:selectedMetadata?.checkedAt||null,source:selectedMetadata?.source||AIR_STATION_SOURCE,coordinateSource:selectedMetadata?.coordinateSource||null,stale:liveMetadataValid&&!!metadata.stale,reason:metadata?.reason||(!metaValid?'metadata_unavailable':null)},notice:'측정소별 잠정값이며 지역 평균이 아닙니다. 공식 측정소 주소로 시·군을 연결하며 점검·결측·미수신은 구분합니다.'};
}
