// Local-only dashboard preview. Every email is captured, never delivered.
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import initialWorker,{__test as initialTests} from '../cloudflare/worker.js';
const workerUrl=new URL('../cloudflare/worker.js',import.meta.url);
let worker=initialWorker,automationTests=initialTests,lastWorkerMtime=(await stat(workerUrl)).mtimeMs;
const root=resolve(import.meta.dirname,'..'),assets=process.env.MUSEFILM_ASSET_ROOT || root,port=Number(process.env.MUSEFILM_PREVIEW_PORT || 8787),db=new DatabaseSync(':memory:');
db.exec(await readFile(resolve(root,'cloudflare/schema.sql'),'utf8'));
function statement(sql){return {values:[],bind(...values){this.values=values;return this},async first(){return db.prepare(sql).get(...this.values)||null},async all(){return {results:db.prepare(sql).all(...this.values)}},async run(){return {meta:{changes:Number(db.prepare(sql).run(...this.values).changes)}}}}}
const database={prepare:statement,async batch(items){db.exec('BEGIN');try{const results=[];for(const item of items)results.push(await item.all());db.exec('COMMIT');return results}catch(error){db.exec('ROLLBACK');throw error}}};
const now=()=>new Date().toISOString();
for(const [index,status] of ['subscribed','subscribed','subscribed','pending','contact','unsubscribed'].entries()){
  const id='local-'+index,email=['alice','lin','chen','film','hello','sam'][index]+'@example.test',platform=index===1?'windows':'mac';
  db.prepare('INSERT INTO subscribers(id,email,status,locale,platform,consent_version,confirmation_token,unsubscribe_token,created_at,last_download_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,email,status,'zh',platform,'2026-10-20','confirm-'+index,'unsubscribe-'+index,now(),now());
  db.prepare('INSERT INTO subscriber_platforms VALUES(?,?,?)').run(id,platform,now());
}
db.prepare("INSERT INTO subscriber_platforms VALUES('local-2','windows',?)").run(now());
for(let day=0;day<7;day++)for(let index=0;index<(7-day)*2;index++){
  const time=new Date(Date.now()-day*86400000-index*120000).toISOString();
  db.prepare("INSERT INTO visit_events(id,fingerprint,path,platform,locale,country,browser,created_at) VALUES(?,?,'/','mac','zh','CN','Safari',?)").run('visit-'+day+'-'+index,'local-visitor-'+index,time);
  if(index<2)db.prepare("INSERT INTO download_events(id,fingerprint,platform,download_url,asset_name,release_tag,ip_address,country,region,city,operating_system,browser,email_status,created_at) VALUES(?,?,'mac','https://github.com/Quartzsyr/MuseFilm/releases/download/MAC3.2.2/MuseFilm.dmg','MuseFilm.dmg','MAC3.2.2','192.0.2.10','演示地区','演示省份','演示城市','macOS','Safari','sent',?)").run('download-'+day+'-'+index,'local-visitor-'+index,time);
}
for(const [id,type,message,status] of [['feedback-1','bug','导入一卷照片后，希望可以直接修改拍摄日期。','new'],['feedback-2','suggestion','期待增加胶卷标签的批量编辑功能。','reviewing']])db.prepare("INSERT INTO feedback(id,type,message,contact_email,platform,fingerprint,status,created_at) VALUES(?,?,?,'alice@example.test','mac','local',?,?)").run(id,type,message,status,now());
for(const [id,subject,status] of [['draft-demo','MuseFilm 使用指南','draft'],['sent-demo','MuseFilm macOS 更新','sent']]){
  db.prepare('INSERT INTO campaigns(id,subject,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,subject,'你好，\n\n这一卷，我们改进了胶卷档案与搜索体验。欢迎试用并回复你的使用感受。',status,now(),now());
  db.prepare("INSERT INTO campaign_options(campaign_id,audience) VALUES(?,'mac')").run(id);
}
db.prepare("INSERT INTO campaign_recipients(campaign_id,subscriber_id,status,sent_at) VALUES('sent-demo','local-0','sent',?)").run(now());
db.prepare("UPDATE mail_settings SET baseline_at=?,last_scan_at=?,imap_last_at=?,scan_due='2099-01-01',imap_due='2099-01-01' WHERE id=1").run(now(),now(),now());
const mail=[];async function capture(message){mail.push(message);await writeFile('/tmp/musefilm-community-preview-mail.json',JSON.stringify(mail,null,2))}
const env={DB:database,LOCAL_PREVIEW:true,FINGERPRINT_SALT:'local-preview-only-salt-with-more-than-32-characters',EMAIL:{send:capture},SUBSCRIBER_EMAIL:{send:capture},FEEDBACK_TO_EMAIL:'owner@example.test',FEEDBACK_FROM_EMAIL:'feedback@musefilm.top',ALLOWED_ORIGINS:'http://127.0.0.1:'+port,ALLOW_UNPROTECTED_FEEDBACK:'true'};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.avif':'image/avif','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{try{
  const mtime=(await stat(workerUrl)).mtimeMs;if(mtime!==lastWorkerMtime){const module=await import(workerUrl.href+'?preview='+mtime);worker=module.default;automationTests=module.__test;lastWorkerMtime=mtime}
  const url=new URL(req.url,'http://127.0.0.1:'+port);
  if(url.pathname==='/admin'||url.pathname.startsWith('/api/')||url.pathname==='/unsubscribe'||url.pathname==='/subscribe/confirm'){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks),request=new Request(url,{method:req.method,headers:req.headers,...(body.length?{body}:{})});
    // Real authorization, with fake external checks in the local preview only.
    if(['/api/admin/automation/check','/api/admin/automation/imap'].includes(url.pathname)){
      const authorized=await worker.fetch(new Request(url.origin+'/api/admin/session',{headers:req.headers}),env);if(authorized.status===200){const imap=url.pathname.endsWith('/imap');db.prepare(imap?"UPDATE mail_settings SET imap_last_at=?,imap_error='' WHERE id=1":"UPDATE mail_settings SET last_scan_at=?,scan_error='' WHERE id=1").run(now());res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,unchanged:true,checked:0,matched:0}));return}
    }
    const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname).replace(/^\//,'');let data;
  for(const folder of [root,resolve(assets,'public'),assets]){const path=resolve(folder,relative);if(!path.startsWith(folder+'/'))continue;try{data=await readFile(path);break}catch{}}
  if(!data){res.writeHead(404);res.end('not found');return}
  if(relative==='index.html')data=Buffer.from(data.toString().replace('https://musefilm-feedback-api.syrquartz.workers.dev','http://127.0.0.1:'+port));
  res.writeHead(200,{'Content-Type':types[extname(relative)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
}catch(error){res.writeHead(500);res.end(error.message)}}).listen(port,'127.0.0.1',()=>console.log('Local dashboard preview (mock mail): http://127.0.0.1:'+port+'/admin'));
let ticking=false;const tick=setInterval(async()=>{if(ticking)return;ticking=true;try{db.prepare('UPDATE mail_settings SET last_tick_at=? WHERE id=1').run(now());await automationTests.dispatchMail(env)}catch(error){console.error('Local queue failed:',error.code || error.message)}finally{ticking=false}},2000);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(tick);server.close(()=>process.exit(0))});
