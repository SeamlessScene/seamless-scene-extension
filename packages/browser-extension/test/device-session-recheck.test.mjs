import {test} from 'node:test';import assert from 'node:assert/strict';
import {createDeviceLinkClient,sessionRecheckMs} from '../src/device-link-client.mjs';
const origin='https://preview.seamlessscene.com',accountId='11111111-1111-4111-8111-111111111111',pairingId='22222222-2222-4222-8222-222222222222';
function fixture({reply='paired',clientVersion=null}={}){
 let clock=1800000000000,sessions=0,cleaned=0;const bodies=[];const expiresAt=new Date(clock+3600000).toISOString();
 let state={generation:0,active:{state:'paired',origin,token:'a'.repeat(64),accountId,pairingId,expiresAt,displayName:'Synthetic'},pending:null,revocations:[]};
 const journal={read:async()=>structuredClone(state),change:async(g,fn)=>{assert.equal(g,state.generation);const next=structuredClone(state),result=fn(next);state=next;return result;}};
 const client=createDeviceLinkClient({journal,config:{fixtureOnly:true,pairingOrigin:origin,deviceLinkLifetimeSeconds:86400},now:()=>clock,clientVersion,cleanup:async()=>{cleaned++;},
  request:async(op,body)=>{assert.equal(op,'session');sessions++;bodies.push(body);return reply==='paired'?{state:'paired',id:pairingId,accountId,expiresAt,scope:'catalog:read'}:{state:reply};}});
 return {client,bodies,tick(ms){clock+=ms;},get sessions(){return sessions;},get cleaned(){return cleaned;}};
}
test('credentials reuse a successful link check for a minute instead of asking the website on every call',async()=>{
 const f=fixture();
 for(let i=0;i<10;i++){const c=await f.client.credentials();assert.equal(c.pairingId,pairingId);f.tick(5000);}
 assert.equal(f.sessions,1);
 f.tick(sessionRecheckMs);await f.client.credentials();assert.equal(f.sessions,2);
});
test('an unavailable link is never cached',async()=>{
 const f=fixture({reply:'unavailable'});
 await assert.rejects(f.client.credentials(),/device-link-unavailable/);
 await assert.rejects(f.client.credentials(),/device-link-invalid/);
 assert.equal(f.sessions,1);assert.equal(f.cleaned,1);
});
test('session checks report the build version to the website, and omit a malformed one',async()=>{
 const f=fixture({clientVersion:'0.59.2'});await f.client.credentials();assert.deepEqual(f.bodies,[{disconnect:false,clientVersion:'0.59.2'}]);
 const g=fixture({clientVersion:'dev-build'});await g.client.credentials();assert.deepEqual(g.bodies,[{disconnect:false}]);
});
