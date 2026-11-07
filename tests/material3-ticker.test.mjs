import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('a delayed animation frame cannot hide the settled news headline',async()=>{
 const source=await readFile(new URL('../frontend/naver-preview.js',import.meta.url),'utf8');
 const ticker=source.slice(source.indexOf('function startHeadlineTicker('),source.indexOf('function renderBriefingPreview('));
 const classes=new Set(),track={children:[],classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},replaceChildren(){this.children=[]},append(x){this.children.push(x)}};
 const badge={},button={querySelector:s=>s==='.headline-track'?track:badge,setAttribute(){},contains:()=>false,addEventListener(){}};
 let id=0;const timers=new Map(),frames=[];
 const context=vm.createContext({naverPreview:true,examples:{kepco:[['first'],['second']]},previewContext:{},refreshHeadlines:null,
  document:{hidden:false,activeElement:null,createElement:()=>({}),addEventListener(){}},window:{addEventListener(){}},matchMedia:()=>({matches:false}),
  setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id},clearTimeout:key=>timers.delete(key),requestAnimationFrame:fn=>frames.push(fn)});
 vm.runInContext(ticker,context);context.startHeadlineTicker(button,{});
 const run=ms=>{const entry=[...timers].find(([,v])=>v.ms===ms);assert.ok(entry);timers.delete(entry[0]);entry[1].fn()};
 run(6000);run(500); // Background tabs can delay rAF beyond the transition timer.
 while(frames.length)frames.shift()();
 assert.equal(track.children.length,1);assert.equal(track.children[0].textContent,'second');assert.equal(classes.has('is-turning'),false);
});
