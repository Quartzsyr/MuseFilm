import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
const source=await readFile(new URL("../site.js",import.meta.url),"utf8");
const section=source.slice(source.indexOf('const downloadDialog ='),source.indexOf('async function recordAnonymousVisit()'));
function harness(){
  const handlers=new Map(),requests=[],downloads=[],documentHandlers={};let opens=0;
  class Element{constructor(href){this.href=href;this.dataset={}}closest(){return this}click(){downloads.push(this.href);documentHandlers.click?.({target:this,preventDefault(){}})}remove(){}}
  const email={value:"",focus(){}},subscribe={checked:false},status={textContent:""},dialog={open:false,showModal(){this.open=true;opens++},close(){this.open=false;handlers.get("dialog:close")?.()},addEventListener(event,fn){handlers.set("dialog:"+event,fn)}};
  const form={reset(){email.value="";subscribe.checked=false},reportValidity(){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)},elements:{namedItem(){return subscribe}},addEventListener(event,fn){handlers.set("form:"+event,fn)}};
  const toast={hidden:true,textContent:""},installer={textContent:""};
  const nodes={"[data-download-dialog]":dialog,"[data-download-form]":form,"[data-download-email]":email,"[data-download-dialog-status]":status,"[data-download-toast]":toast,"[data-download-installer]":installer};
  const document={querySelector(selector){return nodes[selector] || {addEventListener(event,fn){handlers.set(selector+":"+event,fn)}}},addEventListener(event,fn){documentHandlers[event]=fn},createElement(){return new Element()},body:{append(){}}};
  const context=vm.createContext({document,Element,URL,window:{setTimeout(){return 1},clearTimeout(){}},translate:key=>key,renderCounts(){},lastCounts:{windows:1,mac:1},lastCountsSynced:true,downloadOpened:false,currentLanguage:"zh",referrerHost:()=>"example.test",anonymousEventId:()=>"dialog-test",musefilmApi:async(path,options)=>{requests.push(JSON.parse(options.body));return{thankYouQueued:true}}});
  vm.runInContext(section,context);
  const click=()=>documentHandlers.click({target:new Element("https://github.com/Quartzsyr/MuseFilm/releases/download/MAC3.2.2/MuseFilm.dmg"),preventDefault(){}});
  return{click,email,subscribe,status,dialog,requests,downloads,get opens(){return opens},skip:()=>handlers.get("[data-download-skip]:click")(),submit:()=>handlers.get("form:submit")({preventDefault(){}})};
}
test("installer click opens an optional modal without starting a download or sending data",()=>{const app=harness();app.click();assert.equal(app.dialog.open,true);assert.equal(app.subscribe.checked,false);assert.equal(app.requests.length,0);assert.equal(app.downloads.length,0)});
test("skip ignores an invalid email, starts one download and does not share the typed email",()=>{const app=harness();app.click();app.email.value="not-an-email";app.subscribe.checked=true;app.skip();assert.equal(app.dialog.open,false);assert.equal(app.downloads.length,1);assert.equal(app.opens,1);assert.equal(app.requests[0].email,"");assert.equal(app.requests[0].subscribe,false)});
test("sharing requires a valid email and transmits news consent only when checked",()=>{const app=harness();app.click();app.submit();assert.equal(app.dialog.open,true);assert.equal(app.requests.length,0);app.email.value="reader@example.com";app.subscribe.checked=true;app.submit();assert.equal(app.downloads.length,1);assert.equal(app.requests[0].email,"reader@example.com");assert.equal(app.requests[0].subscribe,true);assert.equal(app.requests[0].consentVersion,"2026-10-20")});
test("closing cancels; reopening clears previous email and subscription choice",()=>{const app=harness();app.click();app.email.value="reader@example.com";app.subscribe.checked=true;app.dialog.close();assert.equal(app.requests.length,0);app.click();assert.equal(app.email.value,"");assert.equal(app.subscribe.checked,false)});
