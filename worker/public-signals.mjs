import {createD1SnapshotStore} from './snapshot-d1.mjs';
const SOURCES={weather:{name:'기상청 특보',url:'https://www.weather.go.kr/w/wnuri-fct2021/weather/warning.do',sourceUrl:'https://www.weather.go.kr/w/special-report/overall.do'},fire:{name:'산림청 산불 공개현황',url:'https://fd.forest.go.kr/ffas/pubConn/selectPublicFireShowList.do',sourceUrl:'https://fd.forest.go.kr/ffas/'},landslide:{name:'산림청 산사태 예보',url:'https://sansatai.forest.go.kr/mhms_pub/mhms/forecast/forecastList.do',sourceUrl:'https://sansatai.forest.go.kr/mhms_pub/mhms/forecast/forecastPage.do'}};
const memory=new Map(),pending=new Map();
// Display grace is independent of the unchanged 10-minute collection cache.
const SNAPSHOT_GRACE_MS=30*60000;
function pendingSnapshot(data,now){
 const age=now-Date.parse(data.checkedAt);
 return {...data,stale:!!data.stale||!Number.isFinite(age)||age>=SNAPSHOT_GRACE_MS||age< -60000,reason:data.reason||'refresh_pending',refreshPending:true};
}
const plain=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim().slice(0,600);
export function parsePublicSignal(id,text){
 if(typeof text!=='string'||text.length>700000)throw Error('response_limit');
 if(id==='weather'){
  const table=text.match(/<table\b[^>]*id="current-warnings"[^>]*>([\s\S]*?)<\/table>/i);if(!table)throw Error('schema_changed');
  const rows=[...table[1].matchAll(/<tr\b[^>]*data-type="[^"]+"[^>]*>([\s\S]*?)<\/tr>/g)];
  // KMA's explicit empty message precedes the current table, outside its tbody.
  // Do not accept a blank table alone or the separate preliminary-warning message.
  const current=text.slice(0,table.index);
  const explicitEmpty=/<h3[^>]*>특보 내용<\/h3>[\s\S]*?<p class="tit">\s*o\s*없\s*음\s*<\/p>[\s\S]*?<p class="txt">\s*o\s*없음\s*<\/p>/.test(current);
  if(!rows.length&&!/특보.*없|발효.*없/.test(table[1])&&!explicitEmpty)throw Error('empty_unverified');
  const records=rows.map(row=>{const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m=>plain(m[1]));if(cells.length!==6||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(cells[3]))throw Error('schema_changed');return {type:cells[0],level:cells[1],region:cells[2],announced:cells[3],effective:cells[4],releaseEstimate:cells[5]}});
  if(records.length>300)throw Error('response_limit');return {count:records.length,records};
 }
 const d=JSON.parse(text);const list=id==='fire'?d.fireShowInfoList:d.list;
 if(!Array.isArray(list)||list.length>300||(id==='landslide'&&(d.success!==true||d.totalCount!==list.length)))throw Error('schema_changed');
 if(id==='fire'){
  const records=list.map(r=>{
   if(typeof r.frfrPrgrsStcdNm!=='string'||typeof r.frfrSttmnAddr!=='string')throw Error('schema_changed');
   const phase=r.frfrPrgrsStcdNm.trim();
   if(/산불외종료|진화완료|진화 완료|상황종료/.test(phase))return null;
   if(!/진화중|진화 중|발생|초기|확인중|확인 중/.test(phase))throw Error('unverified_fire_phase');
   return {type:'산불',level:phase,region:plain(r.frfrSttmnAddr),announced:plain(String(r.frfrFrngDtm||'')),effective:plain(String(r.frfrFrngDtm||''))};
  }).filter(Boolean);
  return {count:records.length,records,reportedCount:list.length};
 }
 // Nonempty landslide wire records still require independent schema verification.
 return {count:list.length,records:[]};
}
async function readBody(r){if(!r.ok)throw Error('upstream_http_'+r.status);if(Number(r.headers.get('content-length'))>700000)throw Error('response_limit');const reader=r.body?.getReader();if(!reader)throw Error('body');const chunks=[];let n=0;try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>700000)throw Error('response_limit');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}const b=new Uint8Array(n);let p=0;for(const c of chunks){b.set(c,p);p+=c.length}return new TextDecoder('utf-8',{fatal:true}).decode(b)}
export async function handlePublicSignals(request,env={},options={}){
 const now=options.now??Date.now(),fetchFn=options.fetchFn??fetch,store=options.store??(env.DB?createD1SnapshotStore(env.DB):null);
 const part=new URL(request.url).searchParams.get('part');
 if(part&&!Object.hasOwn(SOURCES,part))return Response.json({error:'invalid_part'},{status:400});
 const signals=await Promise.all(Object.entries(SOURCES).filter(([id])=>!part||id===part).map(async([id,s])=>{const base={id,name:s.name,sourceUrl:s.sourceUrl,coverage:'national-public-list',safetyConclusion:'unknown'},key='public:signals:'+id;
  try{const old=store?await store.read(key):{version:null,value:memory.get(key)},saved=old.value;
   if(saved?.nextFetchAt>now&&saved.data)return {...base,...saved.data,fromCache:true};
   const waiting=()=>saved?.data?{...base,...pendingSnapshot(saved.data,now)}:{...base,status:'unavailable',reason:'refresh_pending',count:null,records:[]};
   if(saved?.leaseUntil>now)return waiting();
   let claimedVersion=old.version;
   if(store){const claim=await store.compareAndSwap(key,old.version,{data:saved?.data||null,nextFetchAt:0,leaseUntil:now+45000});if(!claim.applied)return waiting();claimedVersion=claim.version;}
   if(pending.has(id))return pending.get(id);
   const job=(async()=>{let data;try{const read=async()=>{const r=await fetchFn(s.url,{redirect:'manual',signal:AbortSignal.timeout(id==='landslide'?20000:id==='fire'?12000:8000),headers:{Accept:id==='weather'?'text/html':'application/json'}});return readBody(r)};let body;try{body=await read()}catch(error){if(id!=='fire'||!(['TimeoutError','AbortError'].includes(error.name)||/^upstream_http_5[0-9]{2}$/.test(error.message)))throw error;body=await read()}data={...parsePublicSignal(id,body),status:'ok',stale:false,checkedAt:new Date(now).toISOString(),notice:'공식 공개목록 조회 결과이며 무사고·안전 판정이 아닙니다.'}}catch(error){const failureCode=error.name==='TimeoutError'?'upstream_timeout':/^[a-z_0-9]+$/.test(error.message)?error.message:'provider_failure';data=saved?.data?.status==='ok'?{...saved.data,stale:true,reason:'provider_fetch_failed',failureCode,attemptedAt:new Date(now).toISOString(),notice:'최신 조회 실패 · 이전 성공 자료입니다. 현재 발표 건수가 아닙니다.'}:{status:'unavailable',reason:'provider_fetch_failed',failureCode,attemptedAt:new Date(now).toISOString(),count:null,records:[],notice:'조회 실패로 현재 발표 유무를 확인할 수 없습니다.'}}
    const value={data,nextFetchAt:now+600000,leaseUntil:0};if(store)await store.compareAndSwap(key,claimedVersion,value);else memory.set(key,value);return {...base,...data}})();pending.set(id,job);options.waitUntil?.(job.catch(()=>{}));try{return await job}finally{pending.delete(id)}
  }catch{return {...base,status:'unavailable',count:null,records:[],notice:'자료 저장 상태 미확인'}}
 }));return Response.json({checkedAt:new Date(now).toISOString(),signals},{headers:{'Cache-Control':'private, no-store'}});
}
export function clearPublicSignalMemory(){memory.clear();pending.clear()}
