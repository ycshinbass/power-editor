/** Inactive portable push core. No network, crypto credentials, routes or bindings.
 * store.transaction(userId, callback) MUST serialize transactions durably per user.
 * callback receives async {get(key),set(key,value),delete(key),list(prefix)}; list
 * returns [{key,value}]. Values are private and must never enter public snapshots.
 * resolveUser(context) MUST verify a session or an explicitly authorized job scope,
 * never accept a request-supplied user id. send(subscription,payload,options) MUST
 * perform standards-compliant encryption/VAPID and honor redirect:'manual'.
 * A transport 2xx means provider accepted, NOT device delivery. Leases give bounded
 * retries, not exactly-once device delivery (a crashed sender may retry).
 */
const PROVIDERS=new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
const MAX_AGE=30*86400000, LEASE=120000;
const ID=/^[A-Za-z0-9_-]{1,100}$/;
function fail(code){throw Object.assign(new Error(code),{code})}
export function validatePushEndpoint(endpoint){
 if(typeof endpoint!=='string'||endpoint.length>2048)fail('invalid_endpoint');
 let u;try{u=new URL(endpoint)}catch{fail('invalid_endpoint')}
 if(u.protocol!=='https:'||!PROVIDERS.has(u.hostname)||u.username||u.password||u.port||u.hash||u.pathname==='/')fail('invalid_endpoint');
 return u.href;
}
function bytes(s,n){return typeof s==='string'&&/^[A-Za-z0-9_-]+$/.test(s)&&s.length===Math.ceil(n*8/6)}
export function validatePushSubscription(raw,now=Date.now()){
 if(!raw||typeof raw!=='object'||!bytes(raw.keys?.p256dh,65)||!bytes(raw.keys?.auth,16))fail('invalid_subscription');
 const endpoint=validatePushEndpoint(raw.endpoint);
 const expiry=raw.expirationTime==null?now+MAX_AGE:raw.expirationTime;
 if(!Number.isFinite(expiry)||expiry<=now)fail('expired_subscription');
 return {endpoint,keys:{p256dh:raw.keys.p256dh,auth:raw.keys.auth},expiresAt:Math.min(expiry,now+MAX_AGE)};
}
export function nextPushTime(now,quiet={start:22,end:7,offsetMinutes:540}){
 if(!quiet||typeof quiet!=='object'||Array.isArray(quiet))fail('invalid_quiet_hours');
 const {start,end,offsetMinutes}=quiet;
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<0||start>23||end>23||!Number.isInteger(offsetMinutes)||Math.abs(offsetMinutes)>840)fail('invalid_quiet_hours');
 if(start===end)return now;
 const local=new Date(now+offsetMinutes*60000),hour=local.getUTCHours();
 const asleep=start>end?(hour>=start||hour<end):(hour>=start&&hour<end);
 if(!asleep)return now;
 const until=new Date(local);until.setUTCHours(end,0,0,0);if(until.getTime()<=local.getTime())until.setUTCDate(until.getUTCDate()+1);
 return until.getTime()-offsetMinutes*60000;
}
function payloadOf(raw){
 if(!raw||typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>80||typeof raw.body!=='string'||raw.body.length>240||typeof raw.url!=='string'||!raw.url.startsWith('/')||raw.url.startsWith('//')||/[\\\x00-\x20]/.test(raw.url)||raw.url.length>300)fail('invalid_payload');
 return {title:raw.title.trim(),body:raw.body,url:raw.url};
}
export function createPushService({store,resolveUser,send,config={},now=()=>Date.now(),digest,regionMatches}={}){
 const enabled=config.approved===true&&config.configured===true&&typeof send==='function'&&typeof digest==='function'&&typeof resolveUser==='function'&&typeof store?.transaction==='function';
 const knownRegions=new Set(Array.isArray(config.regionNames)?config.regionNames:[]);
 function regionsOf(regions){if(!Array.isArray(regions)||regions.length>30||regions.some(r=>typeof r!=='string'||r.length>30||!knownRegions.has(r)))fail('invalid_regions');return [...new Set(regions)]}
 function scopedItemsOf(items){if(items===undefined)return null;if(!Array.isArray(items)||items.length>100)fail('invalid_push_items');const seen=new Set();return items.filter(item=>{if(!item||typeof item.id!=='string'||!item.id||item.id.length>200||!['common','national','global','local'].includes(item.scope))fail('invalid_push_items');regionsOf(item.regions);if(seen.has(item.id))return false;seen.add(item.id);return true}).map(i=>({id:i.id,scope:i.scope,regions:[...i.regions]}))}
 function matchedCount(items,sub){if(items===null||items===undefined)return 1;return items.filter(i=>i.scope!=='local'||sub.regionsConfirmed===true&&Array.isArray(sub.regions)&&(sub.regions.length===0||typeof regionMatches==='function'&&regionMatches(i.regions,sub.regions)===true)).length}
 function scopedPayload(payload,count,items){return items===null||items===undefined?payload:{...payload,body:`관심 범위에 해당하는 새 전력 소식 ${count}건을 확인하세요. 전국·해외 주요 소식도 함께 포함합니다.`}}
 function quietOf(sub){return sub.quiet===undefined?{start:22,end:7,offsetMinutes:540}:sub.quiet}
 function nightQuiet(allowNight){if(typeof allowNight!=='boolean')fail('invalid_allow_night');return {start:allowNight?0:22,end:allowNight?0:7,offsetMinutes:540}}
 function preferencesOf(sub){const quiet=quietOf(sub);nextPushTime(now(),quiet);return {allowNight:quiet.start===quiet.end,quiet:{...quiet},regions:Array.isArray(sub.regions)?[...sub.regions]:[],regionsConfirmed:sub.regionsConfirmed===true,expiresAt:sub.expiresAt}}
 async function rescheduleQuiet(tx,id,hours){const time=now();for(const {key,value:j} of await tx.list('out:')){
  if(j.subscriptionId!==id||j.expiresAt<=time||!(j.status==='queued'&&j.attempts===0||j.status==='retry'&&j.deferReason==='quiet'))continue;
  const nextAt=Math.max(nextPushTime(time,hours),j.retryNotBefore||0);await tx.set(key,{...j,nextAt,deferReason:nextAt>time?'quiet':null});
 }}
 const state=()=>({enabled,status:enabled?'configured':'configuration_pending',deliveryVerified:false});
 async function user(ctx){if(!enabled)fail('push_disabled');const id=await resolveUser(ctx);if(typeof id!=='string'||!ID.test(id))fail('unauthorized');return id}
 async function transaction(ctx,fn){const uid=await user(ctx);return store.transaction(uid,fn)}
 return {state,
 async subscribe(ctx,raw,{consent=false,quiet,regions,allowNight}={}){
  if(consent!==true)fail('consent_required');const uid=await user(ctx);const sub=validatePushSubscription(raw,now());
  const id=await digest(sub.endpoint);if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))fail('invalid_digest');
  if(allowNight!==undefined&&typeof allowNight!=='boolean')fail('invalid_allow_night');
  if(regions!==undefined)regionsOf(regions);if(quiet!==undefined)nextPushTime(now(),quiet);
  await store.transaction(uid,async tx=>{const existing=await tx.get('sub:'+id),subs=await tx.list('sub:');if(subs.length>=10&&!existing)fail('subscription_limit');
   const hours=allowNight!==undefined?nightQuiet(allowNight):quiet!==undefined?quiet:quietOf(existing||{});nextPushTime(now(),hours);
   const preferences=regions!==undefined?{regions:regionsOf(regions),regionsConfirmed:true}:existing?{regions:existing.regions||[],regionsConfirmed:existing.regionsConfirmed===true}:{regions:[],regionsConfirmed:false};
   await tx.set('sub:'+id,{...existing,...sub,id,quiet:hours,consentedAt:existing?.consentedAt??now(),...preferences});
   if(allowNight!==undefined||quiet!==undefined)await rescheduleQuiet(tx,id,hours);
  });
  return {id,expiresAt:sub.expiresAt,status:'subscribed'};
 },
 async getPreferences(ctx,id){
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))fail('invalid_id');return transaction(ctx,async tx=>{const sub=await tx.get('sub:'+id);if(!sub||sub.expiresAt<=now())fail('subscription_not_found');return preferencesOf(sub)});
 },
 async updateNight(ctx,id,allowNight){
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))fail('invalid_id');const quiet=nightQuiet(allowNight);
  return transaction(ctx,async tx=>{const sub=await tx.get('sub:'+id);if(!sub||sub.expiresAt<=now())fail('subscription_not_found');const updated={...sub,quiet};await tx.set('sub:'+id,updated);await rescheduleQuiet(tx,id,quiet);return preferencesOf(updated)});
 },
 async updateRegions(ctx,id,regions){
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))fail('invalid_id');const selected=regionsOf(regions);
  return transaction(ctx,async tx=>{const sub=await tx.get('sub:'+id);if(!sub||sub.expiresAt<=now())fail('subscription_not_found');await tx.set('sub:'+id,{...sub,regions:selected,regionsConfirmed:true});return {status:'updated',regions:selected}});
 },
 async unsubscribe(ctx,id){if(!/^[a-f0-9]{64}$/.test(id))fail('invalid_id');return transaction(ctx,async tx=>{await tx.delete('sub:'+id);for(const {key,value} of await tx.list('out:'))if(value.subscriptionId===id)await tx.delete(key);return {status:'removed'}})},
 // User-triggered connectivity check only: no automatic retry and no arbitrary payload.
 async test(ctx,id){
  const uid=await user(ctx);if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))fail('invalid_id');
  const time=now();const sub=await store.transaction(uid,async tx=>{
   const item=await tx.get('sub:'+id);if(!item||item.expiresAt<=time)fail('subscription_not_found');
   const last=await tx.get('test:last');if(last&&time-last.at<60000)fail('test_rate_limited');
   await tx.set('test:last',{at:time});return item;
  });
  let status=0;
  try{validatePushEndpoint(sub.endpoint);const still=await store.transaction(uid,tx=>tx.get('sub:'+id));if(!still)return {status:'subscription_removed',providerAccepted:false,deviceDelivery:'unverified'};
   const result=await send(sub,{id:'push-test-'+time,title:'우리지역 전력에디터 테스트 알림',body:'알림 연결 확인용 메시지입니다. 실제 전력 상황 알림이 아닙니다.',url:'/'},{redirect:'manual',timeoutMs:10000});status=Number(result?.status)||0;
  }catch{}
  if(status===404||status===410)await store.transaction(uid,async tx=>{await tx.delete('sub:'+id);for(const item of await tx.list('out:'))if(item.value.subscriptionId===id)await tx.delete(item.key)});
  return {status:status>=200&&status<300?'provider_accepted':status===404||status===410?'subscription_expired':'send_failed',providerAccepted:status>=200&&status<300,deviceDelivery:'unverified'};
 },
 async enqueue(ctx,eventId,raw,{createdAt=now(),items}={}){
  if(!ID.test(eventId))fail('invalid_event_id');const payload={...payloadOf(raw),id:eventId};const scopedItems=scopedItemsOf(items);
  return transaction(ctx,async tx=>{let queued=0,duplicate=0;const time=now();
   if(!Number.isFinite(createdAt)||createdAt>time||createdAt<=time-86400000)return {status:'invalid_or_expired_intent',queued:0,duplicate:0,delivered:false};
   const entries=await tx.list('out:');for(const {key,value} of entries)if(value.expiresAt<=time)await tx.delete(key);
   if(entries.filter(x=>x.value.expiresAt>time).length>=500)fail('outbox_limit');
   for(const {key,value:sub} of await tx.list('sub:')){
    if(sub.expiresAt<=time){await tx.delete(key);continue}if(sub.consentedAt>createdAt)continue;const outKey='out:'+eventId+':'+sub.id;
    if(await tx.get(outKey)){duplicate++;continue}
    const count=matchedCount(scopedItems,sub);if(!count)continue;
    await tx.set(outKey,{eventId,subscriptionId:sub.id,payload:scopedPayload(payload,count,scopedItems),items:scopedItems,status:'queued',attempts:0,nextAt:nextPushTime(time,quietOf(sub)),deferReason:nextPushTime(time,quietOf(sub))>time?'quiet':null,expiresAt:createdAt+86400000});queued++;
   }return {status:'queued',queued,duplicate,delivered:false};
  });
 },
 async dispatch(ctx){
  const uid=await user(ctx),time=now();
  const jobs=await store.transaction(uid,async tx=>{const claimed=[];for(const {key,value:j} of await tx.list('out:')){
   if(claimed.length>=20)break;if(j.expiresAt<=time){await tx.delete(key);continue}
   if(!['queued','retry','sending'].includes(j.status)||j.nextAt>time)continue;
   if(j.attempts>=5){await tx.set(key,{...j,status:'failed'});continue}
   const sub=await tx.get('sub:'+j.subscriptionId);if(!sub||sub.expiresAt<=time){await tx.delete(key);if(sub)await tx.delete('sub:'+sub.id);continue}
   const count=matchedCount(j.items,sub);if(!count){await tx.delete(key);continue}
   j.payload=scopedPayload(j.payload,count,j.items);
   const due=nextPushTime(time,quietOf(sub));if(due>time){await tx.set(key,{...j,nextAt:due,deferReason:'quiet'});continue}
   const claim={...j,status:'sending',attempts:j.attempts+1,nextAt:time+LEASE};await tx.set(key,claim);claimed.push({key,j:claim,sub});
  }return claimed});
  let accepted=0,retry=0,failed=0;
  for(const {key,j,sub} of jobs){let status=0;
   try{validatePushEndpoint(sub.endpoint);const still=await store.transaction(uid,tx=>tx.get('sub:'+sub.id));if(!still)continue;const currentCount=matchedCount(j.items,still);if(!currentCount){await store.transaction(uid,tx=>tx.delete(key));continue}const result=await send(still,scopedPayload(j.payload,currentCount,j.items),{redirect:'manual',timeoutMs:10000});status=Number(result?.status)||0}catch{}
   await store.transaction(uid,async tx=>{const current=await tx.get(key);if(!current||current.status!=='sending'||current.attempts!==j.attempts)return;
    if(status===404||status===410){await tx.delete('sub:'+sub.id);for(const item of await tx.list('out:'))if(item.value.subscriptionId===sub.id)await tx.delete(item.key);failed++;return}
    if(status>=200&&status<300){await tx.set(key,{...j,status:'provider_accepted',acceptedAt:now()});accepted++;return}
    const recoverable=status===0||status===408||status===429||status>=500;
    const nextAt=now()+Math.min(3600000,30000*2**Math.min(j.attempts-1,7));
    if(recoverable&&j.attempts<5&&nextAt<j.expiresAt){await tx.set(key,{...j,status:'retry',nextAt,retryNotBefore:nextAt,deferReason:'retry'});retry++}
    else{await tx.set(key,{...j,status:'failed'});failed++}
   });
  }
  return {processed:jobs.length,providerAccepted:accepted,retry,failed,deviceDelivery:'unverified'};
 }
 };
}
