import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
const get=(path,method='GET')=>worker.fetch(new Request('https://power-editor-design-1031.ycshinbass.chatgpt.site'+path,{method}),{},{waitUntil:p=>p.catch(()=>{})});
test('social metadata is in the initial HTML and its public image is a genuine 800x400 PNG',async()=>{
 const response=await get('/');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\/html/);
 const head=(await response.text()).split('</head>')[0];
 for(const name of ['og:title','og:description','og:url','og:image','og:image:width','og:image:height'])assert.equal([...head.matchAll(new RegExp('property="'+name+'"','g'))].length,1,name);
 assert.match(head,/<meta property="og:url" content="https:\/\/power\.suncheon-ops\.workers\.dev\/">/);
 const image=head.match(/<meta property="og:image" content="([^"]+)"/)[1];assert.equal(image,'https://power-editor-design-1031.ycshinbass.chatgpt.site/share-card.png');
 const result=await get(new URL(image).pathname);assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'image/png');
 const bytes=Buffer.from(await result.arrayBuffer());assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(bytes.readUInt32BE(16),800);assert.equal(bytes.readUInt32BE(20),400);assert.ok(bytes.length<5000000);
 const header=await get('/share-card.png','HEAD');assert.equal(header.status,200);assert.equal(header.headers.get('content-type'),'image/png');assert.equal((await header.arrayBuffer()).byteLength,0);
});
