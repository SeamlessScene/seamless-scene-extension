import test from 'node:test';
import assert from 'node:assert/strict';
import {startBackground} from '../background-services.mjs';
import {registerDeviceLinkService} from '../src/device-link-service.mjs';
import {EXECUTING_BUILD} from '../src/build-info.mjs';

test('worker composition passes a live viewer-owned diagnostic getter without querying page data',()=>{
  let value='missing-id',options;
  startBackground({chrome:{runtime:{onMessage:{addListener(){}}}},catalogTrustConfig:{},signOutProtected(){},deps:{
    registerLocalPlaybackRelay:()=>({authorizeRenderer:()=>false}),registerCatalogRuntimeService(){},
    registerViewerService:()=>({playerIdentityState:()=>value}),registerViewerWebBridge(){},
    registerDeviceLinkService(_runtime,_config,args){options=args;},registerCreatorBuilderBridge(){},registerViewerSites(){}
  }});
  assert.equal(options.getPlayerIdentityState(),'missing-id');value='no-player';assert.equal(options.getPlayerIdentityState(),'no-player');
});

test('actual device service sends only the current enum on session requests, including legacy migration',async()=>{
  const id='a'.repeat(32),origin='https://preview.seamlessscene.com',url=`chrome-extension://${id}/catalog-account.html`;
  const accountId='11111111-1111-4111-8111-111111111111',pairingId='22222222-2222-4222-8222-222222222222';
  const active={state:'paired',origin,token:'d'.repeat(64),accountId,pairingId,displayName:'Synthetic',expiresAt:new Date(Date.now()+3600000).toISOString()};
  let listener,diagnostic='missing-id',legacy=active,state={generation:0,active:null,pending:null,revocations:[]};const requests=[];
  const priorChrome=globalThis.chrome;
  globalThis.chrome={storage:{session:{get:async()=>({'catalogPairing.v1':legacy}),remove:async()=>{legacy=null;}}}};
  const journal={read:async()=>structuredClone(state),change:async(g,fn)=>{assert.equal(g,state.generation);const next=structuredClone(state),out=fn(next);state=next;return out;},
    invalidate:async()=>{state={...state,generation:state.generation+1,active:null,revocations:[{active:state.active}]};return structuredClone(state);}};
  try {
    registerDeviceLinkService({id,getURL:path=>`chrome-extension://${id}/${path}`,onMessage:{addListener:fn=>{listener=fn;}}},
      {pairingOrigin:origin,deviceLinkLifetimeSeconds:86400}, {journal,locks:{request:async(_name,_options,fn)=>fn()},cleanup:async()=>{},
        getPlayerIdentityState:()=>diagnostic,fetcher:async(requestUrl,init)=>{
          const body=JSON.parse(init.body);requests.push({url:requestUrl,body});
          return Response.json({data:body.disconnect?{state:'disconnected'}:{state:'paired',id:pairingId,accountId,displayName:'Synthetic',expiresAt:active.expiresAt,scope:'catalog:read'}});
        }});
    const sender={id,url,origin:`chrome-extension://${id}`,tab:{id:1,url},frameId:0,documentId:crypto.randomUUID(),documentLifecycle:'active'};
    const call=method=>new Promise(resolve=>listener({kind:'device-link-v1',method,build:EXECUTING_BUILD},sender,resolve));
    assert.equal((await call('status')).ok,true);assert.equal(requests.length,2);
    assert.deepEqual(requests[0].body,{disconnect:false,playerIdentityState:'missing-id'});
    assert.deepEqual(requests[1].body,{disconnect:false,clientVersion:EXECUTING_BUILD.version,playerIdentityState:'missing-id'});
    diagnostic='no-player';assert.equal((await call('status')).ok,true);assert.equal(requests[2].body.playerIdentityState,'no-player');
    assert.equal((await call('disconnect')).ok,true);assert.deepEqual(requests[3].body,{disconnect:true});
    assert.ok(requests.every(r=>r.url===origin+'/api/v1/pairing/session'));
  }finally{globalThis.chrome=priorChrome;}
});
