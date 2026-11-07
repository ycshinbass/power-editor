import test from 'node:test';import assert from 'node:assert/strict';
import {SOURCES,parseFeed,safeURL,cleanText,classifyHeadline,selectItems,parseRegions,collectBriefing,clearFeedMemory,handleBriefing,regionsMatch,getEditorial,CURATED} from '../worker/feed.mjs';
const now=Date.parse('2026-10-31T14:00:00Z'),source={id:'fixture-domestic',name:'Test publisher',kind:'publisher',scope:'national',priority:30,hosts:['newsis.com'],home:'https://www.newsis.com/',url:'https://www.newsis.com/fixture.xml'};
const rss=(title='한전 전력망 운영계획',url='https://www.newsis.com/view/123',date='Fri, 30 Oct 2026 15:00:00 +0900')=>`<?xml version="1.0"?><rss><channel><item><title><![CDATA[${title}]]></title><link>${url}</link><pubDate>${date}</pubDate><description>private full article not retained</description></item></channel></rss>`;
test('bounded XML strips markup, normalizes URL/date and retains no body',()=>{const rows=parseFeed(rss('<b>한전</b> &amp; 전력망'),source,now);assert.equal(rows[0].title,'한전 & 전력망');assert.equal(rows[0].publishedAt,'2026-10-30T06:00:00.000Z');assert.equal(Object.keys(rows[0]).length,4);assert.throws(()=>parseFeed('<!DOCTYPE foo><rss/>',source,now));assert.throws(()=>parseFeed('<html>challenge</html>',source,now));assert.equal(parseFeed(rss('한전','javascript:alert(1)'),source,now).length,0);assert.equal(parseFeed(rss('한전',undefined,'invalid'),source,now).length,0);assert.equal(parseFeed(rss('한전',undefined,'2030-01-01'),source,now).length,0);assert.equal(parseFeed(rss('한전',undefined,new Date(now+11*60000).toISOString()),source,now).length,0);});
test('safe links cannot escape publisher allowlist',()=>{assert.equal(safeURL('http://www.newsis.com/view/x?utm_source=a&id=2#x',source),'https://www.newsis.com/view/x?id=2');for(const x of ['https://newsis.com.evil.test/x','https://a@www.newsis.com/x','https://www.newsis.com:8080/x','https://127.0.0.1/x'])assert.equal(safeURL(x,source),null);});
test('Atom support and entity text never executes code',()=>{const xml='<feed><entry><title>Power grid upgrade</title><link rel="alternate" href="https://www.newsis.com/x"/><updated>2026-10-30T00:00:00Z</updated></entry></feed>';assert.equal(parseFeed(xml,source,now).length,1);assert.equal(cleanText('&lt;script&gt;alert(1)&lt;/script&gt;'),'<script>alert(1)</script>');});
test('electricity relevance excludes generic oil, politics and stockbait',()=>{for(const title of ['Oil prices jump on supply cut','정전협정 체결을 위한 회담','한전 주가 급등 종목추천','Powers of the president','전기차 신차 디자인 공개'])assert.equal(classifyHeadline(title,source),null);assert.equal(classifyHeadline('순천 변전소 설비 점검',source).scope,'local');assert.equal(classifyHeadline('서울 한전 전기요금 논의',source).scope,'national');assert.equal(classifyHeadline('진주 송전탑 작업자 숨져',source).scope,'national');assert.equal(classifyHeadline('Battery storage supports power grid',SOURCES.find(s=>s.id==='eia')).scope,'global');});
test('regional filter preserves common/global and distinct Korean titles',()=>{const results=[{source,checkedAt:new Date(now).toISOString(),items:[{title:'순천 변전소 점검',url:'https://www.newsis.com/a',publishedAt:new Date(now-1000).toISOString()},{title:'부산 변전소 점검',url:'https://www.newsis.com/b',publishedAt:new Date(now-1000).toISOString()},{title:'한전 전국 전기요금 변경',url:'https://www.newsis.com/c',publishedAt:new Date(now-1000).toISOString()}]},{source:SOURCES.find(s=>s.id==='eia'),checkedAt:new Date(now).toISOString(),items:[{title:'Electricity demand rises',url:'https://www.eia.gov/d',publishedAt:new Date(now-1000).toISOString()}]}];assert.equal(selectItems(results,[],now).length,4);const filtered=selectItems(results,['순천'],now);assert.equal(filtered.length,3);assert.ok(filtered.some(x=>x.scope==='global'));assert.ok(filtered.some(x=>x.scope==='national'));assert.ok(filtered.every(x=>x.reason&&x.uncertainty));assert.deepEqual(parseRegions('순천,순천,invalid,여수'),['순천','여수']);});
test('dedup URL and titles; age limit is not current live news',()=>{const rows=[{title:'한전 설비 개선',url:'https://www.newsis.com/a',publishedAt:new Date(now-86400000*10).toISOString()},{title:'한전 설비 개선',url:'https://www.newsis.com/b',publishedAt:new Date(now-1000).toISOString()},{title:'다른 한전 소식',url:'https://www.newsis.com/c',publishedAt:new Date(now-86400000*60).toISOString()}];const items=selectItems([{source,items:rows}],[],now);assert.equal(items.length,1);assert.equal(items[0].url,rows[1].url);});
test('real collector reports failure, cached success, stale and unavailable honestly',async()=>{clearFeedMemory();let calls=0;const ok=()=>{calls++;return Promise.resolve(new Response(rss(),{headers:{'Content-Type':'application/xml'}}));};let result=await collectBriefing([],{sources:[source],now,fetchFn:ok});assert.equal(result.status,'ok');assert.equal(result.items.length,1);result=await collectBriefing([],{sources:[source],now:now+1000,fetchFn:ok});assert.equal(calls,1);assert.equal(result.sources[0].fromCache,true);result=await collectBriefing([],{sources:[source],now:now+700000,fetchFn:()=>Promise.reject(new Error('network failed'))});assert.equal(result.status,'partial');assert.equal(result.stale,true);assert.equal(result.items[0].stale,true);clearFeedMemory();result=await collectBriefing([],{sources:[source],now,fetchFn:()=>Promise.resolve(new Response('<html>blocked</html>'))});assert.equal(result.status,'unavailable');assert.deepEqual(result.items,[]);});
test('read size cap and method gate',async()=>{clearFeedMemory();const result=await collectBriefing([],{sources:[source],now,fetchFn:()=>Promise.resolve(new Response('x',{headers:{'content-length':'9999999'}}))});assert.equal(result.status,'unavailable');const r=await handleBriefing(new Request('https://test/api/briefing',{method:'POST'}));assert.equal(r.status,405);});

test('date-only official feed keeps date precision rather than inventing time',()=>{const rows=parseFeed(rss('한전 공급계획',undefined,'2026-10-31'),source,now);assert.equal(rows[0].publishedAt,'2026-10-31');assert.equal(rows[0].publicationPrecision,'date');});

test('province selections include known child cities without excluding global items',()=>{
  assert.equal(regionsMatch(['순천'],['전남']),true);
  assert.equal(regionsMatch(['전남'],['순천']),false);
  assert.equal(regionsMatch(['진주'],['전남']),false);
  const result=selectItems([{source,checkedAt:new Date(now).toISOString(),items:[{title:'순천 변전소 설비 점검',url:'https://www.newsis.com/province-fixture',publishedAt:new Date(now).toISOString()}]}],['전남'],now);
  assert.equal(result.length,1);assert.equal(result[0].scope,'local');
});

test('curated memo requires exact feed URL, title and same publication day',()=>{
  const [url,record]=Object.entries(CURATED)[0];const raw={url,title:record.originalTitle,publishedAt:record.publishedDate+'T14:00:00.000Z'};
  const reviewNow=Date.parse('2026-10-31T15:00:00Z');const editorial=getEditorial(raw,reviewNow);
  assert.equal(editorial,null);
  assert.equal(getEditorial({...raw,title:raw.title+' updated'},reviewNow),null);
  assert.equal(getEditorial({...raw,url:raw.url+'&different=1'},reviewNow),null);
  assert.equal(getEditorial({...raw,publishedAt:'2026-10-29T14:00:00Z'},reviewNow),null);
  assert.equal(getEditorial(raw,Date.parse('2026-10-30T00:00:00Z')),null);
  const result=selectItems([{source:SOURCES.find(s=>s.id==='eia'),checkedAt:new Date(reviewNow).toISOString(),items:[raw]}],[],reviewNow);
  assert.equal(result.length,1);assert.equal(result[0].editorial,undefined);assert.equal(selectItems([],[],reviewNow).length,0);
});

test('exact reviewed MOTIR article is eligible before title-only rejection, never injected',()=>{
  const src=SOURCES.find(s=>s.id==='motir');const [url,record]=Object.entries(CURATED).find(([u])=>u.includes('motir.go.kr'));
  const reviewNow=Date.parse('2026-10-31T15:00:00Z');const raw={url,title:record.originalTitle,publishedAt:record.publishedDate,publicationPrecision:'date'};
  assert.equal(classifyHeadline(raw.title,src),null);
  const items=selectItems([{source:src,checkedAt:new Date(reviewNow).toISOString(),items:[raw]}],[],reviewNow);
  assert.equal(items.length,0);
  assert.equal(selectItems([{source:src,items:[]}],[],reviewNow).length,0);
  assert.equal(selectItems([{source:src,items:[{...raw,title:raw.title+' 정정'}]}],[],reviewNow).length,0);
});

test('old unreviewed operational alerts expire after72hours; reviewed analysis remains',()=>{
  const src=SOURCES.find(s=>s.id==='pjm'),reviewNow=Date.parse('2026-10-31T15:00:00Z');
  const expired={title:'Operations Update: PJM Issues Capacity Advisory for Oct.19',url:'https://insidelines.pjm.com/old-alert/',publishedAt:'2026-10-19T12:00:00Z'};
  const fresh={...expired,title:'PJM Issues Maximum Generation Alert',url:'https://insidelines.pjm.com/recent-alert/',publishedAt:'2026-10-30T12:00:00Z'};
  const [url,record]=Object.entries(CURATED).find(([u])=>u.includes('pjm-ferc-focus'));
  const reviewed={url,title:record.originalTitle,publishedAt:record.publishedDate+'T12:00:00Z'};
  const items=selectItems([{source:src,checkedAt:new Date(reviewNow).toISOString(),items:[expired,fresh,reviewed]}],[],reviewNow);
  assert.equal(items.length,2);assert.ok(items.some(x=>x.url===fresh.url));assert.ok(items.some(x=>x.url===reviewed.url&&!x.editorial));assert.ok(!items.some(x=>x.url===expired.url));
});
test('Worker-compatible manual redirects are rejected without following',async()=>{clearFeedMemory();let calls=0,mode;const result=await collectBriefing([],{sources:[source],now,fetchFn:async(_url,options)=>{calls++;mode=options.redirect;return new Response('',{status:302,headers:{location:'https://evil.example'}})}});assert.equal(mode,'manual');assert.equal(calls,1);assert.equal(result.status,'unavailable')});

test('KEPCO location is a hint, official exact-article region metadata can verify it',()=>{
 const classified=classifyHeadline('여수 한전 배전망 점검',source);assert.equal(classified.scope,'local');assert.equal(classified.regionVerified,false);assert.deepEqual(classified.regionHints,['여수']);
 const official=SOURCES.find(s=>s.id==='motir'),raw={title:'여수 한전 배전망 점검',url:'https://www.motir.go.kr/a',publishedAt:new Date(now).toISOString()};
 const regionEvidence={type:'official_metadata',url:raw.url,regions:['여수']};
 assert.equal(selectItems([{source:official,items:[{...raw,regionEvidence}]}],[],now)[0].regionVerified,true);
 assert.equal(selectItems([{source:official,items:[{...raw,regionEvidence:{...regionEvidence,url:'https://wrong.test/a'}}]}],[],now)[0].regionVerified,false);
});
test('built-in editorial memo expires seven days after its original review, never extended by reading',()=>{
 const [url,record]=Object.entries(CURATED)[0],raw={url,title:record.originalTitle,publishedAt:record.publishedDate};const deadline=Date.parse(record.checkedAt)+7*86400000;
 assert.equal(getEditorial(raw,deadline),null);assert.equal(getEditorial(raw,deadline-1),null);
});

test('private KEPCO collection is opt-in, bounded to one cached read per hourly slot',async()=>{
 clearFeedMemory();const kepco=SOURCES.find(s=>s.id==='kepco'),html=`<a href="javascript:fn_Detail('15','3178');"><strong class="tit">한전 변압기 수급 설명</strong><span class="date">2026.10.30</span></a>`;let calls=0;
 const fetchFn=async(url,init)=>{calls++;assert.equal(init.redirect,'manual');assert.equal(init.headers.Accept,'text/html');return new Response(html)};
 const at=Date.parse('2026-11-02T00:00:00Z');
 const excluded=await collectBriefing([],{sources:[kepco],fetchFn,now:at});assert.equal(calls,0);assert.equal(excluded.sources.length,0);
 let result=await collectBriefing([],{sources:[kepco],allowPrivateSources:true,fetchFn,now:at});assert.equal(calls,1);assert.equal(result.items.length,1);assert.equal(result.items[0].editorial,undefined);
 await collectBriefing([],{sources:[kepco],allowPrivateSources:true,fetchFn,now:at+3599999});assert.equal(calls,1);
 await collectBriefing([],{sources:[kepco],allowPrivateSources:true,fetchFn,now:Date.parse('2026-11-02T07:00:00Z')});assert.equal(calls,2);
 clearFeedMemory();result=await collectBriefing([],{sources:[kepco],allowPrivateSources:true,fetchFn:async()=>new Response('<html>access challenge</html>'),now:at});assert.equal(result.status,'unavailable');
});
