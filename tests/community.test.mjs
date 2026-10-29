import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import test from "node:test";
import worker, { __test } from "../cloudflare/worker.js";

const schema=await readFile(new URL("../cloudflare/schema.sql",import.meta.url),"utf8");
const origin="https://musefilm-feedback-api.syrquartz.workers.dev";
const downloadUrl="https://github.com/Quartzsyr/MuseFilm/releases/download/MAC3.2.2/MuseFilm.dmg";
class D1 {
  constructor(){this.sqlite=new DatabaseSync(":memory:");this.sqlite.exec(schema);this.sqlite.exec("UPDATE download_security_settings SET window_limit=100,daily_limit=1000")}
  prepare(sql){const db=this.sqlite;return {values:[],bind(...values){this.values=values;return this},async first(){return db.prepare(sql).get(...this.values) || null},async all(){return {results:db.prepare(sql).all(...this.values)}},async run(){const result=db.prepare(sql).run(...this.values);return {meta:{changes:Number(result.changes)}}}}}
  async batch(statements){return Promise.all(statements.map(s=>s.all()))}
}
function fixture(){const db=new D1(),ownerMail=[],userMail=[];const env={DB:db,FINGERPRINT_SALT:"community-tests-only-long-salt-over-32-characters",EMAIL:{async send(mail){ownerMail.push(mail)}},SUBSCRIBER_EMAIL:{async send(mail){userMail.push(mail)}},FEEDBACK_TO_EMAIL:"owner@example.com",FEEDBACK_FROM_EMAIL:"feedback@musefilm.top"};return {db,env,ownerMail,userMail}}
function req(path,body,extra={}){return new Request(origin+path,{method:body===undefined?"GET":"POST",headers:{Origin:path==="/api/download"?"https://musefilm.top":origin,"Content-Type":"application/json","CF-Connecting-IP":"203.0.113.10",...extra},...(body===undefined?{}:{body:JSON.stringify(body)})})}
async function contact(f,email,subscribe=false){return worker.fetch(req("/api/download",{eventId:crypto.randomUUID(),downloadUrl,noticeVersion:"2026-10-19",email,subscribe,consentVersion:subscribe?"2026-10-20":"",locale:"zh"}),f.env)}
async function directContact(f,email){return worker.fetch(req("/api/download",{eventId:crypto.randomUUID(),downloadUrl,noticeVersion:"2026-10-19",email,subscribe:true,consentVersion:"2026-10-20-email-subscription-v2",locale:"zh"}),f.env)}
async function login(f){const response=await worker.fetch(req("/api/admin/login/request",{}),f.env);assert.equal(response.status,200);const data=await response.json();const code=f.ownerMail.at(-1).text.match(/\d{8}/)[0];const result=await worker.fetch(req("/api/admin/login",{challengeId:data.challengeId,code},{Cookie:`musefilm_challenge=${data.challengeId}`}),f.env);assert.equal(result.status,200);return result.headers.get("Set-Cookie").split(";")[0]}
async function action(f,path,body,cookie){const response=await worker.fetch(req(path,body,{Cookie:cookie}),f.env);const data=await response.json();return {response,data}}
async function confirm(f,token,path="/api/subscribe/confirm"){return worker.fetch(new Request(origin+path,{method:"POST",headers:{Origin:origin},body:new URLSearchParams({token})}),f.env)}

test("skipping email preserves direct-download notification and creates no contact",async()=>{
  const f=fixture(),response=await contact(f,"");assert.equal(response.status,202);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM subscribers").get().n,0);assert.equal(f.userMail.length,0);assert.equal(f.ownerMail.length,1);
});
test("optional email is saved without subscribing; private connection data is not sent to the visitor",async()=>{
  const f=fixture();assert.equal((await contact(f," Visitor@Example.com ")).status,202);const row=f.db.sqlite.prepare("SELECT * FROM subscribers").get();assert.equal(row.email,"visitor@example.com");assert.equal(row.status,"contact");assert.equal(f.userMail.length,1);assert.match(f.userMail[0].text,/feedback=1/);assert.doesNotMatch(f.userMail[0].text,/203\.0\.113\.10/);await contact(f,"visitor@example.com");assert.equal(f.userMail.length,1);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM subscribers").get().n,1);
});
test("news requires opt-in and confirmation; email-link GET requests do not subscribe or unsubscribe",async()=>{
  const f=fixture();await contact(f,"reader@example.com",true);let row=f.db.sqlite.prepare("SELECT * FROM subscribers").get();assert.equal(row.status,"pending");assert.match(f.userMail[0].text,/确认订阅/);await worker.fetch(req("/subscribe/confirm?token="+row.confirmation_token),f.env);assert.equal(f.db.sqlite.prepare("SELECT status FROM subscribers").get().status,"pending");await confirm(f,row.confirmation_token);assert.equal(f.db.sqlite.prepare("SELECT status FROM subscribers").get().status,"subscribed");await worker.fetch(req("/unsubscribe?token="+row.unsubscribe_token),f.env);assert.equal(f.db.sqlite.prepare("SELECT status FROM subscribers").get().status,"subscribed");await confirm(f,row.unsubscribe_token,"/api/unsubscribe");assert.equal(f.db.sqlite.prepare("SELECT status FROM subscribers").get().status,"unsubscribed");await contact(f,"reader@example.com");assert.equal(f.db.sqlite.prepare("SELECT status FROM subscribers").get().status,"unsubscribed");assert.equal(f.userMail.length,1);
});
test("submitting email with the current disclosure subscribes immediately and remains eligible until unsubscribed",async()=>{
  const f=fixture();assert.equal((await directContact(f,"reader@example.com")).status,202);
  const row=f.db.sqlite.prepare("SELECT * FROM subscribers").get();assert.equal(row.status,"subscribed");assert.ok(row.consent_at);assert.equal(row.confirmed_at,row.consent_at);assert.equal(row.consent_version,"2026-10-20-email-subscription-v2");
  assert.doesNotMatch(f.userMail[0].text,/确认订阅|subscribe\/confirm/);assert.match(f.userMail[0].html,/你已订阅/);assert.match(f.userMail[0].text,/不再接收邮件/);
  await directContact(f,"reader@example.com");assert.equal(f.userMail.length,1);
  await confirm(f,row.unsubscribe_token,"/api/unsubscribe");assert.equal(f.db.sqlite.prepare("SELECT status FROM subscribers").get().status,"unsubscribed");
  await contact(f,"reader@example.com");assert.equal(f.db.sqlite.prepare("SELECT status FROM subscribers").get().status,"unsubscribed");
  await directContact(f,"reader@example.com");assert.equal(f.db.sqlite.prepare("SELECT status FROM subscribers").get().status,"subscribed");
});
test("admin APIs require a one-use, expiring email code and an HttpOnly session",async()=>{
  const f=fixture();assert.equal((await worker.fetch(req("/api/admin/subscribers"),f.env)).status,401);const response=await worker.fetch(req("/api/admin/login/request",{}),f.env);const {challengeId}=await response.json();const code=f.ownerMail[0].text.match(/\d{8}/)[0];const headers={Cookie:`musefilm_challenge=${challengeId}`};assert.equal((await worker.fetch(req("/api/admin/login",{challengeId,code:"00000000"},headers),f.env)).status,401);const logged=await worker.fetch(req("/api/admin/login",{challengeId,code},headers),f.env);assert.equal(logged.status,200);assert.match(logged.headers.get("Set-Cookie"),/HttpOnly; Secure; SameSite=Strict/);assert.equal((await worker.fetch(req("/api/admin/login",{challengeId,code},headers),f.env)).status,401);const cookie=logged.headers.get("Set-Cookie").split(";")[0];assert.equal((await action(f,"/api/admin/subscribers",undefined,cookie)).response.status,200);const cross=req("/api/admin/campaigns",{subject:"News",body:"A new release has arrived."},{Cookie:cookie,Origin:"https://evil.example"});assert.equal((await worker.fetch(cross,f.env)).status,403);
});
test("campaigns require a tested draft and exact recipient confirmation, and honor later unsubscribes",async()=>{
  const f=fixture();await contact(f,"confirmed@example.com",true);const reader=f.db.sqlite.prepare("SELECT * FROM subscribers WHERE email='confirmed@example.com'").get();await confirm(f,reader.confirmation_token);await contact(f,"pending@example.com",true);await contact(f,"contact@example.com",false);const cookie=await login(f);
  const created=await action(f,"/api/admin/campaigns",{subject:"MuseFilm 新消息",body:"这一卷，我们更新了胶卷档案与搜索体验。"},cookie);const id=created.data.id;assert.ok(id);
  assert.equal((await action(f,`/api/admin/campaigns/${id}/start`,{confirmRecipientCount:1},cookie)).response.status,409);
  assert.equal((await action(f,`/api/admin/campaigns/${id}/test`,{},cookie)).response.status,200);
  assert.equal((await action(f,`/api/admin/campaigns/${id}/start`,{confirmRecipientCount:2},cookie)).response.status,409);
  assert.equal((await action(f,`/api/admin/campaigns/${id}/start`,{confirmRecipientCount:1},cookie)).response.status,200);
  await confirm(f,reader.unsubscribe_token,"/api/unsubscribe");const before=f.userMail.length;const processed=await action(f,`/api/admin/campaigns/${id}/process`,{},cookie);assert.equal(processed.data.progress.skipped,1);assert.equal(f.userMail.length,before);
});
test("immediate subscribers receive a campaign once and retain the unsubscribe link",async()=>{
  const f=fixture();await directContact(f,"confirmed@example.com");const cookie=await login(f);const created=await action(f,"/api/admin/campaigns",{subject:"MuseFilm 新版本",body:"这一卷，我们更新了胶卷档案与搜索体验。"},cookie),id=created.data.id;await action(f,`/api/admin/campaigns/${id}/test`,{},cookie);await action(f,`/api/admin/campaigns/${id}/start`,{confirmRecipientCount:1},cookie);const first=await action(f,`/api/admin/campaigns/${id}/process`,{},cookie);assert.equal(first.data.progress.sent,1);const length=f.userMail.length;assert.equal((await action(f,`/api/admin/campaigns/${id}/process`,{},cookie)).response.status,409);assert.equal(f.userMail.length,length);assert.match(f.userMail.at(-1).text,/退订/);
});
test("subscriber search/export does not expose confirmation tokens and protects CSV formulas",async()=>{
  const f=fixture();await contact(f,"=formula@example.com");const cookie=await login(f);const result=await action(f,"/api/admin/subscribers?q=formula",undefined,cookie);assert.equal(result.data.subscribers.length,1);assert.equal(result.data.subscribers[0].confirmation_token,undefined);assert.equal(result.data.subscribers[0].thank_you_status,"sent");const exported=await worker.fetch(req("/api/admin/export",undefined,{Cookie:cookie}),f.env);assert.match(await exported.text(),/'=formula@example.com/);assert.equal(__test.csvCell("=cmd"),'"\'=cmd"');
});
test("SMTP uses TLS on QQ port 465 and sends UTF-8 MIME after successful authentication",async()=>{
  const writes=[];let options,step=0;
  class Socket extends EventEmitter{setTimeout(){}end(){}destroy(){}write(value,callback){writes.push(value);queueMicrotask(()=>{callback?.();const replies=["250-qq mail\r\n250 AUTH LOGIN\r\n","334 user\r\n","334 pass\r\n","235 ok\r\n","250 ok\r\n","250 ok\r\n","354 send data\r\n","250 queued\r\n"];const reply=replies[step++];if(reply)this.emit("data",Buffer.from(reply))});return true}}
  const connect=opts=>{options=opts;const socket=new Socket();queueMicrotask(()=>socket.emit("data",Buffer.from("220 qq smtp ready\r\n")));return socket};
  await __test.sendQqSmtp({SMTP_USER:"owner@qq.com",SMTP_PASSWORD:"test-only-authorization-code"},{to:"reader@example.com",subject:"感谢下载 MuseFilm",text:"一卷光。",html:"<p>一卷光。</p>"},connect);
  assert.equal(options.host,"smtp.qq.com");assert.equal(options.port,465);assert.equal(options.rejectUnauthorized,true);assert.match(writes[7],/Content-Transfer-Encoding: base64/);assert.match(writes[7],/Subject: =\?UTF-8\?B\?/);assert.match(writes[7],/To: <reader@example.com>/);
});
