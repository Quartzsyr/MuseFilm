import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import worker from '../cloudflare/worker.js';
import { normalizeIp } from '../cloudflare/ip-security.js';
const schema=await readFile(new URL('../cloudflare/schema.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('../cloudflare/migrations/20261029-ip-security.sql',import.meta.url),'utf8');
const origin='https://api.musefilm.top',site='https://musefilm.top',ip='202.101.113.147';
class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(schema)}
 prepare(sql){const db=this.db;return {values:[],bind(...v){this.values=v;return this},async first(){return db.prepare(sql).get(...this.values)||null},async all(){return {results:db.prepare(sql).all(...this.values)}},async run(){return {meta:{changes:Number(db.prepare(sql).run(...this.values).changes)}}}}}
 async batch(items){this.db.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());this.db.exec('COMMIT');return out}catch(e){this.db.exec('ROLLBACK');throw e}}
}
function fixture(){const DB=new D1();return {DB,env:{DB,FINGERPRINT_SALT:'ip-security-test-only-salt-over-32-characters',ADMIN_TOKEN:'test-admin'},mail:[]}}
function req(path,body,{address=ip,agent='Edge',admin=false,auth=admin,origin:requestOrigin=admin?origin:site}={}){return new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json','CF-Connecting-IP':address,'User-Agent':agent,...(auth?{Authorization:'Bearer test-admin'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})}
const download=(f,options={},body={})=>worker.fetch(req('/api/download',{eventId:crypto.randomUUID(),downloadUrl:'https://github.com/Quartzsyr/MuseFilm/releases/download/Beta/MuseFilmSetup.exe',noticeVersion:'2026-10-19',...body},options),f.env);
const admin=(f,path,body,options={})=>worker.fetch(req('/api/admin/'+path,body,{admin:true,...options}),f.env);
async function control(f,action='ban',extra={}){const r=await admin(f,'ip-controls',{ip,action,...extra});assert.equal(r.status,200);return r.json()}
const count=f=>f.DB.db.prepare('SELECT count(*) AS n FROM download_events').get().n;

test('defaults limit the same IP across browsers and installer platforms, without trusting body IP',async()=>{
 const f=fixture();assert.deepEqual((await (await admin(f,'download-security')).json()).settings,{windowMinutes:30,windowLimit:3,dailyLimit:10});
 for(let i=0;i<3;i++)assert.equal((await download(f,{agent:'browser-'+i},{ip:'1.2.3.4',downloadUrl:i===1?'https://github.com/Quartzsyr/MuseFilm/releases/download/Mac/MuseFilm.dmg':'https://github.com/Quartzsyr/MuseFilm/releases/download/Beta/MuseFilmSetup.exe'})).status,202);
 const r=await download(f,{agent:'another browser'});assert.equal(r.status,429);const data=await r.json();assert.equal(data.error,'download_rate_limited');assert.ok(data.retryAfter>1700&&data.retryAfter<=1800);assert.equal(r.headers.get('Retry-After'),String(data.retryAfter));assert.equal(count(f),3);
 assert.equal((await download(f,{address:'203.0.113.9'})).status,202);
});
test('concurrent requests cannot exceed the quota',async()=>{
 const f=fixture();const statuses=await Promise.all(Array.from({length:20},(_,i)=>download(f,{agent:'Browser'+i}).then(r=>r.status)));
 assert.equal(statuses.filter(s=>s===202).length,3);assert.equal(statuses.filter(s=>s===429).length,17);assert.equal(count(f),3);
});
test('rolling window expires and 24-hour limit still applies',async()=>{
 const f=fixture();await admin(f,'download-security',{windowMinutes:1,windowLimit:2,dailyLimit:3});
 for(let i=0;i<2;i++)assert.equal((await download(f)).status,202);
 f.DB.db.prepare('UPDATE download_events SET created_at=?').run(new Date(Date.now()-120000).toISOString());
 assert.equal((await download(f)).status,202);const r=await download(f);assert.equal(r.status,429);assert.ok((await r.json()).retryAfter>86000);
 f.DB.db.prepare('UPDATE download_events SET created_at=?').run(new Date(Date.now()-86401000).toISOString());assert.equal((await download(f)).status,202);
});
test('existing downloads count, replays never create a second authorization or notification',async()=>{
 const f=fixture();const body={eventId:'same-event'};assert.equal((await download(f,{},body)).status,202);const r=await download(f,{},body);assert.equal(r.status,202);assert.equal((await r.json()).recorded,false);assert.equal(count(f),1);
 await admin(f,'download-security',{windowMinutes:30,windowLimit:1,dailyLimit:10});assert.equal((await download(f)).status,429);
});
test('ban rejects APIs; polling remains available, admin remains usable, release and expiry restore access',async()=>{
 const f=fixture();await control(f,'ban',{message:'请停止重复下载',durationMinutes:60});
 assert.equal((await download(f)).status,403);assert.equal(count(f),0);
 const access=await (await worker.fetch(req('/api/access'),f.env)).json();assert.equal(access.blocked,true);assert.equal(access.message,'请停止重复下载');assert.ok(access.expiresAt);
 assert.equal((await worker.fetch(req('/api/feedback',{message:'blocked'}),f.env)).status,403);
 assert.equal((await worker.fetch(req('/api/visit',{path:'/'}),f.env)).status,403);
 assert.equal((await admin(f,'ip-controls')).status,200);
 await control(f,'release');assert.equal((await download(f)).status,202);
 await control(f);f.DB.db.prepare('UPDATE ip_controls SET expires_at=?').run(new Date(Date.now()-1000).toISOString());assert.equal((await download(f)).status,202);
 assert.equal((await (await admin(f,'ip-controls')).json()).controls.length,0);
});
test('message-only locks operations, persists across fresh requests and returns literal text',async()=>{
 const f=fixture(),message='<script>alert(1)</script>\n访问已暂停';await control(f,'message',{message});
 const row=f.DB.db.prepare('SELECT * FROM ip_controls').get();assert.equal(row.blocked,0);assert.equal((await download(f)).status,403);
 assert.equal((await (await worker.fetch(req('/api/access'),f.env)).json()).message,message);
 await control(f,'release');const data=await (await admin(f,'ip-controls')).json();assert.equal(data.controls.length,0);assert.equal(data.history.length,2);
});
test('administration requires auth and same-origin; malformed input cannot change controls',async()=>{
 const f=fixture();assert.equal((await admin(f,'ip-controls',undefined,{auth:false})).status,401);
 assert.equal((await admin(f,'ip-controls',{ip,action:'ban'},{origin:'https://evil.test'})).status,403);
 for(const b of [{ip:'bad-ip',action:'ban'},{ip,action:'message',message:''},{ip,action:'ban',message:[]},{ip,action:'ban',durationMinutes:-1}])assert.equal((await admin(f,'ip-controls',b)).status,400);
 for(const b of [{windowMinutes:0,windowLimit:3,dailyLimit:10},{windowMinutes:30,windowLimit:4,dailyLimit:3},{windowMinutes:30,windowLimit:1.5,dailyLimit:10}])assert.equal((await admin(f,'download-security',b)).status,400);
 assert.equal(f.DB.db.prepare('SELECT count(*) AS n FROM ip_controls').get().n,0);
 assert.equal((await worker.fetch(req('/api/access',undefined,{origin:'https://evil.test'}),f.env)).status,403);
});
test('IPv6 canonicalization shares quota and ban; missing trusted connection fails closed',async()=>{
 assert.equal(normalizeIp('2001:0DB8:0:0:0:0:0:1'),'2001:db8::1');assert.equal(normalizeIp('::ffff:192.0.2.1'),'192.0.2.1');
 const f=fixture();await admin(f,'ip-controls',{ip:'2001:0DB8:0:0:0:0:0:1',action:'ban'});assert.equal((await download(f,{address:'2001:db8::1'})).status,403);
 assert.equal((await download(f,{address:''})).status,503);
});
test('migration is repeatable and preserves existing download history',async()=>{
 const f=fixture();await download(f);f.DB.db.exec(migration);f.DB.db.exec(migration);assert.equal(count(f),1);
});
