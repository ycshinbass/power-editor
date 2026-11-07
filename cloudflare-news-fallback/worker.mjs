// No cron, AI, publisher crawling, or public unauthenticated Google fetch.
// Sites owns durable per-query snapshots, leases and independent route cooldowns.
export async function collect(request,env,{fetchFn=fetch}={}){
 const path=new URL(request.url).pathname;
 if(request.method==='GET'&&path==='/health')return Response.json({service:'power-editor-news-fallback',version:1,configured:typeof env.COLLECTOR_TOKEN==='string'&&env.COLLECTOR_TOKEN.length>=32});
 if(request.method!=='POST'||path!=='/rss')return new Response('Not found',{status:404});
 if(typeof env.COLLECTOR_TOKEN!=='string'||env.COLLECTOR_TOKEN.length<32)return new Response('Not configured',{status:503});
 const actual=new TextEncoder().encode(request.headers.get('Authorization')||''),expected=new TextEncoder().encode('Bearer '+env.COLLECTOR_TOKEN);
 let mismatch=actual.length^expected.length;for(let i=0;i<expected.length;i++)mismatch|=(actual[i]||0)^expected[i];
 if(mismatch)return new Response('Forbidden',{status:403});
 const output={'Cache-Control':'no-store','X-Power-News-Collector':'1'};
 try{
  const body=await boundedText(request,6000);let target;
  try{target=new URL(JSON.parse(body).url);}catch{return new Response('Invalid request',{status:400,headers:output});}
  const p=target.searchParams;
  if(target.origin!=='https://news.google.com'||target.pathname!=='/rss/search'||target.username||target.password||target.hash||target.href.length>5500||!p.get('q')||p.get('q').length>1200||[...p.keys()].some(k=>!['q','hl','gl','ceid'].includes(k))||['q','hl','gl','ceid'].some(k=>p.getAll(k).length!==1)||!['ko|KR|KR:ko','en-US|US|US:en'].includes([p.get('hl'),p.get('gl'),p.get('ceid')].join('|')))return new Response('Invalid source',{status:400,headers:output});
  const upstream=await fetchFn(target,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Accept:'application/rss+xml, application/xml;q=0.9','User-Agent':'PowerEditor/1.0 (+https://power-editor-design-1031.ycshinbass.chatgpt.site/)'}});
  const text=await boundedText(upstream,750000),headers=new Headers(output);
  for(const name of ['content-type','retry-after']){const value=upstream.headers.get(name);if(value)headers.set(name,value);}
  // The caller validates RSS and records failures; HTML is never an empty success.
  return new Response(text,{status:upstream.status,headers});
 }catch(error){return new Response(error.name==='TimeoutError'?'Upstream timeout':'Upstream unavailable',{status:502,headers:output});}
}
async function boundedText(message,limit){
 if(Number(message.headers.get('content-length'))>limit)throw Error('size_limit');
 const reader=message.body?.getReader();if(!reader)return '';
 const decoder=new TextDecoder();let text='',size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('size_limit');text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}finally{await reader.cancel().catch(()=>{});}
}
export default {fetch:(request,env)=>collect(request,env)};
