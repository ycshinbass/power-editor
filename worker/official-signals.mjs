// Preparation only: provider keys AND a reviewed wire-schema sample are required.
// No credential is stored here. Fixtures are synthetic, not live provider evidence.
export const OFFICIAL_SIGNAL_SOURCES = {
  weatherWarning: {
    name: '기상청 기상특보', kind: 'official-warning', keyName: 'KMA_AUTH_KEY',
    endpoint: 'https://apihub.kma.go.kr/api/typ01/url/wrn_now_data_new.php',
    documentation: 'https://apihub.kma.go.kr/apiList.do?seqApi=10&seqApiSub=288',
    publicUrl: 'https://www.weather.go.kr/w/special-report/overall.do',
    limitation: '발표·발효 시각 및 특보 명령 코드를 확인해야 합니다. 발표 자료를 현재 발효 중인 경보로 단정하지 않습니다.'
  },
  wildfireRisk: {
    name: '국립산림과학원 산불위험예보', kind: 'risk-forecast', keyName: 'FOREST_RISK_SERVICE_KEY',
    endpoint: 'https://apis.data.go.kr/1400377/forestPointV2/forestPointListSigunguSearchV2',
    documentation: 'https://www.data.go.kr/data/15084817/openapi.do',
    publicUrl: 'https://forestfire.nifos.go.kr/',
    limitation: '산불위험 예측이며 실제 산불 발생·진화 정보가 아닙니다. 분석 대상이 없는 지역도 있습니다.'
  },
  wildfireIncident: {
    name: '국가산불정보시스템 산불정보', kind: 'actual-incident', keyName: null,
    endpoint: null,
    documentation: 'https://www.safetydata.go.kr/disaster-data/view?dataSn=882',
    publicUrl: 'https://fd.forest.go.kr/ffas/',
    limitation: '활용 신청·인증과 응답 명세 검증이 필요합니다. 공개 페이지의 공공누리 제3유형 조건도 확인해야 하며 위험예보·과거 통계로 대체하지 않습니다.'
  }
};

const OFFICIAL_MAX_BYTES = 512000;
const OFFICIAL_MAX_ROWS = 3000;
const OFFICIAL_KMA_FIELDS = ['REG_UP','REG_UP_KO','REG_ID','REG_KO','TM_FC','TM_EF','WRN','LVL','CMD'];
const OFFICIAL_WARNING_NAMES = {W:'강풍',R:'호우',C:'한파',D:'건조',O:'폭풍해일',N:'지진해일',V:'풍랑',T:'태풍',S:'대설',Y:'황사',H:'폭염',F:'안개',K:'열대야'};

function officialText(value, max=100) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[<>\u0000-\u001f]/.test(value)) throw Error('Invalid official field');
  return value.trim();
}

// KMA explicitly documents these compact timestamps as KST.
export function parseOfficialKst(value) {
  if (typeof value !== 'string') throw Error('Invalid official time');
  const compact = /^\d{12}(?:\d{2})?$/.test(value) ? value : null;
  if (!compact) throw Error('Unsupported official time format');
  const [year,month,day,hour,minute,second] = [value.slice(0,4),value.slice(4,6),value.slice(6,8),value.slice(8,10),value.slice(10,12),value.slice(12,14)||'00'].map(Number);
  const asUTC = new Date(Date.UTC(year,month-1,day,hour,minute,second));
  if(year<2000 || year>2100 || asUTC.getUTCFullYear()!==year || asUTC.getUTCMonth()!==month-1 || asUTC.getUTCDate()!==day || asUTC.getUTCHours()!==hour || asUTC.getUTCMinutes()!==minute || asUTC.getUTCSeconds()!==second) throw Error('Invalid official calendar time');
  return new Date(asUTC.getTime()-9*3600000).toISOString();
}

function officialEnvelope(kind, checkedAt, records) {
  return {
    kind, status: records.length ? 'reported' : 'no_records', checkedAt, records,
    coverage: 'reported_records_only', safetyConclusion: 'unknown',
    notice: records.length ? '제공기관의 보고 항목입니다. 적용 구역·명령과 원문을 확인하세요.' : '응답에 항목이 없습니다. 무위험·무사고를 뜻하지 않습니다.'
  };
}

export function normalizeKmaWarningRows(rows, checkedAt=new Date().toISOString()) {
  if(!Array.isArray(rows) || rows.length>OFFICIAL_MAX_ROWS || !Number.isFinite(Date.parse(checkedAt))) throw Error('Invalid warning rows');
  const records=rows.map(row=>{
    const values=Object.fromEntries(OFFICIAL_KMA_FIELDS.map(field=>[field,officialText(row?.[field])]));
    const announcedAt=parseOfficialKst(values.TM_FC), effectiveAt=parseOfficialKst(values.TM_EF);
    if(Date.parse(announcedAt)>Date.parse(checkedAt)+600000) throw Error('Future warning publication');
    return {
      regionCode:values.REG_ID, regionName:values.REG_KO,
      parentRegionCode:values.REG_UP, parentRegionName:values.REG_UP_KO,
      announcedAt,effectiveAt, warningCode:values.WRN,
      warningName:OFFICIAL_WARNING_NAMES[values.WRN]||'미확인 특보 코드',
      levelCode:values.LVL, commandCode:values.CMD,
      active:null, severity:null,
      interpretation:'수준·명령 코드는 실응답 도움말 대조 전 자동 해석하지 않습니다.'
    };
  });
  return officialEnvelope('official-warning',checkedAt,records);
}

// Accept a named header only; never guess positional columns or decode command values.
export function parseKmaWarningText(text, checkedAt=new Date().toISOString()) {
  if(typeof text!=='string' || text.length>OFFICIAL_MAX_BYTES || /<(?:html|!doctype|!entity)/i.test(text)) throw Error('Invalid warning response');
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  let header=null, delimiter=null;const rows=[];
  for(const line of lines){
    const candidate=line.replace(/^#\s*/,'');
    const separator=candidate.includes(',')?',':null;
    const fields=separator?candidate.split(',').map(x=>x.trim()):candidate.split(/\s+/);
    if(OFFICIAL_KMA_FIELDS.every(x=>fields.includes(x))){
      if(header || new Set(fields).size!==fields.length)throw Error('Ambiguous warning header');
      header=fields;delimiter=separator;continue;
    }
    if(line.startsWith('#'))continue;
    if(!header)throw Error('Warning schema header missing');
    const values=delimiter?line.split(',').map(x=>x.trim()):line.split(/\s+/);
    if(values.length!==header.length)throw Error('Warning row schema mismatch');
    rows.push(Object.fromEntries(header.map((field,i)=>[field,values[i]])));
    if(rows.length>OFFICIAL_MAX_ROWS)throw Error('Warning row limit');
  }
  if(!header)throw Error('Warning schema header missing');
  return normalizeKmaWarningRows(rows,checkedAt);
}

export function normalizeForestRiskRows(rows,checkedAt=new Date().toISOString()) {
  if(!Array.isArray(rows)||rows.length>OFFICIAL_MAX_ROWS||!Number.isFinite(Date.parse(checkedAt)))throw Error('Invalid risk rows');
  const records=rows.map(row=>{
    const number=key=>{
      const raw=row?.[key];
      if(!['number','string'].includes(typeof raw)||String(raw).trim()==='')throw Error('Missing risk value');
      const value=Number(raw);if(!Number.isFinite(value)||value<0||value>1e9)throw Error('Invalid risk value');return value;
    };
    const values=Object.fromEntries(['maxi','meanavg','mini','d1','d2','d3','d4'].map(k=>[k,number(k)]));
    if(values.mini>values.meanavg||values.meanavg>values.maxi)throw Error('Inconsistent risk range');
    return {
      regionCode:officialText(row?.sigucode), regionName:officialText(row?.sigun),
      parentRegionName:officialText(row?.doname),
      // analdate is documented only as the data reference date, not a collected-at time.
      referenceTimeRaw:officialText(row?.analdate,40),
      maximum:values.maxi,mean:values.meanavg,minimum:values.mini,
      providerCategoryValues:{low:values.d1,somewhatHigh:values.d2,high:values.d3,veryHigh:values.d4},
      forecastOnly:true, actualFireOccurrence:null, severity:null,
      interpretation:'예보지수·기준시각의 의미를 제공기관 명세와 실응답으로 대조해야 하며 발생 여부로 변환하지 않습니다.'
    };
  });
  return officialEnvelope('risk-forecast',checkedAt,records);
}

export function parseForestRiskJson(text,checkedAt=new Date().toISOString()) {
  if(typeof text!=='string'||text.length>OFFICIAL_MAX_BYTES)throw Error('Risk response limit');
  const data=JSON.parse(text), response=data?.response;
  if(!response || response?.header?.resultCode!=='00' || !response.body)throw Error('Risk provider did not report success');
  const body=response.body, total=Number(body.totalCount);
  if(!Number.isSafeInteger(total)||total<0||total>OFFICIAL_MAX_ROWS)throw Error('Risk total invalid');
  let rows=body.items?.item;
  if(total===0 && (body.items==='' || body.items===null || Array.isArray(rows)&&rows.length===0))rows=[];
  else if(rows && !Array.isArray(rows))rows=[rows];
  if(!Array.isArray(rows)||rows.length!==total)throw Error('Partial risk coverage or unknown envelope');
  return normalizeForestRiskRows(rows,checkedAt);
}

async function readOfficialBody(response) {
  if(!response.ok||!response.body||Number(response.headers.get('content-length'))>OFFICIAL_MAX_BYTES)throw Error('Official response rejected');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>OFFICIAL_MAX_BYTES){await reader.cancel();throw Error('Official response limit')}chunks.push(value)}}finally{reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}

export async function collectOfficialSignals(env={},options={}) {
  const checkedAt=new Date(options.now??Date.now()).toISOString(), fetchFn=options.fetchFn??fetch;
  const validated=options.validatedSchemas??[];
  const results=await Promise.all(Object.entries(OFFICIAL_SIGNAL_SOURCES).map(async([id,source])=>{
    const base={id,name:source.name,kind:source.kind,checkedAt,sourceUrl:source.publicUrl,documentation:source.documentation,records:[],safetyConclusion:'unknown',notice:source.limitation};
    if(!source.endpoint)return {...base,status:'unimplemented',reason:'응답 명세와 이용 조건 확인이 남았습니다.'};
    const key=source.keyName&&env[source.keyName];
    if(typeof key!=='string'||!key.trim())return {...base,status:'not_configured',reason:'발급된 제공기관 인증키가 설정되지 않았습니다.'};
    // A key is not proof that our synthetic fixture matches the provider's actual envelope.
    if(!validated.includes(id))return {...base,status:'validation_required',reason:'실응답의 문자 인코딩·필드·코드·완전성을 대조한 후 활성화해야 합니다.'};
    const url=new URL(source.endpoint);
    if(id==='weatherWarning'){url.searchParams.set('fe','f');url.searchParams.set('disp','0');url.searchParams.set('help','1');url.searchParams.set('authKey',key)}
    else{url.searchParams.set('ServiceKey',key);url.searchParams.set('pageNo','1');url.searchParams.set('numOfRows',String(OFFICIAL_MAX_ROWS));url.searchParams.set('_type','json')}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
      // Workers supports manual/follow, not redirect:error. Never forward keys to a redirect.
      const response=await fetchFn(url.href,{method:'GET',redirect:'manual',signal:controller.signal,headers:{Accept:id==='weatherWarning'?'text/plain':'application/json'}});
      if(response.status>=300&&response.status<400)throw Error('Official redirect rejected');
      const text=await readOfficialBody(response);
      const normalized=id==='weatherWarning'?parseKmaWarningText(text,checkedAt):parseForestRiskJson(text,checkedAt);
      return {...base,...normalized};
    }catch{return {...base,status:'unavailable',reason:'인증·응답 형식·범위 또는 연결을 확인할 수 없습니다. 공식 페이지를 확인하세요.'}}
    finally{clearTimeout(timer)}
  }));
  return {checkedAt,signals:results,notice:'미연결·실패·항목 없음은 안전 또는 무사고를 뜻하지 않습니다.'};
}
