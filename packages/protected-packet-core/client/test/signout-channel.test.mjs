import {test} from 'node:test';import assert from 'node:assert/strict';
import {accountSignout} from './support/account-signout.mjs';
import {subscribePrivateSignOut} from '../browser-signout-channel.mjs';
import {EXECUTING_BUILD} from '../../../browser-extension/src/build-info.mjs';
const turn=()=>new Promise(r=>setImmediate(r));
test('initiating account disconnect awaits renderer restoration and durable cleanup',async()=>{
 let release;const h=accountSignout(()=>new Promise(r=>release=r));let result;const work=h.disconnect().then(r=>result=r);
 while(!release)await turn();assert.equal(result,undefined);assert(!h.events.includes('remote-disconnect'));
 release();await work;assert.equal(result.ok,true);assert.equal(result.value.state,'disconnected');assert.equal(h.record,null);
 assert(h.events.indexOf('owner-complete')<h.events.indexOf('remote-disconnect'));assert(h.events.indexOf('disk-clear')<h.events.indexOf('remote-disconnect'));
});
for(const fault of ['native','storage','disk'])test(`initiating account reports ${fault} cleanup failure, never disconnected`,async()=>{
 const h=accountSignout(async()=>{if(fault==='native')throw Error('native restore failed');},{storageFailure:fault==='storage',diskFailure:fault==='disk'});
 const result=await h.disconnect();assert.equal(result.ok,false);assert.equal(result.code,'catalog-protected-signout-incomplete');
 assert(h.events.includes('remote-disconnect'));assert.equal(h.record,null);for(const event of ['cache-clear','keys-clear','subject-clear','owner-start','disk-clear'])assert(h.events.includes(event));
});
test('private completion listener denies content/account senders and mixed builds',async()=>{
 let listener,calls=0;const runtime={id:'a'.repeat(32),getURL:p=>'chrome-extension://'+'a'.repeat(32)+'/'+p,onMessage:{addListener:f=>listener=f,removeListener(){}}};
 subscribePrivateSignOut(runtime,async()=>calls++);
 const message={kind:'protected-signout',build:EXECUTING_BUILD},worker={id:runtime.id,url:runtime.getURL('background.mjs')};
 for(const sender of [{...worker,tab:{id:1}},{...worker,url:runtime.getURL('catalog-account.html')},{...worker,id:'b'.repeat(32)}])assert.equal(listener(message,sender,()=>{}),undefined);
 assert.equal(listener({...message,build:null},worker,()=>{}),undefined);await turn();assert.equal(calls,0);
 const result=await new Promise(resolve=>assert.equal(listener(message,worker,resolve),true));assert.equal(result.ok,true);assert.equal(calls,1);
});

for(const fault of ['marker','cache','keys','subject','disk'])test(`initiating account attempts all cleanup after ${fault} refusal`,async()=>{
 const h=accountSignout(async()=>{}, {fault});const result=await h.disconnect();assert.equal(result.ok,false);assert.equal(h.record,null);
 for(const e of ['marker','cache-clear','keys-clear','subject-clear','owner-start','disk-clear','remote-disconnect'])assert(h.events.includes(e));
});
test('no-owner disconnect clears private disk and succeeds without fabricating renderer acknowledgement',async()=>{
 const h=accountSignout(async()=>{throw Error('must not call');},{owner:false});const result=await h.disconnect();assert.equal(result.ok,true);assert(!h.events.includes('owner-start'));assert(h.events.includes('disk-clear'));assert.equal(h.record,null);
});
test('disappearing owner cannot be mistaken for confirmed native restoration',async()=>{
 const h=accountSignout(async()=>{},{owner:'disappearing'});const result=await h.disconnect();assert.equal(result.ok,false);assert.equal(h.record,null);assert(h.events.includes('disk-clear'));
});
test('remote disconnect failure retains completed local invalidation and reports a pending revocation',async()=>{
 const h=accountSignout(async()=>{},{remoteFailure:true});const result=await h.disconnect();assert.equal(result.ok,true);assert.equal(result.value.state,'revocation-pending');assert.equal(h.record,null);assert.equal(h.state.active,null);assert.equal(h.state.revocations.length,1);
 for(const e of ['owner-complete','disk-clear','keys-clear','cache-clear','subject-clear'])assert(h.events.includes(e));
});

test('initiating account attempts protected cleanup and remote revoke after pairing removal fails',async()=>{
 const h=accountSignout(async()=>{}, {fault:'pairing'});const result=await h.disconnect();
 assert.equal(result.ok,false);assert.equal(result.code,'catalog-protected-signout-incomplete');
 assert.notEqual(h.record,null); // storage failure is reported, never claimed cleared
 for(const event of ['pairing-clear-attempt','marker','cache-clear','keys-clear','subject-clear','owner-start','owner-complete','disk-clear','remote-disconnect'])assert(h.events.includes(event));
});
