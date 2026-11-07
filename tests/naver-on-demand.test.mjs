import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {refreshNaverSearch} from '../worker/naver-search.mjs';
test('scheduled refresh performs no NAVER lookup or DB enumeration',async()=>{let called=0;const r=await refreshNaverSearch({DB:{prepare(){called++;throw Error('no background reads')}}},{fetchImpl:()=>{called++;throw Error('no background fetch')}});assert.equal(called,0);assert.equal(r.status,'on_demand_only')});
test('NAVER frontend contains no timed or visibility refresh listener',async()=>{const s=await readFile(new URL('../frontend/naver-search.js',import.meta.url),'utf8');assert.doesNotMatch(s,/visibilitychange|setInterval|const arm=/)});
