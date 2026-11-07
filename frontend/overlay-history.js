// One disposable history entry for the current sheet, never a persisted UI snapshot.
const KEY='powerEditorOverlay';
export function bindOverlayHistory(dialog,{window:win=window,canDismiss=()=>true}={}){
  let active=null,pending=false,reopen=false,sequence=0;
  const base=()=>{const state=win.history.state;const clean=state&&typeof state==='object'?{...state}:{};delete clean[KEY];return clean};
  const discard=()=>win.history.replaceState(base(),'');
  // A reload or a Forward visit must not restore an obsolete modal body.
  if(win.history.state?.[KEY])discard();
  function open(){
    if(pending){reopen=true;return}
    if(!dialog.open)dialog.showModal();
    if(!active&&canDismiss()){
      active='sheet-'+(++sequence);
      win.history.pushState({...base(),[KEY]:active},'');
    }
  }
  function consume(){
    if(!active)return;
    const owned=win.history.state?.[KEY]===active;
    active=null;
    if(owned){pending=true;win.history.back()}
  }
  function closed(){if(!dialog.open)consume()}
  function close(){if(!canDismiss())return;reopen=false;if(dialog.open)dialog.close();consume()}
  function cancel(event){event.preventDefault();close()}
  function pop(){
    const queued=pending&&reopen;
    pending=false;reopen=false;active=null;
    if(dialog.open&&canDismiss())dialog.close();
    if(win.history.state?.[KEY])discard();
    if(queued)open();
  }
  dialog.addEventListener('close',closed);
  dialog.addEventListener('cancel',cancel);
  win.addEventListener('popstate',pop);
  return {open,close,destroy(){dialog.removeEventListener('close',closed);dialog.removeEventListener('cancel',cancel);win.removeEventListener('popstate',pop)}};
}
