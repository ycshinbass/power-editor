import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPowerFlow,koreaDay,compactChartFrame} from '../frontend/power-flow.js';
const date='2026-11-02',now=Date.parse(date+'T12:00:00+09:00');
const point=(time,total=30,fuels={nuclear:20,gas:10})=>({at:date+'T'+time+':00+09:00',total,fuels});
const sample={date,unit:'MW',seriesValidated:true,intervalMinutes:5,fuelKeys:[{key:'nuclear',label:'원자력'},{key:'gas',label:'가스'}],today:[point('00:00'),point('00:05'),point('00:15'),point('00:20'),point('13:00')],previous:[{at:'2026-11-01T00:00:00+09:00',total:29},{at:'2026-11-01T00:05:00+09:00',total:28}]};
test('compact review converts verified MW into GW, preserves source and shares mobile plot frame',()=>{
 const source={...sample,today:[point('00:00',54603,{nuclear:30000,gas:24603})],previous:[]};
 const original=JSON.stringify(source),r=renderPowerFlow(source,{now,compact:true,width:332,height:220});
 assert.equal(JSON.stringify(source),original);assert.equal(r.unit,'GW');assert.ok(Math.abs(r.rows[0].total-54.603)<1e-8);
 assert.equal(r.geometry.left,compactChartFrame(332).left);assert.equal(r.geometry.right,326);
 assert.ok((r.geometry.right-r.geometry.left)/332>.89);assert.match(r.svg,/>GW<\/text>/);assert.match(r.svg,/>60<\/text>/);assert.doesNotMatch(r.svg,/>\d+\.\d+<\/text>/);
 const native=renderPowerFlow({...source,unit:'GW',today:[point('00:00',54.603,{nuclear:30,gas:24.603})]},{now,compact:true});assert.equal(native.rows[0].total,54.603);
 assert.equal(renderPowerFlow({...source,unit:'invalid'},{now,compact:true}).hasData,false);
});
test('compact tooltip formats signed source values to one decimal in GW',async()=>{
 const {mountPowerFlow}=await import('../frontend/power-flow.js');
 const source={...sample,fuelKeys:[{key:'nuclear',label:'원자력'},{key:'fuelPwr5',label:'양수'}],today:[point('00:00',29600,{nuclear:30000,fuelPwr5:-400})],previous:[]};
 const el={setAttribute(){},getBoundingClientRect:()=>({left:0,width:332,height:220}),innerHTML:''},tooltip={textContent:''};
 const r=mountPowerFlow(el,source,{now,compact:true},{tooltipElement:tooltip});el.onpointermove({clientX:r.geometry.left});
 assert.match(tooltip.textContent,/합계 29\.6 GW/);assert.match(tooltip.textContent,/수력·양수 -0\.4/);assert.match(tooltip.textContent,/원자력 30\.0/);
});
test('24 hour graph keeps gaps split and future values absent',()=>{const r=renderPowerFlow(sample,{now});assert.equal(r.rows.length,4);assert.equal((r.svg.match(/data-fuel="nuclear"/g)||[]).length,2);assert.match(r.svg,/24:00/);assert.match(r.svg,/stroke-dasharray="6 5"/);assert.equal(r.rows.some(p=>p.time==='13:00'),false)});
test('never draws values without verified units and compatible source series',()=>{for(const patch of [{seriesValidated:false},{unit:undefined},{unit:'gateway'}]){const r=renderPowerFlow({...sample,...patch},{now});assert.equal(r.hasData,false);assert.equal(r.rows.length,0);assert.doesNotMatch(r.svg,/data-fuel/)}const r=renderPowerFlow({...sample,today:[point('00:00',100)],previous:[]},{now});assert.equal(r.rows.length,0)});
test('missing fuel, numeric strings, duplicate dates and invalid time discarded',()=>{const r=renderPowerFlow({...sample,today:[point('00:00'),point('00:00'),point('00:05',30,{nuclear:20}),point('00:10','30'),{at:'bad',total:30}],previous:[]},{now});assert.equal(r.rows.length,1)});
test('comparison can be disabled and real zero measurements stay zero',()=>{const r=renderPowerFlow({...sample,today:[point('00:00',0,{nuclear:0,gas:0})]},{now,compare:false});assert.equal(r.rows[0].total,0);assert.doesNotMatch(r.svg,/data-comparison/);assert.equal(r.hasData,true)});
test('empty graph has axes but no fabricated units or values',()=>{const r=renderPowerFlow({status:'not_connected'},{now});assert.equal(r.hasData,false);assert.equal(r.unit,null);assert.match(r.svg,/00:00/);assert.match(r.svg,/자료 없음/);assert.doesNotMatch(r.svg,/NaN|undefined/)});
test('Korea date and hostile labels are safe',()=>{assert.equal(koreaDay(Date.parse('2026-11-01T15:01:00Z')),'2026-11-02');const r=renderPowerFlow({...sample,date:'<script>'},{now});assert.doesNotMatch(r.svg,/<script>/);assert.equal(r.hasData,false)});
test('responsive geometry keeps readable type and ticks inside narrow and wide boxes',()=>{
 for(const width of [254,324,702,1118]){const r=renderPowerFlow(sample,{now,width,height:260});assert.equal(r.geometry.width,width);assert.equal(r.geometry.height,260);assert.ok(r.geometry.right>r.geometry.left);assert.match(r.svg,/font-size="13"/);assert.match(r.svg,/24:00/);assert.equal((r.svg.match(/:00<\/text>/g)||[]).length,width<360?4:5);assert.doesNotMatch(r.svg,/NaN|undefined/)}
});
test('large y-axis values reserve enough left margin and missing data stays inside the box',()=>{
 const big=renderPowerFlow({...sample,today:[point('00:00',1000000,{nuclear:700000,gas:300000})],previous:[]},{now,width:254});assert.ok(big.geometry.left>=84);assert.ok(big.geometry.right>big.geometry.left);const empty=renderPowerFlow({}, {now,width:254});assert.match(empty.svg,/x="127"/);assert.equal(empty.hasData,false);
});
test('mounted chart follows resize without stacking observers or losing pointer coordinates',async()=>{
 const {mountPowerFlow}=await import('../frontend/power-flow.js');let size={left:10,width:324,height:260},callback,observations=0;
 const OldObserver=globalThis.ResizeObserver;globalThis.ResizeObserver=class{constructor(fn){callback=fn}observe(){observations++}};
 try{const attrs={},el={setAttribute(k,v){attrs[k]=v},getBoundingClientRect:()=>size,innerHTML:''},tooltip={textContent:''};const r=mountPowerFlow(el,sample,{now},{tooltipElement:tooltip});assert.equal(attrs.viewBox,'0 0 324 260');assert.equal(observations,1);el.onpointermove({clientX:10+r.geometry.left});assert.match(tooltip.textContent,/00:00 · 합계 30 MW/);size={...size,width:702};callback();assert.equal(attrs.viewBox,'0 0 702 260');assert.equal(observations,1);mountPowerFlow(el,sample,{now});assert.equal(observations,1)}finally{if(OldObserver===undefined)delete globalThis.ResizeObserver;else globalThis.ResizeObserver=OldObserver}
});
const groupedKeys=[{key:'fuelPwr1',label:'수력'},{key:'fuelPwr2',label:'유류'},{key:'fuelPwr3',label:'유연탄'},{key:'fuelPwr4',label:'원자력'},{key:'fuelPwr5',label:'양수'},{key:'fuelPwr6',label:'가스'},{key:'fuelPwr7',label:'국내탄'},{key:'fuelPwr8',label:'신재생'},{key:'other',label:'알 수 없는 원료'}];
const groupedValues={fuelPwr1:8,fuelPwr2:2,fuelPwr3:10,fuelPwr4:30,fuelPwr5:-12,fuelPwr6:20,fuelPwr7:3,fuelPwr8:7,other:1};
const grouped={...sample,fuelKeys:groupedKeys,today:[point('00:00',69,groupedValues),point('00:05',69,groupedValues)]};
test('UI fuel groups preserve signed total, separate negative pumping and unknown labels',()=>{const before=JSON.stringify(grouped),r=renderPowerFlow(grouped,{now});assert.equal(JSON.stringify(grouped),before);assert.equal(r.rows[0].total,69);assert.equal(r.rows[0].fuels.find(f=>f.label==='석탄·유류').value,15);const hydro=r.rows[0].fuels.find(f=>f.label==='수력·양수');assert.equal(hydro.value,-4);assert.deepEqual(hydro.components.map(f=>f.value),[8,-12]);assert.equal(r.legend.length,6);assert.ok(r.legend.some(f=>f.label==='알 수 없는 원료'));assert.match(r.svg,/data-fuel="hydro-pumped" data-sign="1"/);assert.match(r.svg,/data-fuel="hydro-pumped" data-sign="-1"/);assert.match(r.svg,/stroke-width="0.8"/);assert.match(r.svg,/data-comparison="previous"/)});
test('missing component still invalidates grouped series, no fabricated zero',()=>{const fuels={...groupedValues};delete fuels.fuelPwr2;assert.equal(renderPowerFlow({...grouped,today:[point('00:00',69,fuels)]},{now}).rows.length,0)});
test('grouped tooltip exposes original components and signed net',async()=>{const{mountPowerFlow}=await import('../frontend/power-flow.js');const el={setAttribute(){},getBoundingClientRect:()=>({left:0,width:324,height:260}),innerHTML:''},tooltip={textContent:''};const r=mountPowerFlow(el,grouped,{now},{tooltipElement:tooltip});el.onpointermove({clientX:r.geometry.left});assert.match(tooltip.textContent,/수력·양수 -4 \(수력 8, 양수 -12\)/);assert.match(tooltip.textContent,/석탄·유류 15 \(유류 2, 유연탄 10, 국내탄 3\)/)});
test('baseload stack and legend share order without changing source-group colors or signed pumping',()=>{
 const r=renderPowerFlow({...grouped,today:[point('00:00',69,groupedValues)]},{now});
 assert.deepEqual(r.legend,[{label:'원자력',color:'#209c89'},{label:'석탄·유류',color:'#c78024'},{label:'가스',color:'#9c69b8'},{label:'신재생',color:'#d65c68'},{label:'수력·양수',color:'#2677b9'},{label:'알 수 없는 원료',color:'#729b38'}]);
 assert.deepEqual(r.rows[0].fuels.map(f=>f.label),r.legend.map(f=>f.label));
 const line=(key,sign=1)=>{const tag=r.svg.match(new RegExp(`<line data-fuel="${key}" data-sign="${sign}"[^>]+>`))?.[0];assert.ok(tag);return{top:Number(tag.match(/y1="([^"]+)"/)[1]),bottom:Number(tag.match(/y2="([^"]+)"/)[1]),color:tag.match(/stroke="([^"]+)"/)[1]}};
 const order=['fuelPwr4','coal-oil','fuelPwr6','fuelPwr8','hydro-pumped','other'];
 const zero=line('hydro-pumped',-1).bottom;
 assert.equal(line(order[0]).bottom,zero);
 for(let i=0;i<order.length;i++){const area=line(order[i]);assert.ok(area.top<area.bottom);assert.equal(area.color,r.legend[i].color);if(i)assert.equal(area.bottom,line(order[i-1]).top)}
 assert.ok(line('hydro-pumped',-1).top>zero);
 assert.equal(r.rows[0].total,69);assert.equal(r.unit,'MW');assert.match(r.svg,/data-comparison="previous"/);
});
test('baseload order is independent of provider order and retains unknown groups',()=>{
 const r=renderPowerFlow({...grouped,fuelKeys:[...groupedKeys].reverse()},{now});
 assert.deepEqual(r.legend.map(f=>f.label),['원자력','석탄·유류','가스','신재생','수력·양수','알 수 없는 원료']);
 assert.equal(r.rows[0].total,69);assert.deepEqual(r.rows[0].fuels.find(f=>f.label==='수력·양수').components.map(f=>f.value),[-12,8]);
});
