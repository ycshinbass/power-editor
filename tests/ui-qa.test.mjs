import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../scripts/ui-qa.html',import.meta.url),'utf8');
const dev=await readFile(new URL('../scripts/dev.mjs',import.meta.url),'utf8');
test('isolated UI fixture uses production renderers without saved data or API calls',()=>{
 for(const module of ['overlay-history.js','plans.js','detail-layout.js'])assert.ok(html.includes("from '/"+module+"'"));
 assert.doesNotMatch(html,/localStorage|sessionStorage|navigator\.geolocation|fetch\(|\/app\.js|serviceWorker/);
 assert.match(dev,/pathname==='\/__qa-ui'/);
 assert.match(dev,/connect-src 'none'/);
 assert.match(dev,/geolocation=\(\), microphone=\(\), camera=\(\)/);
 assert.match(html,/합성 자료 전용/);
});
test('fixture covers history, annual edge cases and detail quality',()=>{
 for(const marker of ['history.back()','history.forward()','qa-expired','qa-cross','qa-cancelled','validDate(date)','airTable(','pm10:null','stale:true'])assert.ok(html.includes(marker),marker);
});
test('responsive fixture uses real isolated iframe viewport without recursion',()=>{
 for(const width of [320,390,768,1184])assert.ok(html.includes('data-qa-width="'+width+'"'));
 assert.ok(html.includes("frame.src='/__qa-ui?frame=1'"));
 assert.ok(html.includes("frame.style.width=width+'px'"));
 assert.ok(html.includes("if(inFrame)$('#responsiveQA').hidden=true"));
});
