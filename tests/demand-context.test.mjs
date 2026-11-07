import test from 'node:test';import assert from 'node:assert/strict';
import {parseHistoricDemand,parseDayAhead,fourWeekComparison} from '../worker/demand-context.mjs';
test('historic demand requires every 5-minute market sample of the requested date',()=>{
 const times=Array.from({length:288},(_,i)=>'20261027'+String(Math.floor(i/12)).padStart(2,'0')+String(i%12*5).padStart(2,'0')+'00'),values=Array(288).fill(60000);
 const html='function drawChart(par1, par2, par3){현재수요(전력시장) "data": x;var x = ['+values+'];var t_time = ['+times+'];';
 assert.equal(parseHistoricDemand(html,'2026-10-27').length,288);assert.throws(()=>parseHistoricDemand(html,'2026-10-20'));assert.throws(()=>parseHistoricDemand(html.replace(times[1],times[0]),'2026-10-27'));
});
test('four-week comparison uses the complete previous hour, not current instant or partial hour',()=>{
 const date='2026-11-03',start=Date.parse(date+'T00:00:00+09:00'),today=Array.from({length:181},(_,i)=>({at:new Date(start+i*300000).toISOString(),mw:66000})),histories=[7,14,21,28].map(n=>({date:new Date(start+32400000-n*86400000).toISOString().slice(0,10),points:Array.from({length:288},(_,i)=>({hour:Math.floor(i/12),minute:i%12*5,mw:60000}))}));
 const result=fourWeekComparison(today,histories,start+15*3600000);assert.equal(result.hour,14);assert.equal(result.deltaMw,6000);assert.ok(Math.abs(result.percent-10)<1e-8);assert.equal(result.dates.length,4);
 assert.equal(fourWeekComparison(today.filter((p,i)=>i!==169),histories,start+15*3600000),null);assert.equal(fourWeekComparison(today,histories.slice(1),start+15*3600000),null);assert.equal(fourWeekComparison(today.slice(0,3),histories,start+10*60000),null);
});
test('day-ahead forecast accepts exactly 24 positive hours for the selected transaction day',()=>{
 const body='하루전 발전계획용 수요예측 단위 : MW <input id="issue_date" value="2026-11-03"><table><th scope="col">구분</th><th scope="col">11.03<br/>(화)</th>'+Array.from({length:24},(_,i)=>'<tr><td>'+(i+1)+'h</td><td>60,000</td></tr>').join('')+'</table>';
 assert.equal(parseDayAhead(body,'2026-11-03').length,24);assert.throws(()=>parseDayAhead(body,'2026-11-04'));assert.throws(()=>parseDayAhead(body.replace('<td>60,000</td>','<td>0</td>'),'2026-11-03'));assert.throws(()=>parseDayAhead(body.replace('<td>24h</td>','<td>23h</td>'),'2026-11-03'));
});
