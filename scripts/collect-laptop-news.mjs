// Explicit one-time recovery, never run by the website or a scheduler.
// Only RSS headline metadata is retained; no publisher article body or AI call.
import {writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {collect} from '../cloudflare-news-fallback/worker.mjs';
import {parseFeed} from '../worker/feed.mjs';
import {selectFocusedNews} from '../worker/focused-news.mjs';

const queries={kepco:'한국전력 OR 한전',power:'전력망 OR 전력수급 OR 송전 OR 변전 OR 정전',outage:'(정전 OR "전력 공급 중단") (가구 OR 세대 OR 복구 OR 한전) -정전협정 -휴전 -전쟁 -단전예고'};
const snapshot={schemaVersion:1,categories:{}},results=[];
const token=randomBytes(32).toString('hex');
for(const [category,query] of Object.entries(queries)){
 if(results.length)await setTimeout(2500);
 const url=new URL('https://news.google.com/rss/search');url.search=new URLSearchParams({q:query+' when:3d',hl:'ko',gl:'KR',ceid:'KR:ko'});
 const started=Date.now();
 const r=await collect(new Request('https://diagnostic.invalid/rss',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({url:String(url)})}),{COLLECTOR_TOKEN:token});
 if(!r.ok)throw Error('Collection stopped: '+category+' HTTP '+r.status);
 const text=await r.text();if(!/<rss[\s>]|<feed[\s>]/i.test(text))throw Error('Collection stopped: invalid RSS');
 const now=Date.now(),parsed=parseFeed(text,{id:'google-focused-'+category,format:'google-news-rss',hosts:['news.google.com']},now);
 const items=selectFocusedNews(parsed,category,now);
 snapshot.categories[category]={status:'ok',category,items,checkedAt:new Date(now).toISOString()};
 results.push({category,status:r.status,parsed:parsed.length,selected:items.length,elapsedMs:now-started,checkedAt:new Date(now).toISOString()});
}
await writeFile(new URL('../worker/laptop-news-snapshot.json',import.meta.url),JSON.stringify(snapshot,null,2)+'\n');
console.log(JSON.stringify({saved:true,googleRequests:results.length,results}));
