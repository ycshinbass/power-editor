import test from 'node:test';import assert from 'node:assert/strict';import {koreaClock,startKoreaClock} from '../frontend/logic.js';
test('Korea date, weekday and seconds are independent of UTC/browser timezone',()=>{
 assert.equal(koreaClock(new Date('2026-11-01T08:30:09Z')),'2026.11.01 (일) 17:30:09');
 assert.equal(koreaClock(new Date('2026-12-31T14:59:59Z')),'2026.12.31 (목) 23:59:59');
 assert.equal(koreaClock(new Date('2026-12-31T15:00:00Z')),'2027.01.01 (금) 00:00:00');
});
test('clock ticks locally, pauses hidden and immediately catches up on visibility',()=>{
 let date=new Date('2026-12-31T14:59:59Z'),tick,listener,clears=0;
 const el={},doc={hidden:false,addEventListener:(type,fn)=>{assert.equal(type,'visibilitychange');listener=fn},removeEventListener:(type,fn)=>{assert.equal(fn,listener);listener=null}};
 const timers={setInterval:(fn,ms)=>{assert.equal(ms,1000);tick=fn;return 1},clearInterval:()=>{clears++;tick=null}};
 const stop=startKoreaClock(el,doc,timers,()=>date);assert.match(el.textContent,/23:59:59$/);
 date=new Date('2026-12-31T15:00:00Z');tick();assert.equal(el.textContent,'2027.01.01 (금) 00:00:00');assert.equal(el.dateTime,date.toISOString());
 doc.hidden=true;listener();assert.equal(tick,null);
 date=new Date('2026-12-31T17:12:13Z');doc.hidden=false;listener();assert.match(el.textContent,/02:12:13$/);assert.equal(typeof tick,'function');
 stop();assert.equal(tick,null);assert.equal(listener,null);assert.equal(clears,2);
});
