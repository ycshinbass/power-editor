import {googleNewsSources} from '../worker/google-news.mjs';
import {collectBriefing,clearFeedMemory} from '../worker/feed.mjs';
import {validateSnapshotPayload} from '../worker/snapshots.mjs';
import {diverseNews,newsQuotaNotice,isKepcoNews,isRegionalNews,freshNews} from '../frontend/logic.js';
const regions=['여수','순천','광양','구례','보성','고흥'];
const now=Date.now();clearFeedMemory();
const snapshot=validateSnapshotPayload(await collectBriefing([],{now,sources:googleNewsSources(regions)}),now);
const top=diverseNews(snapshot.items,regions,now).filter(i=>freshNews(i,now)).slice(0,5);
// Intentionally never print real news titles, URLs or descriptions into AI context.
console.log(JSON.stringify({checkedAt:snapshot.checkedAt,status:snapshot.status,sources:snapshot.sources.map(s=>({id:s.id,status:s.status,items:s.itemCount,error:s.error})),candidates:snapshot.items.length,topCount:top.length,localCount:top.filter(i=>isRegionalNews(i,regions)).length,kepcoCount:top.filter(isKepcoNews).length,aiRecords:snapshot.items.filter(i=>i.editorial).length,shortage:newsQuotaNotice(top,regions,now)},null,2));
if(snapshot.sources.some(s=>s.status==='error'))process.exitCode=1;
