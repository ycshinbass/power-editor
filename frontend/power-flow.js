/* Daily nationwide generation only. Values must carry verified units and compatible fuels. */
const COLORS=['#2677b9','#c78024','#209c89','#9c69b8','#d65c68','#729b38','#718695','#b986a1','#508d9e'];
// Group only verified source labels; unknown labels stay independently visible.
export function displayFuelGroups(keys){
 const groups=[];for(const k of keys){const label=k.label.trim();const name=['유류','유연탄','국내탄'].includes(label)?'석탄·유류':['수력','양수'].includes(label)?'수력·양수':null;let group=name&&groups.find(g=>g.label===name);if(!group){group={key:name==='석탄·유류'?'coal-oil':name==='수력·양수'?'hydro-pumped':k.key,label:name||k.label,components:[]};groups.push(group)}group.components.push(k)}return groups;
}
const DEFAULT_WIDTH=1000,DEFAULT_HEIGHT=260;
// One pixel-based plot frame for the two mobile review charts.
export function compactChartFrame(width,height=220){return {width:Math.max(220,width),height,left:28,right:Math.max(220,width)-6,top:22,bottom:height-26,fontSize:13};}
const mountedCharts=new WeakMap();
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function koreaDay(time=Date.now()){return new Date(time+9*3600000).toISOString().slice(0,10)}
function dayStart(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return NaN;const t=Date.parse(date+'T00:00:00+09:00');return Number.isFinite(t)&&koreaDay(t)===date?t:NaN}
function number(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0}
function normalPoints(values,start,now,keys,stack){
 if(!Array.isArray(values))return [];
 const seen=new Set();const points=[];
 for(const p of values){const at=Date.parse(p?.at);if(!Number.isFinite(at)||at<start||at>=start+86400000||at>now||seen.has(at)||!number(p.total))continue;
  if(stack&&(!p.fuels||keys.some(k=>!(typeof p.fuels[k.key]==='number'&&Number.isFinite(p.fuels[k.key])))))continue;
  // Even flagged series cannot silently over-stack an incompatible total.
  if(stack){const sum=keys.reduce((n,k)=>n+p.fuels[k.key],0);if(Math.abs(sum-p.total)>Math.max(0.01,p.total*0.005))continue}
  seen.add(at);points.push({...p,at,minute:(at-start)/60000});
 }
 return points.sort((a,b)=>a.at-b.at);
}
function segments(points,interval){const result=[];for(const p of points){const prev=result.at(-1)?.at(-1);if(!prev||p.at-prev.at>interval*60000*1.01)result.push([]);result.at(-1).push(p)}return result}
function labelMinute(minute){return String(Math.floor(minute/60)).padStart(2,'0')+':'+String(Math.floor(minute%60)).padStart(2,'0')}
export function renderPowerFlow(data={},options={}){
 const WIDTH=Math.max(220,Number(options.width)||DEFAULT_WIDTH),HEIGHT=Math.max(220,Number(options.height)||DEFAULT_HEIGHT),compact=options.compact===true,frame=compactChartFrame(WIDTH,HEIGHT),RIGHT=compact?frame.right:WIDTH-22,TOP=compact?frame.top:26,BOTTOM=compact?frame.bottom:HEIGHT-46;
 const now=options.now instanceof Date?options.now.getTime():options.now??Date.now();const date=options.date||data.date||koreaDay(now);const start=dayStart(date);const validDate=Number.isFinite(start);const compare=options.compare!==false;
 const keys=Array.isArray(data.fuelKeys)?data.fuelKeys.filter(k=>k&&typeof k.key==='string'&&typeof k.label==='string').slice(0,20):[];
 const valid=data.seriesValidated===true&&['MW','GW'].includes(data.unit)&&keys.length>0&&new Set(keys.map(k=>k.key)).size===keys.length&&validDate;
 const interval=number(data.intervalMinutes)&&data.intervalMinutes>0&&data.intervalMinutes<=60?data.intervalMinutes:5;
 const scale=compact&&data.unit==='MW'?0.001:1,displayUnit=compact?'GW':data.unit;
 const convert=p=>({...p,total:p.total*scale,fuels:p.fuels?Object.fromEntries(Object.entries(p.fuels).map(([key,value])=>[key,value*scale])):undefined});
 const today=valid?normalPoints(data.today,start,now,keys,true).map(convert):[];
 const previous=valid&&compare?normalPoints(data.previous,start-86400000,Math.min(now,start),[],false).map(convert):[];
 const all=[...today,...previous];const maxValue=Math.max(0,...all.map(p=>p.total),...today.map(p=>keys.reduce((n,k)=>n+Math.max(0,p.fuels[k.key]),0)));const ymin=Math.min(0,...today.map(p=>keys.reduce((n,k)=>n+Math.min(0,p.fuels[k.key]),0)))*1.2;const rawYmax=maxValue>0?Math.ceil(maxValue/4/10**Math.floor(Math.log10(maxValue/4)))*10**Math.floor(Math.log10(maxValue/4))*4:1;
 const ymax=compact?Math.max(4,Math.ceil(rawYmax/4)*4):rawYmax;
 const LEFT=compact?frame.left:Math.max(66,Math.min(106,ymax.toLocaleString('ko-KR').length*8+12));
 const x=minute=>LEFT+minute/1440*(RIGHT-LEFT),y=value=>BOTTOM-(value-ymin)/(ymax-ymin)*(BOTTOM-TOP);
 let svg=`<title>전국 발전원별 하루 추이</title><desc>${escape(date)} 한국시간 00시부터 24시. 확인한 자료만 표시하며 미수집 구간은 비웁니다. 전일 합계는 점선입니다.</desc>`;
 for(let i=0;i<=4;i++){const value=ymax*i/4;svg+=`<line x1="${LEFT}" x2="${RIGHT}" y1="${y(value)}" y2="${y(value)}" stroke="var(--chart-grid,#dfe7e9)"/>`;if(all.length)svg+=`<text x="${LEFT-(compact?4:9)}" y="${y(value)+4}" text-anchor="end" font-size="13" fill="var(--chart-text,#536b78)">${compact?String(Math.round(value)):Number(value.toPrecision(4)).toLocaleString('ko-KR')}</text>`}
 for(const h of (!compact&&WIDTH<360?[0,8,16,24]:[0,6,12,18,24]))svg+=`<text x="${x(h*60)}" y="${compact?HEIGHT-7:HEIGHT-15}" text-anchor="${compact&&h===0?'start':compact&&h===24?'end':'middle'}" font-size="13" fill="var(--chart-text,#536b78)">${String(h).padStart(2,'0')}${compact?(h===24?'시':''):':00'}</text>`;
 if(all.length)svg+=`<text x="${compact?LEFT-4:LEFT}" y="14" text-anchor="${compact?'end':'start'}" font-size="13" fill="var(--chart-text,#536b78)">${displayUnit}</text>`;
 const groups=displayFuelGroups(keys);
 // Keep each source group's existing color while stacking baseload first.
 const groupColors=new Map(groups.map((g,i)=>[g,COLORS[i%COLORS.length]]));
 const stackOrder=['원자력','석탄·유류','가스','신재생','수력·양수'];
 const rank=g=>{const index=stackOrder.indexOf(g.label.trim());return index<0?stackOrder.length:index};
 groups.sort((a,b)=>rank(a)-rank(b));
 const groupPart=(p,g,sign)=>g.components.reduce((sum,k)=>sum+(sign>0?Math.max(0,p.fuels[k.key]):Math.min(0,p.fuels[k.key])),0);
 const runs=segments(today,interval);
 for(let j=0;j<groups.length;j++)for(const sign of [1,-1])for(const run of runs){
  if(!run.some(p=>groupPart(p,groups[j],sign)!==0))continue;
  const above=run.map(p=>[x(p.minute),y(groups.slice(0,j+1).reduce((s,g)=>s+groupPart(p,g,sign),0))]);
  const below=run.map(p=>[x(p.minute),y(groups.slice(0,j).reduce((s,g)=>s+groupPart(p,g,sign),0))]);
  if(run.length===1)svg+=`<line data-fuel="${escape(groups[j].key)}" data-sign="${sign}" x1="${above[0][0]}" x2="${above[0][0]}" y1="${above[0][1]}" y2="${below[0][1]}" stroke="${groupColors.get(groups[j])}" stroke-width="2"/>`;
  else svg+=`<path data-fuel="${escape(groups[j].key)}" data-sign="${sign}" d="M${above.map(p=>p.join(',')).join(' L')} L${below.reverse().map(p=>p.join(',')).join(' L')} Z" fill="${groupColors.get(groups[j])}" stroke="var(--chart-boundary,#fff)" stroke-width="0.8" stroke-linejoin="round"/>`;
 }
 if(ymin<0)svg+=`<line x1="${LEFT}" x2="${RIGHT}" y1="${y(0)}" y2="${y(0)}" stroke="#71818b"/>`+(compact?'':`<text x="${RIGHT}" y="${BOTTOM+12}" text-anchor="end" font-size="10" fill="var(--chart-text,#536b78)">음수 출력 · 합계에 반영</text>`);
 for(const run of runs)if(run.length>1)svg+=`<path data-comparison="today" d="M${run.map(p=>[x(p.minute),y(p.total)].join(',')).join(' L')}" fill="none" stroke="var(--chart-total,#142f44)" stroke-width="2"/>`;

 for(const run of segments(previous,interval)){if(run.length===1)svg+=`<circle cx="${x(run[0].minute)}" cy="${y(run[0].total)}" r="2" fill="var(--chart-previous,#526c7a)"/>`;else svg+=`<path data-comparison="previous" d="M${run.map(p=>[x(p.minute),y(p.total)].join(',')).join(' L')}" fill="none" stroke="var(--chart-previous,#526c7a)" stroke-width="2" stroke-dasharray="6 5"/>`}
 if(!all.length)svg+=`<text x="${WIDTH/2}" y="${HEIGHT/2}" text-anchor="middle" font-size="13" fill="var(--chart-text,#536b78)">확인된 하루 추이 자료 없음</text>`;
 const status=all.length?`${date} · 당일 ${today.length}개${compare?' · 전일 '+previous.length+'개':''} 확인 · 미수집 구간은 공백${data.reason?' · 갱신 실패 · 이전 자료':data.stale?' · 자료 지연':''}`:data.message||(data.reason==='refresh_pending'?'공식 자료 수집 중 · 잠시 후 새로고침해 주세요.':data.reason==='provider_timeout'?'제공처 응답 지연 · 확인되지 않은 수치는 표시하지 않습니다.':null)||'하루 추이 연동 대기 · 확인되지 않은 수치는 표시하지 않습니다.';
 const rows=today.map(p=>({minute:p.minute,time:labelMinute(p.minute),total:p.total,fuels:groups.map(g=>({label:g.label,value:g.components.reduce((sum,k)=>sum+p.fuels[k.key],0),components:g.components.map(k=>({label:k.label,value:p.fuels[k.key]}))}))}));
 return {svg,geometry:{width:WIDTH,height:HEIGHT,left:LEFT,right:RIGHT},legend:valid?groups.map(k=>({label:k.label,color:groupColors.get(k)})):[],rows,status,hasData:all.length>0,unit:valid?displayUnit:null,date,intervalMinutes:interval};
}
export function mountPowerFlow(element,data,options={},targets={}){
 const box=element.getBoundingClientRect();const result=renderPowerFlow(data,{...options,width:box.width||options.width,height:box.height||options.height});const {width:WIDTH,height:HEIGHT,left:LEFT,right:RIGHT}=result.geometry;element.setAttribute('viewBox',`0 0 ${WIDTH} ${HEIGHT}`);element.setAttribute('role','img');element.setAttribute('aria-label','전국 발전원별 하루 추이');element.innerHTML=result.svg;
 if(targets.statusElement)targets.statusElement.textContent=result.status;
 if(targets.legendElement){targets.legendElement.replaceChildren();for(const item of result.legend){const label=document.createElement('span');const dot=document.createElement('i');dot.style.backgroundColor=item.color;dot.className='flow-dot';label.append(dot,document.createTextNode(item.label));targets.legendElement.append(label)}if(result.hasData){const label=document.createElement('span');label.textContent='━ 당일 합계 (음수 포함)';targets.legendElement.append(label)}if(result.hasData&&options.compare!==false){const label=document.createElement('span');label.textContent='┄ 전일 합계';targets.legendElement.append(label)}}
 const format=value=>options.compact?value.toFixed(1):value.toLocaleString('ko-KR');
 const tooltip=targets.tooltipElement;if(tooltip){const fallback='그래프에서 시간을 가리키면 확인된 발전원별 수치를 볼 수 있습니다.';tooltip.textContent=result.hasData?fallback:'자료 연결 후 시간별 발전원 구성과 전일 합계를 표시합니다.';element.onpointermove=e=>{const box=element.getBoundingClientRect();const minute=Math.max(0,Math.min(1440,((e.clientX-box.left)/box.width*WIDTH-LEFT)/(RIGHT-LEFT)*1440));const nearest=result.rows.reduce((best,p)=>!best||Math.abs(p.minute-minute)<Math.abs(best.minute-minute)?p:best,null);tooltip.textContent=nearest&&Math.abs(nearest.minute-minute)<=result.intervalMinutes/2?`${nearest.time} · 합계 ${format(nearest.total)} ${result.unit} · `+nearest.fuels.map(f=>`${f.label} ${format(f.value)}${f.components.length>1?' ('+f.components.map(c=>c.label+' '+format(c.value)).join(', ')+')':''}`).join(' / '):`${labelMinute(minute)} · 확인된 당일 자료 없음`}}
 const mounted=mountedCharts.get(element);if(mounted){mounted.data=data;mounted.options=options;mounted.targets=targets;mounted.width=box.width;mounted.height=box.height}else if(typeof ResizeObserver!=='undefined'){const state={data,options,targets,width:box.width,height:box.height};const observer=new ResizeObserver(()=>{const size=element.getBoundingClientRect();if(size.width>0&&(Math.abs(size.width-state.width)>0.5||Math.abs(size.height-state.height)>0.5))mountPowerFlow(element,state.data,state.options,state.targets)});state.observer=observer;mountedCharts.set(element,state);observer.observe(element)}
 return result;
}
