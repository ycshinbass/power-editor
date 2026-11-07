import {REGION_CATALOG,normalizeRegions,regionMatches} from '../frontend/regions.js';

// RSS metadata only. No publisher-page requests, descriptions, translations or AI.
const POWER='(전력 OR 한전 OR 정전 OR 송전 OR 변전 OR 배전 OR 변압기 OR 전력기기 OR 발전소 OR 전기요금)';
function source(id,name,query,scope='national',locale='ko'){
 const url=new URL('https://news.google.com/rss/search');
 url.search=new URLSearchParams({q:query+' when:3d',hl:locale==='en'?'en-US':locale,gl:locale==='en'?'US':'KR',ceid:locale==='en'?'US:en':'KR:ko'}).toString();
 return {id,name,kind:'press',scope,format:'google-news-rss',url:url.href,home:'https://news.google.com/',hosts:['news.google.com'],priority:40,scheduledOnly:true,editorialAllowed:false,aiUseAllowed:false,rights:'Google 뉴스 RSS · 제목·발행처·발행일·기사 링크만 표시 · AI 미사용. 피드는 개인·비상업용 리더 목적을 명시하며 공개·팀 공동 이용 허용은 미확인.',rightsURL:'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko'};
}
export function googleNewsSources(regions=[]){
 const sources=[source('google-national','Google 뉴스 · 국내 전력',POWER),source('google-kepco','Google 뉴스 · 한전','(한국전력 OR 한전 OR KEPCO)'),source('google-global','Google News · 해외 전력','("power outage" OR "power grid" OR "grid reliability" OR "power transformer" OR "HVDC" OR "electricity demand")','global','en')];
 const selected=normalizeRegions(regions).sort();
 // At most six regional requests per edition, regardless of browser visits.
 for(let i=0;i<selected.length;i+=5){const batch=selected.slice(i,i+5);let hash=2166136261;for(const c of batch.join('|'))hash=Math.imul(hash^c.charCodeAt(0),16777619);
  sources.push(source('google-local-'+(hash>>>0).toString(36),'Google 뉴스 · '+batch.join('·'),'('+batch.map(r=>'"'+r+'"').join(' OR ')+') '+POWER));
 }
 return sources;
}

const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const names=r=>[...new Set([r.id,r.fullName,...(r.aliases||[])])].filter(Boolean);
const aliasOwners=new Map();
for(const r of REGION_CATALOG)for(const name of names(r)){if(!aliasOwners.has(name))aliasOwners.set(name,new Set());aliasOwners.get(name).add(r.id)}
export function headlineRegions(title){
 // A query's location and publisher headquarters never establish article location.
 const found=REGION_CATALOG.filter(r=>names(r).some(name=>!['광주','광주시'].includes(name)&&aliasOwners.get(name).size===1&&new RegExp('(^|[^가-힣A-Za-z0-9])'+escape(name)+'(?=$|[^가-힣A-Za-z0-9])').test(title))).map(r=>r.id);
 return found.filter(r=>!found.some(other=>other!==r&&regionMatches(r,other))).slice(0,30);
}

export function googleMetadata(block,title,url,cleanText){
 const source=block.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i);
 const publisher=cleanText(source?.[1]||'').slice(0,120);
 if(!publisher)return null;
 // Google's headline suffix repeats the source field; the publisher headline is unchanged.
 const suffix=' - '+publisher;
 const headline=title.endsWith(suffix)?title.slice(0,-suffix.length).trim():title;
 const regions=headlineRegions(headline);
 return {title:headline,publisherName:publisher,...(regions.length?{regionEvidence:{type:'headline_location',url,regions}}:{})};
}
