const DAY=86400000,TTL=2*DAY,KEY='power:demand:rolling48:v1';
export async function retainDemand(store,incoming=[],now=Date.now()){
 if(!store)throw Error('storage_missing');
 for(let attempt=0;attempt<8;attempt++){
  const old=await store.read(KEY),map=new Map((old.value?.points||[]).filter(p=>Number.isFinite(p.savedAt)&&now-p.savedAt<TTL&&p.savedAt<=now).map(p=>[p.at,p]));
  for(const p of incoming){const t=Date.parse(p.at);if(!Number.isFinite(t)||t%300000||t>now||now-t>=TTL||!Number.isFinite(p.mw)||p.mw<=0||p.mw>200000)continue;const prior=map.get(p.at);map.set(p.at,{at:p.at,mw:p.mw,savedAt:prior?.savedAt??now});}
  const points=[...map.values()].sort((a,b)=>a.at.localeCompare(b.at));
  if(points.length>864)throw Error('retention_limit');
  const value={points,checkedAt:new Date(now).toISOString(),retentionHours:48};
  if(old.value&&JSON.stringify(old.value.points)===JSON.stringify(points))return value;
  if((await store.compareAndSwap(KEY,old.version,value)).applied)return value;
 }
 throw Error('retention_write_conflict');
}
export function yesterdayComparison(today,points,now=Date.now()){
 const latest=today?.at(-1);if(!latest||now-Date.parse(latest.at)>3600000)return null;
 const at=new Date(Date.parse(latest.at)-DAY).toISOString();const previous=points.find(p=>p.at===at);
 if(!previous||previous.mw<=0)return null;
 return {basis:'previous_day_same_time',at:latest.at,previousAt:at,currentMw:latest.mw,previousMw:previous.mw,deltaMw:latest.mw-previous.mw,percent:(latest.mw-previous.mw)/previous.mw*100};
}
