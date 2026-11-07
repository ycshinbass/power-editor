// One durable collection reservation per hourly edition, across isolates.
export function newsEdition(now=Date.now()){return new Date(Math.floor(now/3600000)*3600000).toISOString();}
export async function reserveNewsRun(store,requestId,now=Date.now()){
 const key='news:collection-budget:v1',slot=newsEdition(now);
 for(let n=0;n<8;n++){
  const old=await store.read(key);
  if(old.value?.slot===slot)return {allowed:false,requestId:old.value.requestId,slot};
  if((await store.compareAndSwap(key,old.version,{slot,requestId,at:new Date(now).toISOString()})).applied)return {allowed:true,requestId,slot};
 }
 throw Error('news_budget_unavailable');
}
