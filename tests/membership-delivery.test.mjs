import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../cloudflare/worker.js';

async function fixture() {
 const html=await (await worker.fetch(new Request('https://api.musefilm.top/admin'),{})).text();
 const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const client=source.slice(source.indexOf('const memberTitles='),source.indexOf("$('#member-report-close').onclick="));
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',reset(){},replaceChildren(){this.innerHTML=''},addEventListener(type,fn){this[type]=fn}});return nodes.get(id)};
 const clipboard=[],downloads=[],events={};
 const context=vm.createContext({$:get,window:{addEventListener(type,fn){events[type]=fn}},navigator:{clipboard:{async writeText(text){clipboard.push(text)}}},
  buttonAction:async(button,action)=>action(),toast(){},esc:String,number:String,date:String,Blob,
  URL:{createObjectURL(blob){downloads.push({blob});return 'blob:test'},revokeObjectURL(){}},setTimeout(fn){fn()},
  document:{createElement(){return {click(){Object.assign(downloads.at(-1),{filename:this.download})}}}}
 });
 get('#member-code-numbered').checked=true;
 vm.runInContext(client,context);
 const batch={id:'test-batch',label:'测试',product:'plus',durationDays:31,expiresAt:1800000000};
 const codes=[{id:'one',code:'MUSE-1111',status:'available'},{id:'used',code:'MUSE-USED',status:'claimed'},{id:'two',code:'MUSE-2222',status:'available'},{id:'disabled',code:'MUSE-DISABLED',status:'disabled'},{id:'expired',code:'MUSE-EXPIRED',status:'expired'}].map(c=>({...c,redeemURL:'https://membership.musefilm.top/redeem#'+c.code}));
 const render=codes=>vm.runInContext('renderMemberDelivery('+JSON.stringify({batch,codes})+')',context);
 render(codes);
 const click=dataset=>get('#view-membership').click({target:{closest(){return {dataset}}}});
 return {html,get,clipboard,downloads,events,context,codes,render,click};
}

test('served admin copies and exports only available numbered codes, in batch order, one per line',async()=>{
 const f=await fixture();
 assert.match(f.html,/id="member-code-list"[^>]*readonly/);
 assert.equal(f.get('#member-code-list').value,'1. MUSE-1111\n2. MUSE-2222');
 await f.get('#member-copy').onclick();assert.equal(f.clipboard.at(-1),'1. MUSE-1111\n2. MUSE-2222');
 f.get('#member-txt').onclick();const download=f.downloads.at(-1);
 assert.equal(download.filename,'MuseFilm-test-batch-codes.txt');
 assert.equal(download.blob.type,'text/plain;charset=utf-8');
 assert.equal(await download.blob.text(),'1. MUSE-1111\n2. MUSE-2222\n');
 f.get('#member-code-numbered').checked=false;f.get('#member-code-numbered').onchange();
 assert.equal(f.get('#member-code-list').value,'MUSE-1111\nMUSE-2222');
 await f.get('#member-copy').onclick();assert.equal(f.clipboard.at(-1),'MUSE-1111\nMUSE-2222');
 await f.click({memberCode:'one'});assert.equal(f.clipboard.at(-1),'MUSE-1111');
 await f.click({memberLink:'one'});assert.equal(f.clipboard.at(-1),'https://membership.musefilm.top/redeem#MUSE-1111');
});

test('empty batches cannot copy or export stale codes, and leaving clears the plain list',async()=>{
 const f=await fixture();f.render(f.codes.filter(c=>c.status!=='available'));
 assert.equal(f.get('#member-copy').disabled,true);assert.equal(f.get('#member-txt').disabled,true);
 assert.equal(f.get('#member-code-list').value,'');
 await f.get('#member-copy').onclick();f.get('#member-txt').onclick();assert.equal(f.clipboard.length,0);assert.equal(f.downloads.length,0);
 f.render(f.codes);f.events.pagehide();assert.equal(f.get('#member-code-list').value,'');
 assert.equal(f.get('#member-codes').innerHTML,'');assert.equal(f.get('#member-delivery').hidden,true);
 assert.equal(vm.runInContext('memberDelivery',f.context),null);
});

test('CSV retains the full inventory and links with real spreadsheet row separators',async()=>{
 const f=await fixture();f.get('#member-csv').onclick();const download=f.downloads.at(-1);
 const bytes=new Uint8Array(await download.blob.arrayBuffer());assert.deepEqual([...bytes.slice(0,3)],[239,187,191]);
 const text=await download.blob.text();assert.equal(text.trim().split('\r\n').length,6);
 assert.ok(text.includes('MUSE-USED'));assert.ok(text.includes('https://membership.musefilm.top/redeem#MUSE-1111'));
});
