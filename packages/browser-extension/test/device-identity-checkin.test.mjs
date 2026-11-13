import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceLinkClient, sessionRecheckMs} from '../src/device-link-client.mjs';
const origin = 'https://preview.seamlessscene.com';
const pairingId = '22222222-2222-4222-8222-222222222222', accountId = '11111111-1111-4111-8111-111111111111';
function fixture({linked=true, reply='paired', onSession=async()=>{}}={}) {
  let clock=1800000000000, observation='identified', cleanups=0, reads=0;
  const calls=[], expiresAt=new Date(clock+3600000).toISOString();
  let state={generation:0,active:linked?{state:'paired',origin,token:'a'.repeat(64),accountId,pairingId,expiresAt,displayName:'Synthetic'}:null,pending:null,revocations:[]};
  const journal={read:async()=>structuredClone(state),change:async(g,fn)=>{assert.equal(g,state.generation);const next=structuredClone(state),v=fn(next);state=next;return v;},
    invalidate:async()=>{state={...state,generation:state.generation+1,active:null,revocations:[{active:state.active}]};return structuredClone(state);}};
  const client=createDeviceLinkClient({journal,config:{fixtureOnly:true,pairingOrigin:origin,deviceLinkLifetimeSeconds:86400},now:()=>clock,clientVersion:'0.60.0',
    getPlayerIdentityState:()=>{reads++;if(observation instanceof Error)throw observation;return observation;},cleanup:async()=>{cleanups++;},
    request:async(op,body)=>{calls.push({op,body:structuredClone(body)});if(body.disconnect)return {state:'disconnected'};
      if(op==='device-start')return {state:'pending',id:pairingId,code:'ABCDEF123456',expiresAt:new Date(clock+300000).toISOString(),replacesId:null};
      if(op==='device-exchange')return {state:'paired',id:pairingId,expiresAt,scope:'catalog:read'};
      await onSession(body);
      if(reply==='offline')throw Error('device-network-unavailable');
      return reply==='paired'?{state:'paired',id:pairingId,accountId,displayName:'Synthetic',expiresAt,scope:'catalog:read'}:{state:reply};}});
  return {client,calls,set:v=>{observation=v;},tick:()=>{clock+=sessionRecheckMs;},get reads(){return reads;},get cleanups(){return cleanups;}};
}

test('check-in reads the latest diagnostic only for an already-required session request',async()=>{
  const f=fixture();
  await f.client.credentials();f.set('missing-id');
  for(let i=0;i<10;i++)await f.client.credentials();
  assert.equal(f.calls.length,1);assert.equal(f.reads,1);
  f.tick();await f.client.credentials();
  assert.equal(f.calls[1].body.playerIdentityState,'missing-id');
  f.set('no-player');await f.client.status();
  assert.equal(f.calls[2].body.playerIdentityState,'no-player');
  for(const call of f.calls)assert.deepEqual(Object.keys(call.body).sort(),['clientVersion','disconnect','playerIdentityState']);
});

test('diagnostic failure never authorizes, refuses, or adds retries to a session check',async()=>{
  const f=fixture();f.set(Error('probe failed'));await f.client.credentials();assert.equal(f.calls[0].body.playerIdentityState,'unknown');
  const denied=fixture({reply:'unavailable'});await assert.rejects(denied.client.credentials(),/device-link-unavailable/);assert.equal(denied.cleanups,1);
  const offline=fixture({reply:'offline'});await assert.rejects(offline.client.credentials(),/device-network-unavailable/);assert.equal(offline.calls.length,1);assert.equal(offline.cleanups,0);
  const unlinked=fixture({linked:false});await assert.rejects(unlinked.client.credentials(),/device-link-invalid/);assert.equal(unlinked.calls.length,0);assert.equal(unlinked.reads,0);
});

test('device start/exchange/disconnect bodies remain unchanged; post-exchange check reports the enum',async()=>{
  const f=fixture({linked:false});await f.client.start();f.set('missing-id');await f.client.finish();await f.client.disconnect();
  assert.deepEqual(f.calls.map(x=>x.op),['device-start','device-exchange','session','session']);
  assert.equal('playerIdentityState' in f.calls[0].body,false);
  assert.equal('playerIdentityState' in f.calls[1].body,false);
  assert.equal(f.calls[2].body.playerIdentityState,'missing-id');
  assert.deepEqual(f.calls[3].body,{disconnect:true});
});

test('ownership changing during a check does not mutate the sent body or credential authority',async()=>{
  let release,started,first=true;
  const began=new Promise(resolve=>{started=resolve;}),wait=new Promise(resolve=>{release=resolve;});
  const f=fixture({onSession:async()=>{if(first){first=false;started();await wait;}}});
  const pending=f.client.credentials();await began;f.set('unknown');release();
  assert.equal((await pending).pairingId,pairingId);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.playerIdentityState,'identified');
  await f.client.status();assert.equal(f.calls[1].body.playerIdentityState,'unknown');
});
