import {createD1SnapshotStore} from './snapshot-d1.mjs';
export const KPX_URL='https://www.kpx.or.kr/powerinfoSubmain.es?mid=a10404030000';
const key='public:kpx:supply',memory={value:null},TTL=600000;let pending;
export function parsePowerSupply(html,now=Date.now()){
 if(typeof html!=='string'||html.length>1000000)throw Error('response_limit');
 const cells={};for(const [field,id,unit] of [['capacityMw','avil','MW'],['demandMw','load','MW'],['reserveMw','supPow','MW'],['reservePercent','supPer','%']]){
  const matches=[...html.matchAll(new RegExp(`<td\\s+id="${id}"\\s*>\\s*([0-9,]+(?:\\.[0-9]+)?)\\s*${unit}\\s*</td>`,'g'))];
  if(matches.length!==1){const e=Error('schema_changed');e.shape={bytes:html.length,field:id,strictMatches:matches.length,hasFieldId:html.includes('id="'+id+'"'),hasKpxTitle:html.includes('실시간 전력수급현황'),accessChallenge:/captcha|access denied|request rejected|Web firewall security policies|접근이 차단|비정상적인 접근/i.test(html)};throw e;}cells[field]=Number(matches[0][1].replaceAll(',',''));if(!Number.isFinite(cells[field])||cells[field]<0||cells[field]>1000000)throw Error('invalid_value');
 }
 const time=html.match(/<p class="info_top">\s*(\d{4})\.(\d{2})\.(\d{2})\([^)]+\)\s*(\d{2}):(\d{2})/);
 if(!time)throw Error('timestamp_missing');const [,y,m,d,h,min]=time;const raw=`${y}-${m}-${d}T${h}:${min}:00+09:00`,t=Date.parse(raw);
 if(!Number.isFinite(t)||new Date(t+9*3600000).toISOString().slice(0,16)!==`${y}-${m}-${d}T${h}:${min}`||t>now+300000)throw Error('invalid_timestamp');
 if(cells.demandMw<=0||Math.abs(cells.capacityMw-cells.demandMw-cells.reserveMw)>3||Math.abs(cells.reserveMw/cells.demandMw*100-cells.reservePercent)>.1)throw Error('inconsistent_values');
 return {status:'ok',...cells,referenceAt:new Date(t).toISOString(),checkedAt:new Date(now).toISOString(),source:'전력거래소',sourceUrl:KPX_URL,scope:'national-market',stale:now-t>=3600000};
}
async function bodyText(response){if(!response.ok)throw Error('upstream_http_'+response.status);if(Number(response.headers.get('content-length'))>1000000)throw Error('response_limit');const reader=response.body?.getReader();if(!reader)throw Error('body_missing');let size=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000)throw Error('response_limit');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}const bytes=new Uint8Array(size);let p=0;for(const c of chunks){bytes.set(c,p);p+=c.length}return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
export async function handlePowerSupply(request,env={},options={}){
 const now=options.now??Date.now(),fetchFn=options.fetchFn??fetch,store=options.store??(env.DB?createD1SnapshotStore(env.DB):null);
 const output=data=>{if(data.diagnostic?.excerpt){const {excerpt,...safe}=data.diagnostic;data={...data,diagnostic:safe}}return Response.json(data,{headers:{'Cache-Control':'private, no-store'}})};
 try{
  const saved=store?await store.read(key):{version:null,value:memory.value},cached=saved.value;
  if(cached?.data?.failureCode==='upstream_access_blocked'||cached?.data?.diagnostic?.accessChallenge||/Web firewall security policies/i.test(cached?.data?.diagnostic?.excerpt||''))return output({status:'unavailable',failureCode:'upstream_access_blocked',source:'전력거래소',sourceUrl:KPX_URL,checkedAt:cached.data.checkedAt,notice:'공식 사이트의 웹 방화벽이 서버 요청을 차단했습니다. 자동 재시도를 중단했으며 공식 API 또는 제공처 접근 승인이 필요합니다.'});
  if(cached?.nextFetchAt>now)return output({...cached.data,stale:cached.data.status==='ok'?!!cached.data.failureCode||now-Date.parse(cached.data.referenceAt)>=3600000:true,fromCache:true});
  if(pending)return output(await pending);
  pending=(async()=>{let data;try{const r=await fetchFn(KPX_URL,{headers:{Accept:'text/html'},redirect:'manual',signal:AbortSignal.timeout(8000)});data=parsePowerSupply(await bodyText(r),now)}catch(error){const reason=String(error?.message||'');const failureCode=error?.shape?.accessChallenge?'upstream_access_blocked':/^(?:upstream_http_[1-5][0-9]{2}|response_limit|body_missing|schema_changed|invalid_value|timestamp_missing|invalid_timestamp|inconsistent_values)$/.test(reason)?reason:['TimeoutError','AbortError'].includes(error?.name)?'upstream_timeout':'upstream_fetch_or_decode';const diagnostic=reason==='schema_changed'?error.shape:undefined;data=cached?.data?.status==='ok'?{...cached.data,stale:true,failureCode,diagnostic,notice:'최신 수집 실패 · 이전 자료'}:{status:'unavailable',failureCode,diagnostic,source:'전력거래소',sourceUrl:KPX_URL,checkedAt:new Date(now).toISOString(),notice:'공식 수급 자료를 확인하지 못했습니다.'}}
   const value={data,nextFetchAt:now+TTL};if(store)await store.compareAndSwap(key,saved.version,value);else memory.value=value;return data})();
  try{return output(await pending)}finally{pending=null}
 }catch{return output({status:'unavailable',source:'전력거래소',sourceUrl:KPX_URL,notice:'공식 수급 저장 상태를 확인하지 못했습니다.'})}
}
export function clearPowerSupplyMemory(){memory.value=null;pending=null}
