import { registerDeviceLinkService } from '../../../../browser-extension/src/device-link-service.mjs';
import { EXECUTING_BUILD } from '../../../../browser-extension/src/build-info.mjs';
import { subscribePrivateSignOut } from '../../browser-signout-channel.mjs';
import { signOutProtected } from '../../browser-signout.mjs';
/** Account sign-out through the durable device-link owner: journal invalidation and protected cleanup first, remote revocation after. */
export function accountSignout(cleanup, { storageFailure = false, diskFailure = false, fault = null, owner = true, remoteFailure = false } = {}) {
  const id='a'.repeat(32),url=`chrome-extension://${id}/catalog-account.html`,listeners=[],events=[];
  let owned=owner!==false,record={state:'paired',origin:'https://catalog.example',token:'a'.repeat(64),expiresAt:new Date(Date.now()+1790000).toISOString()};
  let state={version:1,generation:0,active:{state:'paired',origin:'https://catalog.example',token:'a'.repeat(64),accountId:'44444444-4444-4444-8444-444444444444',pairingId:'22222222-2222-4222-8222-222222222222',displayName:'Synthetic',expiresAt:new Date(Date.now()+3600000).toISOString()},pending:null,revocations:[]};
  const journal={read:async()=>structuredClone(state),change:async(g,fn)=>{if(g!==state.generation)throw Error('generation');const next=structuredClone(state),r=fn(next);state=next;return structuredClone(r);},invalidate:async()=>{state.generation++;state.revocations.push({active:state.active});state.active=null;state.pending=null;return structuredClone(state);}};
  const worker={id,url:`chrome-extension://${id}/background.mjs`};
  const ui={id,url,origin:`chrome-extension://${id}`,tab:{id:1,url},frameId:0,documentId:crypto.randomUUID(),documentLifecycle:'active'};
  const runtime={id,getURL:p=>`chrome-extension://${id}/${p}`,onMessage:{addListener:f=>listeners.push(f),removeListener:f=>{const i=listeners.indexOf(f);if(i>=0)listeners.splice(i,1);}},sendMessage:message=>new Promise((resolve,reject)=>{
    if(owner==='disappearing'){owned=false;reject(Error('owner-disappeared'));return;}
    let accepted=false;for(const listener of [...listeners])accepted=listener(message,worker,resolve)===true||accepted;
    if(!accepted)reject(Error('no-private-receiver'));
  })};
  subscribePrivateSignOut(runtime,async()=>{try{events.push('owner-start');await cleanup();events.push('owner-complete');}finally{owned=false;}});
  globalThis.chrome={storage:{session:{get:async()=>({}),remove:async()=>{events.push('pairing-clear-attempt');if(fault==='pairing')throw Error('pairing-remove');record=null;events.push('pairing-cleared');}}}};
  const options={chromeApi:{runtime,storage:{local:{set:async()=>{events.push('marker');if(fault==='marker')throw Error('marker');}}}},
    createCache:()=>({clear:async()=>{events.push('cache-clear');if(storageFailure||fault==='cache')throw Error('storage');},close(){}}),
    createInstallation:()=>({clear:async()=>{events.push('keys-clear');if(fault==='keys')throw Error('keys');},close(){}}),clearAccount:async()=>{events.push('subject-clear');if(fault==='subject')throw Error('subject');},
    navigatorApi:{locks:{request:async(n,o,fn)=>fn(owned?null:{name:n})},storage:{getDirectory:async()=>({removeEntry:async()=>{events.push('disk-clear');if(diskFailure||fault==='disk')throw Error('disk');}})}}};
  registerDeviceLinkService(runtime,{fixtureOnly:false,pairingOrigin:'https://catalog.example',deviceLinkLifetimeSeconds:2592000},{journal,locks:{request:async(n,o,fn)=>fn()},
    cleanup:()=>signOutProtected(options),fetcher:async()=>{events.push('remote-disconnect');if(remoteFailure)throw Error('remote');return Response.json({data:{state:'disconnected'}});}});
  const disconnect=()=>new Promise(resolve=>{for(const listener of [...listeners])listener({kind:'device-link-v1',method:'disconnect',build:EXECUTING_BUILD},ui,resolve);});
  return {disconnect,events,runtime,worker,get record(){return record;},get state(){return state;}};
}
