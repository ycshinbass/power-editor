import {createD1SnapshotStore} from './snapshot-d1.mjs';
import {publicForecastApi} from './demand-api.mjs';
const DAY=86400000,HOUR=3600000;
const kday=n=>new Date(n+32400000).toISOString().slice(0,10);
export function parseHistoricDemand(html,date){
 const code=html.split('function drawChart(par1, par2, par3){')[1]?.split('function drawChart2')[0];
 if(!code||!code.includes('현재수요(전력시장)')||!code.includes('"data": x'))throw Error('history_schema');
 const arr=name=>{const raw=code.match(new RegExp('var '+name+'\\s*=\\s*\\[([\\d,\\s]+)\\]'))?.[1];if(!raw)throw Error('history_missing');return raw.split(',').map(s=>Number(s.trim()));};
 const values=arr('x'),times=arr('t_time'),prefix=date.replaceAll('-','');
 if(values.length!==288||times.length!==288)throw Error('history_incomplete');
 return values.map((mw,i)=>{const h=Math.floor(i/12),m=i%12*5,stamp=prefix+String(h).padStart(2,'0')+String(m).padStart(2,'0')+'00';if(String(times[i])!==stamp||!Number.isFinite(mw)||mw<=0||mw>200000)throw Error('history_invalid');return {hour:h,minute:m,mw};});
}
export function parseDayAhead(html,date){
 if(!html.includes('하루전 발전계획용 수요예측')||!html.includes('단위 : MW'))throw Error('forecast_definition');
 const declared=html.match(/id="issue_date"[^>]*value="(\d{4}-\d{2}-\d{2})"/)?.[1];if(declared!==date)throw Error('forecast_date');
 const table=html.split('<th scope="col">구분</th>')[1]?.split('</table>')[0];if(!table)throw Error('forecast_table');
 const headings=[...table.matchAll(/<th scope="col">(\d{2}\.\d{2})<br\/?>(?:.|\n|\r)*?<\/th>/g)];
 const wanted=date.slice(5).replace('-','.');const index=headings.findIndex(m=>m[1]===wanted);if(index<0||headings.filter(m=>m[1]===wanted).length!==1)throw Error('forecast_column');
 const points=[...table.matchAll(/<tr>\s*<td>(\d{1,2})h<\/td>([\s\S]*?)<\/tr>/g)].map(m=>{const cells=[...m[2].matchAll(/<td>\s*([\d,]+)\s*<\/td>/g)];if(cells.length!==headings.length)throw Error('forecast_cells');return {hour:Number(m[1]),mw:Number(cells[index][1].replaceAll(',',''))};});
 if(points.length!==24||points.some((p,i)=>p.hour!==i+1||!Number.isFinite(p.mw)||p.mw<=0||p.mw>200000))throw Error('forecast_values');return points;
}
export function fourWeekComparison(today,histories,now=Date.now()){
 const date=kday(now),start=Date.parse(date+'T00:00:00+09:00'),latest=Math.max(...today.map(p=>Date.parse(p.at)));
 const hour=Math.floor((Math.min(latest,now)-start)/HOUR)-1;
 if(hour<0||hour>23||histories.length!==4)return null;
 const current=today.filter(p=>Date.parse(p.at)>=start+hour*HOUR&&Date.parse(p.at)<start+(hour+1)*HOUR);
 if(current.length!==12||current.some((p,i)=>Date.parse(p.at)!==start+hour*HOUR+i*300000))return null;
 const means=histories.map(h=>{const rows=h.points.filter(p=>p.hour===hour);if(rows.length!==12||rows.some((p,i)=>p.minute!==i*5))return null;return rows.reduce((s,p)=>s+p.mw,0)/12;});
 if(means.some(v=>!Number.isFinite(v)||v<=0))return null;
 const actualMw=current.reduce((s,p)=>s+p.mw,0)/12,baselineMw=means.reduce((s,v)=>s+v,0)/4;
 return {actualMw,baselineMw,deltaMw:actualMw-baselineMw,percent:(actualMw/baselineMw-1)*100,hour,startAt:new Date(start+hour*HOUR).toISOString(),endAt:new Date(start+(hour+1)*HOUR).toISOString(),dates:histories.map(h=>h.date),method:'national_market_5m_hour_mean',notice:'최근 완료된 1시간의 전국 전력시장 5분 수요 평균을 1·2·3·4주 전 동일요일 같은 시간 평균과 비교합니다. 공휴일·날씨 보정은 하지 않습니다.'};
}
async function textResponse(url,fetchFn){const r=await fetchFn(url,{redirect:'manual',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('upstream_http_'+r.status);if(Number(r.headers.get('content-length'))>1500000)throw Error('size');const reader=r.body.getReader(),chunks=[];let n=0;try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>1500000)throw Error('size');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}const bytes=new Uint8Array(n);let p=0;for(const c of chunks){bytes.set(c,p);p+=c.length}const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/Web firewall security policies|Access Denied|Request Rejected/i.test(text))throw Error('access_blocked');return text;}
export async function demandContext(env,{now=Date.now(),fetchFn=fetch,store=env.DB?createD1SnapshotStore(env.DB):null,waitUntil}={}){
 if(!store)return {histories:[],forecast:null};
 const date=kday(now),diagnostics={};
 const cached=async(key,ttl,run)=>{const old=await store.read(key);if(old.value?.failureCode)diagnostics[key]=old.value.failureCode;if(old.value?.failureCode==='access_blocked'||old.value?.expires>now)return old.value.data;const claim=await store.compareAndSwap(key,old.version,{expires:now+30000,data:old.value?.data||null});if(!claim.applied)return old.value?.data||null;let data;try{data=await run()}catch(error){const failureCode=error.name==='TimeoutError'?'upstream_timeout':/^[a-z_0-9]+$/.test(error.message)?error.message:'provider_failure';diagnostics[key]=failureCode;return (await store.compareAndSwap(key,claim.version,{expires:now+600000,data:old.value?.data||null,failureCode}),old.value?.data||null)}await store.compareAndSwap(key,claim.version,{expires:now+ttl,data});return data;};
 const historyTasks=[];
 const forecastTask=cached('demand:forecast:v1:'+date,HOUR,async()=>{const urls=['https://www.kpx.or.kr/pssInland.es?mid=a10404090100&device=pc','https://www.kpx.or.kr/pssJeju.es?mid=a10404090200&device=pc'];const [a,b]=await Promise.all(urls.map(async u=>parseDayAhead(await textResponse(u,fetchFn),date)));return {date,status:'ok',scope:'mainland_plus_jeju',points:a.map((p,i)=>({hour:p.hour,mw:p.mw+b[i].mw})),checkedAt:new Date(now).toISOString(),sourceUrls:urls,notice:'KPX 육지·제주 하루전 발전계획용 시간별 예측의 합산값. 시간축은 해당 1시간 구간 종료시각입니다. 5분 실적과 집계 간격이 다릅니다.'};});
 const result=await Promise.all([...historyTasks,forecastTask]);let forecast=result[0];
 if(!forecast?.previousTail&&env.KPX_FORECAST_API_VERIFIED==='true'){
  const api=await publicForecastApi(env,{store,now,fetchFn,waitUntil});
  if(api.status==='ok')forecast=api;else diagnostics.forecastApi=api.reason;
 }
 return {histories:[],forecast,diagnostics};
}
