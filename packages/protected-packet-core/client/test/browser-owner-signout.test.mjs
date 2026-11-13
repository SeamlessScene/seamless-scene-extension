import {test} from 'node:test';import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {directory} from './support/node-directory.mjs';import {createProtectedBrowserOwner} from '../browser-owner.mjs';
test('renderer disposal joins active private signout before releasing owner storage',async t=>{
 const path=await mkdtemp(join(tmpdir(),'owner-signout-'));t.after(()=>rm(path,{recursive:true,force:true}));let subscribed,restored,unlocked=false;
 const chromeApi={runtime:{id:'a'.repeat(32)},storage:{session:{get:async()=>({})},onChanged:{addListener(){},removeListener(){}}}};
 const root=directory(path);const owner=await createProtectedBrowserOwner({chromeApi,indexedDB:new IDBFactory(),locationApi:{protocol:'chrome-extension:',hostname:chromeApi.runtime.id,pathname:'/local-playback-frame.html'},
 navigatorApi:{locks:{request:async(n,o,fn)=>{try{return await fn({});}finally{unlocked=true;}}},storage:{getDirectory:async()=>root}},
 pairingConfig:{fixtureOnly:true,pairingOrigin:'https://catalog.example'},issuer:'https://license.invalid',descriptorTrust:new Map([['test',{}]]),licenseTrust:new Map([['test',{}]]),account:'50000000-0000-4000-8000-000000000001',
 catalogOptions:{activationStore:{accept(){},compile(){}},readPolicy:async()=>({}),expectedService:"fixture"},executor:{cancel:()=>new Promise(r=>restored=r)},readSource:()=>({}),refreshControl:async()=>{},subscribeSignOut:cb=>{subscribed=cb;return()=>{};},external:true});
 const signingOut=subscribed();const rejection=assert.doesNotReject(signingOut);
 while(!restored)await new Promise(r=>setImmediate(r));assert.equal(unlocked,false);restored();
 await Promise.all([rejection,owner.close()]);assert.equal(unlocked,true);
});
