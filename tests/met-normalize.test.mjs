import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeMet} from '../worker/met-normalize.mjs';
const H=3600000,T=Date.parse('2026-10-31T19:00:00Z'),checked='2026-10-31T19:19:00Z';
function body(){return {properties:{meta:{updated_at:'2026-10-31T18:00:00Z',units:{air_temperature:'celsius',wind_speed:'m/s',precipitation_amount:'mm'}},timeseries:Array.from({length:80},(_,i)=>({time:new Date(T+i*H).toISOString(),data:{instant:{details:{wind_speed:i}},next_1_hours:{details:{precipitation_amount:0.1}}}}))}};}
test('three rolling 24-hour windows start at next hour, explicitly not midnight totals',()=>{
 const w=normalizeMet(body(),'순천',checked);assert.equal(w.periodKind,'rolling24h');assert.equal(w.days.length,3);
 assert.equal(w.days[0].periodStart,'2026-10-31T20:00:00.000Z');assert.equal(w.days[0].periodEnd,'2026-11-01T20:00:00.000Z');assert.equal(w.days[0].date,'2026-11-01');assert.equal(w.days[0].rainMm,2.4);assert.equal(w.days[0].windMs,24);assert.equal(w.days[0].coverageHours,24);
 assert.equal(w.days[0].gustMs,null);assert.equal(w.days[0].snowCm,null);assert.equal(w.sourceUpdatedAt,'2026-10-31T18:00:00Z');
});
test('missing hour cannot be treated as zero or contiguous coverage',()=>{
 const b=body();b.properties.timeseries.splice(8,1);const w=normalizeMet(b,'순천',checked);assert.equal(w.days[0].rainMm,null);assert.equal(w.days[0].windMs,null);assert.equal(w.days[0].coverageHours,23);assert.equal(w.days[1].rainMm,2.4);
});
test('missing next-hour detail or six-hour rain never substitutes; absent wind distinct',()=>{
 const b=body();delete b.properties.timeseries[5].data.next_1_hours;b.properties.timeseries[5].data.next_6_hours={details:{precipitation_amount:0}};let w=normalizeMet(b,'순천',checked);assert.equal(w.days[0].rainMm,null);assert.equal(w.days[0].windMs,24);
 delete b.properties.timeseries[30].data.instant.details.wind_speed;w=normalizeMet(b,'순천',checked);assert.equal(w.days[1].windMs,null);assert.equal(w.days[1].rainMm,2.4);
});
test('duplicate/reversed times, wrong/missing units, future/stale update rejected',()=>{
 for(const mutate of [b=>b.properties.timeseries[2].time=b.properties.timeseries[1].time,b=>b.properties.timeseries.reverse(),b=>delete b.properties.meta.units.wind_speed,b=>b.properties.meta.units.precipitation_amount='cm',b=>b.properties.meta.updated_at='2026-10-31T20:00:00Z',b=>b.properties.meta.updated_at='2026-10-29T18:00:00Z']){const b=body();mutate(b);assert.throws(()=>normalizeMet(b,'순천',checked));}
});
test('incomplete later windows remain unknown; exact-hour request starts that hour',()=>{
 const b=body();b.properties.timeseries=b.properties.timeseries.slice(0,49);const w=normalizeMet(b,'순천','2026-10-31T19:00:00Z');
 assert.equal(w.days[0].periodStart,'2026-10-31T19:00:00.000Z');assert.equal(w.days[2].rainMm,null);assert.equal(w.days[2].windMs,null);assert.equal(w.days[2].coverageHours,1);
});
test('cached source freshness is evaluated at serving time while fetchedAt stays original',()=>{const later=new Date(Date.parse(checked)+2*H).toISOString(),w=normalizeMet(body(),'순천',checked,later);assert.equal(w.checkedAt,checked);assert.equal(w.days[0].periodStart,'2026-10-31T22:00:00.000Z');assert.throws(()=>normalizeMet(body(),'순천',checked,new Date(Date.parse(checked)+37*H).toISOString()),e=>e.code==='stale_source')});
