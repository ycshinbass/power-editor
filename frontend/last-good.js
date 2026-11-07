// Display-only grace. Never changes provider polling, timestamps, quotas or storage TTL.
export const LAST_GOOD_MS=3*3600000;
const time=d=>Date.parse(d?.checkedAt||d?.fetchedAt);
const ok=d=>['ok','partial'].includes(d?.status);
export function failedRefresh(d){return !!d&&(!!d.refreshError||!!d.failureCode||!!d.fallback||!!d.reason&&!['refresh_pending'].includes(d.reason)||!ok(d));}
export function withinGrace(d,now=Date.now(),graceMs=LAST_GOOD_MS){
 const age=now-time(d),validUntil=Date.parse(d?.validUntil);return ok(d)&&Number.isFinite(age)&&age>=0&&age<=graceMs&&(!Number.isFinite(validUntil)||now<validUntil)&&(!d.date||d.date===new Date(now+9*3600000).toISOString().slice(0,10));
}
export function usesLastGood(d,now=Date.now()){return failedRefresh(d)&&withinGrace(d,now);}
export function retainLastGood(previous,next,now=Date.now(),graceMs=LAST_GOOD_MS){
 if(ok(next)&&!failedRefresh(next)&&(!Number.isFinite(Date.parse(next.validUntil))||now<Date.parse(next.validUntil)))return next;
 // Fresh response with explicit missing data or different scope is not a transport failure.
 if(['region_unmatched','region_selection_required','no_station','station_data_missing','date_rollover','contract_validation_pending','credentials_missing'].includes(next?.reason))return next;
 const candidate=withinGrace(next,now,graceMs)?next:withinGrace(previous,now,graceMs)?previous:null;
 return candidate?{...candidate,stale:true,fallback:true,refreshError:next?.reason||next?.failureCode||'request_failed'}:ok(next)?{status:'unavailable',fallback:false,reason:'last_good_expired',city:next.city,date:next.date,source:next.source,checkedAt:next.checkedAt,items:[]}:next;
}
export function lastGoodCache(graceMs=LAST_GOOD_MS){
 const entries=new Map();
 return {resolve(key,next,now=Date.now()){const value=retainLastGood(entries.get(key),next,now,graceMs);if(ok(value))entries.set(key,value);return value;}};
}
export function fallbackNote(d,now=Date.now()) {return usesLastGood(d,now)?'최신 조회 지연 · 최근 3시간 이내 정상 자료 · 수신 '+d.checkedAt:'';}
