import test from 'node:test';
import assert from 'node:assert/strict';
import {registerViewerService} from '../src/viewer-service.mjs';
import {connectViewerController} from '../src/viewer-client.mjs';
import {EXECUTING_BUILD} from '../src/build-info.mjs';
import {PLAYER_IDENTITY_FRESH_MS,PLAYER_IDENTITY_HEARTBEAT_MS} from '../src/player-identity-observation.mjs';
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},emit(...args){for(const fn of this.listeners)fn(...args);}});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

function serviceFixture() {
  const id='a'.repeat(32),runtime={id,onConnect:event(),onMessage:event(),getURL:path=>`chrome-extension://${id}/${path}`};
  const service=registerViewerService(runtime,{}, {store:{read:async()=>({preferences:{autoArm:false},library:[],selections:{}})},deviceJournal:{},tabs:{},action:null});
  const ports=[];
  function connect(tabId=1,origin='https://www.amazon.com') {
    const url=origin+'/gp/video/detail/B0FB12A176';
    const port={name:'viewer-controller-v1',sender:{id,url,origin,tab:{id:tabId,url},frameId:0,documentId:crypto.randomUUID(),documentLifecycle:'active'},onMessage:event(),onDisconnect:event(),
      disconnect(){this.onDisconnect.emit();},postMessage(message){if(message.id)queueMicrotask(()=>this.onMessage.emit({id:message.id,ok:true,value:{state:'unavailable'},build:EXECUTING_BUILD}));}};
    runtime.onConnect.emit(port);port.onMessage.emit({hello:true,build:EXECUTING_BUILD});ports.push(port);return port;
  }
  const status=(port,value,build=EXECUTING_BUILD)=>port.onMessage.emit({status:{state:'idle',identityObservation:value},build});
  return {service,connect,status,close(){for(const p of ports)p.disconnect();}};
}

test('viewer check-in uses only a fresh uniquely owned supported controller',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1800000000000});
  const f=serviceFixture();try{
    assert.equal(f.service.playerIdentityState(),'unknown');
    const p=f.connect();assert.equal(f.service.playerIdentityState(),'unknown');
    for(const state of ['identified','missing-id','no-player','unknown']){
      f.status(p,{state,observedAt:Date.now()});assert.equal(f.service.playerIdentityState(),state);
    }
    f.status(p,{state:'identified',observedAt:Date.now()});
    t.mock.timers.tick(PLAYER_IDENTITY_FRESH_MS-1);assert.equal(f.service.playerIdentityState(),'identified');
    t.mock.timers.tick(1);assert.equal(f.service.playerIdentityState(),'unknown');
    f.status(p,{state:'identified',observedAt:Date.now()});
    const second=f.connect(2);f.status(second,{state:'identified',observedAt:Date.now()});
    assert.equal(f.service.playerIdentityState(),'unknown');
    f.status(second,{state:'no-player',observedAt:Date.now()});assert.equal(f.service.playerIdentityState(),'identified');
    f.status(p,{state:'no-player',observedAt:Date.now()});assert.equal(f.service.playerIdentityState(),'no-player');
    f.status(p,{state:'identified',observedAt:Date.now()});
    second.disconnect();assert.equal(f.service.playerIdentityState(),'identified');
    p.disconnect();assert.equal(f.service.playerIdentityState(),'unknown');
  }finally{f.close();await flush();}
});

test('replacement, inactive senders, malformed status, and stale ports cannot preserve identified',async()=>{
  const f=serviceFixture();try{
    const old=f.connect();f.status(old,{state:'identified',observedAt:Date.now()});
    const current=f.connect();assert.equal(f.service.playerIdentityState(),'unknown');
    f.status(old,{state:'identified',observedAt:Date.now()});assert.equal(f.service.playerIdentityState(),'unknown');
    f.status(current,{state:'missing-id',observedAt:Date.now()});assert.equal(f.service.playerIdentityState(),'missing-id');
    f.status(current,{state:'identified',observedAt:Date.now()},null);assert.equal(f.service.playerIdentityState(),'missing-id');
    f.status(current,{state:'identified',observedAt:Date.now(),title:'must not be retained'});assert.equal(f.service.playerIdentityState(),'unknown');
    f.status(current,{state:'identified',observedAt:Date.now()});
    current.sender.documentLifecycle='cached';assert.equal(f.service.playerIdentityState(),'unknown');
    current.disconnect();
    const loopback=f.connect(3,'http://127.0.0.1:8080');f.status(loopback,{state:'identified',observedAt:Date.now()});
    assert.equal(f.service.playerIdentityState(),'unknown','local fixtures are not a supported streaming observation');
  }finally{f.close();await flush();}
});

test('controller refreshes coarse freshness on its existing timer without resending unchanged status every tick',async t=>{
  t.mock.timers.enable({apis:['Date','setInterval','setTimeout'],now:1800000000000});
  const sent=[],port={onMessage:event(),onDisconnect:event(),postMessage:m=>sent.push(m),disconnect(){this.onDisconnect.emit();}};
  let state='identified',observationAge=0;
  const controller=connectViewerController({runtime:{connect:()=>port},read:async()=>({state:'idle',identityObservation:{state,observedAt:Date.now()-observationAge}}),execute:async()=>{}});
  try{
    t.mock.timers.tick(500);await flush();
    const statuses=()=>sent.filter(x=>x.status);
    assert.equal(statuses().length,1);assert.equal(statuses()[0].status.identityObservation.state,'identified');
    t.mock.timers.tick(500);await flush();assert.equal(statuses().length,1);
    t.mock.timers.tick(PLAYER_IDENTITY_HEARTBEAT_MS);await flush();assert.equal(statuses().length,2);
    assert.equal(statuses()[1].status.identityObservation.observedAt,Date.now());
    state='missing-id';t.mock.timers.tick(500);await flush();assert.equal(statuses().length,3);
    observationAge=PLAYER_IDENTITY_FRESH_MS;t.mock.timers.tick(500);await flush();
    assert.equal(statuses().length,4);assert.equal('identityObservation' in statuses()[3].status,false);
    controller.close();t.mock.timers.tick(PLAYER_IDENTITY_HEARTBEAT_MS);await flush();assert.equal(statuses().length,4);
  }finally{controller.close();}
});

test('a closed or replaced controller cannot publish an awaited observation',async t=>{
  t.mock.timers.enable({apis:['Date','setInterval','setTimeout'],now:1800000000000});
  const sent=[],ports=[];let release;
  const runtime={connect(){const p={onMessage:event(),onDisconnect:event(),postMessage:m=>sent.push(m),disconnect(){this.onDisconnect.emit();}};ports.push(p);return p;}};
  const pending=new Promise(resolve=>{release=resolve;});
  const controller=connectViewerController({runtime,read:()=>pending,execute:async()=>{}});
  t.mock.timers.tick(500);await flush();controller.close();
  release({state:'idle',identityObservation:{state:'identified',observedAt:Date.now()}});await flush();
  assert.equal(sent.some(x=>x.status),false);
});
