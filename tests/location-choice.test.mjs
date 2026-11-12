import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {restoreLocationChoice} from '../frontend/location-onboarding.js';
import {REGION_CATALOG} from '../frontend/regions.js';
import {nearestCity} from '../frontend/logic.js';

test('return visits reuse only an explicit choice with an already granted permission',async()=>{
 for(const choice of [null,'later','requested'])for(const state of ['prompt','denied','granted']){
  let calls=0;
  await restoreLocationChoice({storage:{getItem:()=>choice},permissions:{query:async()=>({state})},onAllow:()=>calls++});
  assert.equal(calls,choice==='requested'&&state==='granted'?1:0);
 }
 await restoreLocationChoice({storage:{getItem:()=> 'requested'},permissions:undefined,onAllow:()=>assert.fail('permission unavailable')});
});

test('actual location callback updates weather to a Suwon district and keeps precise coordinates out of storage',async()=>{
 const app=await readFile(new URL('../frontend/app.js',import.meta.url),'utf8');
 let success,selected;
 const context=vm.createContext({REGION_CATALOG,WEATHER_CITIES:REGION_CATALOG.filter(r=>Number.isFinite(r.latitude)).map(r=>r.id),nearestCity,Number,
  renderAirLocation(){},renderLocalCards(){},setWeatherCity:(city,mode)=>{selected={city,mode}},
  navigator:{geolocation:{getCurrentPosition:callback=>{success=callback}}}});
 vm.runInContext(app.split('\n').find(line=>line.startsWith('const CITY_CENTERS='))+"\nlet airPosition=null,airLocationPending=false,airLocationMessage='';\n"+app.slice(app.indexOf('function requestAirLocation()'),app.indexOf('function nearestAirContent()')),context);
 context.requestAirLocation();success({coords:{latitude:37.2636,longitude:127.0286,accuracy:30}});
 assert.match(selected.city,/^수원시 /);assert.equal(selected.mode,'current');
 assert.doesNotMatch(app.match(/function persist\(\).*?\n/s)[0],/latitude|longitude|airPosition/);
});

test('weather point changes clear old observations immediately and refresh both forecast paths',async()=>{
 const app=await readFile(new URL('../frontend/app.js',import.meta.url),'utf8'),calls=[];
 const context=vm.createContext({WEATHER_CITIES:['수원시 영통구'],localStorage:{setItem:(key,value)=>calls.push([key,value])},
  persist(){},renderWeather(){},renderLocalCards(){},refreshWeather:()=>calls.push('model'),refreshLocalData:parts=>calls.push([...parts])});
 vm.runInContext("let weatherCity='순천',weatherLocationMode='current',weatherData={city:'순천'},localData={weather:{city:'순천',temperature:25},airQuality:{count:3}};\n"+app.slice(app.indexOf('function setWeatherCity('),app.indexOf('let airPosition=')),context);
 await context.setWeatherCity('수원시 영통구','current');
 assert.equal(vm.runInContext('localData.weather.city',context),'수원시 영통구');
 assert.equal(vm.runInContext('localData.weather.temperature',context),undefined);
 assert.equal(vm.runInContext('localData.airQuality.count',context),3);
 assert.equal(vm.runInContext('weatherData',context),null);
 assert.ok(calls.includes('model'));assert.deepEqual(calls.at(-1),['weather','weatherForecast']);
 await context.setWeatherCity('수원시 영통구');assert.equal(vm.runInContext('weatherLocationMode',context),'manual');
});
