/* Display preference only: no network requests or location access. */
export const THEME_KEY='power-editor-theme';
export function initTheme(doc=document,win=window){
 const media=win.matchMedia?.('(prefers-color-scheme: dark)');let saved=null;
 try{saved=win.localStorage.getItem(THEME_KEY)}catch{}
 const buttons=[...doc.querySelectorAll('[data-theme-choice]')];
 function apply(theme){doc.documentElement.dataset.theme=theme;for(const b of buttons)b.setAttribute('aria-pressed',String(b.dataset.themeChoice===theme));const meta=doc.querySelector('meta[name="theme-color"]');if(meta)meta.content=theme==='dark'?'#101e29':'#172f42'}
 apply(['light','dark'].includes(saved)?saved:media?.matches?'dark':'light');
 for(const b of buttons)b.addEventListener('click',()=>{saved=b.dataset.themeChoice;apply(saved);try{win.localStorage.setItem(THEME_KEY,saved)}catch{}});
 media?.addEventListener?.('change',e=>{if(!['light','dark'].includes(saved))apply(e.matches?'dark':'light')});
}
if(typeof document!=='undefined')initTheme();

if(typeof window!=='undefined')window.addEventListener('error',()=>{if(!document.documentElement.classList.contains('naver-design-preview'))document.documentElement.classList.add('startup-error');});
