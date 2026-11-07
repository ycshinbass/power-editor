import test from 'node:test';
import assert from 'node:assert/strict';
import {bindOverlayHistory} from '../frontend/overlay-history.js';
function fixture({required=false,state={route:'today'}}={}){
 const win=new EventTarget(),dialog=new EventTarget(),entries=[{external:true},state],jobs=[];let index=1,allowed=!required;
 win.history={get state(){return entries[index]},pushState(s){entries.splice(++index);entries.push(s)},replaceState(s){entries[index]=s},back(){jobs.push(()=>{if(index>0){index--;win.dispatchEvent(new Event('popstate'))}})},forward(){jobs.push(()=>{if(index<entries.length-1){index++;win.dispatchEvent(new Event('popstate'))}})}};
 dialog.open=false;dialog.showModal=()=>{dialog.open=true};dialog.close=()=>{dialog.open=false;jobs.push(()=>dialog.dispatchEvent(new Event('close')))};
 const controller=bindOverlayHistory(dialog,{window:win,canDismiss:()=>allowed});
 return {win,dialog,controller,entries,get index(){return index},allow(){allowed=true},flush(){while(jobs.length)jobs.shift()()}};
}
test('Back closes a sheet before root navigation; Forward never resurrects it',()=>{
 const f=fixture();f.controller.open();assert.equal(f.index,2);f.win.history.back();f.flush();assert.equal(f.dialog.open,false);assert.equal(f.index,1);
 f.win.history.forward();f.flush();assert.equal(f.dialog.open,false);assert.equal(f.win.history.state.powerEditorOverlay,undefined);assert.equal(f.win.history.state.route,'today');
 f.win.history.back();f.flush();f.win.history.back();f.flush();assert.equal(f.index,0);
});
test('switches do not push; repeated X closes consume the same bounded entry',()=>{
 const f=fixture();for(let i=0;i<20;i++){f.controller.open();f.controller.open();assert.equal(f.entries.length,3);f.controller.close();f.flush();assert.equal(f.index,1);assert.equal(f.dialog.open,false)}
});
test('Escape and native close consume entry; open during close traversal is safe',()=>{
 const f=fixture();f.controller.open();const cancel=new Event('cancel',{cancelable:true});f.dialog.dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);f.flush();assert.equal(f.index,1);
 f.controller.open();f.dialog.close();f.flush();assert.equal(f.index,1);
 f.controller.open();f.controller.close();f.controller.open();f.flush();assert.equal(f.dialog.open,true);assert.equal(f.index,2);f.win.history.back();f.flush();assert.equal(f.dialog.open,false);
});
test('required first-use sheet cannot dismiss and does not trap browser navigation',()=>{
 const f=fixture({required:true});f.controller.open();assert.equal(f.entries.length,2);f.controller.close();f.dialog.dispatchEvent(new Event('cancel',{cancelable:true}));assert.equal(f.dialog.open,true);
 f.win.history.back();f.flush();assert.equal(f.index,0);assert.equal(f.dialog.open,true);
});
test('confirming first region closes without backing away; reload strips stale marker',()=>{
 const f=fixture({required:true});f.controller.open();f.allow();f.dialog.close();f.flush();assert.equal(f.index,1);f.controller.open();assert.equal(f.index,2);
 const reload=fixture({state:{route:'plan',powerEditorOverlay:'old'}});assert.deepEqual(reload.win.history.state,{route:'plan'});assert.equal(reload.dialog.open,false);
});
