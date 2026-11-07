// Local design review only. This module is never included in the Worker build.
import {readFile} from 'node:fs/promises';
const read=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
export async function reviewResponse(path){
const now=new Date().toISOString();
if(path==='/api/focused-news')return {status:'ok',items:[],checkedAt:now,notice:'검증용 빈 뉴스 목록'};
if(path==='/api/power-demand'){const date=new Date(Date.now()+32400000).toISOString().slice(0,10),start=Date.parse(date+'T00:00:00+09:00'),rows=offset=>Array.from({length:offset?288:Math.max(2,Math.floor((Date.now()-start)/300000))},(_,i)=>({at:new Date(start+offset+i*300000).toISOString(),mw:60000+10000*Math.sin(i/50)}));return {status:'ok',date,today:rows(0),previous:rows(-86400000),stale:false,referenceAt:now,validationFixture:true};}

if(path==='/api/local-data'){const {handleLocalData}=await import('../worker/local-data.mjs');const base=await (await handleLocalData(new Request('http://local/api/local-data'),{})).json();return {...base,weather:{status:'ok',city:'순천',temperature:18.2,humidity:62,windSpeed:2.4,rainfall:0,precipitationType:0,referenceAt:now,checkedAt:now,validationFixture:true},weatherForecast:{status:'ok',city:'순천',forecastIssuedAt:now,date:new Date(Date.now()+9*3600000).toISOString().slice(0,10),days:[],conditions:[{at:now,sky:3,precipitationType:0}],checkedAt:now},earthquake:{status:'ok',count:0,items:[],checkedAt:now,validationFixture:true}}}
if(path==='/api/power-flow'){const {handlePowerFlow}=await import('../worker/local-data.mjs');return (await handlePowerFlow(new Request('http://local/api/power-flow'),{})).json()}
if(path==='/api/briefing') {const curated=await read('../worker/curated.json');return {status:'ok',checkedAt:now,notice:'',selection:{regions:['여수','순천','광양','구례','보성','고흥']},sources:[],items:Object.entries(curated.articles).slice(0,6).map(([url,r],i)=>({id:'review-'+i,url,title:r.originalTitle,reason:r.selectionReason,scope:'global',freshness:Date.now()-Date.parse(r.publishedDate)>3*86400000?'older':'recent',sourceName:r.publisher,publishedAt:r.publishedDate,checkedAt:r.checkedAt,editorial:r}))};}
if(path==='/api/power-supply')return {status:'ok',reservePercent:54.07,reserveMw:31691,demandMw:58614,referenceAt:now,checkedAt:now,stale:false};
if(path==='/api/public-signals')return {signals:[{id:'weather',name:'기상청 특보',status:'ok',count:1,checkedAt:now,sourceUrl:'https://www.weather.go.kr/w/special-report/overall.do',records:[{type:'호우',level:'주의보',region:'순천시',announced:'2026-11-01 16:00',effective:'2026-11-01 18:00',releaseEstimate:'3일 새벽'}],notice:'검증용 자료'},{id:'fire',name:'산불 공개현황',status:'ok',count:0,checkedAt:now,sourceUrl:'https://fd.forest.go.kr/ffas/',records:[],notice:'검증용 자료'},{id:'landslide',name:'산사태 예보',status:'ok',count:0,checkedAt:now,sourceUrl:'https://sansatai.forest.go.kr/',records:[],notice:'검증용 자료'}]};
if(path==='/api/events')return read('../frontend/official-events.json');
if(path==='/api/weather'){const start=new Date();start.setUTCMinutes(0,0,0);const end=new Date(+start+86400000);return {status:'ok',city:'순천',source:'MET Norway',periodKind:'rolling24h',checkedAt:now,sourceUpdatedAt:now,validationFixture:true,days:[{date:now.slice(0,10),periodStart:start.toISOString(),periodEnd:end.toISOString(),windMs:5.8,rainMm:12.4,gustMs:null,snowCm:null}]};}
if(path==='/api/push/config')return {enabled:false,reason:'디자인 검토 시안에서는 알림을 연결하지 않습니다.'};
return {status:'unavailable',enabled:false,reason:'검토 시안 · 외부 연결 없음',sources:[]};
}
export const reviewNotice='<div class="mockup-notice" style="padding:8px 20px;background:#e9eef5;color:#334a65;text-align:center;font:600 11px/1.5 sans-serif">검토 시안 · 예시 데이터 · 실제 상황 아님</div>';
