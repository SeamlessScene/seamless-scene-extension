import {test} from 'node:test';import assert from 'node:assert/strict';
import {createDeviceLinkClient,PENDING_CODE_MAX_MS} from '../src/device-link-client.mjs';
// E95 (0.66.1): the website may issue approval codes that last 30 minutes. Codes of 5 minutes
// (today's) and of 30 minutes are accepted; one further ahead is still refused.
const origin='https://seamlessscene.com';
function fixture(lifetimeMs,now=Date.now()){
 let state={generation:0,active:null,pending:null,revocations:[]};
 const journal={read:async()=>structuredClone(state),change:async(g,fn)=>{assert.equal(g,state.generation);const next=structuredClone(state),result=fn(next);state=next;return result;}};
 const request=async op=>{assert.equal(op,'device-start');return {state:'pending',id:'22222222-2222-4222-8222-222222222222',code:'ABCDEF123456',expiresAt:new Date(now+lifetimeMs).toISOString(),replacesId:null};};
 return createDeviceLinkClient({journal,config:{pairingOrigin:origin,deviceLinkLifetimeSeconds:2592000},request,cleanup:async()=>{},now:()=>now});
}
test('E95: 5- and 30-minute approval codes are accepted, longer ones refused',async()=>{
 assert.equal(PENDING_CODE_MAX_MS,1800000);
 for(const ms of [300000,600000,1800000]){const r=await fixture(ms).start();assert.equal(r.state,'pending',`${ms} ms`);assert.equal(r.code,'ABCDEF123456');}
 await assert.rejects(fixture(1800001).start(),/device-response-invalid/);
 await assert.rejects(fixture(0).start(),/device-response-invalid/,'an expired code is still refused');
});
