import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCES,SOURCE_POLICY,CURATED,parseFeed,safeURL,selectItems,collectBriefing,clearFeedMemory} from '../worker/feed.mjs';
import {validateSnapshotPayload} from '../worker/snapshots.mjs';
const source=SOURCES.find(s=>s.id==='mcee'),now=Date.parse('2026-11-01T07:00:00Z');
const url='https://www.mcee.go.kr/home/web/board/read.do?menuId=10598&boardMasterId=939&boardId=1903400';
const rawURL='https://www.mcee.go.kr/home/web/board/read.do;jsessionid=fixture-discard?boardId=1903400&boardMasterId=939&menuId=10598&pagerOffset=0';
const rss=(stamp='Fri Oct 30 19:00:00 KST 2026',link=rawURL)=>'<rss><channel><item><title>2026년 수소발전 입찰시장 개설</title><link><![CDATA['+link+']]></link><pubDate>'+stamp+'</pubDate><description>DO NOT RETAIN BODY</description></item></channel></rss>';
test('MCEE RSS keeps canonical title/date/link only and validates KST calendar',()=>{
  const [item]=parseFeed(rss(),source,now);
  assert.deepEqual(item,{title:'2026년 수소발전 입찰시장 개설',url,publishedAt:'2026-10-30T10:00:00.000Z',publicationPrecision:'datetime'});
  for(const stamp of ['Fri Oct 32 19:00:00 KST 2026','Fri Oct 30 24:00:00 KST 2026','Fri Oct 30 19:60:00 KST 2026','Sat Oct 30 19:00:00 KST 2026','Fri Oct 30 19:00:00 UTC 2026','2026-10-30'])assert.equal(parseFeed(rss(stamp),source,now).length,0);
  assert.equal(parseFeed(rss('Sat Oct 31 00:30:00 KST 2026'),source,now)[0].publishedAt,'2026-10-30T15:30:00.000Z');
});
test('MCEE canonical links strip session/paging and reject non-press or ambiguous identity',()=>{
  assert.equal(safeURL(rawURL,source),url);
  for(const link of [url.replace('www.mcee','evil.mcee'),url.replace('read.do','download.do'),url.replace('939','940'),url.replace('10598','1'),url.replace('1903400','NaN'),url+'&boardId=2',url.replace('https://','https://user@')])assert.equal(safeURL(link,source),null);
});
test('MCEE collection is snapshot compatible, power-relevant and never curated before rights review',async()=>{
  clearFeedMemory();
  const result=await collectBriefing([],{now,sources:[source],fetchFn:async()=>new Response(rss())});
  assert.equal(result.status,'ok');assert.equal(result.items.length,1);
  assert.equal(result.items[0].scope,'national');assert.deepEqual(result.items[0].regions,[]);
  assert.equal(result.items[0].articleEvidenceVerified,false);
  assert.equal(JSON.stringify(result).includes('fixture-discard'),false);
  validateSnapshotPayload(result,now);
  assert.equal(source.editorialAllowed,false);
  assert.ok(source.rightsURL);assert.ok(source.rssGuideURL);
  assert.equal(SOURCE_POLICY.deferred.find(x=>x.name==='기후에너지환경부 본문 편집').status,'title_links_only');
  const raw=parseFeed(rss(),source,now)[0];
  CURATED[url]={originalTitle:raw.title,publishedDate:'2026-10-30',checkedAt:'2026-10-31T00:00:00Z',headlineKo:'must not show'};
  try{assert.equal(selectItems([{source,items:[raw]}],[],now)[0].editorial,undefined);}finally{delete CURATED[url];}
  clearFeedMemory();
});
