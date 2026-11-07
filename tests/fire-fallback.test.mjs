import test from 'node:test';
import assert from 'node:assert/strict';
import {scopedPublicSignal} from '../frontend/logic.js';
import {handlePublicSignals,clearPublicSignalMemory} from '../worker/public-signals.mjs';

test('fire failed refresh uses at most three hours of verified data and replaces it on success',async()=>{
 clearPublicSignalMemory();
 const start=Date.parse('2026-11-04T01:00:00Z'),req=new Request('https://test/api/public-signals?part=fire');
 const read=async(now,fetchFn)=>(await(await handlePublicSignals(req,{}, {now,fetchFn})).json()).signals[0];
 const empty=()=>Response.json({fireShowInfoList:[]});
 await read(start,empty);
 const failed=await read(start+3600000,()=>{throw Error('upstream_http_503')});
 assert.equal(failed.checkedAt,new Date(start).toISOString());
 for(const age of [3600000,3*3600000]){
  const view=scopedPublicSignal(failed,['순천'],start+age);
  assert.equal(view.fallback,true);assert.equal(view.label,'관심지역 0건');
 }
 assert.equal(scopedPublicSignal(failed,[],start+3*3600000+1).kind,'stale');
 const fresh=await read(start+4200000,()=>Response.json({fireShowInfoList:[{frfrPrgrsStcdNm:'진화중',frfrSttmnAddr:'전라남도 순천시',frfrFrngDtm:'2026-11-04 11:00'}]}));
 const view=scopedPublicSignal(fresh,['순천'],start+4200000);
 assert.equal(view.count,1);assert.equal(view.fallback,undefined);assert.equal(fresh.stale,false);
 assert.equal(fresh.checkedAt,new Date(start+4200000).toISOString());
 clearPublicSignalMemory();
});
