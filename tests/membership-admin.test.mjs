import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import worker from '../cloudflare/worker.js';
const origin='https://musefilm-feedback-api.syrquartz.workers.dev';
const schema=await readFile(new URL('../cloudflare/schema.sql',import.meta.url),'utf8');
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(schema);const requests=[];
 const DB={prepare(sql){return {
  args:[],bind(...args){this.args=args;return this},
  async first(){return db.prepare(sql).get(...this.args)},
  async all(){return {results:db.prepare(sql).all(...this.args)}},
  async run(){return {meta:{changes:Number(db.prepare(sql).run(...this.args).changes)}}}
 }}};
 const cookie='a'.repeat(64);db.prepare('INSERT INTO admin_sessions VALUES(?,?,?)').run(createHash('sha256').update(cookie).digest('hex'),new Date().toISOString(),new Date(Date.now()+3600000).toISOString());
 return {db,cookie,requests,env:{DB,MEMBERSHIP_ADMIN_TOKEN:'server-only-test-token',MEMBERSHIP:{async fetch(request){requests.push(request);return Response.json({batches:[]})}}}};
}
async function call(f,path='codes/list',{cookie=true,originHeader=origin,method='POST',body={}}={}){return worker.fetch(new Request(origin+'/api/admin/membership/'+path,{method,headers:{...(cookie?{Cookie:'musefilm_admin='+f.cookie}:{}),Origin:originHeader,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})}),f.env)}
test('membership dashboard shares the existing HttpOnly website session and never exposes its service credential',async()=>{const f=fixture();assert.equal((await call(f,'codes/list',{cookie:false})).status,401);assert.equal(f.requests.length,0);const result=await call(f);assert.equal(result.status,200);assert.equal((await result.json()).ok,true);assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'https://membership.internal/v1/admin/codes/list');assert.equal(f.requests[0].headers.get('authorization'),'Bearer server-only-test-token');assert.equal(f.requests[0].headers.get('cookie'),null);const html=await (await worker.fetch(new Request(origin+'/admin'),f.env)).text();assert.match(html,/会员与充值/);assert.match(html,/id="member-create"/);assert.doesNotMatch(html,/server-only-test-token/);assert.equal(result.headers.get('cache-control'),'no-store')});
test('membership proxy rejects CSRF, arbitrary paths and GET mutations before forwarding',async()=>{const f=fixture();for(const [path,options,status]of [['codes/create',{originHeader:'https://attacker.example'},403],['orders/revoke',{},404],['codes/create',{method:'GET'},404],['codes/create',{body:{text:'x'.repeat(9000)}},413]])assert.equal((await call(f,path,options)).status,status);assert.equal(f.requests.length,0)});
test('membership connection failures remain private and preserve the website session',async()=>{const f=fixture();f.env.MEMBERSHIP={async fetch(){return Response.json({error:'internal-token-details'},{status:403})}};let result=await call(f);assert.equal(result.status,502);assert.doesNotMatch(await result.text(),/internal-token-details/);delete f.env.MEMBERSHIP_ADMIN_TOKEN;result=await call(f);assert.equal(result.status,503)});
