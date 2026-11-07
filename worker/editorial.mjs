// Private writer authorization belongs to the caller. No network requests or credentials.
const MEMO_KEYS=['sourceId','url','originalTitle','publishedAt','headlineKo','gist','selectionReason','uncertainty','checkedAt','expiresAt'];
const EVENT_KEYS=['id','title','startDate','endDate','timezone','scope','allDay','sourcePublisher','sourcePublishedAt','sourceUrl','license','checkedAt','expiresAt','factualNote','editorReason','statusLabel','suggestedReviewAt','reviewNote','status'];
const HOSTS={eia:['www.eia.gov'],pjm:['insidelines.pjm.com'],motir:['www.motir.go.kr']};
const DAY=86400000;
function reject(code='editorial_invalid'){throw Object.assign(Error(code),{code});}
function shape(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).some(k=>!keys.includes(k)))reject();}
function plain(v,max=1500){if(typeof v!=='string'||!v.trim()||v.length>max||/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))reject();return v;}
function date(v){if(typeof v!=='string'||!/^\d{4}-\d\d-\d\d$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)reject();return v;}
function time(v){if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT/.test(v)||!/(Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))reject();date(v.slice(0,10));return Date.parse(v);}
function published(v){return /^\d{4}-\d\d-\d\d$/.test(v)?Date.parse(date(v)):time(v);}
function link(v,hosts){plain(v,2000);let u;try{u=new URL(v);}catch{reject();}if(u.protocol!=='https:'||/:[0-9]+$/.test(v.split('/')[2]||'')||u.username||u.password||u.port||u.hash||!hosts.includes(u.hostname))reject();return v;}
function reviewDates(v,now,writing){const checked=time(v.checkedAt),expires=time(v.expiresAt);if(checked>now+600000||expires<=checked||expires-checked>90*DAY||(writing&&expires<=now))reject();}
function memo(v,now,writing=false){shape(v,MEMO_KEYS);if(typeof v.sourceId!=='string'||!Object.hasOwn(HOSTS,v.sourceId))reject();link(v.url,HOSTS[v.sourceId]);plain(v.originalTitle,600);published(v.publishedAt);for(const k of ['headlineKo','gist','selectionReason','uncertainty'])plain(v[k],k==='headlineKo'?300:1500);reviewDates(v,now,writing);if(writing&&time(v.expiresAt)-time(v.checkedAt)>7*DAY)reject();return structuredClone(v);}
function event(v,now,writing=false){shape(v,EVENT_KEYS);plain(v.id,120);if(!/^[a-zA-Z0-9_-]+$/.test(v.id))reject();plain(v.title,300);date(v.startDate);date(v.endDate);if(v.endDate<v.startDate||v.timezone!=='Asia/Seoul'||v.scope!=='national'||v.allDay!==true||!['scheduled','cancelled'].includes(v.status))reject();link(v.sourceUrl,['www.moe.go.kr','www.nec.go.kr']);if(published(v.sourcePublishedAt)>now+600000)reject();for(const k of ['sourcePublisher','license','factualNote','editorReason','statusLabel','reviewNote'])plain(v[k],1500);date(v.suggestedReviewAt);reviewDates(v,now,writing);return structuredClone(v);}
function items(snapshot){return snapshot?.snapshot?.items||snapshot?.items||[];}
function matches(r,i){return r.sourceId===i.sourceId&&r.url===i.url&&r.originalTitle===i.title&&r.publishedAt===i.publishedAt;}
export function createEditorialService({store,getSnapshot,seedEvents={events:[]},now=()=>Date.now()}={}){
 if(!store?.read||!store?.compareAndSwap||typeof getSnapshot!=='function')reject('configuration_invalid');
 const keys={records:'editorial:records:v1',events:'editorial:events:v1'},max={records:100,events:30};
 async function read(kind){
  const raw=await store.read(keys[kind]);if(!raw||!('value'in raw)||!('version'in raw))reject('adapter_contract');
  if(raw.value===null){if(raw.version!==null)reject('adapter_contract');return {version:null,value:{schemaVersion:1,checkedAt:kind==='events'?seedEvents.checkedAt||null:null,[kind]:kind==='events'?(seedEvents.events||[]).map(e=>event({...e,status:e.status||'scheduled'},now())):[]}};}
  shape(raw.value,['schemaVersion','checkedAt',kind]);if(raw.value.schemaVersion!==1||!Array.isArray(raw.value[kind])||raw.value[kind].length>max[kind]||typeof raw.version!=='string')reject('store_corrupt');time(raw.value.checkedAt);
  return {version:raw.version,value:{...raw.value,[kind]:raw.value[kind].map(v=>(kind==='records'?memo:event)(v,now()))}};
 }
 async function upsert(kind,input){
  shape(input,[kind]);if(!Array.isArray(input[kind])||!input[kind].length||input[kind].length>max[kind])reject();
  const validated=input[kind].map(v=>(kind==='records'?memo:event)(v,now(),true));
  const identity=v=>kind==='records'?v.sourceId+'|'+v.url:v.id;
  if(new Set(validated.map(identity)).size!==validated.length)reject();
  for(let attempt=0;attempt<8;attempt++){
   const current=kind==='records'?items(await getSnapshot()):[];
   if(kind==='records'){if(validated.some(r=>!current.some(i=>matches(r,i))))reject('snapshot_mismatch');}
   const old=await read(kind),merged=new Map(old.value[kind].filter(v=>Date.parse(v.expiresAt)>now()).map(v=>[identity(v),v]));
   for(const v of validated){const prior=merged.get(identity(v));if(prior&&Date.parse(v.checkedAt)<Date.parse(prior.checkedAt))reject('older_review');merged.set(identity(v),v);}
   let evictionCount=0;
   if(kind==='records'&&merged.size>max[kind]){
    const incoming=new Set(validated.map(identity));
    const evictable=[...merged.values()].filter(r=>!incoming.has(identity(r))&&!current.some(i=>matches(r,i))).sort((a,b)=>Date.parse(a.checkedAt)-Date.parse(b.checkedAt)||identity(a).localeCompare(identity(b)));
    for(const r of evictable){if(merged.size<=max[kind])break;merged.delete(identity(r));evictionCount++;}
   }
   if(merged.size>max[kind])reject('capacity_exceeded');
   const value={schemaVersion:1,checkedAt:new Date(now()).toISOString(),[kind]:[...merged.values()]};
   if(new TextEncoder().encode(JSON.stringify(value)).length>750000)reject('size_exceeded');
   const saved=await store.compareAndSwap(keys[kind],old.version,value);
   if(saved?.applied)return {version:saved.version,...value,...(kind==='records'?{evictionCount}:{})};
  }reject('write_conflict');
 }
 return {
  async readEditorial(){const r=await read('records');return {version:r.version,...r.value};},
  upsertEditorial(input){return upsert('records',input);},
  async applyEditorial(snapshot){
   const out=structuredClone(snapshot),target=out?.snapshot||out,records=(await read('records')).value.records;
   if(!Array.isArray(target?.items))return out;
   target.items=target.items.map(i=>{if(i.editorial){const deadline=Math.min(Date.parse(i.editorial.checkedAt)+7*DAY,i.editorial.expiresAt?Date.parse(i.editorial.expiresAt):Infinity);if(!Number.isFinite(deadline)||deadline<=now())delete i.editorial}const r=records.find(r=>matches(r,i)&&Math.min(Date.parse(r.expiresAt),Date.parse(r.checkedAt)+7*DAY)>now()&&(!i.editorial||Date.parse(r.checkedAt)>Date.parse(i.editorial.checkedAt)));if(!r)return i;return {...i,editorial:{headlineKo:r.headlineKo,gist:r.gist,selectionReason:r.selectionReason,uncertainty:r.uncertainty,checkedAt:r.checkedAt,expiresAt:new Date(Math.min(Date.parse(r.expiresAt),Date.parse(r.checkedAt)+7*DAY)).toISOString(),originalTitle:r.originalTitle,label:'원문 대조 편집 메모 · 일회성 AI 편집',translationLabel:'우리지역 전력에디터 번역·요약',publishedDate:r.publishedAt.slice(0,10),supportingUrls:[r.url]}};});return out;
  },
  async readEvents(){const r=await read('events');return {version:r.version,...r.value,storeCheckedAt:r.value.checkedAt,mode:'one-time-source-verified-not-auto-synced',sourceStatus:'공식 원문 일회성 확인 · 자동 동기화 아님'};},
  upsertEvents(input){return upsert('events',input);}
 };
}
