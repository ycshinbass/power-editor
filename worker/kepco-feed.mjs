// Owner-private, noncommercial personal title/date/link cache only.
// Never relay article bodies, attachments or images; never infer locality from site navigation.
export const KEPCO_SOURCE = {
  id:'kepco', name:'한국전력공사 보도·설명자료', kind:'official', scope:'national',
  format:'kepco-html', url:'https://www.kepco.co.kr/home/media/newsroom/pr/boardList.do',
  home:'https://www.kepco.co.kr/', hosts:['www.kepco.co.kr'], priority:35,
  editorialAllowed:false, privateUseOnly:true,
  rights:'소유자 비공개·비상업적 개인 이용 한정 · 제목·게시일·원문 링크만 표시 · 공개·상업 재배포 허용 아님',
  rightsURL:'https://www.kepco.co.kr/home/service/legalnotice/conts.do'
};
function text(value) {
  return value.replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{
    const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);
    return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';
  }).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[n]).replace(/\s+/g,' ').trim();
}
export function isRelevantKepcoTitle(title) {
  // A corporate name alone must not make awards/recruitment/CSR power news.
  if(/수상|대통령상|장관상|경영대상|인사혁신|채용|입사식|봉사활동|스포츠|배구/.test(title))return false;
  return /전력|전기|송전|배전|변전|변압기|계통|발전|에너지|정전|전기요금|ESS\b|BIXPO|수요예측|기자재/i.test(title.replace(/한국전력(?:공사)?/g,''));
}
export function parseKepcoList(html,source=KEPCO_SOURCE,now=Date.now()) {
  if(source.id!=='kepco'||typeof html!=='string')return [];
  const out=[],seen=new Set();
  // Only actual article anchors: no execution of javascript, pagination or remote URLs.
  const anchors=html.matchAll(/<a\b[^>]*href="javascript:fn_Detail\('(\d+)','(\d+)'\);"[^>]*>([\s\S]*?)<\/a>/gi);
  let inspected=0;
  for(const [,board,id,body] of anchors){
    if(++inspected>12)break;
    if(board!=='15'||seen.has(id))continue;
    const title=text(body.match(/<strong\b[^>]*class="tit"[^>]*>([\s\S]*?)<\/strong>/i)?.[1]||'').slice(0,280);
    const stamp=text(body.match(/<span\b[^>]*class="date"[^>]*>([\s\S]*?)<\/span>/i)?.[1]||'');
    if(!/^\d{4}\.\d{2}\.\d{2}$/.test(stamp)||!isRelevantKepcoTitle(title))continue;
    const publishedAt=stamp.replaceAll('.','-'),time=Date.parse(publishedAt+'T00:00:00+09:00');
    if(!Number.isFinite(time)||new Date(time+9*3600000).toISOString().slice(0,10)!==publishedAt||time>now||time<now-90*86400000)continue;
    seen.add(id);out.push({title,url:`https://www.kepco.co.kr/home/media/newsroom/pr/boardView.do?boardMngNo=15&boardNo=${id}`,publishedAt,publicationPrecision:'date'});
  }
  if(!inspected)throw new Error('KEPCO list structure unavailable');
  return out;
}
