import {test} from 'node:test';import assert from 'node:assert/strict';
import {createDeviceLinkClient} from '../src/device-link-client.mjs';
import {catalogTrustConfig} from '../catalog-trust-config.mjs';
// A link made by 0.65.x recorded the preview origin; the build that moved to the root must keep it working.
const root='https://seamlessscene.com',preview='https://preview.seamlessscene.com',other='https://other.example';
const accountId='11111111-1111-4111-8111-111111111111',pairingId='22222222-2222-4222-8222-222222222222';
function fixture(storedOrigin,legacyPairingOrigins=[preview]){
 const clock=1800000000000,expiresAt=new Date(clock+3600000).toISOString(),ops=[];
 let state={generation:0,active:{state:'paired',origin:storedOrigin,token:'a'.repeat(64),accountId,pairingId,expiresAt,displayName:'Synthetic'},pending:null,revocations:[]};
 const journal={read:async()=>structuredClone(state),change:async(g,fn)=>{assert.equal(g,state.generation);const next=structuredClone(state),result=fn(next);state=next;return result;}};
 const client=createDeviceLinkClient({journal,config:{pairingOrigin:root,legacyPairingOrigins,deviceLinkLifetimeSeconds:2592000},now:()=>clock,cleanup:async()=>{},
  cryptoApi:crypto,request:async(op,body)=>{ops.push(op);
   if(op==='session')return {state:'paired',id:pairingId,accountId,expiresAt,scope:'catalog:read'};
   if(op==='device-start')return {state:'pending',id:'33333333-3333-4333-8333-333333333333',code:'ABCDEF123456',expiresAt:new Date(clock+60000).toISOString(),replacesId:body.replacesId};
   throw Error('unexpected '+op);}});
 return {client,ops,get active(){return state.active;}};
}
test('the release config names the preview origin as a legacy pairing origin',()=>{
 assert.equal(catalogTrustConfig.pairingOrigin,root);
 assert.deepEqual([...catalogTrustConfig.legacyPairingOrigins],[preview]);
});
test('a preview-origin link keeps working after the move and is rewritten to the root',async()=>{
 const f=fixture(preview);
 assert.equal((await f.client.status()).state,'paired');
 assert.equal(f.active.origin,root);
 const c=await f.client.credentials();assert.equal(c.pairingId,pairingId);
});
test('credentials work on a preview-origin link',async()=>{
 const f=fixture(preview);
 assert.equal((await f.client.credentials()).accountId,accountId);assert.equal(f.active.origin,root);
});
test('renewing a preview-origin link starts a replacement',async()=>{
 const f=fixture(preview);
 const r=await f.client.start({replace:true});
 assert.equal(r.state,'pending');assert.equal(r.replacing,true);assert.match(r.approvalUrl,/^https:\/\/seamlessscene\.com\/account\/device-links\?code=/);
 assert.deepEqual(f.ops,['device-start']);
});
test('a link from any other origin is still refused before any request',async()=>{
 const f=fixture(other);
 await assert.rejects(f.client.status(),/device-link-invalid/);
 await assert.rejects(f.client.credentials(),/device-link-invalid/);
 assert.deepEqual(f.ops,[]);
 const g=fixture(preview,[]);
 await assert.rejects(g.client.status(),/device-link-invalid/);
});
