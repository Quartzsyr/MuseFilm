import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import worker,{__test as t} from '../cloudflare/worker.js';

const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
const image='https://github.com/Quartzsyr/MuseFilm/releases/download/MAC4.0/preview.png';
const subscriber={unsubscribe_token:'test-unsubscribe',confirmation_token:'test-confirm'};
const campaign={subject:'MuseFilm 4.0',body:`你好，\n\n**光页画册**已经准备好。\n\n![光页画册](${image})\n\n欢迎体验。`,kind:'release',release_url:'https://github.com/Quartzsyr/MuseFilm/releases/tag/MAC4.0'};
const response=bytes=>new Response(bytes,{headers:{'Content-Type':'image/png'}});

test('campaign HTML renders responsive images and retains readable text, CTA and unsubscribe',()=>{
 const mail=t.campaignContent(campaign,subscriber);
 assert.match(mail.html,/<img src="https:\/\/github.com/);assert.match(mail.html,/<strong>光页画册<\/strong>/);
 assert.match(mail.html,/width:100%;max-width:532px;height:auto/);assert.match(mail.html,/alt="光页画册"/);
 assert.match(mail.html,/查看新版本与下载/);assert.match(mail.html,/test-unsubscribe/);
 assert.match(mail.text,/图片：光页画册\nhttps:/);assert.doesNotMatch(mail.text,/!\[|\*\*/);assert.match(mail.text,/releases\/tag\/MAC4.0/);
 assert.deepEqual(mail.emailImages,[{url:image,alt:'光页画册'}]);
});
test('raw HTML and image labels cannot inject executable attributes',()=>{
 const body=`<script>alert(1)</script>\n\n![\" onerror=\"alert(1)](${image})`;
 const result=t.campaignBodyContent(body);assert.doesNotMatch(result.html,/<script>| onerror="/);assert.match(result.html,/&lt;script&gt;/);assert.match(result.html,/&quot;/);
 for(const url of ['javascript:alert(1)','data:image/svg+xml;base64,x','http://example.com/a.png','https://127.0.0.1/a.png','https://[::1]/a.png','https://user:secret@example.com/a.png','https://localhost/a.png','https://example.local/a.png','https://example.com/a.svg'])assert.equal(t.emailImageUrl(url),null,url);
});
test('six image limit preserves additional images as links instead of dropping their descriptions',()=>{
 const body=Array.from({length:8},(_,i)=>`![预览 ${i}](https://musefilm.top/images/${i}.png)`).join('\n\n'),r=t.campaignBodyContent(body);
 assert.equal(r.images.length,6);assert.equal([...r.html.matchAll(/<img /g)].length,6);assert.match(r.html,/查看图片：预览 7/);assert.match(r.text,/图片：预览 7/);
});
test('trusted image downloads become CID attachments, de-duplicated across repeated appearances',async()=>{
 const mail=t.campaignContent({...campaign,body:campaign.body+`\n\n![另一处](${image})`},subscriber),requests=[];
 const prepared=await t.prepareInlineEmailImages(mail,async(url,options)=>{requests.push(url);assert.equal(options.redirect,'manual');return response(png)});
 assert.equal(requests.length,1);assert.equal(prepared.inlineImages.length,1);assert.match(prepared.html,/src="cid:mf-image-1@musefilm.top"/);assert.equal([...prepared.html.matchAll(/src="cid:/g)].length,2);assert.deepEqual(prepared.inlineImages[0].bytes,png);assert.equal(prepared.text,mail.text);
});
test('only trusted public image hosts are fetched and every redirect is checked',async()=>{
 const remote=t.campaignContent({...campaign,body:'![外链](https://example.com/image.png)'},subscriber);
 const r=await t.prepareInlineEmailImages(remote,async()=>{throw new Error('External images must never be fetched')});assert.equal(r.inlineImages.length,0);assert.match(r.html,/src="https:\/\/example.com/);
 let calls=0;const rejected=await t.prepareInlineEmailImages(t.campaignContent(campaign,subscriber),async()=>{calls++;return new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}})});
 assert.equal(calls,1);assert.equal(rejected.inlineImages.length,0);assert.match(rejected.html,/src="https:/);
 let redirects=0;const allowed=await t.prepareInlineEmailImages(t.campaignContent(campaign,subscriber),async()=>++redirects===1?new Response(null,{status:302,headers:{Location:'https://release-assets.githubusercontent.com/public/image.png'}}):response(png));assert.equal(redirects,2);assert.equal(allowed.inlineImages.length,1);
});
test('failed, oversized and mislabeled images fall back to original HTTPS HTML',async()=>{
 const mail=t.campaignContent(campaign,subscriber);
 for(const fetcher of [async()=>{throw new Error('offline')},async()=>new Response('error',{status:404}),async()=>new Response('<svg/>',{headers:{'Content-Type':'image/svg+xml'}}),async()=>new Response('<html>bad</html>',{headers:{'Content-Type':'image/png'}}),async()=>new Response(png,{headers:{'Content-Type':'image/png','Content-Length':String(4*1024*1024)}})]){
  const r=await t.prepareInlineEmailImages(mail,fetcher);assert.equal(r.inlineImages.length,0);assert.equal(r.html,mail.html);
 }
});
test('GitHub octet-stream downloads require a recognized raster image signature',async()=>{
 const mail=t.campaignContent(campaign,subscriber);
 const valid=await t.prepareInlineEmailImages(mail,async()=>new Response(png,{headers:{'Content-Type':'application/octet-stream'}}));assert.equal(valid.inlineImages.length,1);assert.equal(valid.inlineImages[0].type,'image/png');
 const invalid=await t.prepareInlineEmailImages(mail,async()=>new Response('<html>not an image</html>',{headers:{'Content-Type':'application/octet-stream'}}));assert.equal(invalid.inlineImages.length,0);
});
test('stream and total image budgets remain bounded without relying on Content-Length',async()=>{
 const large=new Uint8Array(3*1024*1024);large.set(png);let cancelled=false;
 const mail=t.campaignContent({...campaign,body:`![一](https://musefilm.top/1.png)\n\n![二](https://musefilm.top/2.png)\n\n![三](https://musefilm.top/3.png)`},subscriber);
 const r=await t.prepareInlineEmailImages(mail,async()=>response(large));assert.equal(r.inlineImages.length,2);assert.match(r.html,/src="https:\/\/musefilm.top\/3.png"/);
 const stream=new ReadableStream({start(controller){controller.enqueue(large);controller.enqueue(png)},cancel(){cancelled=true}});
 const overflow=await t.prepareInlineEmailImages(t.campaignContent(campaign,subscriber),async()=>response(stream));assert.equal(overflow.inlineImages.length,0);assert.equal(cancelled,true);
});
test('MIME nests text and HTML alternatives inside related with matching inline image Content-IDs',async()=>{
 const prepared=await t.prepareInlineEmailImages(t.campaignContent(campaign,subscriber),async()=>response(png));
 const mime=t.smtpMime({...prepared,to:'reader@example.com'},'owner@example.com');
 assert.match(mime,/Content-Type: multipart\/related; type="multipart\/alternative"/);assert.match(mime,/Content-Type: multipart\/alternative/);
 assert.match(mime,/Content-ID: <mf-image-1@musefilm.top>/);assert.match(mime,/Content-Disposition: inline; filename="musefilm-1.png"/);
 const encoded=[...mime.matchAll(/Content-Transfer-Encoding: base64\r\n(?:[^\r\n]+\r\n)*\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map(m=>Buffer.from(m[1],'base64'));
 assert.equal(encoded.length,3);assert.match(encoded[0].toString(),/图片：光页画册/);assert.match(encoded[1].toString(),/src="cid:mf-image-1@musefilm.top"/);assert.deepEqual(encoded[2],Buffer.from(png));
 const simple=t.smtpMime({to:'reader@example.com',subject:'更新',text:'正文',html:'<p>正文</p>'},'owner@example.com');assert.doesNotMatch(simple,/multipart\/related/);
});
test('release drafts retain four useful images, skip installation/history sections and eliminate image Markdown artifacts in prose',()=>{
 const notes=`## 新功能\n- 光页与桌面联动\n![预览](${image})\n\n## 安装\n![安装](https://musefilm.top/install.png)\n## 徕卡\n![红标](https://musefilm.top/leica.png)\n## 历史版本\n![旧图](https://musefilm.top/old.png)`;
 const body=t.releaseDraftBody({platform:'mac',title:'4.0',notes,url:campaign.release_url});assert.match(body,/光页与桌面联动/);assert.match(body,/!\[预览\]/);assert.match(body,/!\[红标\]/);assert.doesNotMatch(body,/install.png|old.png|• !/);
});
test('admin preview supports HTTPS images and editing an image invalidates the previous tested draft',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(await readFile(new URL('../cloudflare/schema.sql',import.meta.url),'utf8'));
 const DB={prepare(sql){return {
  values:[],bind(...values){this.values=values;return this},
  async first(){return db.prepare(sql).get(...this.values)||null},
  async all(){return {results:db.prepare(sql).all(...this.values)}},
  async run(){return {meta:{changes:Number(db.prepare(sql).run(...this.values).changes)}}}
 }}};
 const mail=[],env={DB,ADMIN_TOKEN:'test-only',FEEDBACK_TO_EMAIL:'owner@example.com',SUBSCRIBER_EMAIL:{async send(m){mail.push(m)}}};
 const origin='https://musefilm-feedback-api.syrquartz.workers.dev';
 async function api(path,body,method){const r=await worker.fetch(new Request(origin+'/api/admin/'+path,{method:method || (body?'POST':'GET'),headers:{Origin:origin,Authorization:'Bearer test-only','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);assert.equal(r.status,200);return r.json()}
 const {id}=await api('campaigns',{subject:campaign.subject,body:campaign.body}),preview=await api('campaigns/'+id+'/preview');assert.match(preview.html,/<img src=/);
 await api('campaigns/'+id+'/test',{});assert.equal(mail.length,1);assert.match(mail[0].html,/<img /);
 await api('campaigns/'+id,{subject:campaign.subject,body:campaign.body.replace(image,'https://musefilm.top/new.png')},'PATCH');assert.equal((await api('campaigns/'+id)).campaign.test_status,'');
 const admin=await worker.fetch(new Request(origin+'/admin'),env);assert.match(admin.headers.get('Content-Security-Policy'),/img-src 'self' data: https:/);assert.match(await admin.text(),/id="insert-mail-image"/);db.close();
});
