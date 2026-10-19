// Local-only preview. All email is captured in /tmp; nothing is delivered.
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import worker from "../cloudflare/worker.js";
const root=resolve(import.meta.dirname,".."),assets=process.env.MUSEFILM_ASSET_ROOT || root,db=new DatabaseSync(":memory:");
db.exec(await readFile(resolve(root,"cloudflare/schema.sql"),"utf8"));
const database={prepare(sql){return{values:[],bind(...values){this.values=values;return this},async first(){return db.prepare(sql).get(...this.values)||null},async all(){return{results:db.prepare(sql).all(...this.values)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...this.values).changes)}}}}},async batch(statements){return Promise.all(statements.map(s=>s.all()))}};
for(const [index,status] of ["subscribed","pending","contact"].entries())db.prepare("INSERT INTO subscribers(id,email,status,locale,platform,consent_version,confirmation_token,unsubscribe_token,created_at,last_download_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run("local-"+index,["alice","lin","film"][index]+"@example.test",status,"zh",index===1?"windows":"mac","2026-10-20","confirm-"+index,"unsubscribe-"+index,new Date().toISOString(),new Date().toISOString());
const mail=[];async function capture(message){mail.push(message);await writeFile("/tmp/musefilm-community-preview-mail.json",JSON.stringify(mail,null,2))}
const env={DB:database,FINGERPRINT_SALT:"local-preview-only-salt-with-more-than-32-characters",EMAIL:{send:capture},SUBSCRIBER_EMAIL:{send:capture},FEEDBACK_TO_EMAIL:"owner@example.test",FEEDBACK_FROM_EMAIL:"feedback@musefilm.top",ALLOWED_ORIGINS:"http://127.0.0.1:8787",ALLOW_UNPROTECTED_FEEDBACK:"true"};
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".glb":"model/gltf-binary",".png":"image/png",".avif":"image/avif",".jpg":"image/jpeg",".webp":"image/webp",".svg":"image/svg+xml"};
http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,"http://127.0.0.1:8787");
  if(url.pathname==="/admin"||url.pathname.startsWith("/api/")||url.pathname==="/unsubscribe"||url.pathname==="/subscribe/confirm"){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);const response=await worker.fetch(new Request(url,{method:req.method,headers:req.headers,...(body.length?{body}:{})}),env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  const relative=decodeURIComponent(url.pathname==="/"?"/index.html":url.pathname).replace(/^\//,"");let data;
  for(const folder of [root,resolve(assets,"public"),assets]){const path=resolve(folder,relative);if(!path.startsWith(folder+"/"))continue;try{data=await readFile(path);break}catch{}}
  if(!data){res.writeHead(404);res.end("not found");return}
  if(relative==="index.html")data=Buffer.from(data.toString().replace("https://musefilm-feedback-api.syrquartz.workers.dev","http://127.0.0.1:8787"));
  res.writeHead(200,{"Content-Type":types[extname(relative)]||"application/octet-stream","Cache-Control":"no-store"});res.end(data);
}catch(error){res.writeHead(500);res.end(error.message)}}).listen(8787,"127.0.0.1",()=>console.log("Local preview (mock email): http://127.0.0.1:8787/ and /admin"));
