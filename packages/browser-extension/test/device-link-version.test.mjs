import {test} from 'node:test';import assert from 'node:assert/strict';
import {createDeviceLinkClient} from '../src/device-link-client.mjs';
const origin='https://preview.seamlessscene.com';
function fixture(clientVersion){
 let state={generation:0,active:null,pending:null,revocations:[]};const bodies=[];
 const journal={read:async()=>structuredClone(state),change:async(g,fn)=>{assert.equal(g,state.generation);const next=structuredClone(state),result=fn(next);state=next;return result;}};
 const request=async(op,body)=>{bodies.push({op,body});return {state:'pending',id:'22222222-2222-4222-8222-222222222222',code:'ABCDEF123456',expiresAt:new Date(Date.now()+300000).toISOString(),replacesId:null};};
 return {client:createDeviceLinkClient({journal,config:{fixtureOnly:true,pairingOrigin:origin,deviceLinkLifetimeSeconds:86400},request,cleanup:async()=>{},clientVersion}),bodies};
}
test('device-start carries the build version when one is configured, and never an unparseable one',async()=>{
 const f=fixture('0.46.0');assert.equal((await f.client.start()).state,'pending');
 assert.equal(f.bodies[0].op,'device-start');assert.equal(f.bodies[0].body.clientVersion,'0.46.0');assert.deepEqual(Object.keys(f.bodies[0].body).sort(),['clientVersion','proofHash','replacesId','tokenHash']);
 const bare=fixture();await bare.client.start();assert.ok(!('clientVersion' in bare.bodies[0].body));
 const odd=fixture('v1');await odd.client.start();assert.ok(!('clientVersion' in odd.bodies[0].body));
});
