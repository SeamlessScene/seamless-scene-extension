import {test} from 'node:test';import assert from 'node:assert/strict';
import {createDeviceLinkClient} from '../src/device-link-client.mjs';
const origin='https://preview.seamlessscene.com',accountId='11111111-1111-4111-8111-111111111111',pairingId='22222222-2222-4222-8222-222222222222';
function fixture({remaining=1000,cross=false,unavailable=false,afterCommit=false,replace=false}={}){
 let clock=1800000000000,cleaned=0;const expiry=clock+remaining;
 let state={generation:0,active:{state:'paired',origin,token:'a'.repeat(64),accountId,pairingId,expiresAt:new Date(expiry).toISOString(),displayName:'Synthetic'},pending:null,revocations:[]};const original=structuredClone(state.active);
 const journal={read:async()=>structuredClone(state),change:async(g,fn)=>{assert.equal(g,state.generation);const next=structuredClone(state),result=fn(next);state=next;if(afterCommit)clock=expiry;return result;},invalidate:async()=>{state.generation++;state.revocations.push({active:state.active});state.active=null;return structuredClone(state);}};
 const client=createDeviceLinkClient({journal,config:{fixtureOnly:true,pairingOrigin:origin,deviceLinkLifetimeSeconds:86400},now:()=>clock,cleanup:async()=>{cleaned++;},request:async(op,body)=>{if(body.disconnect)return {state:'disconnected'};if(cross)clock=expiry;if(replace)state.active={...original,pairingId:accountId,token:'b'.repeat(64),expiresAt:new Date(expiry+86400000).toISOString()};return unavailable?{state:'unavailable'}:{state:'paired',id:original.pairingId,accountId:original.accountId,expiresAt:original.expiresAt,scope:'catalog:read'};}});
 return {client,get cleaned(){return cleaned;},get state(){return state;},advance(){clock=expiry;}};
}
for(const operation of ['status','credentials']){
 test(`${operation}: natural expiry before request preserves playback cleanup boundary`,async()=>{const f=fixture({remaining:0});if(operation==='status')assert.equal((await f.client.status()).state,'expired');else await assert.rejects(f.client.credentials(),/link-invalid/);assert.equal(f.cleaned,0);});
 for(const unavailable of [true,false])test(`${operation}: ${unavailable?'unavailable':'paired'} reply arriving at exact expiry cannot clear playback or return credentials`,async()=>{const f=fixture({cross:true,unavailable});if(operation==='status')assert.equal((await f.client.status()).state,'expired');else await assert.rejects(f.client.credentials(),/link-invalid/);assert.equal(f.cleaned,0);assert.equal(f.state.active,null);});
 test(`${operation}: unavailable before expiry still clears protected state`,async()=>{const f=fixture({unavailable:true});if(operation==='status')assert.equal((await f.client.status()).state,'unavailable');else await assert.rejects(f.client.credentials(),/link-unavailable/);assert.equal(f.cleaned,1);assert.equal(f.state.active,null);});
 test(`${operation}: old response cannot clear a newer authorized session`,async()=>{const f=fixture({cross:true,unavailable:true,replace:true});await assert.rejects(f.client[operation](),/session-changed/);assert.equal(f.state.active.pairingId,accountId);assert.equal(f.cleaned,0);});
 test(`${operation}: expiry during journal completion cannot deliver paired authority`,async()=>{const f=fixture({afterCommit:true});await assert.rejects(f.client[operation](),/link-invalid/);assert.equal(f.cleaned,0);});
}
test('explicit disconnect after natural deadline still performs protected signout cleanup',async()=>{const f=fixture();f.advance();assert.equal((await f.client.disconnect()).state,'disconnected');assert.equal(f.cleaned,1);assert.equal(f.state.active,null);});
test('delayed approval subject response cannot commit an expired new device credential',async()=>{
 let clock=1800000000000;const expiry=clock+1000,old={state:'paired',origin,token:'a'.repeat(64),accountId,pairingId,displayName:'Old',expiresAt:new Date(clock+86400000).toISOString()},pending={id:'33333333-3333-4333-8333-333333333333',token:'b'.repeat(64),proof:'c'.repeat(64)};
 let state={generation:0,active:old,pending,revocations:[]},cleaned=0;
 const journal={read:async()=>structuredClone(state),change:async(g,fn)=>{assert.equal(g,0);const next=structuredClone(state),result=fn(next);state=next;return result;}};
 const client=createDeviceLinkClient({journal,config:{fixtureOnly:true,pairingOrigin:origin,deviceLinkLifetimeSeconds:86400},now:()=>clock,cleanup:async()=>cleaned++,request:async op=>{if(op==='session')clock=expiry;return {state:'paired',id:pending.id,expiresAt:new Date(expiry).toISOString(),scope:'catalog:read',...(op==='session'?{accountId,displayName:'Synthetic'}:{})};}});
 await assert.rejects(client.finish(),/link-invalid/);assert.deepEqual(state.active,old);assert.deepEqual(state.pending,pending);assert.equal(cleaned,0);
});
