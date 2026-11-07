import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const context=vm.createContext({URLSearchParams,location:{search:''},koreaDay:(now=Date.now())=>new Date(now+32400000).toISOString().slice(0,10)});
vm.runInContext(readFileSync(new URL('../frontend/naver-preview.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,''),context);
const curve=(points,x=h=>h,y=v=>v)=>context.forecastDisplayPath(points,x,y);
const points=values=>values.map((mw,i)=>({hour:i+1,mw}));
function segments(path){return [...path.matchAll(/C([\d., -]+)/g)].map(m=>m[1].trim().split(/[ ,]+/).map(Number));}
test('hourly curve retains all 24 official knots and never overshoots their ranges',()=>{
 const source=points([56965,54783,53598,52888,53293,54921,58062,62676,63212,59445,56213,53112,49554,53578,57005,61223,66767,69253,68373,66877,65262,63470,62607,61094]),copy=JSON.stringify(source),path=curve(source),parts=segments(path);
 assert.equal(parts.length,23);assert.match(path,/^M1\.000,56\.965/);assert.equal(JSON.stringify(source),copy);
 parts.forEach(([x1,y1,x2,y2,x3,y3],i)=>{
  const a=source[i],b=source[i+1],lo=Math.min(a.mw,b.mw)/1000,hi=Math.max(a.mw,b.mw)/1000;
  assert.equal(x3,b.hour);assert.equal(y3,b.mw/1000);assert.ok(x1>a.hour&&x2<x3);
  let prior=a.mw/1000;
  for(let n=0;n<=100;n++){const t=n/100,u=1-t,y=u**3*a.mw/1000+3*u*u*t*y1+3*u*t*t*y2+t**3*y3;
   assert.ok(y>=lo-.001&&y<=hi+.001,'overshoot at hour '+b.hour);assert.ok((hi===lo||b.mw>=a.mw?y-prior:prior-y)>=-.001);prior=y;}
 });
 assert.ok(!path.includes('M0.000'));assert.ok(!path.includes('25.000'));
});
test('flat hours and sharp changes preserve extrema without spurious peaks',()=>{
 const source=points([50000,50000,100000,10000,10000]);const parts=segments(curve(source));
 assert.deepEqual(parts[0].filter((_,i)=>i%2),[50,50,50]);assert.deepEqual(parts[3].filter((_,i)=>i%2),[10,10,10]);
 assert.equal(parts[1][3],100);assert.equal(parts[2][1],100); // horizontal tangent at the official peak
});
test('missing, invalid and reversed hours break the curve instead of inventing data',()=>{
 for(const source of [[{hour:1,mw:50000},{hour:3,mw:60000}],[{hour:1,mw:50000},{hour:2,mw:null},{hour:3,mw:60000}],[{hour:2,mw:50000},{hour:1,mw:60000}]]){
  const path=curve(source);assert.equal(segments(path).length,0);assert.equal((path.match(/M/g)||[]).length,2);
 }
 assert.equal(curve([]),'');
});
test('only forecast changes to cubic; actual and previous retain real gaps and mini stays unchanged',()=>{
 const now=Date.parse('2026-11-06T03:00:00Z'),sample=(at,mw)=>({at,mw});
 const data={status:'ok',date:'2026-11-06',today:[sample('2026-11-06T00:00:00Z',60000),sample('2026-11-06T00:05:00Z',61000),sample('2026-11-06T00:20:00Z',62000)],previous:[],forecast:{status:'ok',date:'2026-11-06',points:points(Array(24).fill(60000))}},frame={left:25,right:355,top:25,bottom:190,height:220};
 const drawing=context.liveDemandDrawing(data,frame,{now});assert.match(drawing,/<path d="[^"]*C[^"]*" class="demand-line predicted"/);
 const actual=drawing.match(/<path d="([^"]*)" class="demand-line actual"/)[1];assert.equal((actual.match(/M/g)||[]).length,2);assert.equal((actual.match(/L/g)||[]).length,1);assert.ok(!actual.includes('C'));
 assert.doesNotMatch(context.liveDemandDrawing(data,frame,{now,mini:true}),/predicted| C/);assert.match(drawing,/표시용 보간/);
});

test('hour-end forecast intervals are centered on the real clock without shifting instantaneous actuals',()=>{
 const now=Date.parse('2026-11-06T03:00:00Z'),source=points(Array.from({length:24},(_,i)=>50000+i*1000));
 const data={status:'ok',date:'2026-11-06',today:[{at:'2026-11-06T00:00:00Z',mw:60000},{at:'2026-11-06T00:05:00Z',mw:61000}],previous:[{at:'2026-11-05T00:00:00Z',mw:59000},{at:'2026-11-05T00:05:00Z',mw:60000}],forecast:{status:'ok',date:'2026-11-06',points:source}},copy=JSON.stringify(data);
 const drawing=context.liveDemandDrawing(data,{left:0,right:240,top:20,bottom:200,height:230},{now}),path=drawing.match(/<path d="([^"]*)" class="demand-line predicted"/)[1],parts=segments(path);
 assert.match(path,/^M5\.000,/); // 01h = 00–01, displayed at 00:30
 assert.equal(parts.length,23);assert.equal(parts[4][4],55); // 06h = 05–06, at 05:30
 assert.equal(parts.at(-1)[4],235); // 24h = 23–24, at 23:30; no extrapolated midnight
 for(const kind of ['actual','baseline'])assert.match(drawing.match(new RegExp('<path d="([^"]*)" class="demand-line '+kind+'"'))[1],/^M90\.000,.* L90\.833,/); // 09:00 and 09:05 KST
 assert.equal(JSON.stringify(data),copy);assert.match(drawing,/1시간 구간의 중앙/);
});

test('only a real previous-day final forecast connects across midnight and is clipped at 00:00',()=>{
 const now=Date.parse('2026-11-06T03:00:00Z'),forecast={status:'ok',date:'2026-11-06',points:points(Array.from({length:24},(_,i)=>50000+i*1000)),previousTail:{date:'2026-11-05',hour:24,mw:52000}},data={status:'unavailable',forecast},copy=JSON.stringify(data),frame={left:0,right:240,top:20,bottom:200,height:230};
 const drawing=context.liveDemandDrawing(data,frame,{now}),path=drawing.match(/<path d="([^"]*)" class="demand-line predicted"/)[1],parts=segments(path);
 assert.match(path,/^M-5\.000,188\.000/);assert.equal(parts.length,24);assert.equal(parts[0][4],5); // yesterday 23:30 → today 00:30
 const [x1,y1,x2,y2,x3,y3]=parts[0];
 assert.ok(Math.abs((-5+3*x1+3*x2+x3)/8)<.001); // cubic at midnight (t=.5)
 const midnightY=(188+3*y1+3*y2+y3)/8;assert.ok(midnightY>=188&&midnightY<=200);
 assert.match(drawing,/<clipPath id="demand-forecast-clip"><rect x="0" y="20" width="240" height="180"/);assert.match(drawing,/clip-path="url\(#demand-forecast-clip\)"/);
 assert.equal(parts.at(-1)[4],235);assert.equal(JSON.stringify(data),copy);assert.match(drawing,/00시는 전날 마지막 구간/);
 for(const patch of [{date:'2026-11-04'},{date:'2026-11-06'},{hour:23},{mw:null},{mw:0},{mw:Infinity}]){
  const invalid={...data,forecast:{...forecast,previousTail:{...forecast.previousTail,...patch}}};
  assert.match(context.liveDemandDrawing(invalid,frame,{now}),/<path d="M5\.000,/);
 }
});
