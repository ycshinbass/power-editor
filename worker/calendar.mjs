import {createD1SnapshotStore} from './snapshot-d1.mjs';
// Metadata only: no editorial writes, notifications, scraped bodies, or AI calls.
export const CALENDAR_SOURCES=[
 {id:'kasi-holidays',provider:'kasi',operation:'getHoliDeInfo',type:'national_holiday',publisher:'한국천문연구원',sourceUrl:'https://www.data.go.kr/data/15012690/openapi.do'},
 {id:'kasi-rest',provider:'kasi',operation:'getRestDeInfo',type:'public_holiday',publisher:'한국천문연구원',sourceUrl:'https://www.data.go.kr/data/15012690/openapi.do'},
 {id:'kasi-anniversaries',provider:'kasi',operation:'getAnniversaryInfo',type:'commemoration',publisher:'한국천문연구원',sourceUrl:'https://www.data.go.kr/data/15012690/openapi.do'},
 {id:'nec-elections',provider:'nec',operation:'getCommonSgCodeList',type:'election',publisher:'중앙선거관리위원회',sourceUrl:'https://www.data.go.kr/data/15000897/openapi.do'}
];
const DAY=86400000,MAX_PAGES=5,PAGE_SIZE=100,MAX_BYTES=300000,memory=new Map(),pending=new Map();
const error=code=>Object.assign(new Error(code),{code});
const failureCodes=new Set(['auth_required','rate_limited','provider_error','redirect_rejected','upstream_http','timeout','unreachable','response_limit','schema_invalid','pagination_limit','missing_key','store_unavailable']);
function decodeXML(value){return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,s)=>{if(s[0]==='#'){const n=s[1].toLowerCase()==='x'?parseInt(s.slice(2),16):Number(s.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):''}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[s]||''}).trim()}
function tag(text,name){return decodeXML(text.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`,'i'))?.[1]||'')}
function resultError(code){if(/^(?:20|21|30|31|32|33|SERVICE_KEY_IS_NOT_REGISTERED_ERROR|SERVICE_ACCESS_DENIED_ERROR|INVALID_SERVICE_KEY)$/i.test(code))return 'auth_required';if(/^(?:22|LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR)$/i.test(code))return 'rate_limited';return 'provider_error'}
export function parseCalendarPage(text){
 if(typeof text!=='string'||text.length>MAX_BYTES)throw error('response_limit');
 let code,items,total,page;
 if(text.trim().startsWith('{')){
  let obj;try{obj=JSON.parse(text)}catch{throw error('schema_invalid')}
  const response=obj.response;code=String(response?.header?.resultCode??'');
  if(!['00','0','INFO-00'].includes(code))throw error(code?resultError(code):'schema_invalid');
  const b=response?.body;if(!b)throw error('schema_invalid');
  items=b.items?.item??(Array.isArray(b.items)?b.items:[]);if(!Array.isArray(items))items=items&&typeof items==='object'?[items]:[];
  total=/^\d+$/.test(String(b.totalCount))?Number(b.totalCount):NaN;page=Number(b.pageNo);
 }else{
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw error('schema_invalid');
  code=tag(text,'resultCode')||tag(text,'returnReasonCode');
  if(!['00','0','INFO-00'].includes(code))throw error(code?resultError(code):'schema_invalid');
  if(!/<body[\s>]/i.test(text)||!/<\/response\s*>/i.test(text))throw error('schema_invalid');
  items=[...text.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(m=>Object.fromEntries(['locdate','dateName','isHoliday','dateKind','sgId','sgTypecode','sgName','sgVotedate'].map(k=>[k,tag(m[1],k)])));
  total=/^\d+$/.test(tag(text,'totalCount'))?Number(tag(text,'totalCount')):NaN;page=Number(tag(text,'pageNo'));
 }
 if(!Number.isInteger(total)||total<0||!Number.isInteger(page)||page<1||items.length>PAGE_SIZE||items.length>total||items.some(i=>!i||typeof i!=='object'))throw error('schema_invalid');
 return {items,total,page};
}
function dateOnly(raw){const s=String(raw??'');if(!/^\d{8}$/.test(s))throw error('schema_invalid');const date=`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;if(!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw error('schema_invalid');return date}
export function normalizeCalendarItems(rows,source,checkedAt){
 return rows.map(row=>{const date=dateOnly(source.provider==='nec'?row.sgVotedate:row.locdate),title=String(source.provider==='nec'?row.sgName??'':row.dateName??'').trim();
  if(!title||title.length>160||/[\x00-\x1f\x7f<>]/.test(title))throw error('schema_invalid');
  if(source.provider==='kasi'&&!['Y','N'].includes(row.isHoliday))throw error('schema_invalid');
  return {id:`${source.provider}:${date}:${encodeURIComponent(title)}`,date,title,type:source.type,types:[source.type],sourceIds:[source.id],isHoliday:source.provider==='kasi'&&row.isHoliday==='Y',source:source.provider,sourceUrl:source.sourceUrl,publisher:source.publisher,checkedAt};
 });
}
export function mergeCalendarItems(items,year){const merged=new Map();for(const item of items){if(!item.date.startsWith(year+'-'))continue;const old=merged.get(item.id);if(old){old.types=[...new Set([...old.types,...item.types])];old.sourceIds=[...new Set([...old.sourceIds,...item.sourceIds])];old.isHoliday||=item.isHoliday}else merged.set(item.id,{...item,types:[...item.types]})}return [...merged.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title,'ko'))}
async function safeText(response){
 if(response.redirected||response.status>=300&&response.status<400){await response.body?.cancel();throw error('redirect_rejected')}
 if(!response.ok){await response.body?.cancel();throw error([401,403].includes(response.status)?'auth_required':response.status===429?'rate_limited':'upstream_http')}
 if(Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw error('response_limit')}
 const reader=response.body?.getReader();if(!reader)throw error('schema_invalid');let size=0,text='',decoder=new TextDecoder('utf-8',{fatal:true});try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw error('response_limit');text+=decoder.decode(value,{stream:true})}return text+decoder.decode()}finally{await reader.cancel().catch(()=>{})}
}
export async function collectCalendarSource(source,year,key,fetchFn=fetch,now=Date.now()){
 if(!key||typeof key!=='string')throw error('missing_key');
 // Public-data keys may be stored raw or already percent encoded. Decode once only.
 let serviceKey=key;try{serviceKey=decodeURIComponent(key)}catch{throw error('auth_required')}
 const base=source.provider==='nec'?'https://apis.data.go.kr/9760000/CommonCodeService/':'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000),rows=[];let expectedTotal;
 try{for(let page=1;page<=MAX_PAGES;page++){
  const url=new URL(base+source.operation);url.searchParams.set('ServiceKey',serviceKey);url.searchParams.set('pageNo',String(page));url.searchParams.set('numOfRows',String(PAGE_SIZE));if(source.provider==='kasi')url.searchParams.set('solYear',String(year));
  const parsed=parseCalendarPage(await safeText(await fetchFn(url.href,{redirect:'manual',signal:controller.signal,headers:{Accept:'application/xml, application/json'}})));
  if(parsed.page!==page||expectedTotal!==undefined&&expectedTotal!==parsed.total)throw error('schema_invalid');expectedTotal=parsed.total;
  if(expectedTotal>MAX_PAGES*PAGE_SIZE)throw error('pagination_limit');rows.push(...parsed.items);
  if(rows.length===expectedTotal)return normalizeCalendarItems(rows,source,new Date(now).toISOString());
  if(!parsed.items.length||rows.length>expectedTotal)throw error('schema_invalid');
 }throw error('pagination_limit');
 }catch(e){throw error(controller.signal.aborted?'timeout':failureCodes.has(e?.code)?e.code:'unreachable')}finally{clearTimeout(timer)}
}
function notice(code){return code==='pagination_limit'?'제공처 전체 목록이 수집 한도를 초과했습니다. 해당 출처의 일정이 없다는 뜻은 아니며 이전 자료가 있으면 유지합니다.':code==='store_unavailable'?'공유 캐시를 확인할 수 없어 추가 API 호출을 보류했습니다.':code==='auth_required'?'기존 공공데이터 키의 해당 API 활용 승인·접근 권한 확인이 필요합니다. 24시간 뒤 다시 확인합니다.':code==='rate_limited'?'제공처 호출 한도에 도달했습니다. 24시간 뒤 다시 확인합니다.':code==='missing_key'?'기존 공공데이터 API 키가 연결되지 않았습니다.':'공식 API 최신 확인 실패 · 이전 자료가 있으면 유지합니다.'}
function present(source,value,now){const data=value?.data,stale=!!data&&(!!value.failureCode||now-Date.parse(data.checkedAt)>=DAY);return {items:data?.items||[],source:{id:source.id,publisher:source.publisher,sourceUrl:source.sourceUrl,status:data?(stale?'stale':'ok'):'unavailable',checkedAt:data?.checkedAt||null,lastAttemptAt:value?.lastAttemptAt||null,nextFetchAt:value?.nextFetchAt?new Date(value.nextFetchAt).toISOString():null,...(value?.failureCode?{failureCode:value.failureCode,notice:notice(value.failureCode)}:{}),...(value?.leaseUntil>now?{refreshing:true}:{})}}}
async function sourceSnapshot(source,year,env,options){
 const now=options.now??Date.now(),store=options.store??(env.DB?createD1SnapshotStore(env.DB):null),key=`public:calendar:v1:${source.id}:${source.provider==='nec'?'all':year}`;
 const read=()=>store?store.read(key):Promise.resolve({version:null,value:memory.get(key)||null});
 let saved=await read();if(saved.value?.nextFetchAt>now||saved.value?.leaseUntil>now)return present(source,saved.value,now);
 if(pending.has(key))return pending.get(key);
 const task=(async()=>{
  const lease={...saved.value,leaseUntil:now+60000};let version=saved.version;
  if(store){const write=await store.compareAndSwap(key,version,lease);if(!write.applied)return present(source,(await read()).value,now);version=write.version}else memory.set(key,lease);
  let value;try{const items=await collectCalendarSource(source,year,env.PUBLIC_DATA_SERVICE_KEY,options.fetchFn??fetch,now);value={data:{items,checkedAt:new Date(now).toISOString()},lastAttemptAt:new Date(now).toISOString(),nextFetchAt:now+DAY,leaseUntil:0}}catch(e){const failureCode=failureCodes.has(e?.code)?e.code:'unreachable';value={data:saved.value?.data||null,lastAttemptAt:new Date(now).toISOString(),nextFetchAt:now+(['auth_required','rate_limited'].includes(failureCode)?DAY:6*3600000),leaseUntil:0,failureCode}}
  if(store){const write=await store.compareAndSwap(key,version,value);if(!write.applied)return present(source,(await read()).value,now)}else memory.set(key,value);
  return present(source,value,now);
 })();pending.set(key,task);try{return await task}finally{pending.delete(key)}
}
export async function handleCalendar(request,env={},options={}){
 const now=options.now??Date.now(),currentYear=new Date(now+9*3600000).getUTCFullYear(),yearRange={min:currentYear-1,max:currentYear+1};const params=new URL(request.url).searchParams,raw=params.get('year')??String(currentYear),year=Number(raw);
 const respond=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
 if(request.method!=='GET'&&request.method!=='HEAD')return respond({status:'unavailable',error:'method_not_allowed'},405);
 if(!/^\d{4}$/.test(raw)||year<yearRange.min||year>yearRange.max||params.getAll('year').length>1||[...params.keys()].some(k=>k!=='year'))return respond({status:'unavailable',error:'year_invalid',yearRange},400);
 const results=await Promise.all(CALENDAR_SOURCES.map(async source=>{try{return await sourceSnapshot(source,year,env,options)}catch{return present(source,{failureCode:'store_unavailable'},now)}}));
 const sources=results.map(r=>r.source),items=mergeCalendarItems(results.flatMap(r=>r.items),year);
 return respond({year,yearRange,status:sources.every(s=>s.status==='ok')?'ok':sources.some(s=>s.status!=='unavailable')?'partial':'unavailable',items,sources});
}
export function clearCalendarMemory(){memory.clear();pending.clear()}
