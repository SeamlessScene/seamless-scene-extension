import {EXECUTING_BUILD} from './build-info.mjs';
import {sameExecutingBuild} from './build-identity.mjs';
import {runtimeDocument} from './runtime-document.mjs';
import {createDeviceJournal} from './device-link-store.mjs';
import {createDeviceLinkClient,deviceLifetime} from './device-link-client.mjs';
import {sessionCheckIn} from './player-identity-observation.mjs';
// Fixed reasons a private credential read may report, so the player can say
// what failed (not linked, removed, offline, changed mid-read) instead of one
// generic "link required".
const credentialCodes = new Set(['device-link-invalid', 'device-link-unavailable', 'device-network-unavailable', 'device-busy',
  'device-state-changed', 'device-generation-changed', 'device-session-changed', 'device-subject-invalid', 'device-response-invalid']);
export function registerDeviceLinkService(runtime,config,{journal=createDeviceJournal(),fetcher=fetch,locks=navigator.locks,cleanup,authorizeRenderer=()=>false,getPlayerIdentityState}={}) {
 let pending=0,deliveryEpoch=0;
 const runtimeStorageClear=()=>chrome.storage.session.remove('catalogPairing.v1');
 const request=async(operation,body,token)=>{
  const url=config.pairingOrigin+'/api/v1/pairing/'+operation;
  const r=await fetcher(url,{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json',Origin:`chrome-extension://${runtime.id}`,...(token?{Authorization:'Bearer '+token}:{})},credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(8000)});
  if(r.status!==200||r.redirected){await r.body?.cancel();throw Error('device-network-unavailable');}
  const reader=r.body.getReader();let size=0;const parts=[];try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192)throw Error('device-response-too-large');parts.push(value);}}finally{await reader.cancel();reader.releaseLock();}
  const bytes=new Uint8Array(size);let pos=0;for(const p of parts){bytes.set(p,pos);pos+=p.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)).data;
 };
 const client=deviceLifetime(config)?createDeviceLinkClient({journal,config,request,clientVersion:EXECUTING_BUILD.version,getPlayerIdentityState,cleanup:async()=>{
  const outcomes=await Promise.allSettled([Promise.resolve().then(runtimeStorageClear),Promise.resolve().then(cleanup)]);
  if(outcomes.some(r=>r.status==='rejected'))throw Error('catalog-protected-signout-incomplete');
 }}):null;
 runtime.onMessage.addListener((m,sender,respond)=>{
  if(!['device-link-v1','device-credentials-v1'].includes(m?.kind))return;
  const privateRead=m.kind==='device-credentials-v1';
  const d=runtimeDocument(sender,runtime.id),allowed=d?.frameId===0&&sender.url===runtime.getURL('catalog-account.html')&&sender.tab.url===sender.url;
  const reply=(ok,value)=>respond({ok,...(ok?{value}:{code:value}),build:EXECUTING_BUILD});
  if(!sameExecutingBuild(m.build)||(privateRead?(!authorizeRenderer(sender)||Object.keys(m).sort().join(',')!=='build,kind'):(!allowed||Object.keys(m).sort().join(',')!=='build,kind,method'||!['start','renew','finish','status','cancel','disconnect'].includes(m.method)))){reply(false,'device-sender-denied');return;}
  if(!deviceLifetime(config)){reply(true,{state:'unconfigured'});return;}
  if(pending>=8&&m.method!=='disconnect'){reply(false,'device-busy');return;}pending++;
  if(m.method==='disconnect')deliveryEpoch++;const requestEpoch=deliveryEpoch;

  // Disconnect does not queue behind remote work; generation fencing invalidates it immediately.
  const run=async()=>{
   if(m.method!=='disconnect'){
    const state=await journal.read();
    if(!state.active&&!state.pending&&!state.revocations.length){
     const old=(await chrome.storage.session.get('catalogPairing.v1'))['catalogPairing.v1'];
     if(old?.state==='paired'&&(old.origin===config.pairingOrigin||(config.legacyPairingOrigins??[]).includes(old.origin))&&Date.parse(old.expiresAt)>Date.now()){
      const current=await request('session',sessionCheckIn({getPlayerIdentityState}),old.token);
      if(current.state==='paired'&&current.expiresAt===old.expiresAt&&current.id===old.pairingId&&current.accountId===old.accountId){
       await journal.change(state.generation,v=>{if(v.active||v.pending)throw Error('device-state-changed');v.active={...old,displayName:current.displayName};});await runtimeStorageClear();
      }
     }
    }
   }
   if(privateRead){const credentials=await client.credentials();if(!authorizeRenderer(sender))throw Error('device-credentials-unavailable');return credentials;}
   return m.method==='renew'?client.start({replace:true}):client[m.method]();
  };
  const task=m.method==='disconnect'?run():locks.request('catalogPairing.v1',{mode:'exclusive'},run);
  void task.then(v=>{if((m.method!=='disconnect'&&requestEpoch!==deliveryEpoch)||(privateRead&&(!authorizeRenderer(sender)||!Number.isFinite(v.expiresAt)||v.expiresAt<=Date.now())))reply(false,privateRead?'device-credentials-unavailable':'device-operation-interrupted');else reply(true,v);},e=>reply(false,e.message==='catalog-protected-signout-incomplete'||(privateRead&&credentialCodes.has(e.message))?e.message:'device-operation-unavailable')).finally(()=>pending--);return true;
 });
}
