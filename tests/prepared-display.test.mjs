import test from 'node:test';
import assert from 'node:assert/strict';
import {preparedDisplay} from '../worker/prepared-display.mjs';
const now=Date.parse('2026-11-06T03:00:00Z'),request=path=>new Request('https://example.test'+path),good=n=>({status:'ok',date:'2026-11-06',checkedAt:new Date(now).toISOString(),value:n});
function memory(){const entries=new Map();return{entries,match:async key=>entries.get(key.url)?.clone(),put:async(key,r)=>{entries.set(key.url,r.clone())}}}
const response=data=>Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
function context(){const jobs=[];return{jobs,waitUntil:p=>jobs.push(p)}}
test('shared prepared response reuses identical public data for ten minutes without calling the provider',async()=>{
 const cache=memory(),ctx=context();let calls=0;const load=async()=>{calls++;return response(good(1))};
 const a=await preparedDisplay(request('/api/power-demand'),ctx,load,{cache,now});assert.equal(a.headers.get('X-Editor-Snapshot'),'miss');await a.json();
 const b=await preparedDisplay(request('/api/power-demand'),ctx,load,{cache,now:now+599999});assert.equal(b.headers.get('X-Editor-Snapshot'),'hit');assert.equal((await b.json()).value,1);assert.equal(calls,1);assert.equal(ctx.jobs.length,0);
});
test('an aged snapshot returns immediately while one background refresh runs; timestamps are preserved',async()=>{
 const cache=memory(),ctx=context(),url=request('/api/power-demand');await preparedDisplay(url,ctx,async()=>response(good(1)),{cache,now});
 let release,calls=0;const delayed=()=>{calls++;return new Promise(resolve=>release=()=>resolve(response({...good(2),checkedAt:new Date(now+600000).toISOString()})))};
 const a=await preparedDisplay(url,ctx,delayed,{cache,now:now+600000});assert.equal(a.headers.get('X-Editor-Snapshot'),'updating');const old=await a.json();assert.equal(old.value,1);assert.equal(old.checkedAt,good(1).checkedAt);assert.equal(old.refreshPending,true);assert.equal(old.stale,true);
 await preparedDisplay(url,ctx,delayed,{cache,now:now+600001});assert.equal(calls,1);release();await Promise.all(ctx.jobs);
 const fresh=await preparedDisplay(url,ctx,delayed,{cache,now:now+601000});assert.equal((await fresh.json()).value,2);assert.equal(fresh.headers.get('Cache-Control'),'private, no-store');
});
test('regions and dates are isolated, unrecognized/private/search requests are never cached',async()=>{
 const cache=memory(),ctx=context();let calls=0;const load=async()=>{calls++;return response({weather:{status:'ok',checkedAt:new Date(now).toISOString(),temperature:calls}})};
 const city='&parts=weather';await preparedDisplay(request('/api/local-data?city=a'+city),ctx,load,{cache,now});await preparedDisplay(request('/api/local-data?city=b'+city),ctx,load,{cache,now});assert.equal(calls,2);
 for(const path of ['/api/naver-search?category=power','/api/events','/api/editorial','/api/power-demand?unexpected=x']){await preparedDisplay(request(path),ctx,load,{cache,now});await preparedDisplay(request(path),ctx,load,{cache,now});}
 assert.equal(cache.entries.size,2);
});
test('expired source data, failed results and previous-day power snapshots do not become fresh again',async()=>{
 const cache=memory(),ctx=context(),url=request('/api/power-demand');let calls=0;
 const load=async()=>{calls++;return response(good(calls))};await preparedDisplay(url,ctx,load,{cache,now});
 const expired=await preparedDisplay(url,ctx,async()=>response({status:'unavailable'}),{cache,now:now+10800001});assert.equal(expired.headers.get('X-Editor-Snapshot'),'miss');assert.equal((await expired.json()).status,'unavailable');
 const nearMidnight=Date.parse('2026-11-06T23:59:00+09:00'),cache2=memory();await preparedDisplay(url,ctx,async()=>response({...good(1),checkedAt:new Date(nearMidnight).toISOString()}),{cache:cache2,now:nearMidnight});
 const rollover=await preparedDisplay(url,ctx,async()=>response({status:'unavailable'}),{cache:cache2,now:nearMidnight+60001});assert.equal(rollover.headers.get('X-Editor-Snapshot'),'miss');
});
test('news preserves the twenty-four-hour validity bound and a failed background fetch cannot erase good data',async()=>{
 const cache=memory(),ctx=context(),url=request('/api/focused-news?category=kepco'),news={status:'ok',checkedAt:new Date(now).toISOString(),validUntil:new Date(now+86400000).toISOString(),items:[{title:'kept'}]};
 await preparedDisplay(url,ctx,async()=>response(news),{cache,now});
 const fallback=await preparedDisplay(url,ctx,async()=>{throw Error('network')},{cache,now:now+23*3600000});assert.equal((await fallback.json()).items[0].title,'kept');await Promise.all(ctx.jobs);
 const expired=await preparedDisplay(url,ctx,async()=>response({status:'unavailable'}),{cache,now:now+86400000});assert.equal((await expired.json()).status,'unavailable');
});
test('simultaneous first readers share one load but each gets an independently readable response',async()=>{
 const cache=memory(),ctx=context(),url=request('/api/power-demand');let release,calls=0;
 const load=()=>{calls++;return new Promise(resolve=>release=()=>resolve(response(good(1))))};
 const a=preparedDisplay(url,ctx,load,{cache,now}),b=preparedDisplay(url,ctx,load,{cache,now});await new Promise(resolve=>setImmediate(resolve));release();
 const results=await Promise.all([a,b]);assert.equal(calls,1);assert.deepEqual(await Promise.all(results.map(r=>r.json())),[good(1),good(1)]);
});
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createPreparedCache} from '../worker/prepared-display.mjs';
test('prepared responses survive separate request instances in existing D1 storage, and expiry cleanup preserves other namespaces',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../drizzle/0000_editor_snapshots.sql',import.meta.url),'utf8'));
 const db={withSession(){return this},prepare(sql){return{bind(...values){return{async first(){return sqlite.prepare(sql).get(...values)||null},async run(){return{success:true,meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}}}}}}}};
 sqlite.prepare('INSERT INTO editor_snapshots (key,version,value) VALUES (?,?,?)').run('private:user','kept',JSON.stringify({private:true}));
 sqlite.prepare('INSERT INTO editor_snapshots (key,version,value) VALUES (?,?,?)').run('public:display:v1:expired','old',JSON.stringify({expiresAt:1}));
 const time=Date.now(),req=request('/api/power-demand'),ctx=context();let calls=0;const load=async()=>{calls++;return response({...good(1),checkedAt:new Date(time).toISOString()})};
 const first=await preparedDisplay(req,ctx,load,{cache:createPreparedCache(db),now:time});assert.equal(first.headers.get('X-Editor-Snapshot'),'miss');
 const second=await preparedDisplay(req,ctx,load,{cache:createPreparedCache(db),now:time+1000});assert.equal(second.headers.get('X-Editor-Snapshot'),'hit');assert.equal((await second.json()).value,1);assert.equal(calls,1);
 assert.equal(sqlite.prepare('SELECT key FROM editor_snapshots WHERE key=?').get('public:display:v1:expired'),undefined);assert.ok(sqlite.prepare('SELECT key FROM editor_snapshots WHERE key=?').get('private:user'));sqlite.close();
});
