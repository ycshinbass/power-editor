import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialKst,normalizeKmaWarningRows,parseKmaWarningText,normalizeForestRiskRows,parseForestRiskJson,collectOfficialSignals} from '../worker/official-signals.mjs';

// Synthetic documentation-shaped fixtures, NOT captured or validated provider responses.
const checkedAt='2026-10-31T18:00:00Z';
const warning={REG_UP:'L',REG_UP_KO:'전라남도',REG_ID:'L0001',REG_KO:'순천시',TM_FC:'202611010100',TM_EF:'202611010400',WRN:'R',LVL:'2',CMD:'1'};
const risk={sigucode:'46150',sigun:'순천시',doname:'전라남도',analdate:'2026-11-01 03:00',maxi:'80',meanavg:'40',mini:'10',d1:'1',d2:'2',d3:'3',d4:'4'};
const header=Object.keys(warning).join(',');
const text='# '+header+'\n'+Object.values(warning).join(',');

test('official time is KST, impossible calendar time rejected',()=>{
  assert.equal(parseOfficialKst('202611010100'),'2026-10-31T16:00:00.000Z');
  for(const value of ['202602300100','202611012500','not-a-time'])assert.throws(()=>parseOfficialKst(value));
});
test('warning codes preserved without claiming active or interpreting undocumented levels',()=>{
  const data=normalizeKmaWarningRows([warning],checkedAt);
  assert.equal(data.records[0].warningName,'호우');assert.equal(data.records[0].levelCode,'2');
  assert.equal(data.records[0].active,null);assert.equal(data.records[0].severity,null);
  assert.equal(data.safetyConclusion,'unknown');
});
test('warning wire parser requires exact named header and rejects mismatches/HTML',()=>{
  assert.equal(parseKmaWarningText(text,checkedAt).records.length,1);
  assert.throws(()=>parseKmaWarningText(Object.values(warning).join(','),checkedAt));
  assert.throws(()=>parseKmaWarningText(text+',extra',checkedAt));
  assert.throws(()=>parseKmaWarningText('<html>login</html>',checkedAt));
  assert.throws(()=>normalizeKmaWarningRows([{...warning,TM_FC:'202612010100'}],checkedAt));
});
test('empty official records never become a safe/no-incident result',()=>{
  const data=parseKmaWarningText('# '+header,checkedAt);
  assert.equal(data.status,'no_records');assert.equal(data.safetyConclusion,'unknown');
});
test('forest risk indices never become actual incidents or a made-up alert grade',()=>{
  const data=normalizeForestRiskRows([risk],checkedAt);
  assert.equal(data.records[0].forecastOnly,true);assert.equal(data.records[0].actualFireOccurrence,null);
  assert.equal(data.records[0].severity,null);assert.equal(data.records[0].referenceTimeRaw,risk.analdate);
  assert.throws(()=>normalizeForestRiskRows([{...risk,maxi:'-1'}],checkedAt));
  assert.throws(()=>normalizeForestRiskRows([{...risk,meanavg:'100'}],checkedAt));
});
test('risk JSON rejects errors and partial pages, not missing-as-zero',()=>{
  const body={response:{header:{resultCode:'00'},body:{totalCount:1,items:{item:risk}}}};
  assert.equal(parseForestRiskJson(JSON.stringify(body),checkedAt).records.length,1);
  body.response.body.totalCount=2;assert.throws(()=>parseForestRiskJson(JSON.stringify(body),checkedAt));
  body.response.header.resultCode='20';assert.throws(()=>parseForestRiskJson(JSON.stringify(body),checkedAt));
});
test('missing credentials and unverified wire schema make no outbound requests',async()=>{
  let calls=0;const fetchFn=async()=>{calls++;throw Error('must not fetch')};
  const data=await collectOfficialSignals({}, {fetchFn});assert.equal(calls,0);
  assert.deepEqual(data.signals.map(x=>x.status),['not_configured','not_configured','unimplemented']);
  const keyed=await collectOfficialSignals({KMA_AUTH_KEY:'synthetic-test-value'}, {fetchFn});
  assert.equal(keyed.signals[0].status,'validation_required');assert.equal(calls,0);
});
test('validated mock uses fixed provider only and errors never disclose credential URL',async()=>{
  let requested;
  const data=await collectOfficialSignals({KMA_AUTH_KEY:'synthetic-test-value'}, {now:Date.parse(checkedAt),validatedSchemas:['weatherWarning'],fetchFn:async(url,options)=>{requested=new URL(url);assert.equal(options.redirect,'manual');return new Response(text)}});
  assert.equal(requested.hostname,'apihub.kma.go.kr');assert.equal(data.signals[0].status,'reported');
  const failed=await collectOfficialSignals({KMA_AUTH_KEY:'synthetic-test-value'}, {validatedSchemas:['weatherWarning'],fetchFn:async()=>{throw Error('secret synthetic-test-value')}});
  assert.equal(failed.signals[0].status,'unavailable');assert.ok(!JSON.stringify(failed).includes('synthetic-test-value'));
});
test('oversized and invalid UTF-8 official responses fail closed',async()=>{
  const options={now:Date.parse(checkedAt),validatedSchemas:['weatherWarning']};
  for(const response of [new Response('x'.repeat(512001)),new Response(new Uint8Array([0xff,0xff]))]){
    const result=await collectOfficialSignals({KMA_AUTH_KEY:'synthetic-test-value'},{...options,fetchFn:async()=>response});
    assert.equal(result.signals[0].status,'unavailable');assert.deepEqual(result.signals[0].records,[]);
  }
});
test('Worker-compatible redirect mode never follows provider redirect with a key',async()=>{
  const options={now:Date.parse(checkedAt),validatedSchemas:['weatherWarning']};
  for(const status of [301,302,303,307,308]){
    let calls=0,observedRedirect;
    const result=await collectOfficialSignals({KMA_AUTH_KEY:'synthetic-test-value'},{...options,fetchFn:async(url,request)=>{
      calls++;observedRedirect=request.redirect;
      // Mirror the production Worker restriction, then emulate a redirect response.
      if(!['manual','follow'].includes(request.redirect))throw new TypeError('Unsupported redirect mode');
      assert.equal(request.redirect,'manual');
      assert.equal(new URL(url).hostname,'apihub.kma.go.kr');
      return new Response(null,{status,headers:{Location:'https://untrusted.example/collect'}});
    }});
    assert.equal(observedRedirect,'manual');assert.equal(calls,1);assert.equal(result.signals[0].status,'unavailable');
    assert.deepEqual(result.signals[0].records,[]);
  }
});
