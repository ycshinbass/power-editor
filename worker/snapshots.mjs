/** Portable central snapshot storage. No runtime bindings, routes or credentials.
 * Adapter MUST implement atomic CAS across all writers (not a get-then-put pair):
 *   read(key) -> {version: opaque string|null, value: JSON envelope|null}
 *   compareAndSwap(key, expectedVersion, value) -> {applied:boolean, version:string}
 * Null version means key absent. Successful writes must issue a NEW version.
 * Collection is outside the transaction; duplicate races may collect twice, but
 * only one logical request commits. Recent request IDs are retained (default32).
 * Authorization is injected and fail-closed; this module never interprets headers.
 */
const LIMITS={bytes:300000,depth:12,nodes:18000,string:30000,array:500,items:100,sources:30};
const PAYLOAD_KEYS=new Set(['version','checkedAt','status','stale','coverage','items','sources','selection','notice','sourcePolicy']);
const ITEM_KEYS=new Set(['id','title','url','publishedAt','publicationPrecision','scope','regions','regionHints','regionVerified','regionEvidence','category','categoryId','reason','uncertainty','matchedTerms','editorial','sourceId','sourceName','sourceType','sourceHome','sourceAllowed','articleEvidenceVerified','checkedAt','stale','freshness']);
const SOURCE_KEYS=new Set(['id','name','kind','home','url','status','itemCount','checkedAt','stale','fromCache','error']);
const EDITORIAL_KEYS=new Set(['headlineKo','gist','selectionReason','uncertainty','checkedAt','expiresAt','label','originalTitle','translationLabel','publishedDate','relevanceClass','supportingUrls']);
const ATTEMPT_KEYS=new Set(['requestId','attemptedAt','finishedAt','outcome','snapshotCheckedAt','errorCode','newItemIds','newItems','audience']);
function onlyKeys(object,keys){if(!object||typeof object!=='object'||Array.isArray(object)||Object.keys(object).some(k=>!keys.has(k)))fail('schema_key');}
function stringList(value,max=100){if(!Array.isArray(value)||value.length>max||value.some(x=>typeof x!=='string'||x.length>1000))fail('schema_invalid');}
function validateIntentItems(value){if(!Array.isArray(value)||value.length>100)fail('store_corrupt');for(const item of value){onlyKeys(item,new Set(['id','scope','regions']));if(typeof item.id!=='string'||!item.id||item.id.length>160||!['national','global','local'].includes(item.scope))fail('store_corrupt');if(!Array.isArray(item.regions)||item.regions.length>30||item.regions.some(r=>typeof r!=='string'||!r.trim()||r.length>80||/[\x00-\x1f\x7f]/.test(r)))fail('store_corrupt');}}
function secureLink(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)fail('schema_invalid');}catch{fail('schema_invalid');}}
export class SnapshotError extends Error{constructor(code){super(code);this.name='SnapshotError';this.code=code;}}
const fail=code=>{throw new SnapshotError(code);};
const iso=ms=>new Date(ms).toISOString();
function timestamp(value){return typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)&&Number.isFinite(Date.parse(value));}
function boundedJSON(value,byteLimit=LIMITS.bytes){
  let nodes=0;const visit=(v,depth)=>{if(++nodes>LIMITS.nodes*Math.ceil(byteLimit/LIMITS.bytes)||depth>LIMITS.depth)fail('schema_limit');if(v===null||typeof v==='boolean')return;if(typeof v==='number'){if(!Number.isFinite(v))fail('schema_type');return;}if(typeof v==='string'){if(v.length>LIMITS.string)fail('schema_limit');return;}if(Array.isArray(v)){if(v.length>LIMITS.array)fail('schema_limit');for(const x of v)visit(x,depth+1);return;}if(!v||typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype)fail('schema_type');for(const [k,x]of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(k))fail('schema_key');visit(k,depth+1);visit(x,depth+1);}};
  visit(value,0);const text=JSON.stringify(value);if(new TextEncoder().encode(text).byteLength>byteLimit)fail('schema_limit');return JSON.parse(text);
}
/** Validates collection payload without rewriting publication dates or checkedAt. */
export function validateSnapshotPayload(input,nowMs=Date.now()){
  const p=boundedJSON(input);if(!p||Array.isArray(p)||p.version!==1||!timestamp(p.checkedAt)||Date.parse(p.checkedAt)>nowMs+600000)fail('schema_invalid');
  if(Object.keys(p).some(k=>!PAYLOAD_KEYS.has(k)))fail('schema_key');
  if(!['ok','partial','unavailable'].includes(p.status)||!Array.isArray(p.items)||p.items.length>LIMITS.items||!Array.isArray(p.sources)||p.sources.length>LIMITS.sources||typeof p.stale!=='boolean')fail('schema_invalid');
  for(const item of p.items){onlyKeys(item,ITEM_KEYS);if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.id!=='string'||!item.id||item.id.length>160||typeof item.title!=='string'||!item.title||item.title.length>600||typeof item.publishedAt!=='string'||!Number.isFinite(Date.parse(item.publishedAt)))fail('schema_invalid');let url;try{url=new URL(item.url);}catch{fail('schema_invalid');}if((url.protocol!=='https:'&&!(item.sourceId==='gynet'&&item.sourceType==='press'&&/^http:\/\/www\.gynet\.co\.kr\/news\/articleView\.html\?idxno=\d+$/.test(url.href)))||url.username||url.password)fail('schema_invalid');if(item.regions!==undefined)stringList(item.regions);if(item.regionHints!==undefined)stringList(item.regionHints,30);if(item.regionVerified!==undefined&&typeof item.regionVerified!=='boolean')fail('schema_invalid');if(item.regionEvidence!==undefined){const e=item.regionEvidence;onlyKeys(e,new Set(['type','url','regions']));if(!((['official_metadata','original_review'].includes(e.type)&&item.sourceType==='official')||(['publisher_metadata','headline_location'].includes(e.type)&&item.sourceType==='press'))||e.url!==item.url||item.regionVerified!==true)fail('schema_invalid');secureLink(e.url);stringList(e.regions,30);}if(item.matchedTerms!==undefined)stringList(item.matchedTerms);if(item.sourceHome!==undefined)secureLink(item.sourceHome);if(item.editorial!==undefined){onlyKeys(item.editorial,EDITORIAL_KEYS);for(const [k,v] of Object.entries(item.editorial))if(k!=='supportingUrls'&&typeof v!=='string')fail('schema_invalid');if(item.editorial.supportingUrls!==undefined){stringList(item.editorial.supportingUrls,20);item.editorial.supportingUrls.forEach(secureLink);}}}
  for(const source of p.sources){onlyKeys(source,SOURCE_KEYS);if(!source||typeof source.id!=='string'||!['ok','stale','error'].includes(source.status)||!timestamp(source.checkedAt))fail('schema_invalid');if(source.home!==undefined)secureLink(source.home);if(source.url!==undefined)secureLink(source.url);}
  if(p.coverage!==undefined)onlyKeys(p.coverage,new Set(['successful','total','notice']));
  if(p.selection!==undefined){onlyKeys(p.selection,new Set(['regions','policy']));if(p.selection.regions!==undefined)stringList(p.selection.regions);}
  if(p.sourcePolicy!==undefined){onlyKeys(p.sourcePolicy,new Set(['description','method','deferred','caveat']));if(p.sourcePolicy.deferred!==undefined){if(!Array.isArray(p.sourcePolicy.deferred)||p.sourcePolicy.deferred.length>30)fail('schema_invalid');for(const entry of p.sourcePolicy.deferred){onlyKeys(entry,new Set(['name','status','reason']));if(Object.values(entry).some(x=>typeof x!=='string'))fail('schema_invalid');}}}
  return p;
}
function validateRead(raw,nowMs){
  if(!raw||!('value'in raw)||!('version'in raw))fail('adapter_contract');
  if(raw.value===null){if(raw.version!==null)fail('adapter_contract');return {version:null,value:null};}
  if(typeof raw.version!=='string'||!raw.version||raw.version.length>200)fail('adapter_contract');
  const v=boundedJSON(raw.value,1000000);onlyKeys(v,new Set(['schemaVersion','snapshot','lastAttempt','requests','seenRecent']));if(v.schemaVersion!==1||!Array.isArray(v.requests)||v.requests.length>100||!('snapshot'in v)||!('lastAttempt'in v))fail('store_corrupt');
  if(v.snapshot!==null)validateSnapshotPayload(v.snapshot,nowMs);
  if(v.seenRecent!==undefined){if(!Array.isArray(v.seenRecent)||v.seenRecent.length>500)fail('store_corrupt');for(const entry of v.seenRecent){onlyKeys(entry,new Set(['id','publishedAt']));if(typeof entry.id!=='string'||!entry.id||entry.id.length>160||typeof entry.publishedAt!=='string'||!Number.isFinite(Date.parse(entry.publishedAt))||Date.parse(entry.publishedAt)>nowMs+600000)fail('store_corrupt');}}
  for(const r of v.requests){onlyKeys(r,ATTEMPT_KEYS);if(r.newItemIds!==undefined)stringList(r.newItemIds,100);if(r.newItems!==undefined)validateIntentItems(r.newItems);if(r.audience==='scoped-v1'&&(!Array.isArray(r.newItems)||JSON.stringify(r.newItems.map(x=>x.id))!==JSON.stringify(r.newItemIds)))fail('store_corrupt');if(!r||typeof r.requestId!=='string'||!timestamp(r.finishedAt)||!['stored','retained','superseded'].includes(r.outcome))fail('store_corrupt');}
  if(v.lastAttempt!==null)onlyKeys(v.lastAttempt,ATTEMPT_KEYS);
  if(v.lastAttempt!==null&&(!timestamp(v.lastAttempt.finishedAt)||typeof v.lastAttempt.requestId!=='string'))fail('store_corrupt');
  return {version:raw.version,value:v};
}
export function createSnapshotService({store,authorize,collect,now=()=>Date.now(),key='power-editor:briefing:v1',staleAfterMs=15*60000,retainRequests=32,maxConflicts=8}={}){
  if(!store||typeof store.read!=='function'||typeof store.compareAndSwap!=='function'||typeof authorize!=='function'||typeof collect!=='function')fail('configuration_invalid');
  if(!Number.isFinite(staleAfterMs)||staleAfterMs<1||!Number.isInteger(retainRequests)||retainRequests<1||retainRequests>100||!Number.isInteger(maxConflicts)||maxConflicts<1||maxConflicts>20)fail('configuration_invalid');
  const read=async()=>validateRead(await store.read(key),now());
  function present(current){const payload=current.value?.snapshot||null;const storedAttempt=current.value?.lastAttempt||null;const attempt=storedAttempt?Object.fromEntries(Object.entries(storedAttempt).filter(([key])=>!['newItemIds','newItems','audience'].includes(key))):null;const reasons=[];if(payload){if(now()-Date.parse(payload.checkedAt)>staleAfterMs)reasons.push('age');if(payload.stale)reasons.push('source_stale');if(attempt?.outcome==='retained')reasons.push('last_refresh_failed');}return {status:payload?(reasons.length?'stale':'fresh'):'missing',version:current.version,stale:!!payload&&reasons.length>0,staleReasons:reasons,checkedAt:payload?.checkedAt||null,snapshot:payload,lastAttempt:attempt};}
  return {
    async readSnapshot(){return present(await read());},
    // Private automation caller only: exact run identity, never infer latest run.
    async readRefreshAttempt(requestId){const current=await read();return current.value?.requests.find(r=>r.requestId===requestId)||null;},
    // Server-internal writer recovery only. Never expose this as a public read route.
    async readPendingNotificationIntents(){const current=await read();return (current.value?.requests||[]).filter(r=>r.outcome==='stored'&&r.audience==='scoped-v1'&&r.newItems?.length&&now()-Date.parse(r.finishedAt)>=0&&now()-Date.parse(r.finishedAt)<=24*60*60*1000).map(({requestId,snapshotCheckedAt,newItemIds,newItems,finishedAt,audience})=>({requestId,snapshotCheckedAt,newItemIds:[...newItemIds],newItems:newItems.map(item=>({...item,regions:[...item.regions]})),finishedAt,audience}));},
    async refresh({requestId,authContext}={}){
      let permitted=false;try{permitted=(await authorize(authContext))===true;}catch{}if(!permitted)fail('unauthorized');
      if(typeof requestId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(requestId))fail('request_id_invalid');
      let current=await read();let prior=current.value?.requests.find(r=>r.requestId===requestId);if(prior)return {...prior,duplicate:true,version:current.version};
      const attemptedAt=iso(now());let payload=null,errorCode=null;
      try{payload=validateSnapshotPayload(await collect(),now());if(payload.status==='unavailable'||payload.status==='partial'&&payload.items.length===0){payload=null;errorCode='collection_unavailable';}}catch(e){payload=null;errorCode=e instanceof SnapshotError?'collection_invalid':'collection_failed';}
      const finishedAt=iso(now());
      for(let count=0;count<maxConflicts;count++){
        prior=current.value?.requests.find(r=>r.requestId===requestId);if(prior)return {...prior,duplicate:true,version:current.version};
        const old=current.value?.snapshot||null;const superseded=payload&&old&&Date.parse(payload.checkedAt)<Date.parse(old.checkedAt);const outcome=!payload?'retained':superseded?'superseded':'stored';
        const historyCutoff=Date.parse(finishedAt)-4*24*60*60*1000;
        const knownRecent=(current.value?.seenRecent||[]).filter(item=>Date.parse(item.publishedAt)>=historyCutoff);
        const previousIds=new Set([...knownRecent,...(old?.items||[])].map(item=>item.id));
        const newItems=outcome==='stored'&&old?[...new Map(payload.items.filter(item=>['national','global','local'].includes(item.scope)&&Array.isArray(item.regions||[])&&(item.regions||[]).length<=30&&(item.regions||[]).every(r=>typeof r==='string'&&r.trim()&&r.length<=80&&!/[\x00-\x1f\x7f]/.test(r))&&!previousIds.has(item.id)&&!item.stale&&Date.parse(item.publishedAt)<=Date.parse(finishedAt)&&Date.parse(item.publishedAt)>=Date.parse(finishedAt)-72*60*60*1000).map(item=>[item.id,{id:item.id,scope:item.scope,regions:[...new Set(item.regions||[])]}])).values()].slice(0,100):[];
        const newItemIds=newItems.map(item=>item.id);
        const result={requestId,attemptedAt,finishedAt,outcome,newItemIds,newItems,audience:'scoped-v1',snapshotCheckedAt:outcome==='stored'?payload.checkedAt:old?.checkedAt||null,...(errorCode?{errorCode}:{})};
        const recentMap=new Map([...knownRecent,...(old?.items||[]),...(outcome==='stored'?payload.items:[])].filter(item=>Date.parse(item.publishedAt)>=historyCutoff&&Date.parse(item.publishedAt)<=Date.parse(finishedAt)).map(({id,publishedAt})=>[id,{id,publishedAt}]));
        const seenRecent=[...recentMap.values()].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,500);
        const previousAttempt=current.value?.lastAttempt;const next={schemaVersion:1,seenRecent,snapshot:outcome==='stored'?payload:old,lastAttempt:previousAttempt&&Date.parse(previousAttempt.finishedAt)>Date.parse(finishedAt)?previousAttempt:result,requests:[...(current.value?.requests||[]),result].slice(-retainRequests)};
        boundedJSON(next,1000000);const write=await store.compareAndSwap(key,current.version,next);
        if(!write||typeof write.applied!=='boolean')fail('adapter_contract');
        if(write.applied){if(typeof write.version!=='string'||!write.version||write.version===current.version)fail('adapter_contract');return {...result,duplicate:false,version:write.version};}
        current=await read();
      }
      fail('write_conflict');
    }
  };
}
