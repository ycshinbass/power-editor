const KEY='power-editor-location-choice-v1';
// An explicit user gesture precedes the browser permission prompt. No coordinates
// or granted permission are stored here; the browser owns permission lifetime.
export function mountLocationChoice({doc=document,storage=localStorage,onAllow}={}){
 try{if(storage.getItem(KEY))return;}catch{}
 if(doc.getElementById('locationFirstVisit'))return;
 const card=doc.createElement('section');card.id='locationFirstVisit';card.className='location-first-visit';card.setAttribute('aria-label','처음 방문 위치 안내');
 card.innerHTML='<div><strong>현재 위치를 사용할까요?</strong><p>가까운 날씨 지점과 관심지역 안의 대기질 측정소를 찾습니다. 서버에는 날씨 지역명만 보내며, 좌표는 보내거나 저장하지 않습니다.</p></div><div class="location-choice-actions"><button type="button" data-location-allow>위치 허용</button><button type="button" data-location-later>나중에</button></div>';
 doc.querySelector('.masthead').after(card);
 const finish=choice=>{try{storage.setItem(KEY,choice)}catch{}card.remove();};
 card.querySelector('[data-location-allow]').onclick=()=>{finish('requested');onAllow();};
 card.querySelector('[data-location-later]').onclick=()=>finish('later');
 return true;
}

// Reuse an existing grant without triggering a permission prompt on return visits.
export async function restoreLocationChoice({permissions=globalThis.navigator?.permissions,onAllow,doc=globalThis.document}={}){
 try{if((await permissions?.query({name:'geolocation'}))?.state==='granted'){doc?.getElementById('locationFirstVisit')?.remove();onAllow();}}catch{}
}
