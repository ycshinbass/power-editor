import {retainDemand,yesterdayComparison} from './demand-retention.mjs';
import {createD1SnapshotStore} from './snapshot-d1.mjs';
import {demandContext,fourWeekComparison} from './demand-context.mjs';
import {publicDemandApi} from './demand-api.mjs';
const URL='https://www.kpx.or.kr/powerinfoSubmain.es?mid=a10606030000';
const day=now=>new Date(now+32400000).toISOString().slice(0,10);
export function parseDemandPage(html,now=Date.now()){
 if(typeof html!=='string'||html.length>1500000)throw Error('body_limit');
 const code=html.split('function drawChart(par1, par2, par3){')[1]?.split('function drawChart2')[0];
 if(!code||!code.includes('현재수요(전력시장)')||!code.includes('"data": x')||!code.includes('과거수요(전력시장)')||!code.includes('"data": y'))throw Error('schema_changed');
 const array=name=>{const raw=code.match(new RegExp('var '+name+' = \\[([\\d,\\s]+)\\];'))?.[1];if(!raw)throw Error('missing_series');const a=raw.split(',').map(s=>Number(s.trim()));if(!a.length||a.length>288||a.some(v=>!Number.isFinite(v)))throw Error('invalid_series');return a;};
 const series=(values,times,date)=>{if(values.length!==times.length)throw Error('misaligned_series');let prior=-Infinity;return times.map((t,i)=>{const s=String(t);if(!/^\d{14}$/.test(s))throw Error('invalid_time');const iso=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+'T'+s.slice(8,10)+':'+s.slice(10,12)+':'+s.slice(12)+'+09:00',at=Date.parse(iso);if(!Number.isFinite(at)||day(at)!==date||at<=prior||at>now+600000||at%300000||values[i]<=0||values[i]>200000)throw Error('invalid_series');prior=at;return {at:new Date(at).toISOString(),mw:values[i]};});};
 const today=series(array('x'),array('t_time'),day(now)),previous=series(array('y'),array('y_time'),day(now-86400000)),referenceAt=today.at(-1).at;
 return {status:'ok',date:day(now),today,previous,referenceAt,checkedAt:new Date(now).toISOString(),stale:now-Date.parse(referenceAt)>3600000,source:'전력거래소',sourceUrl:URL,scope:'national_market',unit:'MW',intervalMinutes:5,notice:'전력거래소 전국 전력시장 수요 · 5분 순시값. 총수요 추정·발전출력·육지 하루전 예측과 구분합니다.'};
}
export async function handlePowerDemand(request,env,{now=Date.now(),fetchFn=fetch,store=env.DB?createD1SnapshotStore(env.DB):null,waitUntil}={}){
 const contextTask=demandContext(env,{now,fetchFn,store,waitUntil}).catch(()=>({histories:[],forecast:null}));
 if(waitUntil)waitUntil(contextTask);
 let data={status:'unavailable',today:[],previous:[]};
 try{if(!store)throw Error('storage');const key='power:demand:official:v1',old=await store.read(key);
 if(old.value?.data?.failureCode==='access_blocked'||old.value?.nextFetchAt>now)data=old.value.data;else{
  const claim=await store.compareAndSwap(key,old.version,{nextFetchAt:now+60000,data:old.value?.data?{...old.value.data,stale:true}:data});
  if(claim.applied){try{const r=await fetchFn(URL,{redirect:'manual',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('upstream_http_'+r.status);if(Number(r.headers.get('content-length'))>1500000)throw Error('limit');const reader=r.body.getReader();let size=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1500000)throw Error('limit');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}const html=new TextDecoder().decode(bytes);if(/Web firewall security policies|Access Denied|Request Rejected/i.test(html))throw Error('access_blocked');data=parseDemandPage(html,now);}catch(error){const code=error.name==='TimeoutError'?'upstream_timeout':/^(upstream_http_[0-9]{3}|access_blocked|schema_changed|missing_series|invalid_series|invalid_time|misaligned_series|body_limit|limit)$/.test(error.message)?error.message:'provider_failure';data={...(old.value?.data||data),stale:true,refreshError:true,failureCode:code};}
   await store.compareAndSwap(key,claim.version,{nextFetchAt:now+600000,data});
  }else data=old.value?.data?{...old.value.data,stale:true}:data;
 }
 if(data.date&&data.date!==day(now))data={status:'unavailable',today:[],previous:[]};else if(data.referenceAt&&now-Date.parse(data.referenceAt)>3600000)data={...data,stale:true};
 }catch{data={status:'unavailable',today:[],previous:[]};}
 const context=await contextTask;
 if(data.status!=='ok'){
  const api=await publicDemandApi(env,{store,now,fetchFn,waitUntil}).catch(()=>({status:'unavailable',reason:'shared_storage_failure'}));
  if(api.status==='ok')data=api;else data={...data,apiDiagnostic:api.reason,...(api.providerCode?{apiProviderCode:api.providerCode}:{})};
 }
 data={...data,forecast:context.forecast,contextDiagnostics:context.diagnostics};
 try{const archive=await retainDemand(store,data.status==='ok'?[...data.today,...(data.previous||[])]:[],now);const previousDate=day(now-86400000);if(data.status==='ok')data={...data,previous:archive.points.filter(p=>day(Date.parse(p.at))===previousDate).map(({at,mw})=>({at,mw})),forecast:context.forecast,comparison:yesterdayComparison(data.today,archive.points,now)};data.retention={status:'ok',count:archive.points.length,retentionHours:48,checkedAt:archive.checkedAt};}catch{data={...data,forecast:context.forecast,comparison:null,retention:{status:'unavailable'}};}
 return Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
}
