import {googleRssFetch,GOOGLE_RSS_REFRESH_MS,GOOGLE_RSS_MAX_AGE_MS} from './google-rss-transport.mjs';
import {googleRssWithFallback,googleNewsMaxAge,googleFallbackConfigured} from './google-rss-fallback.mjs';
import {createD1SnapshotStore} from './snapshot-d1.mjs';
import {googleNewsSources,googleMetadata} from './google-news.mjs';
import {newsMatchesRegions,newsValue} from '../frontend/logic.js';
import {REGION_NAMES as CATALOG_REGION_NAMES,REGION_HIERARCHY as CATALOG_REGION_HIERARCHY,regionMatches,normalizeRegions,getRegion} from '../frontend/regions.js';
import {KEPCO_SOURCE,parseKepcoList} from './kepco-feed.mjs';
// Public-feed pilot: headlines + source links only, never article bodies/images.
export const SOURCES = [
  ...googleNewsSources(),
  KEPCO_SOURCE,
  {id:'gynet',name:'광양뉴스',kind:'press',scope:'national',url:'https://www.gynet.co.kr/rss/allArticle.xml',home:'https://www.gynet.co.kr/',hosts:['www.gynet.co.kr'],priority:40,timezoneOffset:'+09:00',privateUseOnly:true,editorialAllowed:false,rights:'공식 RSS의 개인 리더용 제목·발행일·링크만 연결 · 본문·사진·AI 분석 제외',rightsURL:'https://www.gynet.co.kr/rssIndex.html'},
  {id:'etoday',name:'이투데이 산업',kind:'press',scope:'national',url:'https://rss.etoday.co.kr/eto/industry_news.xml',home:'https://www.etoday.co.kr/',hosts:['www.etoday.co.kr'],priority:40,privateUseOnly:true,editorialAllowed:false,rights:'공식 RSS 비상업적 이용 · 제목·발행일·링크만 연결 · 본문·사진·AI 분석 제외',rightsURL:'https://www.etoday.co.kr/rss/'},
  {id:'sbs',name:'SBS 사회',kind:'press',scope:'national',url:'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=03&plink=RSSREADER',home:'https://news.sbs.co.kr/',hosts:['news.sbs.co.kr'],priority:40,privateUseOnly:true,editorialAllowed:false,geographicCategories:true,rights:'공식 RSS 개인·비상업적 이용 · 제목·발행일·링크만 연결 · 본문·사진·AI 분석 제외',rightsURL:'https://news.sbs.co.kr/news/rss.do'},
  ...[['jeonnam','전남','jn'],['gwangju','광주','gj']].map(([area,region,host])=>({id:'nocut-'+area,name:'노컷뉴스 '+region,kind:'press',scope:'local',url:'https://rss.nocutnews.co.kr/news/'+area+'.xml',home:'https://'+host+'.nocutnews.co.kr/',hosts:[host+'.nocutnews.co.kr'],priority:40,privateUseOnly:true,editorialAllowed:false,aiUseAllowed:false,aiRestricted:true,publisherFeedRegions:[region],rights:'공식 RSS 개인·비상업적 리더용 제목·발행일·링크만 연결 · AI 학습·활용 금지 · 본문·사진 수집 제외',rightsURL:'https://www.nocutnews.co.kr/rss/',aiRestrictionURL:'https://www.nocutnews.co.kr/'})),
  { id:'mcee', name:'기후에너지환경부 보도자료', kind:'official', scope:'national', url:'https://www.mcee.go.kr/home/web/board/rss.do?menuId=10598&boardMasterId=939', home:'https://www.mcee.go.kr/', hosts:['www.mcee.go.kr'], priority:35, editorialAllowed:false, rights:'공식 RSS 안내에 따른 제목·발행일·링크만 표시 · 본문 재사용은 개별 권리 확인 필요', rightsURL:'https://www.mcee.go.kr/home/web/index.do?menuId=345', rssGuideURL:'https://www.mcee.go.kr/home/web/index.do?menuId=447' },
  { id:'pjm', name:'PJM Inside Lines', kind:'official', scope:'global', url:'https://insidelines.pjm.com/feed/', home:'https://www.pjm.com/', hosts:['insidelines.pjm.com','pjm.com'], priority:35, rights:'공식 RSS 독자·집계 서비스 안내 · 제목·링크만 표시', rightsURL:'https://www.pjm.com/about-pjm/newsroom/rss-feeds' },
  { id:'motir', name:'산업통상부 보도자료', kind:'official', scope:'national', method:'POST', timezoneOffset:'+09:00', url:'https://www.motir.go.kr/kor/article/ATCL3f49a5a8c/rss', home:'https://www.motir.go.kr/', hosts:['motir.go.kr'], priority:35, rights:'공공누리 제1유형 · 출처표시', rightsURL:'https://www.motir.go.kr/kor/contents/81' },
  { id:'eia', name:'미국 EIA', kind:'official', scope:'global', url:'https://www.eia.gov/rss/todayinenergy.xml', home:'https://www.eia.gov/', hosts:['eia.gov'], priority:35, rights:'미국 연방정부 공개자료 · 출처·발행일 표시', rightsURL:'https://www.eia.gov/about/copyrights_reuse.php' }
];
export const SOURCE_POLICY = {
  description:'공식 기관 발표와 책임 있는 언론의 공개 RSS를 우선 확인합니다. 출처의 명성이나 조회 수만으로 진위를 확정하지 않습니다.',
  method:'개인용으로 한정된 기존 언론 RSS·한국전력 직접 수집은 공개 배포에서 제외합니다. 언론 기사는 제목·발행일·링크만 연결하고 AI 해설에 사용하지 않습니다. 자동 수집은 제목·발행시각·출처 링크에 한정하며 규칙 기반으로 관련 기사를 선별합니다. AI 요약·번역·에디터 픽은 사용하지 않습니다. Google 뉴스 검색 RSS를 후보 확보에 사용하며 발행처와 Google 경유 링크를 표시합니다. 본문을 자동 수집·재배포하거나 지속적으로 사실검증하지 않습니다.',
  deferred:[
    { name:'기후에너지환경부 본문 편집', status:'title_links_only', reason:'공식 RSS의 제목·발행일·링크만 연결했습니다. 개별 자료의 공공누리 표시와 재사용 범위 확인 전 본문 요약·원문 대조 편집은 제공하지 않습니다.' },
    { name:'뉴시스', status:'not_connected', reason:'공식 약관의 자동 수집·추출 제한에 따라 연결하지 않았습니다. 별도 허가 전 수집하지 않습니다.' },
    { name:'연합뉴스', status:'not_connected', reason:'AI 활용 제한 및 RSS 재사용 권한 확인이 필요하여 연결하지 않았습니다.' },
    { name:'Reuters', status:'not_connected', reason:'공개 무인증 뉴스 피드를 확인하지 못했습니다. 계정·계약이 필요한 서비스를 우회하지 않습니다.' },
    { name:'뉴스1', status:'not_connected', reason:'공식 이용약관의 자동 수집 제한에 따라 연결하지 않았습니다. 허가 없이 우회 수집하지 않습니다.' }
  ],
  caveat:'출처별 편집 범위·갱신 주기가 달라 전체 전력산업 소식을 빠짐없이 보장하지 않습니다. 오보·정정 및 문맥은 원문에서 확인하세요.'
};
export const CURATED = {"https://www.eia.gov/todayinenergy/detail.php?id=68384": {"originalTitle": "The share of solar generation with co-located battery storage is increasing", "headlineKo": "미국 신규 태양광의 배터리 병설 확대…올해 9월까지 16% 넘어", "translationLabel": "우리지역 전력에디터 번역·요약", "publisher": "U.S. Energy Information Administration", "sourceType": "정부 통계 분석", "publishedDate": "2026-10-30", "datePrecision": "day", "gist": "EIA 집계에서 올해 9월까지 추가된 미국 대규모 태양광 용량 중 가동 중인 배터리가 함께 설치된 비중은 16%를 넘었다. 사업자가 제출한 계획에서는 2027~2028년 신규 태양광의 병설 비중이 30%를 넘지만, 이는 준공 실적이 아니다.", "selectionReason": "태양광·배터리 병설 확대. 충·방전에 따른 시간대별 전력 흐름 변화에 주목.", "uncertainty": "미국 사업자 보고자료에 근거한 분석이다. 향후 비중은 계획이며 국내 현장에 같은 비율이나 효과가 적용된다는 뜻은 아니다.", "ageLabelAtReview": "전일 발행", "relevanceClass": "산업 동향", "supportingUrls": ["https://www.eia.gov/todayinenergy/detail.php?id=68384"], "checkedAt": "2026-10-31T14:32:00Z"}, "https://insidelines.pjm.com/pjm-files-amended-reliability-backstop-proposal/": {"originalTitle": "PJM Files Amended Reliability Backstop Proposal", "headlineKo": "PJM, 대규모 수요 증가에 대응할 추가 전원 조달 수정안 제출", "translationLabel": "우리지역 전력에디터 번역·요약", "publisher": "PJM Inside Lines", "sourceType": "계통운영기관 자체 발표", "publishedDate": "2026-10-29", "datePrecision": "day", "gist": "PJM은 2028~2029년 공급연도 용량 부족에 대응하는 추가 조달 절차의 수정안을 FERC에 제출했다고 밝혔다. 2027년 3월 개시를 목표로 비용 배분과 신용 요건 등을 변경했으며, 조달 부족분은 새 정보로 다시 산정할 예정이다.", "selectionReason": "대규모 신규 부하와 전원 확보 속도의 격차. 추가 공급 확보 제도 논의.", "uncertainty": "PJM이 제출한 제안에 대한 자체 설명이다. 최종 승인이나 국내 제도 도입이 확정됐다는 보도가 아니며 현재 정전 발생을 뜻하지 않는다.", "ageLabelAtReview": "2일 전 발행", "relevanceClass": "공급 계획·제도", "supportingUrls": ["https://insidelines.pjm.com/pjm-files-amended-reliability-backstop-proposal/"], "checkedAt": "2026-10-31T14:32:00Z"}, "https://insidelines.pjm.com/pjm-ferc-focus-on-large-load-challenges-at-tech-conference/": {"originalTitle": "PJM, FERC Focus on Large Load Challenges at Tech Conference", "headlineKo": "PJM, 상시 데이터센터 부하로 봄·가을 설비 정비 여건도 어려워져", "translationLabel": "우리지역 전력에디터 번역·요약", "publisher": "PJM Inside Lines", "sourceType": "계통운영기관 자체 발표", "publishedDate": "2026-10-22", "datePrecision": "day", "gist": "PJM은 FERC 기술회의에서 데이터센터의 지속적인 전력 사용이 봄·가을 정비기간의 신뢰도 유지에도 부담을 준다고 설명했다. 대규모 부하의 기술정보 갱신과 전압·주파수 변동 시 계통 연결 유지 요건 등 대응 과제를 제시했다.", "selectionReason": "상시 데이터센터 부하 증가. 봄·가을 휴전·정비 여유도 함께 검토할 과제.", "uncertainty": "10월 21일 회의에 대한 10월 22일 발표이며 오늘의 긴급 상황이 아니다. PJM의 견해와 제도 논의로, 한국 계통의 정비 기준을 대체하지 않는다.", "ageLabelAtReview": "9일 전 발행 · 배경자료", "relevanceClass": "운영 참고 사례", "supportingUrls": ["https://insidelines.pjm.com/pjm-ferc-focus-on-large-load-challenges-at-tech-conference/"], "checkedAt": "2026-10-31T14:32:00Z"}, "https://www.eia.gov/todayinenergy/detail.php?id=68305": {"originalTitle": "PJM, ERCOT, and SWPP all set peak load records this summer", "headlineKo": "미국 PJM·ERCOT·SPP, 올여름 시간당 최대부하 기록 경신", "translationLabel": "우리지역 전력에디터 번역·요약", "publisher": "U.S. Energy Information Administration", "sourceType": "정부 통계 분석", "publishedDate": "2026-10-15", "datePrecision": "day", "gist": "EIA는 계통운영기관이 보고한 시간별 부하자료를 바탕으로 PJM·ERCOT·SPP의 2026년 여름 최대부하가 기존 기록을 넘었다고 분석했다. 대부분의 최대부하는 지역 폭염과 냉방수요 증가 시기에 나타났다.", "selectionReason": "폭염과 냉방수요가 최대부하를 견인. 기상·수요를 함께 보는 수급 계획.", "uncertainty": "16일 전 발표한 과거 여름 분석이다. EIA는 보고 오류 가능성과 각 운영기관 자체 수치와의 차이를 명시하며, 통계상 최대부하 경신이 곧 정전을 뜻하지는 않는다.", "ageLabelAtReview": "16일 전 발행 · 배경자료", "relevanceClass": "기상·수요 참고 사례", "supportingUrls": ["https://www.eia.gov/todayinenergy/detail.php?id=68305"], "checkedAt": "2026-10-31T14:32:00Z"}, "https://www.eia.gov/todayinenergy/detail.php?id=68324": {"originalTitle": "U.S. small-scale solar generation has quadrupled in the last decade", "headlineKo": "미국 소규모 태양광 발전량 확대…계통에서 보이지 않는 발전량 추정도 중요", "translationLabel": "우리지역 전력에디터 번역·요약", "publisher": "U.S. Energy Information Administration", "sourceType": "정부 통계 분석", "publishedDate": "2026-10-16", "datePrecision": "day", "gist": "EIA는 미국 소규모 태양광 발전량이 지난 10년 동안 크게 늘었다고 분석했다. 전력회사가 지붕형 태양광의 실제 발전량을 모두 알 수 없어 설비 용량 조사와 모델을 이용해 발전량을 추정한다고 설명했다.", "selectionReason": "분산형 태양광 확대. 계측 부하와 추정 발전량을 구분해야 하는 운영 과제.", "uncertainty": "15일 전 발행한 미국 통계 설명이다. 발전량은 추정치이며 국내 특정 변전소에서 역송이나 전압 문제가 발생했다는 근거는 아니다.", "ageLabelAtReview": "15일 전 발행 · 배경자료", "relevanceClass": "분산전원 데이터 참고", "supportingUrls": ["https://www.eia.gov/todayinenergy/detail.php?id=68324"], "checkedAt": "2026-10-31T14:32:00Z"}, "https://www.motir.go.kr/kor/article/ATCL3f49a5a8c/172355/view": {"originalTitle": "한·독, 경제안보·첨단산업 협력 강화", "headlineKo": "한·독 산업협력 확대…전력·에너지 분야 협력도 포함", "translationLabel": "우리지역 전력에디터 요약 제목", "publisher": "산업통상부", "sourceType": "정부 보도자료", "publishedDate": "2026-10-30", "datePrecision": "day", "gist": "산업통상부는 한·독 경제·하이테크 협력 틀에 관한 공동의향선언을 체결했다고 발표했다. 첨부 보도자료는 기업·기관 협력 분야에 전력·에너지를 포함하지만 개별 전력설비 도입이나 상용화 성과를 제시하지는 않는다.", "selectionReason": "한·독 전력·에너지 기술 협력 확대. 후속 사업과 실제 설비 적용은 별도 확인.", "uncertainty": "정부의 협력 추진 발표다. 의향선언과 협력 양해각서를 실제 설비 공급계약·기술 검증·현장 적용 완료로 해석하면 안 된다.", "ageLabelAtReview": "전일 발행", "relevanceClass": "국내 산업 동향 · 낮은 우선순위", "supportingUrls": ["https://www.motir.go.kr/kor/article/ATCL3f49a5a8c/172355/view", "https://www.motir.go.kr/attach/down/095a2dda9c864e1d90d751f7668a1117/ef20afcaac10fc8c4bddad7c9bc0c665/9a9db098b587ee18b321c826f3707a49"], "checkedAt": "2026-10-31T14:32:00Z"}};
function normalizeTitle(title){return cleanText(title).replace(/\s+/g,' ').trim();}
export function getEditorial(raw,now=Date.now()){
  return null; // News AI editing disabled by the user; historical records are preserved only.
  const record=CURATED[raw.url];
  if(!record||normalizeTitle(raw.title)!==normalizeTitle(record.originalTitle)||String(raw.publishedAt).slice(0,10)!==record.publishedDate||Date.parse(record.checkedAt)>now+10*60*1000||!Number.isFinite(Date.parse(record.checkedAt))||now>=Date.parse(record.checkedAt)+7*86400000)return null;
  return {headlineKo:record.headlineKo,gist:record.gist,selectionReason:record.selectionReason,uncertainty:record.uncertainty,checkedAt:record.checkedAt,expiresAt:new Date(Date.parse(record.checkedAt)+7*86400000).toISOString(),label:'원문 대조 편집 메모 · 일회성 AI 편집',originalTitle:record.originalTitle,translationLabel:record.translationLabel,publishedDate:record.publishedDate,relevanceClass:record.relevanceClass,supportingUrls:record.supportingUrls};
}
export const REGION_NAMES=CATALOG_REGION_NAMES;
export const REGION_HIERARCHY=CATALOG_REGION_HIERARCHY;
export function regionsMatch(articleRegions,selectedRegions){return !selectedRegions.length||selectedRegions.some(selected=>articleRegions.some(tag=>regionMatches(selected,tag)))}
const MAX_BYTES=750000, MAX_ITEMS=160, TTL=10*60*1000, MAX_STALE=24*60*60*1000;
const memory=new Map();
export function cleanText(value) {
  return String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&#(x[\da-f]+|\d+);/gi,(_,v)=>{let n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/&(amp|lt|gt|quot|apos|nbsp);/gi,(_,e)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[e.toLowerCase()]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\s+/g,' ').trim();
}
export function safeURL(raw,source) {
  try { const u=new URL(cleanText(raw));if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port)return null;const host=u.hostname.toLowerCase();if(!source.hosts.some(h=>host===h||host.endsWith('.'+h)))return null;if(source.format==='google-news-rss'){if(u.protocol!=='https:'||host!=='news.google.com'||!/^\/rss\/articles\/[A-Za-z0-9_-]+$/.test(u.pathname))return null;return u.origin+u.pathname;}if(source.aiRestricted){if(!source.hosts.includes(host)||u.protocol!=='https:'||!/^\/news\/\d+$/.test(u.pathname))return null;return u.origin+u.pathname;}if(source.id==='gynet'){if(host!=='www.gynet.co.kr'||u.pathname!=='/news/articleView.html'||u.searchParams.getAll('idxno').length!==1||!/^\d+$/.test(u.searchParams.get('idxno')||''))return null;return u.protocol+'//www.gynet.co.kr/news/articleView.html?idxno='+u.searchParams.get('idxno');}if(source.id==='mcee'){
    if(host!=='www.mcee.go.kr'||!/^\/home\/web\/board\/read\.do(?:;jsessionid=[^/;]*)?$/.test(u.pathname)||u.searchParams.getAll('menuId').length!==1||u.searchParams.get('menuId')!=='10598'||u.searchParams.getAll('boardMasterId').length!==1||u.searchParams.get('boardMasterId')!=='939'||u.searchParams.getAll('boardId').length!==1||!/^\d+$/.test(u.searchParams.get('boardId')||''))return null;
    return 'https://www.mcee.go.kr/home/web/board/read.do?menuId=10598&boardMasterId=939&boardId='+u.searchParams.get('boardId');
  }u.protocol='https:';u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))u.searchParams.delete(key);return u.href; } catch {return null;}
}
function field(block,name) {const m=block.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'));return m?m[1]:'';}
// Numeric-month RSS dates are ambiguous to Date.parse; ISO dc:date takes precedence.
function nocutStamp(block){
 const iso=cleanText(field(block,'dc:date'));
 if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(iso)){
  const time=Date.parse(iso),offset=iso.endsWith('Z')?0:(iso.at(-6)==='-'?-1:1)*(Number(iso.slice(-5,-3))*60+Number(iso.slice(-2)));
  if(Number.isFinite(time)&&/(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/.test(iso)&&new Date(time+offset*60000).toISOString().slice(0,19)===iso.slice(0,19))return iso;
 }
 const m=cleanText(field(block,'pubDate')).match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) (\d{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) \+0900$/);
 if(!m)return '';
 const local=Date.UTC(+m[4],+m[3]-1,+m[2],+m[5],+m[6],+m[7]),d=new Date(local);
 if(d.getUTCFullYear()!==+m[4]||d.getUTCMonth()!==+m[3]-1||d.getUTCDate()!==+m[2]||d.getUTCHours()!==+m[5]||d.getUTCMinutes()!==+m[6]||d.getUTCSeconds()!==+m[7]||['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]!==m[1])return '';
 return new Date(local-9*3600000).toISOString();
}
function feedTime(stamp,source,dateOnly){
  if(source.id==='mcee'){
    const m=stamp.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) KST (\d{4})$/);
    if(!m)return NaN;
    const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[2]);
    const local=Date.UTC(+m[7],month,+m[3],+m[4],+m[5],+m[6]),d=new Date(local);
    if(d.getUTCFullYear()!==+m[7]||d.getUTCMonth()!==month||d.getUTCDate()!==+m[3]||d.getUTCHours()!==+m[4]||d.getUTCMinutes()!==+m[5]||d.getUTCSeconds()!==+m[6]||['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]!==m[1])return NaN;
    return local-9*60*60*1000;
  }
  if(source.id==='gynet'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp)){const t=Date.parse(stamp.replace(' ','T')+'+09:00');return Number.isFinite(t)&&new Date(t+9*3600000).toISOString().slice(0,19)===stamp.replace(' ','T')?t:NaN;}
  return Date.parse(dateOnly?stamp+'T00:00:00'+(source.timezoneOffset||'Z'):stamp);
}
// Only explicitly geographic publisher tags qualify; publisher headquarters and title words do not.
export function publisherCategoryRegions(block,source){
 if(source.publisherFeedRegions)return [...source.publisherFeedRegions];
 if(!source.geographicCategories)return [];
 const out=[];for(const match of block.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)){
  const text=cleanText(match[1]);if(['광주','광주시'].includes(text))continue;
  const exact=getRegion(text);if(exact){out.push(exact.id);continue}
  const tokens=text.split(/[\s>,/|]+/).filter(Boolean),mapped=[];let valid=true;
  for(let i=0;i<tokens.length;i++){const pair=getRegion(tokens[i]+' '+tokens[i+1]);if(pair){mapped.push(pair.id);i++;continue}const r=getRegion(tokens[i]);if(!r||['광주','광주시'].includes(tokens[i])){valid=false;break}mapped.push(r.id)}
  if(!valid||!mapped.length)continue;
  const broad=mapped.filter(r=>['province','legacy-province'].includes(getRegion(r).kind)),specific=mapped.filter(r=>!broad.includes(r));
  if(broad.some(a=>broad.some(b=>a!==b&&!regionMatches(a,b)&&!regionMatches(b,a))))continue;
  if(broad.length&&specific.some(city=>!broad.some(province=>regionMatches(province,city))))continue;
  out.push(...mapped);
 }return [...new Set(out)].filter(region=>!out.some(other=>other!==region&&regionMatches(region,other))).slice(0,30);
}
export function parseFeed(xml,source,now=Date.now()) {
  if(typeof xml!=='string'||xml.length>MAX_BYTES||/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<(?:rss|feed|rdf:RDF)[\s>]/i.test(xml))throw new Error('유효한 RSS/Atom 피드가 아닙니다');
  const blocks=[...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].slice(0,MAX_ITEMS);const out=[];
  for(const match of blocks){const block=match[2];const title=cleanText(field(block,'title')).slice(0,280);let rawLink=field(block,'link');if(!rawLink){const links=[...block.matchAll(/<link\b([^>]+)\/?\s*>/gi)];const chosen=links.find(m=>! /rel=["'](?:self|enclosure)["']/i.test(m[1]));rawLink=chosen?.[1].match(/href=["']([^"']+)["']/i)?.[1]||'';}const url=safeURL(rawLink,source);const stamp=source.id.startsWith('nocut-')?nocutStamp(block):cleanText(field(block,'pubDate')||field(block,'published')||field(block,'updated')||field(block,'dc:date'));const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(stamp);const time=feedTime(stamp,source,dateOnly);if(!title||!url||!Number.isFinite(time)||time>now+10*60*1000||time<now-90*24*60*60*1000)continue;const google=source.format==='google-news-rss'?googleMetadata(block,title,url,cleanText):null;if(source.format==='google-news-rss'&&!google)continue;const regions=publisherCategoryRegions(block,source);out.push({title,url,...(google||{}),publishedAt:dateOnly?stamp:new Date(time).toISOString(),publicationPrecision:dateOnly?'date':'datetime',...(regions.length?{regionEvidence:{type:'publisher_metadata',url,regions}}:{})});}
  return out;
}
const CATEGORIES=[
  {id:'incident',name:'공급 장애·사고',re:/정전(?!협정|협상|선언)|전력.{0,8}(사고|고장|중단)|변전소.{0,10}(화재|고장)|blackout|power outages?|grid emergency|electricity.{0,12}disrupt/i,reason:'전력공급 중단·설비 사고 소식. 영향 범위와 복구 상태 확인 필요.'},
  {id:'grid',name:'계통·설비',re:/송전|변전|배전|전력망|전력계통|계통연계|HVDC|substation|transmission|power grid|electric grid|grid (reliability|capacity|connection|upgrade)/i,reason:'계통·전력설비 변화. 적용 지역·일정·사업 단계 확인 필요.'},
  {id:'supply',name:'수급·발전',re:/전력수급|전력 수요|전력수요|전력공급|발전량|발전소|수소발전|해상풍력|태양광.{0,8}(발전|보급|설치)|예비력|원전|electricity|power (demand|supply|generation|plant|capacity)|resource adequacy|peak load|peak demand|nuclear (power|plant|reactor)|renewable (power|generation)|electric generation|energy storage|battery storage/i,reason:'전력 수급·발전 자원 변화. 전망과 실제 실적 구분 필요.'},
  {id:'policy',name:'산업·정책',re:/변압기|전력기기|HD현대일렉트릭|효성중공업|LS ELECTRIC|power transformer|switchgear|한국전력|\bKEPCO\b|전력거래소|한전|전기요금|전력시장|전력산업|전력정책|electric utilities|electricity market|power market|grid operator|\bPJM\b|\bNESO\b|\bERCOT\b/i,reason:'전력산업·정책 변화. 확정 내용과 제안·논의 단계 구분 필요.'}
];
const TOPIC_REASONS=[
  [/battery storage|energy storage|저장장치|ESS\b/i,'전력 저장장치 활용. 재생에너지 연계·수급 조정 조건에 주목.'],
  [/peak load|peak demand|최대전력|최대 전력|최대수요/i,'최대 전력수요 변화. 해당 지역의 공급 대비 여건 확인 필요.'],
  [/전기요금|electricity (price|rate|tariff)/i,'전기요금 변화. 확정 여부와 수요자 영향 확인 필요.'],
  [/전력망.{0,20}협력|협력.{0,20}전력망/i,'전력망 기술·사업 협력. 협약과 실제 사업 착수 구분 필요.']
];
export function editorialReason(title,fallback){return TOPIC_REASONS.find(([pattern])=>pattern.test(title))?.[1]||fallback;}
const LOCAL_HAZARD=/태풍|호우|폭우|강풍|대설|산불|대규모.{0,4}(공사|행사)|섬박람회/;
const NATIONAL=/전국|전력거래소|전기요금|전력시장|전력정책|국가전력|전력수급/;
export function classifyHeadline(title,source) {
  if(/(?:수상|대상|시상|우수기관|award|prize)/i.test(title)&&!/(?:송전|배전|변전|전력망|계통|전력수급|요금|정전|설비|transformer|grid|outage)/i.test(title))return null;
  if(/정전협정|정전협상|정전선언|기획광고|협찬|주가.{0,6}급등|급등.{0,6}주가|종목추천|투자주의|주식.{0,4}추천/.test(title))return null;
  const regions=REGION_NAMES.filter(n=>title.includes(n));let category=CATEGORIES.find(c=>c.re.test(title));
  if(!category&&regions.length&&LOCAL_HAZARD.test(title)&&/(전력|송전|변전|배전|한전|정전|설비)/.test(title))category={id:'regional',name:'지역·현장 여건',reason:'관심지역의 기상·재난·주요 일정. 설비 영향과 공식 발표 확인 필요.'};
  if(!category)return null;
  const broadlyRelevant=NATIONAL.test(title)||/(대정전|대규모 정전|광역 정전|사망|숨져|수천|수만|수십만|수백만)/.test(title);
  const scope=source.scope==='global'?'global':regions.length&&!broadlyRelevant?'local':'national';
  return {scope,regions,regionHints:regions,regionVerified:false,category:category.name,categoryId:category.id,reason:editorialReason(title,category.reason),uncertainty:'제목 기반 자동 선별 · 기사 본문 미검토'+(scope==='global'?' · 해외 사례는 국내 위험을 직접 뜻하지 않음':''),matchedTerms:(title.match(category.re)||[]).slice(0,1)};
}
function stableId(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return 'n'+(h>>>0).toString(36);}
export function selectItems(sourceResults,regions=[],now=Date.now()) {
  const chosen=new Map();
  for(const result of sourceResults){const s=result.source;for(const raw of result.items||[]){const editorial=s.editorialAllowed===false?null:getEditorial(raw,now);const c=classifyHeadline(raw.title,s)||(editorial?{scope:s.scope,regions:[],category:editorial.relevanceClass||'산업 동향',categoryId:'industry',reason:editorial.selectionReason,uncertainty:editorial.uncertainty,matchedTerms:[]}:null);if(!c)continue;const evidence=raw.regionEvidence;if(evidence&&((s.format==='google-news-rss'&&evidence.type==='headline_location')||(s.kind==='official'&&['official_metadata','original_review'].includes(evidence.type))||(s.kind==='press'&&(s.geographicCategories||s.publisherFeedRegions)&&evidence.type==='publisher_metadata'))&&evidence.url===raw.url&&Array.isArray(evidence.regions)&&evidence.regions.every(r=>REGION_NAMES.includes(r))&&(!s.publisherFeedRegions||JSON.stringify(evidence.regions)===JSON.stringify(s.publisherFeedRegions))){c.regionEvidence=evidence;c.regionVerified=true;c.regions=evidence.regions;if(c.regions.length&&s.scope!=='global')c.scope='local'}if(!newsMatchesRegions({...c,url:raw.url},regions))continue;const age=now-Date.parse(raw.publishedAt);if(age>45*24*60*60*1000)continue;
    const ephemeral=/operations update|capacity advisory|maximum generation alert|outage alert|grid emergency alert/i.test(raw.title);
    if(!editorial&&ephemeral&&age>72*60*60*1000)continue;const key=raw.url;const {publisherName,...metadata}=raw;const item={...metadata,...c,...(editorial?{editorial}:{}),id:stableId(key),sourceId:s.id,sourceName:raw.publisherName||s.name,sourceType:s.kind,sourceHome:s.home,sourceAllowed:true,articleEvidenceVerified:false,checkedAt:result.checkedAt,...(result.collectionPath?{collectionPath:result.collectionPath,validUntil:result.validUntil}:{}),stale:!!result.stale,freshness:age<=3*24*60*60*1000?'recent':'older',score:s.priority+(age<24*60*60*1000?10:0)+(c.categoryId==='incident'?8:0)};if(!c.regionVerified)delete item.regionEvidence;if(!chosen.has(key)||chosen.get(key).score<item.score)chosen.set(key,item);}}
  // Similar titles from different publishers remain independently attributed; exact title duplicates collapse.
  const titles=new Set(),unique=[...chosen.values()].sort((a,b)=>(newsValue(a).eligible?0:1)-(newsValue(b).eligible?0:1)||newsValue(a).priority-newsValue(b).priority||Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||b.score-a.score).filter(x=>{const k=x.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');if(titles.has(k))return false;titles.add(k);return true;});
  // Preserve regional/global candidates before filling the bounded shared snapshot.
  const perSource=new Map(),reserved=[];for(const x of unique){const n=perSource.get(x.sourceId)||0;if(n<12){reserved.push(x);perSource.set(x.sourceId,n+1)}}
  return [...reserved,...unique.filter(x=>!reserved.includes(x))].slice(0,100).map(({score,...x})=>x);
}
async function readBounded(response) {
  if(Number(response.headers.get('content-length'))>MAX_BYTES)throw new Error('피드 크기 제한 초과');if(!response.body)throw new Error('빈 응답');const reader=response.body.getReader();let size=0;const parts=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new Error('피드 크기 제한 초과');}parts.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}const head=new TextDecoder().decode(bytes.slice(0,200));const declared=head.match(/encoding\s*=\s*["']([^"']+)/i)?.[1];let decoder;try{decoder=new TextDecoder(declared||'utf-8');}catch{decoder=new TextDecoder();}return decoder.decode(bytes);
}
function newsRunSlot(now){return Math.floor(now/3600000)*3600000}
async function fetchOne(source,{now,fetchFn,cache,store,clock,env={}}) {
  const key=new Request('https://power-editor-cache.invalid/public-feed-v1/'+source.id),google=source.format==='google-news-rss',stored=google&&store?await store.read('google-rss:feed:v1:'+source.id):null,initialMaxStale=google?GOOGLE_RSS_MAX_AGE_MS:MAX_STALE;let maxStale=initialMaxStale,previous=stored?.value||memory.get(source.id),leaseVersion=stored?.version;
  const save=async result=>{memory.set(source.id,result);if(stored)await store.compareAndSwap('google-rss:feed:v1:'+source.id,leaseVersion,result);if(cache){try{await cache.put(key,new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json','Cache-Control':'max-age='+Math.floor(maxStale/1000)}}));}catch{}}};
  if(!previous&&cache){try{const r=await cache.match(key);if(r)previous=await r.json();}catch{}}
  if(google&&previous){maxStale=googleNewsMaxAge(previous);const checked=Date.parse(previous.checkedAt);if(Number.isFinite(checked)&&['ok','stale'].includes(previous.status))previous={...previous,validUntil:new Date(checked+maxStale).toISOString()};}
  const existingAge=now-Date.parse(previous?.checkedAt),primaryUsable=previous&&previous.collectionPath!=='cloudflare-fallback'&&['ok','stale'].includes(previous.status)&&existingAge>=0&&existingAge<=GOOGLE_RSS_MAX_AGE_MS;
  const newFallback=google&&!primaryUsable&&googleFallbackConfigured(env)&&previous?.error&&!previous.fallbackAttempted&&previous.collectionPath!=='cloudflare-fallback'&&previous.error!=='google_rss_busy';
  if(google&&previous){const age=now-Date.parse(previous.checkedAt),due=Math.max((Object.hasOwn(previous,'lastRequestAt')?(previous.lastRequestAt||0):Date.parse(previous.attemptedAt||previous.checkedAt))+GOOGLE_RSS_REFRESH_MS,Date.parse(previous.retryAt)||0);if((['ok','stale'].includes(previous.status)&&age>=0&&age<GOOGLE_RSS_REFRESH_MS)||due>now&&!newFallback)return {...previous,...(age<0||(previous.collectionPath==='cloudflare-fallback'?age>=maxStale:age>maxStale)?{items:[],status:'error',stale:false,error:'google_cache_expired'}:{}),source,fromCache:true};}
  if(!google&&previous&&((source.privateUseOnly||source.scheduledOnly)?now-Date.parse(previous.checkedAt)<=MAX_STALE&&newsRunSlot(now)===newsRunSlot(Date.parse(previous.attemptedAt||previous.checkedAt)):now-Date.parse(previous.checkedAt)<TTL))return {...previous,source,fromCache:true};
  if(google&&store){
    const age=now-Date.parse(previous?.checkedAt),usable=previous&&['ok','stale'].includes(previous.status)&&age>=0&&(previous.collectionPath==='cloudflare-fallback'?age<maxStale:age<=maxStale);
    const pending=()=>({...previous,items:usable?previous.items:[],checkedAt:previous?.checkedAt||new Date(now).toISOString(),status:usable?'stale':'error',stale:!!usable,error:'collection_in_progress',retryAt:new Date(clock()+15000).toISOString(),source,fromCache:true});
    if(previous?.leaseUntil>clock())return pending();
    const claim=await store.compareAndSwap('google-rss:feed:v1:'+source.id,stored.version,{...(previous||{items:[],checkedAt:new Date(now).toISOString(),status:'error',stale:false}),leaseUntil:clock()+30000});
    if(!claim.applied)return pending();leaseVersion=claim.version;
  }
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),6500);
  try{const headers={Accept:source.format==='kepco-html'?'text/html':'application/rss+xml, application/xml, text/xml;q=0.9'};if(source.kind==='press'&&previous?.items?.length){if(previous.etag)headers['If-None-Match']=previous.etag;else if(previous.lastModified)headers['If-Modified-Since']=previous.lastModified;}const requestFeed=source.format==='google-news-rss'&&store?(u,o)=>googleRssWithFallback(u,o,{store,fetchFn,clock,env,allowFallback:!primaryUsable,primaryFailure:newFallback&&Date.parse(previous.retryAt)>now?Object.assign(Error(previous.error),{retryAt:previous.retryAt}):null}):fetchFn;const response=await requestFeed(source.url,{method:source.method||'GET',headers,signal:controller.signal,redirect:'manual'});if(!response.ok&&!(response.status===304&&previous?.items?.length))throw new Error('HTTP '+response.status);const xml=response.status===304?null:await readBounded(response);const items=response.status===304?previous.items:source.format==='kepco-html'?parseKepcoList(xml,source,now):parseFeed(xml,source,now);const validator=name=>{const v=response.headers.get(name);return v&&v.length<=300&&!/[\r\n]/.test(v)?v:null};const result={items,checkedAt:new Date(now).toISOString(),...(google?{lastRequestAt:now,collectionPath:response.headers.get('X-Power-Collection-Path')==='cloudflare-fallback'?'cloudflare-fallback':'sites',validUntil:new Date(now+GOOGLE_RSS_MAX_AGE_MS).toISOString()}:{}),status:'ok',stale:false,...(source.kind==='press'?{etag:validator('etag')||previous?.etag||null,lastModified:validator('last-modified')||previous?.lastModified||null}:{})};if(google)maxStale=googleNewsMaxAge(result);await save(result);return {...result,source};
  }catch(error){const message=error?.name==='AbortError'?'출처 응답 시간 초과':String(error?.message||'수집 실패').slice(0,100);const failed=previous&&(previous.items.length||google&&['ok','stale'].includes(previous.status))&&now-Date.parse(previous.checkedAt)>=0&&(previous.collectionPath==='cloudflare-fallback'?now-Date.parse(previous.checkedAt)<maxStale:now-Date.parse(previous.checkedAt)<=maxStale)?{...previous,status:'stale',stale:true,error:message,attemptedAt:new Date(now).toISOString()}:{items:[],checkedAt:new Date(now).toISOString(),status:'error',stale:false,error:message,attemptedAt:new Date(now).toISOString()};if(google){if(error.fallbackAttempted)failed.fallbackAttempted=true;failed.lastRequestAt=['google_rss_busy','google_rss_cooldown'].includes(error.message)?previous?.lastRequestAt||0:now;if(error.retryAt)failed.retryAt=error.retryAt;}if(google||source.privateUseOnly||source.scheduledOnly)await save(failed);return {...failed,source};
  }finally{clearTimeout(timer);}
}
export function limitGoogleNewsAge(payload,now=Date.now()) {
 const valid=(at,data)=>{const age=now-Date.parse(at);return Number.isFinite(age)&&age>=0&&(data?.collectionPath==='cloudflare-fallback'?age<googleNewsMaxAge(data):age<=googleNewsMaxAge(data));};
 const sources=payload.sources||[],byId=new Map(sources.map(s=>[s.id,s]));
 const expired=s=>s.id?.startsWith('google-')&&!valid(s.checkedAt,s);
 const items=(payload.items||[]).filter(i=>!i.sourceId?.startsWith('google-')||valid(i.checkedAt||byId.get(i.sourceId)?.checkedAt,i.collectionPath?i:byId.get(i.sourceId)));
 if(items.length===(payload.items||[]).length&&!sources.some(expired))return payload;
 return {...payload,items,stale:true,status:items.length?'partial':'unavailable',sources:sources.map(s=>expired(s)?{...s,status:'error',stale:false,itemCount:0,error:'google_cache_expired'}:s)};
}
export function parseRegions(value=''){return normalizeRegions(String(value).split(',').map(s=>s.trim()));}
export async function collectBriefing(regions=[],options={}) {
  const now=options.now??Date.now(),fetchFn=options.fetchFn??fetch,cache=options.cache??null;const selected=(options.sources||[...SOURCES,...googleNewsSources(options.newsRegions||regions).slice(3)]).filter(source=>!source.privateUseOnly||options.allowPrivateSources===true);const startedAt=Date.now(),clock=()=>now+Date.now()-startedAt;let googleQueue=Promise.resolve();const results=await Promise.all(selected.map(source=>{const run=()=>fetchOne(source,{now,fetchFn,cache,store:options.store,clock,env:options.env});if(source.format!=='google-news-rss')return run();const task=googleQueue.then(run);googleQueue=task.then(()=>new Promise(r=>setTimeout(r,options.store?2100:0)));return task;}));const successful=results.filter(x=>x.status==='ok').length;const usable=results.filter(x=>x.status!=='error').length;const items=selectItems(results,regions,now);const stale=results.some(x=>x.stale);return {version:1,sourcePolicy:SOURCE_POLICY,checkedAt:new Date(now).toISOString(),status:successful===results.length?'ok':usable?'partial':'unavailable',stale,coverage:{successful,total:results.length,notice:'출처가 정상 응답해도 관련 기사가 없을 수 있습니다. 미수집은 사건 없음이나 안전을 뜻하지 않습니다.'},items,sources:results.map(x=>({id:x.source.id,name:x.source.name,kind:x.source.kind,home:x.source.home,url:x.source.url,status:x.status,itemCount:x.items.length,checkedAt:x.checkedAt,...(x.collectionPath?{collectionPath:x.collectionPath,validUntil:x.validUntil}:{}),stale:x.stale,fromCache:!!x.fromCache,...(x.error?{error:x.error}:{})})),selection:{regions,policy:'전국·세계 주요 소식은 지역 선택과 관계없이 유지됩니다. 선택 지역은 지역 기사만 좁힙니다.'},notice:'기관 발표·언론 RSS의 제목·링크 기반 시험 운영입니다. 실시간 관제·재난경보 서비스가 아니며 원문 확인이 필요합니다.'};
}
export async function handleBriefing(request,env,ctx) {
  if(request.method!=='GET')return new Response(JSON.stringify({error:'GET만 지원합니다'}),{status:405,headers:{Allow:'GET','Content-Type':'application/json; charset=utf-8'}});
  const url=new URL(request.url);const data=await collectBriefing(parseRegions(url.searchParams.get('regions')||''),{env,sources:env.DB&&url.searchParams.get('google')==='1'?undefined:SOURCES.filter(source=>source.format!=='google-news-rss'),store:env.DB?createD1SnapshotStore(env.DB):null,cache:typeof caches!=='undefined'?caches.default:null});return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
export function clearFeedMemory(){memory.clear();}
