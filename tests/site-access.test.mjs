import assert from 'node:assert/strict';
import test from 'node:test';
import { createSiteAccess } from '../site-access.js';
function fixture(){
 const handlers={},created=[],timers=[];let access={blocked:false},failure=false;
 class Node{constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.handlers={};this.open=false}setAttribute(){}append(...nodes){this.children.push(...nodes)}addEventListener(n,f){this.handlers[n]=f}querySelector(selector){return this.children.find(c=>selector==='#site-access-message'?c.id==='site-access-message':'accessExpiry' in c.dataset)}contains(node){return node===this || this.children.includes(node)}showModal(){this.open=true}close(){this.open=false}}
 const document={hidden:false,head:new Node('head'),body:new Node('body'),createElement(tag){const n=new Node(tag);created.push(n);return n},addEventListener(n,f){handlers[n]=f},querySelectorAll(){return created.filter(n=>n.tag==='dialog'&&n.open)}};
 const window={setTimeout(f){timers.push(f);return timers.length},clearTimeout(){},addEventListener(n,f){handlers[n]=f}};
 const api=createSiteAccess({document,window,request:async()=>{if(failure)throw new Error('offline');return access}});
 return {api,handlers,created,setAccess(v){access=v},setFailure(){failure=true},dialog:()=>created.find(n=>n.tag==='dialog')};
}
test('lock uses literal text, prevents Escape and outside controls, and release closes it',async()=>{
 const f=fixture();await f.api.check();f.api.apply({blocked:true,message:'<script>unsafe()</script>\n请停止重复下载'});const dialog=f.dialog();assert.equal(dialog.open,true);assert.equal(dialog.querySelector('#site-access-message').textContent,'<script>unsafe()</script>\n请停止重复下载');assert.equal(dialog.children.some(c=>c.tag==='script'),false);
 let prevented=false,stopped=false;dialog.handlers.cancel({preventDefault(){prevented=true}});assert.equal(prevented,true);f.handlers.keydown({key:'Escape',target:dialog.children.at(-1),preventDefault(){prevented=true},stopImmediatePropagation(){stopped=true}});assert.equal(stopped,true);
 f.api.apply({blocked:false});assert.equal(dialog.open,false);assert.equal(f.api.blocked,false);
});
test('network failures preserve a known ban; reconnect and expiry restore access',async()=>{
 const f=fixture();await new Promise(r=>setImmediate(r));f.api.apply({blocked:true,message:'暂停访问'});f.setFailure();await f.api.check();assert.equal(f.api.blocked,true);assert.equal(f.dialog().open,true);
});
test('subsequent polling updates message and can clear lock without reloading',async()=>{
 const f=fixture();await new Promise(r=>setImmediate(r));f.setAccess({blocked:true,message:'管理员新消息'});await f.api.check();assert.equal(f.dialog().open,true);assert.equal(f.dialog().querySelector('#site-access-message').textContent,'管理员新消息');f.setAccess({blocked:false});await f.api.check();assert.equal(f.dialog().open,false);
});
