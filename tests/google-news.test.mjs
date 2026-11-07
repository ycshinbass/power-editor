import test from 'node:test';
import assert from 'node:assert/strict';
import {googleNewsSources,headlineRegions} from '../worker/google-news.mjs';
import {parseFeed,selectItems,collectBriefing,clearFeedMemory,getEditorial,CURATED} from '../worker/feed.mjs';
import {diverseNews,newsQuotaNotice,newsHasEditorial,isRegionalNews} from '../frontend/logic.js';
import {validateSnapshotPayload} from '../worker/snapshots.mjs';
import {compactAutomationSummary,handleRuntime} from '../worker/runtime.mjs';
import {reserveNewsRun} from '../worker/news-budget.mjs';
const now=Date.parse('2026-11-03T01:00:00Z'),source=googleNewsSources()[0];
const rss=(title='순천 변전소 설비 교체',id='FAKE1',publisher='시험신문',date=new Date(now).toUTCString())=>`<rss><channel><item><title>${title} - ${publisher}</title><link>https://news.google.com/rss/articles/${id}?oc=5</link><pubDate>${date}</pubDate><description>DO NOT RETAIN OR ANALYZE BODY</description><source url="https://publisher.invalid">${publisher}</source></item></channel></rss>`;
test('Google parser keeps publisher and title/date/link only; strict Google article URL',()=>{
 const [i]=parseFeed(rss(),source,now);assert.equal(i.title,'순천 변전소 설비 교체');assert.equal(i.publisherName,'시험신문');assert.equal(i.url,'https://news.google.com/rss/articles/FAKE1');assert.deepEqual(i.regionEvidence.regions,['순천']);assert.equal(i.regionEvidence.type,'headline_location');assert.equal(JSON.stringify(i).includes('DO NOT RETAIN'),false);
 for(const path of ['https://evil.invalid/rss/articles/FAKE1','https://news.google.com.evil.invalid/rss/articles/FAKE1','https://news.google.com/search?q=anything','javascript:alert(1)'])assert.equal(parseFeed(rss().replace('https://news.google.com/rss/articles/FAKE1?oc=5',path),source,now).length,0);
 assert.equal(parseFeed(rss().replace(/<source.*?<\/source>/,''),source,now).length,0);
});
test('regional query is not evidence; broad and ambiguous locations stay broad or unknown',()=>{
 assert.deepEqual(headlineRegions('전남 전력망 확충'),['전남']);assert.deepEqual(headlineRegions('광주 변전소 점검'),[]);assert.deepEqual(headlineRegions('중구 정전'),[]);assert.deepEqual(headlineRegions('보성그룹 전력 사업'),[]);
 const sources=googleNewsSources(['순천','여수']);const [i]=parseFeed(rss('전국 전력망 계획'),sources.at(-1),now);assert.equal(i.regionEvidence,undefined);
 assert.equal(googleNewsSources([]).length,3);assert.equal(googleNewsSources(Array(30).fill('순천')).length,4);
});
test('Google results participate in quotas, overlap KEPCO, keep broad-region limit and deduplicate',()=>{
 const raws=[...parseFeed(rss('순천 한전 변전소 설비 교체','A'),source,now),...parseFeed(rss('여수 송전선로 공사 안내','B'),source,now),...parseFeed(rss('전남 전력망 확충 계획','C'),source,now),...parseFeed(rss('전력수급 예비력 확대','D'),source,now),...parseFeed(rss('전국 발전소 운영 변화','E'),source,now),...parseFeed(rss('순천 한전 변전소 설비 교체','F','다른신문'),source,now)];
 const items=selectItems([{source,items:raws,checkedAt:new Date(now).toISOString()}],[],now);assert.equal(items.length,5);assert.ok(items.every(i=>i.sourceName!=='Google 뉴스 · 국내 전력'&&!i.editorial));
 const top=diverseNews(items,['순천','여수'],now).slice(0,5);assert.equal(newsQuotaNotice(top,['순천','여수'],now),'');assert.equal(isRegionalNews(items.find(i=>i.title.startsWith('전남')),['순천']),false);
 const p=validateSnapshotPayload({version:1,checkedAt:new Date(now).toISOString(),status:'ok',stale:false,items,sources:[]},now);assert.equal(p.items.length,5);
});
test('scheduled Google RSS cache blocks repeat reads within a KST edition, including failures',async()=>{
 clearFeedMemory();let calls=0;const options={sources:[source],now,fetchFn:async()=>{calls++;return new Response(rss())}};await collectBriefing([],options);await collectBriefing([],{...options,now:now+3599999});assert.equal(calls,1);
 await collectBriefing([],{...options,now:Date.parse('2026-11-03T07:01:00Z')});assert.equal(calls,2);
 clearFeedMemory();calls=0;const fail={...options,fetchFn:async()=>{calls++;throw Error('offline')}};await collectBriefing([],fail);await collectBriefing([],{...fail,now:now+1000});assert.equal(calls,1);clearFeedMemory();
});
test('all sources and historical memos are excluded from news AI; write route disabled',async()=>{
 const [url,r]=Object.entries(CURATED)[0];assert.equal(getEditorial({url,title:r.originalTitle,publishedAt:r.publishedDate},now),null);assert.equal(newsHasEditorial({editorial:{selectionReason:'Old AI'}},[],null),false);
 const item={id:'x',sourceId:'eia',url:'https://example.invalid',title:'Never send',publishedAt:new Date(now).toISOString()};const attempt={requestId:'x',newItemIds:['x']};const selection={requestId:'x',articles:[item],reviewable:[item]};const data=compactAutomationSummary({snapshot:{items:[item],sources:[]}},attempt,{records:[]},{events:[]},now,selection);assert.deepEqual(data.candidates,[]);assert.equal(JSON.stringify(data).includes('Never send'),false);
 const out=await handleRuntime(new Request('https://site.invalid/api/editorial',{method:'POST',body:'{}'}),{});assert.equal(out.status,410);
});
test('public deployment rejects anonymous updater and validates service-token digest',async()=>{
 const origin='https://power-editor-design-1031.ycshinbass.chatgpt.site';
 const token='synthetic-test-service-token-only-123456789',digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const env={DB:{},PRIVATE_UPDATER_ENABLED:'true',SITE_PUBLIC_ACCESS:'true',EDITOR_UPDATER_TOKEN_SHA256:digest};
 for(const headers of [{},{'X-Editor-Updater':'wrong'}])assert.equal((await handleRuntime(new Request(origin+'/api/editorial-workflow',{headers}),env)).status,403);
 const result=await handleRuntime(new Request(origin+'/api/editorial-workflow',{headers:{'X-Editor-Updater':token}}),env,{editorialWorkflow:{version:'fixture'}});assert.equal(result.status,200);assert.equal((await result.json()).version,'fixture');
});
test('durable budget admits only one concurrent refresh per edition across request IDs',async()=>{
 let saved=null,version=null,n=0;const store={async read(){return structuredClone({value:saved,version})},async compareAndSwap(k,v,value){if(v!==version)return {applied:false};saved=structuredClone(value);version=String(++n);return {applied:true,version}}};
 const outcomes=await Promise.all(Array.from({length:12},(_,i)=>reserveNewsRun(store,'r'+i,now)));assert.equal(outcomes.filter(x=>x.allowed).length,1);
 assert.equal((await reserveNewsRun(store,'late',now+60000)).allowed,false);assert.equal((await reserveNewsRun(store,'afternoon',Date.parse('2026-11-03T07:00:00Z'))).allowed,true);
 await assert.rejects(reserveNewsRun({read(){throw Error('unavailable')}},'failure',now));
});
