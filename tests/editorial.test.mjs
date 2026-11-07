import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createEditorialService} from '../worker/editorial.mjs';
const T=Date.parse('2026-10-31T19:00:00Z'),stamp=new Date(T).toISOString();
const seed=JSON.parse(readFileSync(new URL('../frontend/official-events.json',import.meta.url)));
const record={sourceId:'eia',url:'https://www.eia.gov/todayinenergy/detail.php?id=1',originalTitle:'Grid report',publishedAt:'2026-10-30',headlineKo:'전력망 보고서',gist:'공식 발표의 내용 요약이다.',selectionReason:'설비 운영에 참고할 자료다.',uncertainty:'국내 적용 여부는 별도 검토한다.',checkedAt:stamp,expiresAt:'2026-11-06T19:00:00Z'};
const snapshot={items:[{sourceId:record.sourceId,url:record.url,title:record.originalTitle,publishedAt:record.publishedAt}]};
function store(){const rows=new Map();let n=0;return {async read(k){return structuredClone(rows.get(k)||{version:null,value:null});},async compareAndSwap(k,v,value){if((rows.get(k)?.version||null)!==v)return {applied:false};const version=String(++n);rows.set(k,{version,value:structuredClone(value)});return {applied:true,version};}};}
function setup(extra={}){return createEditorialService({store:store(),getSnapshot:async()=>snapshot,seedEvents:seed,now:()=>T,...extra});}
test('exact current source/title/date required; invalid update preserves good memo',async()=>{
 const s=setup();await s.upsertEditorial({records:[record]});
 for(const patch of [{originalTitle:'Changed'},{publishedAt:'2026-10-29'},{url:'https://www.eia.gov/another'},{sourceId:'pjm'},{rawBody:'private'},{gist:'<script>x</script>'},{checkedAt:'2026-11-01T19:00:00Z'},{expiresAt:'2026-10-31T18:59:00Z'},{expiresAt:'2027-11-30T19:00:00Z'}])await assert.rejects(s.upsertEditorial({records:[{...record,...patch}]}));
 assert.deepEqual((await s.readEditorial()).records,[record]);
});
test('dynamic memo overlays only exact snapshot and only newer than static memo',async()=>{
 const s=setup();await s.upsertEditorial({records:[record]});
 const applied=await s.applyEditorial(snapshot);assert.equal(applied.items[0].editorial.gist,record.gist);assert.equal(snapshot.items[0].editorial,undefined);
 const newer={items:[{...snapshot.items[0],editorial:{checkedAt:'2026-10-31T19:01:00Z',gist:'Keep static'}}]};
 assert.equal((await s.applyEditorial(newer)).items[0].editorial.gist,'Keep static');
 assert.equal((await s.applyEditorial({items:[{...snapshot.items[0],title:'Changed'}]})).items[0].editorial,undefined);
});
test('events seed fallback, merge and explicit cancellation, strict official links',async()=>{
 const s=setup();const original=(await s.readEvents()).events[0];assert.equal(original.status,'scheduled');
 const cancelled={...original,status:'cancelled',checkedAt:stamp};await s.upsertEvents({events:[cancelled]});
 assert.equal((await s.readEvents()).events[0].status,'cancelled');
 for(const patch of [{sourceUrl:'https://evil.test/x'},{sourceUrl:'https://www.moe.go.kr:8443/x'},{sourceUrl:'https://me@www.moe.go.kr/x'},{endDate:'2026-02-30'},{timezone:'UTC'},{status:'unknown'},{secret:'x'}])await assert.rejects(s.upsertEvents({events:[{...cancelled,...patch}]}));
 assert.equal((await s.readEvents()).events[0].status,'cancelled');
});
test('CAS races merge different events without losing either',async()=>{
 const db=store(),s=setup({store:db});const e={...seed.events[0],status:'scheduled',checkedAt:stamp};
 await Promise.all([s.upsertEvents({events:[{...e,id:'one'}]}),s.upsertEvents({events:[{...e,id:'two'}]})]);
 assert.deepEqual((await s.readEvents()).events.map(e=>e.id).sort(),['csat-2027-academic-year','one','two']);
});
test('expired memo is retained for audit but not applied, unknown input rejected',async()=>{
 const db=store();await setup({store:db}).upsertEditorial({records:[record]});
 const later=setup({store:db,now:()=>T+40*86400000});assert.equal((await later.applyEditorial(snapshot)).items[0].editorial,undefined);
 await assert.rejects(later.upsertEditorial({records:[record],extra:true}));
});

test('successful upsert retires only expired entries while invalid writes do not prune',async()=>{
 const db=store(),s=setup({store:db});await s.upsertEditorial({records:[record]});
 const future=T+40*86400000,next={...record,url:'https://www.eia.gov/new',originalTitle:'New report',publishedAt:'2026-12-09',checkedAt:new Date(future).toISOString(),expiresAt:new Date(future+86400000).toISOString()};
 const later=setup({store:db,now:()=>future,getSnapshot:async()=>({items:[{sourceId:next.sourceId,url:next.url,title:next.originalTitle,publishedAt:next.publishedAt}]})});
 await assert.rejects(later.upsertEditorial({records:[{...next,gist:'<b>invalid</b>'}]}));assert.equal((await later.readEditorial()).records[0].url,record.url);
 await later.upsertEditorial({records:[next]});assert.deepEqual((await later.readEditorial()).records,[next]);
});

test('full memo cache evicts oldest noncurrent entries only, preserving matched and incoming records',async()=>{
 const records=Array.from({length:100},(_,i)=>({...record,url:'https://www.eia.gov/'+i,originalTitle:'Report '+i,checkedAt:new Date(T-100000+i*100).toISOString()}));
 const item=r=>({sourceId:r.sourceId,url:r.url,title:r.originalTitle,publishedAt:r.publishedAt});
 let current={items:records.map(item)};const s=setup({getSnapshot:async()=>current});
 await s.upsertEditorial({records});
 const incoming={...record,url:'https://www.eia.gov/new-current',originalTitle:'Current new report'};
 current={items:[item(records[0]),item(incoming)]};
 await assert.rejects(s.upsertEditorial({records:[{...incoming,gist:'<invalid>'}]}));
 assert.equal((await s.readEditorial()).records.length,100);
 const result=await s.upsertEditorial({records:[incoming]});
 assert.equal(result.evictionCount,1);assert.equal(result.records.length,100);
 assert.ok(result.records.some(r=>r.url===records[0].url));assert.ok(result.records.some(r=>r.url===incoming.url));
 assert.equal(result.records.some(r=>r.url===records[1].url),false);
 assert.equal('evictionCount' in await s.readEditorial(),false);
});

test('legacy static memo is removed after seven days even without expiresAt',async()=>{const s=setup({now:()=>T+7*86400000});const old={items:[{...snapshot.items[0],editorial:{checkedAt:stamp,gist:'expired'}}]};assert.equal((await s.applyEditorial(old)).items[0].editorial,undefined);assert.equal(old.items[0].editorial.gist,'expired');await assert.rejects(setup().upsertEditorial({records:[{...record,expiresAt:new Date(T+8*86400000).toISOString()}]}));});
