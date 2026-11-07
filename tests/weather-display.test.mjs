import test from 'node:test';
import assert from 'node:assert/strict';
import {retainLastGood} from "../frontend/last-good.js";
import {currentWeatherCondition,currentWeatherHTML,currentWeatherText,forecastDates,forecastHTML,weatherIcon,earthquakeSummary,warningSummary,warningDetailsHTML} from '../frontend/weather-display.js';
const now=Date.parse('2026-11-02T15:00:00Z');
test('weather reference retains zero and null; never infers sky from temperature or daily icon',()=>{const text=currentWeatherText({city:'순천',temperature:0,humidity:0,windSpeed:0,icon:'sun'});assert.match(text,/0℃ · 습도 0% · 풍속 0m\/s/);assert.doesNotMatch(text,/맑음|구름 미확인/);assert.match(currentWeatherText(null),/—℃/);assert.match(currentWeatherText({temperature:17,humidity:null,windSpeed:null,stale:true}),/습도 —%.*이전 관측/)});
test('current weather uses fresh precipitation observation before same-point hourly sky',()=>{const o={status:'ok',city:'순천',referenceAt:new Date(now-1800000).toISOString(),precipitationType:1};const f={status:'ok',city:'순천',forecastIssuedAt:new Date(now-3600000).toISOString(),conditions:[{at:new Date(now).toISOString(),sky:1,precipitationType:0}]};assert.equal(currentWeatherCondition(o,f,now).label,'비');for(const [pty,label]of [[2,'비·눈'],[3,'눈'],[5,'빗방울'],[6,'빗방울·눈날림'],[7,'눈날림']])assert.equal(currentWeatherCondition({...o,precipitationType:pty},f,now).label,label);assert.equal(currentWeatherCondition({...o,precipitationType:0},f,now).label,'맑음');f.conditions[0].sky=3;assert.equal(currentWeatherCondition({...o,precipitationType:0},f,now).label,'구름많음');f.conditions[0].sky=4;assert.equal(currentWeatherCondition({...o,precipitationType:0},f,now).label,'흐림');assert.equal(currentWeatherCondition({...o,precipitationType:0},f,now).basis,'시간대 예보')});
test('wrong point, distant hour, stale issue and missing codes do not invent a condition',()=>{const o={city:'순천'},f={status:'ok',city:'순천',forecastIssuedAt:new Date(now-3600000).toISOString(),conditions:[{at:new Date(now).toISOString(),sky:1,precipitationType:0}]};for(const bad of [{...f,city:'여수'},{...f,stale:true},{...f,forecastIssuedAt:new Date(now-18000000).toISOString()},{...f,conditions:[{...f.conditions[0],at:new Date(now+7200000).toISOString()}]},{...f,conditions:[{at:new Date(now).toISOString(),sky:null,precipitationType:null}]}])assert.equal(currentWeatherCondition(o,bad,now).icon,'unknown');assert.equal(currentWeatherCondition({status:'ok',referenceAt:new Date(now-10800000).toISOString(),precipitationType:1},null,now).icon,'unknown');const html=currentWeatherHTML({...o,temperature:0,humidity:55,windSpeed:1},f,now);assert.match(html,/weather-now-temp">0/);assert.match(html,/weather-now-humidity/);assert.match(html,/weather-basis">예보/);assert.match(html,/M19 17A9/)});
test('three calendar days follow KST midnight not UTC',()=>{assert.deepEqual(forecastDates(now),['2026-11-03','2026-11-04','2026-11-05']);assert.deepEqual(forecastDates(now-1),['2026-11-02','2026-11-03','2026-11-04'])});
test('all weather icons are inline SVG, unknown input stays safe',()=>{for(const icon of ['sun','cloud-sun','cloud','rain','snow','sleet','unknown'])assert.match(weatherIcon(icon),new RegExp('icon-'+icon));assert.doesNotMatch(weatherIcon('<script>'),/<script>/)});
test('forecast renders null as dash, explicit partial period, source and distinct measures',()=>{const html=forecastHTML({status:'ok',city:'순천',forecastIssuedAt:'issued',checkedAt:'checked',days:[{date:'2026-11-03',temperatureMin:null,temperatureMax:12,precipitationProbabilityMax:0,windSpeedMax:0,rainfallText:'강수없음',icon:'sun',partial:true}]},{now});assert.match(html,/temp-low">—/);assert.match(html,/남은 시간 예보/);for(const text of ['오늘','내일','모레','시간당 강수 최대','최대강수확률','최대풍속','기상청 단기예보','발표 issued','조회 checked'])assert.ok(html.includes(text));assert.match(html,/<dd>0<\/dd>/);assert.equal((html.match(/class="forecast-day"/g)||[]).length,3)});
test('prior-date records cannot masquerade as today and errors never zero',()=>{const html=forecastHTML({status:'failed',days:[{date:'2026-11-03',temperatureMin:15}]},{now});assert.match(html,/예보 확인 불가/);assert.doesNotMatch(html,/temp-low">15/);assert.match(forecastHTML({status:'ok',stale:true,days:[]},{now}),/이전 예보/)});
test('quake domestic priority, overseas only, verified zero and failure',()=>{const quake=items=>({status:'ok',items,count:items.length});assert.equal(earthquakeSummary(quake([{type:'overseas'},{type:'domestic'}])),'국내 1건');assert.equal(earthquakeSummary(quake([{type:'overseas'}])),'해외 1건');assert.equal(earthquakeSummary(quake([])),'없음');for(const data of [null,{status:'error'}, {...quake([]),stale:true},quake([{type:'unknown'}])])assert.equal(earthquakeSummary(data),'확인 불가')});
test('warning normal zero differs from unknown failure stale and pending',()=>{assert.equal(warningSummary({kind:'ok',count:0}),'발효 없음');assert.equal(warningSummary({kind:'failed',count:0}),'확인 불가');assert.equal(warningSummary({kind:'ok',unknown:true}),'판별 불가');assert.equal(warningSummary({kind:'stale',count:0}),'이전 자료 · 0건');const html=warningDetailsHTML({records:[],pendingRecords:[{type:'호우'}]});assert.match(html,/예비·발효 예정 1건/);assert.doesNotMatch(html,/warning-active-list/)});
test('warning detail escapes source records and includes region and effective time',()=>{const html=warningDetailsHTML({records:[{type:'호우',level:'주의보',region:'<순천>',effective:'11.03 12:00'}]});assert.match(html,/&lt;순천&gt;/);assert.match(html,/11.03 12:00/)});

test('observation city option keeps canonical region ID rather than display label',async()=>{const {readFile}=await import('node:fs/promises');const app=await readFile(new URL('../frontend/app.js',import.meta.url),'utf8');assert.ok(app.includes('<option value="${esc(x)}" ${x===weatherCity?'));});

test('rain, mixed precipitation and snow show measured one-hour water amount next to the icon only',()=>{
 const o={status:'ok',city:'순천',referenceAt:new Date(now-1800000).toISOString(),temperature:2,humidity:90,windSpeed:1,rainfall:2.5};
 for(const precipitationType of [1,2,3,5,6,7]){const html=currentWeatherHTML({...o,precipitationType},null,now);assert.match(html,/weather-now-precip/);assert.match(html,/2.5mm/);assert.match(html,/최근 1시간 강수량/);assert.match(html,/물 환산량/);assert.doesNotMatch(html,/2.5cm/)}
 assert.match(currentWeatherHTML({...o,precipitationType:1,rainfall:0},null,now),/>0mm</);
 for(const bad of [{precipitationType:0},{precipitationType:1,rainfall:null},{precipitationType:1,rainfall:-1},{precipitationType:1,stale:true}])assert.doesNotMatch(currentWeatherHTML({...o,...bad},null,now),/weather-now-precip/);
});

test('current weather falls back to recent same-city data with a visible time',()=>{
 const at=new Date(now-7200000).toISOString(),checkedAt=new Date(now-3600000).toISOString();
 const observation={status:'ok',city:'순천',referenceAt:at,checkedAt,stale:true,temperature:13.5,humidity:29,precipitationType:0};
 const forecast={status:'ok',city:'순천',forecastIssuedAt:new Date(now-10800000).toISOString(),checkedAt,stale:true,conditions:[{at,sky:3,precipitationType:0}]};
 const failed={status:'unavailable',reason:'provider_timeout'};
 const recent=retainLastGood(observation,failed,now);
 const html=currentWeatherHTML(recent,retainLastGood(forecast,failed,now),now);
 assert.match(html,/icon-cloud-sun/);
 assert.match(html,/13\.5.*29/);
 assert.match(html,/이전 예보 22:00 · 이전 관측 22:00/);
 assert.match(currentWeatherHTML(observation,{...forecast,city:'여수'},now),/날씨 정보 없음/);
 assert.match(currentWeatherHTML(null,null,now),/날씨 확인 중/);
 assert.doesNotMatch(currentWeatherHTML(observation,{...forecast,city:'여수'},now),/icon-unknown/);
 assert.equal(currentWeatherCondition(observation,forecast,now+3600001).icon,'unknown');
 assert.equal(currentWeatherCondition({...observation,precipitationType:1},null,now).basis,'이전 관측');
 assert.equal(currentWeatherCondition({...observation,precipitationType:1},{...forecast,stale:false,conditions:[{at:new Date(now).toISOString(),sky:1}]},now).icon,'sun');
});
