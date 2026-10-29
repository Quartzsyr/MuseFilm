import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
const source=await readFile(new URL("../site.js",import.meta.url),"utf8");
const section=source.slice(source.indexOf('const downloadDialog ='),source.indexOf('async function recordAnonymousVisit()'));
function harness({failure=null,wait=null}={}){
  const handlers=new Map(),requests=[],downloads=[],steps=[],optionsLog=[],documentHandlers={};let opens=0;
  class Element{constructor(href){this.href=href;this.dataset={}}closest(){return this}click(){steps.push("download");downloads.push(this.href);documentHandlers.click?.({target:this,preventDefault(){}})}remove(){}}
  const email={value:"",focus(){}},status={textContent:""},dialog={open:false,showModal(){this.open=true;opens++},close(){this.open=false;handlers.get("dialog:close")?.()},addEventListener(event,fn){handlers.set("dialog:"+event,fn)}};
  const form={querySelectorAll(){return []},reset(){email.value=""},reportValidity(){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)},addEventListener(event,fn){handlers.set("form:"+event,fn)}};
  const toast={hidden:true,textContent:""},installer={textContent:""};
  const nodes={"[data-download-dialog]":dialog,"[data-download-form]":form,"[data-download-email]":email,"[data-download-dialog-status]":status,"[data-download-toast]":toast,"[data-download-installer]":installer};
  const document={querySelector(selector){return nodes[selector] || {addEventListener(event,fn){handlers.set(selector+":"+event,fn)}}},addEventListener(event,fn){documentHandlers[event]=fn},createElement(){return new Element()},body:{append(){}}};
  const context=vm.createContext({document,Element,URL,AbortSignal,siteAccess:{blocked:false,apply(){}},window:{setTimeout(){return 1},clearTimeout(){}},translate:key=>key,renderCounts(){},lastCounts:{windows:1,mac:1},lastCountsSynced:true,downloadOpened:false,currentLanguage:"zh",referrerHost:()=>"example.test",anonymousEventId:()=>"dialog-test",musefilmApi:async(path,options)=>{steps.push("report");optionsLog.push(options);requests.push(JSON.parse(options.body));if(wait)await wait;if(failure)throw failure;return{recorded:true,thankYouQueued:true}}});
  vm.runInContext(section,context);
  const click=()=>documentHandlers.click({target:new Element("https://github.com/Quartzsyr/MuseFilm/releases/download/MAC3.2.2/MuseFilm.dmg"),preventDefault(){}});
  return{click,email,status,dialog,requests,downloads,steps,optionsLog,get opens(){return opens},skip:()=>handlers.get("[data-download-skip]:click")(),submit:()=>handlers.get("form:submit")({preventDefault(){}})};
}
test("installer click opens an optional modal without starting a download or sending data",()=>{const app=harness();app.click();assert.equal(app.dialog.open,true);assert.equal(app.requests.length,0);assert.equal(app.downloads.length,0)});
test("skip ignores an invalid email, starts one download and does not share the typed email",async()=>{const app=harness();app.click();app.email.value="not-an-email";await app.skip();assert.equal(app.dialog.open,false);assert.equal(app.downloads.length,1);assert.equal(app.opens,1);assert.equal(app.requests[0].email,"");assert.equal(app.requests[0].subscribe,false)});
test("submitting a valid email subscribes without a checkbox or second confirmation",async()=>{const app=harness();app.click();app.submit();assert.equal(app.dialog.open,true);assert.equal(app.requests.length,0);app.email.value="reader@example.com";await app.submit();assert.equal(app.downloads.length,1);assert.equal(app.requests[0].email,"reader@example.com");assert.equal(app.requests[0].subscribe,true);assert.equal(app.requests[0].consentVersion,"2026-10-20-email-subscription-v2")});
test("closing cancels; reopening clears the previous email",()=>{const app=harness();app.click();app.email.value="reader@example.com";app.dialog.close();assert.equal(app.requests.length,0);app.click();assert.equal(app.email.value,"")});

test("download reporting starts before navigation using a preflight-free keepalive POST",async()=>{
  const app=harness();app.click();await app.skip();assert.deepEqual(app.steps,["report","download"]);assert.equal(app.optionsLog[0].keepalive,true);assert.equal(app.optionsLog[0].headers["Content-Type"],"text/plain;charset=UTF-8");assert.equal(app.requests.length,1);
});

test("denied and failed requests never start the installer",async()=>{for(const failure of [Object.assign(new Error('download_rate_limited'),{status:429,payload:{retryAfter:1800}}),new Error('offline')]){const app=harness({failure});app.click();await app.skip();assert.equal(app.downloads.length,0);assert.equal(app.dialog.open,true);assert.ok(app.status.textContent)}});
test("double click while approval is pending starts at most one download",async()=>{let finish;const wait=new Promise(r=>finish=r),app=harness({wait});app.click();const first=app.skip(),second=app.skip();assert.equal(app.downloads.length,0);assert.equal(app.requests.length,1);finish();await Promise.all([first,second]);assert.equal(app.downloads.length,1)});
test("closing during approval cancels navigation",async()=>{let finish;const wait=new Promise(r=>finish=r),app=harness({wait});app.click();const pending=app.skip();app.dialog.close();finish();await pending;assert.equal(app.downloads.length,0)});
