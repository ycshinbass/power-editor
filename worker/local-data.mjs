import {forecastBase,parseForecast,alignForecast,fillMorningExtremes} from './kma-forecast.mjs';
import {REGION_POINTS,normalizeRegions} from '../frontend/regions.js';
import {createD1SnapshotStore} from './snapshot-d1.mjs';
import {parseAirStations,scopeAirQuality} from './air-stations.mjs';
/** Credential-ready, fail-closed connectors. No credentials, provider bodies or URLs
 * containing credentials are returned or logged. A key alone never validates units. */
export const POWER_ENDPOINTS={supply:'https://apis.data.go.kr/B552115/sukub5mMaxDatetime2/getSukub5mMaxDatetime2',generation:'https://apis.data.go.kr/B552115/PwrAmountByGen/getPwrAmountByGen'};
const LOCAL_ENDPOINTS={weatherForecast:'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst',airStationMetadata:'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList',weather:'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst',airQuality:'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty',weatherWarning:'https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList',earthquake:'https://apihub.kma.go.kr/api/typ01/url/eqk_now.php'};
const DAY=86400000, MAX_BYTES=1500000;
const response=data=>Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
export function koreaDay(now){return new Date(now+9*3600000).toISOString().slice(0,10)}
function missing(source,reason='credentials_missing',extra={}){return {status:'not_connected',reason,source,...extra}}
function measured(value,min,max){if(value===null||value===undefined||value===''||value==='-'||typeof value==='boolean')return null;const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:null}
function airGrade(value){return /^[1-4]$/.test(String(value))?Number(value):null}
function textValue(value,max=100){if(typeof value!=='string'||value.length>max||/[<>\u0000-\u001f]/.test(value))throw Error('invalid_value');return value}
export function parseObservation(body,grid,now){
 const rows=kpxItems(body);if(!rows.length)throw Error('data_missing');const seen=new Set();let referenceAt=null;const values={};
 for(const r of rows){if(Number(r.nx)!==grid.nx||Number(r.ny)!==grid.ny||seen.has(r.category))throw Error('invalid_series');seen.add(r.category);const at=parseKpxTime(String(r.baseDate)+String(r.baseTime).padStart(4,'0'),now);if(referenceAt&&referenceAt!==at)throw Error('invalid_series');referenceAt=at;values[r.category]=r.obsrValue}
 const temperature=measured(values.T1H,-60,60),humidity=measured(values.REH,0,100),windSpeed=measured(values.WSD,0,150),rainfall=measured(values.RN1,0,1000),precipitationType=[0,1,2,3,5,6,7].includes(measured(values.PTY,0,7))?Number(values.PTY):null;
 if([temperature,humidity,windSpeed,rainfall].every(x=>x===null))throw Error('data_missing');
 return {status:'ok',referenceAt,temperature,humidity,windSpeed,rainfall,precipitationType,units:{temperature:'℃',humidity:'%',windSpeed:'m/s',rainfall:'mm'},grid,scope:'representative_grid',stale:now-Date.parse(referenceAt)>7200000};
}
export function parseAirTime(value,now){
 const t=String(value??'');const m=t.match(/^(\d{4}-\d{2}-\d{2}) 24:00$/);
 if(m){const start=parseKpxTime(m[1]+'T00:00:00+09:00',now),next=Date.parse(start)+86400000;if(next>now+300000)throw Error('invalid_timestamp');return new Date(next).toISOString();}
 return parseKpxTime(t.replace(' ','T')+':00+09:00',now);
}
export function parseAirQuality(body,now){
 const rows=kpxItems(body);const items=rows.map(r=>{
  let referenceAt=null;try{referenceAt=parseAirTime(r.dataTime,now)}catch{}
  return {station:textValue(r.stationName,40),region:textValue(r.sidoName,30),referenceAt,pm10:!referenceAt||r.pm10Flag?null:measured(r.pm10Value,0,10000),pm25:!referenceAt||r.pm25Flag?null:measured(r.pm25Value,0,10000),pm10Grade1h:!referenceAt||r.pm10Flag?null:airGrade(r.pm10Grade1h),pm25Grade1h:!referenceAt||r.pm25Flag?null:airGrade(r.pm25Grade1h),pm10Flag:r.pm10Flag?textValue(r.pm10Flag,30):null,pm25Flag:r.pm25Flag?textValue(r.pm25Flag,30):null,stale:!referenceAt||now-Date.parse(referenceAt)>7200000};
 });return {status:'ok',items,count:items.length,unit:'µg/m³',scope:'stations',notice:'측정소별 실시간 잠정값입니다. 지역 평균이 아니며 점검·결측값은 빈칸으로 표시합니다.'};
}
export function parseEarthquake(raw,now){
 const lines=raw.split(/\r?\n/).filter(x=>x.trim()&&!x.trim().startsWith('#'));
 const rows=lines.filter(x=>/^\s*[23]\s*\|/.test(x));if(!rows.length)throw Error('data_missing');
 const items=rows.map(line=>{const p=line.split('|').map(x=>x.trim());if(p.length<11)throw Error('invalid_series');const occurred=p[3].split('.')[0];const magnitude=measured(p[4],0,10),latitude=measured(p[5],-90,90),longitude=measured(p[6],-180,180);if([magnitude,latitude,longitude].includes(null))throw Error('invalid_value');return {type:p[0]==='3'?'domestic':'overseas',publishedAt:parseKpxTime(p[1],now),occurredAt:parseKpxTime(occurred,now),magnitude,latitude,longitude,location:textValue(p[7],200)};});
 return {status:'ok',items,count:items.length,scope:'latest_announcement',notice:'국내·외 최근 발표 정보입니다. 현재 발생 건수나 관심지역의 피해·진도 판정이 아닙니다.'};
}
async function collectLocal(state,request,env,options){
 const now=options.now??Date.now(),query=new URL(request.url).searchParams,city=query.get('city'),grid=Object.hasOwn(OBSERVATION_GRIDS,city)?OBSERVATION_GRIDS[city]:null,fetchFn=options.fetchFn??fetch;
 let store;try{store=options.store??(env.DB?createD1SnapshotStore(env.DB):null)}catch{store=null}
 const call=async(kind,params={})=>{const u=new URL(LOCAL_ENDPOINTS[kind]);u.searchParams.set(kind==='earthquake'?'authKey':'serviceKey',kind==='earthquake'?env.KMA_API_HUB_KEY:env.PUBLIC_DATA_SERVICE_KEY);for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);let r;try{r=await fetchFn(u.href,{redirect:'manual',signal:AbortSignal.timeout(kind==='airQuality'?8000:10000)})}catch(error){if(['TimeoutError','AbortError'].includes(error.name))throw error;throw Error('provider_network_error')}return kind==='earthquake'?new TextDecoder('euc-kr').decode(await safeBody(r)):safeJson(r)};
 const job=async(kind,cache,fn,cost=1)=>{try{const d=await boundedProvider(store,cache,now,cost,fn,{waitUntil:options.waitUntil,diagnostics:kind==='administrativeMap'});state[kind]={...state[kind],...d,reason:d.reason??null,checkedAt:d.checkedAt??new Date(now).toISOString()}}catch{state[kind]={...state[kind],status:'unavailable',reason:'shared_storage_failure'}}};
 const selected=options.parts, wants=kind=>!selected||selected.has(kind);
 const tasks=[];let airStationMetadata=null;
 if(env.PUBLIC_DATA_SERVICE_KEY){
  if(wants('weatherForecast')&&grid)tasks.push(job('weatherForecast',`weatherForecast:${grid.nx}:${grid.ny}:hourly-v2`,async()=>{
   const base=forecastBase(now),params={dataType:'JSON',pageNo:'1',numOfRows:'2000',nx:grid.nx,ny:grid.ny};
   const latest={...parseForecast(await call('weatherForecast',{...params,...base}),grid,now,base),city},today=latest.days[0];
   if(!store||(today.temperatureMin!==null&&today.temperatureMax!==null)||base.base_date!==koreaDay(now).replaceAll('-','')||Number(base.base_time)<=200)return latest;
   const key='forecast:morning:'+base.base_date+':'+grid.nx+':'+grid.ny;
   try{const old=await store.read(key);let morning=old.value?.data;
    if(!morning&&!(old.value?.retryAt>now)&&(old.value?.attempts||0)<3){const attempts=(old.value?.attempts||0)+1,claim=await store.compareAndSwap(key,old.version,{attempts,retryAt:now+60000,data:null});if(claim.applied){try{const earlyBase={base_date:base.base_date,base_time:'0200'};morning=parseForecast(await call('weatherForecast',{...params,...earlyBase}),grid,now,earlyBase);await store.compareAndSwap(key,claim.version,{attempts,data:morning});}catch{await store.compareAndSwap(key,claim.version,{attempts,retryAt:now+60000,data:null});}}}
    return fillMorningExtremes(latest,morning);
   }catch{return latest;}
  },2));
  else if(wants('weatherForecast'))state.weatherForecast={...state.weatherForecast,status:'unavailable',reason:city?'region_unmatched':'region_selection_required'};
  if(wants('weather')&&grid)tasks.push(job('weather',`weather:${grid.nx}:${grid.ny}`,async()=>{const t=new Date(now+9*3600000-40*60000);return {...parseObservation(await call('weather',{dataType:'JSON',pageNo:'1',numOfRows:'100',base_date:t.toISOString().slice(0,10).replaceAll('-',''),base_time:t.toISOString().slice(11,13)+'00',nx:grid.nx,ny:grid.ny}),grid,now),city,checkedAt:new Date(now).toISOString(),notice:'기상청 공식 격자표의 선택지역 대표격자 실황입니다. 지역 전체의 관측값은 아닙니다.'}}));
  else state.weather={...state.weather,status:'unavailable',reason:city?'region_unmatched':'region_selection_required',notice:'기상 지점을 선택해 주세요. 최신 공식 격자표와 일치하지 않는 지역은 임의 연결하지 않습니다.'};
  if(wants('airQuality'))tasks.push(job('airQuality','airQuality:time-v2',async()=>{const data=parseAirQuality(await call('airQuality',{returnType:'json',pageNo:'1',numOfRows:'1000',sidoName:'전국',ver:'1.3'}),now);if(data.items.length&&data.items.every(r=>!r.referenceAt))throw Error('invalid_timestamp');return {...data,checkedAt:new Date(now).toISOString()}}));
  if(wants('airQuality'))tasks.push((async()=>{try{airStationMetadata=await boundedProvider(store,'airStationMetadata',now,1,async()=>parseAirStations(await call('airStationMetadata',{returnType:'json',pageNo:'1',numOfRows:'1000'}),now),{waitUntil:options.waitUntil})}catch{airStationMetadata={status:'unavailable',reason:'shared_storage_failure'}}})());
  state.weatherWarning={source:'기상청 기상특보 발표목록',kind:'announcements'};
  if(wants('weatherWarning'))tasks.push(job('weatherWarning','weatherWarning',async()=>{const date=koreaDay(now).replaceAll('-','');const rows=kpxItems(await call('weatherWarning',{dataType:'JSON',pageNo:'1',numOfRows:'1000',fromTmFc:date,toTmFc:date}));return {status:'ok',items:rows.map(r=>({publishedAt:parseKpxTime(r.tmFc,now),stationCode:String(r.stnId),title:textValue(r.title,300)})),count:rows.length,checkedAt:new Date(now).toISOString(),notice:'오늘 발표된 특보 목록입니다. 해제 발표를 포함하므로 현재 발효 특보 수로 해석하지 않습니다.'}}));
 }
 if(wants('earthquake')&&env.KMA_API_HUB_KEY)tasks.push(job('earthquake','earthquake',async()=>({...parseEarthquake(await call('earthquake',{disp:'2',help:'1'}),now),checkedAt:new Date(now).toISOString()})));
 if(wants('administrativeMap')&&env.VWORLD_API_KEY&&grid)tasks.push(job('administrativeMap',`administrativeMap:${grid.code}`,async()=>{
  const u=new URL('https://api.vworld.kr/req/data');for(const[k,v]of Object.entries({key:env.VWORLD_API_KEY,service:'data',version:'2.0',request:'getfeature',format:'json',size:'1',page:'1',geometry:'false',attribute:'true',crs:'EPSG:4326',geomfilter:`POINT(${grid.longitude} ${grid.latitude})`,data:'LT_C_ADSIGG_INFO',domain:'https://power-editor-design-1031.keenibis32.chatgpt.site'}))u.searchParams.set(k,v);
  let upstream;try{upstream=await fetchFn(u.href,{redirect:'manual',signal:AbortSignal.timeout(10000)})}catch(e){throw Error(['TimeoutError','AbortError'].includes(e.name)?'provider_timeout':'provider_network_error')}
  const raw=await safeJson(upstream),d=raw?.response;
  if(d?.status!=='OK'){const code=/^[A-Z_0-9]{1,80}$/.test(d?.error?.code)?d.error.code:'UNKNOWN';throw Object.assign(Error(code.includes('KEY')||code.includes('DOMAIN')?'authentication_failed':'provider_rejected'),{providerCode:code})}
  const list=d.result?.featureCollection?.features;if(!Array.isArray(list)||list.length!==1)throw Error('data_missing');const properties=list[0].properties;
  const code=String(properties.sig_cd);if(!/^\d{5}$/.test(code))throw Error('invalid_value');
  return {status:'ok',name:textValue(properties.full_nm||properties.sig_kor_nm,100),regionCode:code,city,scope:'representative_point',checkedAt:new Date(now).toISOString(),boundaryMapConnected:false,notice:'선택한 기상 대표좌표가 속한 공식 시·군·구를 확인했습니다. 사건 발생지역·발효지역의 경계 지도 연결은 아직 미완료입니다.'};
 }));
 else if(env.VWORLD_API_KEY)state.administrativeMap={...state.administrativeMap,status:'unavailable',reason:'region_unmatched'};
 await Promise.all(tasks);
 state.weatherForecast=alignForecast(state.weatherForecast,now);
 if(state.weather.referenceAt&&now-Date.parse(state.weather.referenceAt)>7200000)state.weather.stale=true;
 if(state.airQuality.items)state.airQuality=scopeAirQuality(state.airQuality,normalizeRegions((query.get('regions')||'').split(',')),airStationMetadata,now);
}
export async function handleLocalData(request,env={},options={}){
 const query=new URL(request.url).searchParams,rawParts=query.get('parts'),allowed=['weatherForecast','weather','airQuality','weatherWarning','earthquake','administrativeMap'];
 // Reject retired feature requests before accessing storage or any provider.
 if(query.has('roadId')||query.has('flood')||(rawParts||'').split(',').some(p=>['roadWeather','floodHistory'].includes(p)))return Response.json({error:'feature_removed'},{status:410,headers:{'Cache-Control':'private, no-store'}});
 const parts=rawParts===null?null:new Set(rawParts.split(','));
 if(parts&&[...parts].some(p=>!allowed.includes(p)))return Response.json({error:'invalid_parts'},{status:400});
 options={...options,parts};
 const hasPublic=!!env.PUBLIC_DATA_SERVICE_KEY,hasKma=!!env.KMA_API_HUB_KEY;
 const pending=(source,has,extra={})=>missing(source,has?'integration_validation_pending':'credentials_missing',extra);
 const state={checkedAt:new Date(options.now??Date.now()).toISOString(),
  weatherForecast:pending('기상청 단기예보',hasPublic,{kind:'forecast'}),
  weather:pending('기상청 초단기실황',hasPublic,{kind:'observation'}),
  airQuality:pending('한국환경공단 에어코리아',hasPublic,{kind:'observation'}),
  earthquake:pending('기상청 최근 지진정보',hasKma,{kind:'recent_events',notice:'진앙은 피해 범위가 아닙니다.'}),
  administrativeMap:pending('국토교통부 브이월드 행정구역도',!!env.VWORLD_API_KEY),
  outageNews:missing('정전 관련 언론보도','licensed_source_missing')};
 if(env.LOCAL_OFFICIAL_CONTRACT_VERIFIED==='true')await collectLocal(state,request,env,options);
 return response(parts?Object.fromEntries(Object.entries(state).filter(([key])=>key==='checkedAt'||parts.has(key))):state);
}
function finite(value){if(value===null||value===undefined||value===''||typeof value==='boolean')throw Error('invalid_value');const n=Number(value);if(!Number.isFinite(n)||n<0||n>10000000)throw Error('invalid_value');return n}
// Only public numeric measurements are included; never copy request URLs or keys.
function signedPower(value){if(value===null||value===undefined||typeof value==='boolean'||typeof value==='string'&&!value.trim())throw Error('invalid_value');const n=Number(value);return n<0?-finite(-n):finite(n)}
export function withPowerRowDiagnostic(row,parse){
 try{return parse()}catch(error){
  const fields=['currPwrTot','suppAbility','suppReservePwr','suppReserveRate','fuelPwrTot',...Array.from({length:9},(_,i)=>'fuelPwr'+(i+1))];
  const values=Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,typeof row[k]==='number'&&Number.isFinite(row[k])?row[k]:typeof row[k]==='string'&&/^-?\d+(?:\.\d+)?$/.test(row[k])?Number(row[k]):null]));
  error.powerRow={code:error.message,baseDatetime:/^\d{12,14}$/.test(String(row.baseDatetime))?String(row.baseDatetime):null,values};throw error;
 }
}
export function parseKpxTime(value,now=Date.now()){
 const s=String(value??'');let t;
 if(/^\d{12}(?:\d{2})?$/.test(s)){t=Date.parse(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)||'00'}+09:00`);if(!Number.isFinite(t)||new Date(t+9*3600000).toISOString().slice(0,19).replace(/[-:T]/g,'')!==s.padEnd(14,'0'))throw Error('invalid_timestamp')}
 else if(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?(?:Z|\+09:00)$/.test(s)){t=Date.parse(s);const offset=s.endsWith('+09:00')?9*3600000:0;if(!Number.isFinite(t)||new Date(t+offset).toISOString().slice(0,19)!==s.slice(0,19))throw Error('invalid_timestamp')}
 if(!Number.isFinite(t)||t>now+300000)throw Error('invalid_timestamp');return new Date(t).toISOString();
}
export function kpxItems(body,allowWindow=false){
 const r=body?.response;if(!r||!['00','0','NORMAL_SERVICE'].includes(String(r.header?.resultCode)))throw Error('provider_error');
 const raw=r.body?.items;const list=Array.isArray(raw)?raw:Array.isArray(raw?.item)?raw.item:raw?.item&&typeof raw.item==='object'?[raw.item]:null;
 if(!list||list.length>1000||!allowWindow&&Number(r.body?.totalCount)>list.length)throw Error('incomplete_series');return list;
}
export function parseApiSupply(body,now=Date.now()){
 const list=kpxItems(body);if(list.length!==1)throw Error('schema_changed');const r=list[0];
 const referenceAt=parseKpxTime(r.baseDatetime,now),demandMw=finite(r.currPwrTot),capacityMw=finite(r.suppAbility),reserveMw=finite(r.suppReservePwr),reservePercent=finite(r.suppReserveRate);
 if(!demandMw||Math.abs(capacityMw-demandMw-reserveMw)>Math.max(3,capacityMw*.001)||Math.abs(reserveMw/demandMw*100-reservePercent)>.15)throw Error('inconsistent_values');
 return {status:'ok',source:'전력거래소',scope:'national',referenceAt,checkedAt:new Date(now).toISOString(),demandMw,capacityMw,reserveMw,reservePercent,stale:now-Date.parse(referenceAt)>=3600000};
}
export function validatedFuelMap(value){
 if(typeof value!=='string'||value.length>3000)return null;let list;try{list=JSON.parse(value)}catch{return null}
 if(!Array.isArray(list)||!list.length||list.length>9||new Set(list.map(x=>x?.key)).size!==list.length)return null;
 return list.every(x=>x&&/^fuelPwr[1-9]$/.test(x.key)&&typeof x.label==='string'&&x.label.trim().length>0&&x.label.length<=30)?list.map(({key,label})=>({key,label})):null;
}
export function parseGeneration(body,date,fuelKeys,now=Date.now()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!fuelKeys?.length)throw Error('contract_unverified');const seen=new Set();
 return kpxItems(body).map(r=>withPowerRowDiagnostic(r,()=>{const at=parseKpxTime(r.baseDatetime,now);if(koreaDay(Date.parse(at))!==date||seen.has(at))throw Error('invalid_series');seen.add(at);const total=finite(r.fuelPwrTot),fuels=Object.fromEntries(fuelKeys.map(({key})=>[key,signedPower(r[key])]));if(Math.abs(Object.values(fuels).reduce((a,b)=>a+b,0)-total)>Math.max(3,total*.001))throw Error('incompatible_components');return {at,total,fuels}})).sort((a,b)=>a.at.localeCompare(b.at));
}
// Live 2026-11-02: baseDate is ignored. The latest 1,000 descending rows cover
// today and yesterday. Prove the oldest row reaches yesterday's midnight before
// accepting this bounded window; totalCount is the full archive, not this day.
export function parseGenerationWindow(body,date,fuelKeys,now=Date.now()){
 const rows=kpxItems(body,true),previousDate=new Date(Date.parse(date)-DAY).toISOString().slice(0,10);
 const start=Date.parse(previousDate+'T00:00:00+09:00');let last=Infinity;
 const selected={[date]:[],[previousDate]:[]};
 for(const row of rows){const at=Date.parse(parseKpxTime(row.baseDatetime,now));if(at>=last)throw Error('invalid_series');last=at;const day=koreaDay(at);if(at<=now&&selected[day])selected[day].push(row)}
 if(!rows.length||last>start)throw Error('incomplete_series');
 const parse=day=>parseGeneration({response:{header:{resultCode:'00'},body:{items:selected[day],totalCount:selected[day].length}}},day,fuelKeys,now);
 const today=parse(date),previous=parse(previousDate);
 if(!today.length||!previous.length)throw Error('data_missing');
 return {status:'ok',reason:null,date,previousDate,today,previous,referenceAt:today.at(-1).at,checkedAt:new Date(now).toISOString(),stale:now-Date.parse(today.at(-1).at)>=3600000,scope:'national',aggregation:'fuelPwr1–9 signed sum / fuelPwrTot',coverage:{today:today.length,previous:previous.length,expectedPrevious:288},notice:'계통기준 발전출력(MW). 발전원별 음수 출력도 원자료대로 별도 표시하며 합계는 음수를 포함합니다. 미래·누락 구간은 공백입니다.'};
}
async function safeBody(r){if(!r.ok||r.status>=300)throw Object.assign(Error([401,403].includes(r.status)?'authentication_failed':r.status===429?'rate_limited':r.status>=300&&r.status<400?'redirect_blocked':'provider_http_error'),{httpStatus:r.status});if(Number(r.headers.get('content-length'))>MAX_BYTES)throw Error('response_limit');const reader=r.body?.getReader();if(!reader)throw Error('body_missing');let bytes=0;const parts=[];try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>MAX_BYTES)throw Error('response_limit');parts.push(value)}}finally{await reader.cancel().catch(()=>{})}const raw=new Uint8Array(bytes);let p=0;for(const x of parts){raw.set(x,p);p+=x.length}return raw}
async function safeJson(r){const raw=await safeBody(r),text=new TextDecoder().decode(raw);let body;try{body=JSON.parse(text)}catch{if(/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE_ACCESS_DENIED|UNAUTHORIZED|ACCESS_DENIED|SERVICE_KEY_IS_NULL/.test(text))throw Error('authentication_failed');throw Error('invalid_json')}const code=String(body?.response?.header?.resultCode);if(['20','21','30','31','32','99'].includes(code))throw Error('authentication_failed');if(['22','23'].includes(code))throw Error('rate_limited');return body}
/** CAS reserves the entire request batch before fetching. Shared D1 is mandatory:
 * Conservative application cap: <=100/service/KST day, not a provider plan claim.
 * Region cache keys share service quota. Generation is one window call/30min. */
export async function boundedProvider(store,provider,now,count,fetchData,options={}){
 if(!store)return {status:'unavailable',reason:'shared_storage_missing'};const key='public:official-api:'+provider,day=koreaDay(now);
 const saved=await store.read(key),old=saved.value||{},used=old.day===day?old.used:0;
 const interval=provider.startsWith('weatherForecast:')||provider==='demandForecast'?3600000:provider==='airStationMetadata'?DAY:provider==='generation'?1800000:900000;
 // A disconnected client must not leave an empty reservation stuck for 30 min.
 // Keep consumed quota; recover only the expired, unfinished fetch lease.
 const leaseUntil=old.leaseUntil??old.nextFetchAt-interval+45000;
 const diagnosticVersion=Number.isInteger(options.diagnostics)?options.diagnostics:1;
 const diagnoseOnce=options.diagnostics&&['upstream_or_schema_failure','schema_mismatch','inconsistent_values'].includes(old.data?.reason)&&(old.data.diagnosticVersion||0)<diagnosticVersion&&!(old.leaseUntil>now);
 // Only an operator-confirmed new approval can retry an authentication failure
 // early. Keep the same cache and consumed quota; the revision is consumed once.
 const approvalRetry=options.accessRevision&&old.accessRevision!==options.accessRevision&&old.data?.reason==='authentication_failed'&&!(old.leaseUntil>now);
 const transientCooldown=options.diagnostics&&old.data?.reason&&!['authentication_failed','rate_limited','redirect_blocked','daily_limit'].includes(old.data.reason)&&old.nextFetchAt>now+interval&&!(old.leaseUntil>now);
 const newDataDay=['demandToday','demandForecast'].includes(provider)&&old.data?.date!==day&&old.day!==day&&!(old.leaseUntil>now)&&!['authentication_failed','rate_limited','redirect_blocked'].includes(old.data?.reason);
 if(!diagnoseOnce&&!approvalRetry&&!transientCooldown&&!newDataDay&&old.nextFetchAt>now&&(old.data||leaseUntil>now))return old.data?{...old.data,fromCache:true}:{status:'unavailable',reason:'refresh_pending'};
 if(used+count>100)return old.data?{...old.data,stale:true,reason:'daily_limit'}:{status:'unavailable',reason:'daily_limit'};
 const lease={day,used:used+count,nextFetchAt:now+interval,leaseUntil:now+45000,data:old.data||null,...(options.accessRevision?{accessRevision:options.accessRevision}:{})};
 const claim=await store.compareAndSwap(key,saved.version,lease);if(!claim.applied)return {status:'unavailable',reason:'refresh_pending'};
 const service=provider.split(':')[0],quotaKey='public:official-quota:'+service;
 // Region-specific caches share one service cap and authentication cooldown.
 let quotaVersion=null;
 if(service!==provider){
  let reason='refresh_pending';
  for(let attempt=0;attempt<8;attempt++){
   const q=await store.read(quotaKey),v=q.value||{},total=v.day===day?v.used:0;
   if(v.blockedUntil>now){reason=v.reason||'authentication_failed';break}
   if(total+count>100){reason='daily_limit';break}
   const next={day,used:total+count,blockedUntil:0},write=await store.compareAndSwap(quotaKey,q.version,next);
   if(write.applied){quotaVersion=write.version;break}
  }
  if(!quotaVersion){const data=old.data?{...old.data,stale:true,reason}:{status:'unavailable',reason};await store.compareAndSwap(key,claim.version,{...lease,leaseUntil:0,data});return data}
 }
 const operation=(async()=>{let data;try{try{data=await fetchData()}catch(error){
  // Retry only the air measurement provider, once, under the same cache lease and daily budget.
  const transient=['TimeoutError','AbortError'].includes(error.name)||error.message==='provider_network_error'||error.httpStatus>=500&&error.httpStatus<=599;
  if(provider.split(':')[0]!=='airQuality'||!transient||lease.used>=100)throw error;
  lease.used++;const retryClaim=await store.compareAndSwap(key,claim.version,lease);if(!retryClaim.applied)throw error;claim.version=retryClaim.version;
  await new Promise(resolve=>setTimeout(resolve,250));data=await fetchData();
 }}catch(error){const reason=['authentication_failed','rate_limited','redirect_blocked','data_missing','incomplete_series','invalid_timestamp','invalid_series','incompatible_components','invalid_json','provider_http_error','provider_timeout','provider_network_error','provider_rejected','inconsistent_values'].includes(error.message)?error.message:error.message==='invalid_value'?'schema_mismatch':['TimeoutError','AbortError'].includes(error.name)?'provider_timeout':'upstream_or_schema_failure';if(['authentication_failed','rate_limited','redirect_blocked'].includes(reason))lease.nextFetchAt=now+DAY;data=old.data?.status==='ok'?{...old.data,stale:true,reason}:{status:'unavailable',reason};if(Number.isInteger(error.httpStatus))data.httpStatus=error.httpStatus;if(error.contentType)data.contentType=error.contentType;if(error.providerCode)data.providerCode=error.providerCode;if(error.powerRow)data.powerRowDiagnostic=error.powerRow}
    if(provider.split(':')[0]==='airQuality'&&data.status==='ok'&&Array.isArray(data.items)&&Array.isArray(old.data?.items)){
    const prior=new Map(old.data.items.map(r=>[r.region+'|'+r.station,r]));
    data.items=data.items.map(r=>{if(r.referenceAt||r.pm10Flag||r.pm25Flag)return r;const p=prior.get(r.region+'|'+r.station),checked=p?.fallbackCheckedAt||old.data.checkedAt,age=now-Date.parse(checked);return p?.referenceAt&&Number.isFinite(age)&&age>=0&&age<=10800000?{...p,stale:true,fallback:true,fallbackCheckedAt:checked}:r;});
   }
if(quotaVersion&&['authentication_failed','rate_limited','redirect_blocked'].includes(data.reason)){
  for(let attempt=0;attempt<8;attempt++){const q=await store.read(quotaKey);const write=await store.compareAndSwap(quotaKey,q.version,{...q.value,blockedUntil:now+DAY,reason:data.reason});if(write.applied)break}
 }
 if(options.diagnostics)data.diagnosticVersion=diagnosticVersion;
 await store.compareAndSwap(key,claim.version,{...lease,leaseUntil:0,data});return data})();
 if(options.waitUntil)options.waitUntil(operation.catch(()=>{}));
 return operation;
}
export async function handlePowerFlow(request,env={},options={}){
 const now=options.now??Date.now(),currentDate=koreaDay(now),requestedDate=new URL(request.url).searchParams.get('date'),date=requestedDate||currentDate;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(Date.parse(date)).toISOString().slice(0,10)!==date)return Response.json({status:'unavailable',reason:'invalid_date'},{status:400});
 const previousDate=new Date(Date.parse(date)-DAY).toISOString().slice(0,10),fuelKeys=validatedFuelMap(env.POWER_GENERATION_FIELDS);
 const blank={status:'not_connected',reason:'credentials_missing',source:'전력거래소',timezone:'Asia/Seoul',date,previousDate,intervalMinutes:5,unit:null,seriesValidated:false,fuelKeys:[],today:[],previous:[],supply:missing('전력거래소')};
 if(date!==currentDate)return response({...blank,status:'unavailable',reason:'historical_archive_unavailable',supply:missing('전력거래소','historical_archive_unavailable')});
 if(!env.PUBLIC_DATA_SERVICE_KEY)return response(blank);
 // These are deployment attestations, NOT defaults. Enable only after an authorized
 // live response establishes units, fuel mappings, non-overlap and date semantics.
 const generationOnly=new URL(request.url).searchParams.get('part')==='generation';
 const supplyVerified=!generationOnly&&env.POWER_SUPPLY_UNIT==='MW'&&env.POWER_SUPPLY_CONTRACT_VERIFIED==='true';
 const supplyOnly=new URL(request.url).searchParams.get('part')==='supply';
 const generationVerified=!supplyOnly&&env.POWER_GENERATION_UNIT==='MW'&&env.POWER_GENERATION_CONTRACT_VERIFIED==='true'&&fuelKeys;
 if(!supplyVerified&&!generationVerified)return response({...blank,reason:'contract_validation_pending',supply:missing('전력거래소','contract_validation_pending')});
 try{
 const store=options.store??(env.DB?createD1SnapshotStore(env.DB):null),fetchFn=options.fetchFn??fetch;
 const call=async(provider,params={})=>{const u=new URL(POWER_ENDPOINTS[provider]);u.searchParams.set('serviceKey',env.PUBLIC_DATA_SERVICE_KEY);u.searchParams.set('dataType','json');for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);return safeJson(await fetchFn(u.href,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}}))};
 const isolated=promise=>promise.catch(()=>({status:'unavailable',reason:'shared_storage_failure'}));
 const [supply,generationResult]=await Promise.all([
  supplyVerified?isolated(boundedProvider(store,'supply',now,1,async()=>parseApiSupply(await call('supply'),now),{waitUntil:options.waitUntil})):missing('전력거래소','contract_validation_pending'),
  generationVerified?isolated(boundedProvider(store,'generation',now,1,async()=>parseGenerationWindow(await call('generation',{pageNo:'1',numOfRows:'1000'}),date,fuelKeys,now),{waitUntil:options.waitUntil,diagnostics:3})):{status:'not_connected',reason:'contract_validation_pending'}
 ]);
 if(supplyOnly)return response({...blank,status:supply.status,supply});
 let generation=generationResult;
 // Never revive yesterday's cached series as today's graph.
 const compatible=generation.status==='ok'&&generation.date===date;
 if(compatible)generation={...generation,stale:!!generation.reason||!Number.isFinite(Date.parse(generation.referenceAt))||now-Date.parse(generation.referenceAt)>=3600000};
 return response({...blank,...(compatible?generation:{status:generation.status==='ok'?'unavailable':generation.status,reason:generation.status==='ok'?'date_rollover':generation.reason}),unit:compatible?'MW':null,seriesValidated:compatible,fuelKeys:compatible?fuelKeys:[],supply:{...supply,stale:!!supply.reason||!Number.isFinite(Date.parse(supply.referenceAt))||now-Date.parse(supply.referenceAt)>=3600000}});
 }catch{return response({...blank,status:'unavailable',reason:'shared_storage_failure',supply:{status:'unavailable',reason:'shared_storage_failure',source:'전력거래소'}})}
}

// KMA official grid workbook 2610, downloaded 2026-11-02.
export const OBSERVATION_GRIDS=REGION_POINTS;
