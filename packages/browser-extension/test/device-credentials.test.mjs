import {test} from 'node:test';import assert from 'node:assert/strict';
import {readProtectedPairingCredentials} from '../src/device-credentials.mjs';
import {EXECUTING_BUILD} from '../src/build-info.mjs';
const config={fixtureOnly:false,pairingOrigin:'https://preview.seamlessscene.com',deviceLinkLifetimeSeconds:2592000};
const value={accountId:'44444444-4444-4444-8444-444444444444',pairingId:'22222222-2222-4222-8222-222222222222',accessToken:'d'.repeat(64),expiresAt:Date.now()+3600000};
const runtime=reply=>({sendMessage:async message=>{assert.deepEqual(Object.keys(message).sort(),['build','kind']);assert.equal(message.kind,'device-credentials-v1');return reply;}});
test('credentials come only from the device-link owner and are frozen',async()=>{
 const v=await readProtectedPairingCredentials(config,{runtime:runtime({ok:true,value,build:EXECUTING_BUILD})});assert.deepEqual(v,value);assert.ok(Object.isFrozen(v));
});
test('each service-worker refusal becomes its own load error',async()=>{
 await assert.rejects(readProtectedPairingCredentials(config,{runtime:runtime(undefined)}),/protected-credentials-no-reply/);
 await assert.rejects(readProtectedPairingCredentials(config,{runtime:runtime({ok:true,value,build:{...EXECUTING_BUILD,version:'0.0.1'}})}),/extension-build-changed/);
 for(const [code,expected] of [['device-sender-denied','protected-renderer-not-authorized'],['device-link-invalid','catalog-protected-pairing-required'],
  ['device-link-unavailable','protected-link-removed'],['device-network-unavailable','protected-link-check-offline'],['device-credentials-unavailable','protected-link-check-interrupted'],
  ['device-response-invalid','protected-link-check-failed'],['device-operation-unavailable','catalog-protected-pairing-required']])
  await assert.rejects(readProtectedPairingCredentials(config,{runtime:runtime({ok:false,code,build:EXECUTING_BUILD})}),new RegExp(expected));
});
test('unconfigured builds, refused replies, foreign builds, extra keys and stale expiry are refused',async()=>{
 await assert.rejects(readProtectedPairingCredentials({...config,deviceLinkLifetimeSeconds:undefined},{runtime:runtime({ok:true,value,build:EXECUTING_BUILD})}),/device-links-unconfigured/);
 for(const reply of [{ok:true,value:{...value,extra:1},build:EXECUTING_BUILD},{ok:true,value:{...value,accessToken:'short'},build:EXECUTING_BUILD},{ok:true,value:{...value,expiresAt:Date.now()-1},build:EXECUTING_BUILD},{ok:true,value:{...value,expiresAt:Date.now()+2592000000+60000},build:EXECUTING_BUILD}])
  await assert.rejects(readProtectedPairingCredentials(config,{runtime:runtime(reply)}),/catalog-protected-pairing-required/);
 await assert.rejects(readProtectedPairingCredentials(config,{runtime:runtime({ok:true,value,build:EXECUTING_BUILD}),signal:AbortSignal.abort()}));
});
