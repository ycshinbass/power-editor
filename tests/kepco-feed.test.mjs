import test from 'node:test';
import assert from 'node:assert/strict';
import {KEPCO_SOURCE,parseKepcoList,isRelevantKepcoTitle} from '../worker/kepco-feed.mjs';
const now=Date.parse('2026-11-02T02:00:00Z');
const row=(id,title,date='2026.10.29',board='15')=>`<div class="media-list-item"><a href="javascript:fn_Detail('${board}','${id}');"><img alt="전남"><strong class="tit">${title}</strong><span class="date">${date}</span></a></div>`;
test('private metadata-only contract preserves date precision and canonical identity',()=>{
 const [item]=parseKepcoList(row('3178','[보도설명]호남권 전력공급용 변압기 확보'),KEPCO_SOURCE,now);
 assert.equal(item.publishedAt,'2026-10-29');assert.equal(item.publicationPrecision,'date');
 assert.equal(item.url,'https://www.kepco.co.kr/home/media/newsroom/pr/boardView.do?boardMngNo=15&boardNo=3178');
 assert.equal(item.regions,undefined);assert.equal(item.regionEvidence,undefined);assert.equal(item.body,undefined);
 assert.equal(KEPCO_SOURCE.editorialAllowed,false);assert.equal(KEPCO_SOURCE.privateUseOnly,true);
});
test('rejects corporate filler, malformed dates, old/future items and other boards',()=>{
 assert.equal(isRelevantKepcoTitle('한전, ESG 대상 수상'),false);
 assert.equal(parseKepcoList(row('1','한전 수상')+row('2','전력망 확충','2026.02.31')+row('3','전력망 확충','2025.01.01')+row('4','전력망 확충','2026.12.01')+row('5','전력망 확충','2026.10.29','16'),KEPCO_SOURCE,now).length,0);
});
test('bounded first page only; safe text decoding and duplicate handling',()=>{
 const entries=Array.from({length:15},(_,i)=>row(String(i),'한전 에너지 &amp; 신기술'));
 assert.equal(parseKepcoList(entries.join(''),KEPCO_SOURCE,now).length,12);
 const result=parseKepcoList(row('1','한전 에너지 &amp; 신기술')+row('1','전력망'),KEPCO_SOURCE,now);
 assert.equal(result.length,1);assert.equal(result[0].title,'한전 에너지 & 신기술');
});
