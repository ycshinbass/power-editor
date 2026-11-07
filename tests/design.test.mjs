import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('national-flow-first hierarchy keeps supply unavailable, never mock numbers',async()=>{
 const html=await readFile(new URL('../frontend/index.html',import.meta.url),'utf8');
 const labels=['전국 전력흐름','지금 확인할 사항','조간·석간 브리핑','출처 · 공식 상황 정보'];
 const positions=labels.map(x=>html.indexOf(x));
 assert.ok(positions.every((x,i)=>x>=0&&(!i||x>positions[i-1])));
 const supply=html.slice(html.indexOf('<section class="supply-panel"'),html.indexOf('<section class="news section"'));
 assert.match(supply,/수치·자료시각 미확인/);assert.match(supply,/kpx\.or\.kr/);
 assert.doesNotMatch(supply,/12\.5|10,000|80,000|90,000|10:00|예시/);
 assert.equal((supply.match(/aria-label="[^"]*미확인"/g)||[]).length,3);
 assert.match(html,/매시 정각 갱신 · KST/);
});
test('local-first brand preserves installed app identity and national scope',async()=>{
 const html=await readFile(new URL('../frontend/index.html',import.meta.url),'utf8');
 const manifest=JSON.parse(await readFile(new URL('../frontend/manifest.webmanifest',import.meta.url),'utf8'));
 assert.match(html,/<title>전력에디터<\/title>/);
 assert.match(html,/aria-label="전력에디터 오늘"/);
 assert.match(html,/전국 전력흐름/);
 assert.equal(manifest.name,'전력에디터');assert.equal(manifest.short_name,'전력에디터');
 assert.equal(manifest.id,'/');assert.equal(manifest.start_url,'/');
});
