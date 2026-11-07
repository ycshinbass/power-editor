// Presentation only: move existing live controls, retaining their IDs and listeners.
export function mountMaterial3(){
 const view=document.getElementById('todayView');
 if(!view||view.dataset.material3)return;
 view.dataset.material3='true';
 const side=document.createElement('aside');side.className='material-side';side.setAttribute('aria-label','우리지역 현황과 전력 뉴스');
 side.append(view.querySelector('.attention'),view.querySelector('#news'));view.append(side);
 const event=view.querySelector('.event-glance');
 if(event){
  const section=document.createElement('section');section.className='material-events';
  const heading=document.createElement('div');heading.className='material-section-heading';
  const title=document.createElement('h2');title.textContent='다가오는 주요 일정';
  const button=event.querySelector('.plan-link');button.textContent='월간 보기 ↗';
  heading.append(title,button);section.append(heading,event);view.append(section);
 }
 const source=view.querySelector('.references'),note=view.querySelector('.endnote');
 const footer=document.getElementById('previewSiteFooter');
 if(footer&&source&&note){footer.prepend(source,note);}
}
