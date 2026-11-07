import test from 'node:test';import assert from 'node:assert/strict';
import {lastGoodCache,retainLastGood,usesLastGood} from '../frontend/last-good.js';
import {scopedPublicSignal} from '../frontend/logic.js';
import {earthquakeSummary} from '../frontend/weather-display.js';
import {permittedSearchFallback} from '../frontend/naver-search.js';
const now=Date.parse('2026-11-04T03:00:00Z'),good={status:'ok',checkedAt:new Date(now).toISOString(),count:0,items:[]};
test('three-hour fallback retains timestamps, scopes, zero, and replaces on success',()=>{
 const c=lastGoodCache();c.resolve('weather:순천',good,now);
 const failed={status:'unavailable',reason:'request_failed'};
 const cached=c.resolve('weather:순천',failed,now+3600000);
 assert.equal(cached.count,0);assert.equal(cached.checkedAt,good.checkedAt);assert.ok(usesLastGood(cached,now+3*3600000));
 assert.equal(c.resolve('weather:순천',failed,now+3*3600000+1),failed);
 assert.equal(c.resolve('weather:여수',failed,now+3600000),failed);
 const next={...good,count:2,checkedAt:new Date(now+7200000).toISOString()};assert.equal(c.resolve('weather:순천',next,now+7200000),next);
});
test('Naver fallback never extends the original source expiration or changes the result',()=>{
 const result={items:[]},prior={...good,result,expiresAt:now+3600000};
 assert.equal(permittedSearchFallback(prior,{status:'temporarily_unavailable'},now+1000).result,result);
 assert.equal(permittedSearchFallback(prior,null,now+3600000),null);
});
test('missing data and date rollover are not disguised as transport failure',()=>{
 for(const reason of ['date_rollover','region_unmatched','station_data_missing']){const next={status:'unavailable',reason};assert.equal(retainLastGood(good,next,now),next)}
 const previous={...good,date:'2026-11-03'};assert.equal(usesLastGood({...previous,refreshError:true},now),false);
});
test('warning and domestic earthquake retain count only with verified recent successful data',()=>{
 const warning={...good,id:'weather',stale:true,reason:'provider_fetch_failed',records:[]};assert.equal(scopedPublicSignal(warning,[],now+3600000).label,'전국 0건');
 const quake={...good,stale:true,refreshError:true};assert.equal(usesLastGood(quake,now+3600000),true);assert.equal(usesLastGood(quake,now+3*3600000+1),false);
});
test('Google display grace is twenty-four hours while normal observations keep three hours',()=>{
 const news=lastGoodCache(24*3600000),weather=lastGoodCache(),failed={status:'unavailable',reason:'request_failed'};
 for(const cache of [news,weather])cache.resolve('test',good,now);
 assert.equal(news.resolve('test',failed,now+24*3600000).checkedAt,good.checkedAt);
 assert.equal(news.resolve('test',failed,now+24*3600000+1),failed);
 assert.equal(weather.resolve('test',failed,now+3*3600000+1),failed);
 const fresh={...good,checkedAt:new Date(now+24*3600000+2).toISOString(),count:2};
 assert.equal(news.resolve('test',fresh,now+24*3600000+2),fresh);
});
