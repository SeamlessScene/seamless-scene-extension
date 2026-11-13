import { shouldPrefetchNext, viewerFailureCode } from './viewer-model.mjs';
import {EXECUTING_BUILD} from './build-info.mjs';
import {failureCause} from './viewer-load-error.mjs';
export {failureCause};
import {sameExecutingBuild} from './build-identity.mjs';
import {freshPlayerIdentityObservation,PLAYER_IDENTITY_HEARTBEAT_MS} from './player-identity-observation.mjs';
// Controller failures a viewer can act on keep their code; everything else is viewer-action-failed,
// except a failed scene jump, which says so. The raw cause goes to diagnostics only.
const PASSED_CODES=['viewer-scene-unavailable','viewer-not-armed','viewer-not-ready','viewer-controller-busy','viewer-source-changed'];
// One command runs at a time. A command that arrives while another runs (an automatic recheck,
// a jump from the other menu) waits this long for it instead of failing at once.
const BUSY_WAIT_MS=4000;
export function controllerFailureCode(method,error){
 const message=error?.message;
 // Any viewer code with its own sentence passes through (a source check names its mismatch).
 if(PASSED_CODES.includes(message)||(typeof message==='string'&&message.startsWith('viewer-')&&viewerFailureCode(message)===message))return message;
 return method==='jump-scene'?'viewer-jump-failed':method==='arm'?'viewer-arm-failed':'viewer-action-failed';
}
export async function viewerRequest(method,args={}) {
 const r=await chrome.runtime.sendMessage({kind:'viewer-v1',method,args,build:EXECUTING_BUILD});
 if(!r?.ok||!sameExecutingBuild(r.build))throw Error(r?.code??'viewer-unavailable');return r.value;
}
export function connectViewerController({runtime=chrome.runtime,read,execute,onPreferences=()=>{},signal}) {
 let statusKey=null,lastIdentityHeartbeat=0;let port=null,closed=false,busy=false,running=Promise.resolve(),retry=null,reading=null;
 const snapshot=()=>reading??(reading=Promise.resolve().then(read).finally(()=>{reading=null;}));
 function connect(){
  if(closed||signal?.aborted)return;
  let current;try{current=runtime.connect({name:'viewer-controller-v1'});port=current;}catch{return;}
  current.onMessage.addListener(message=>{
   if(port!==current||!sameExecutingBuild(message?.build))return;
   if(message.method==='preferences'){onPreferences(message.value);return;}
   if(!['read','arm','stop','recheck','authoring','preview-seek','timing-report','connection-report','restart','jump-scene'].includes(message.method)||typeof message.id!=='string')return;
   void (async()=>{if(closed)throw Error('viewer-controller-closed');if(message.method==='read')return snapshot();
    if(busy){let timer;await Promise.race([running,new Promise(r=>{timer=setTimeout(r,BUSY_WAIT_MS);})]);clearTimeout(timer);}
    if(busy)throw Error('viewer-controller-busy');busy=true;
    try{const work=Promise.resolve().then(()=>execute(message.method,message.args));running=work.then(()=>{},()=>{});return await work;}finally{busy=false;}})()
    .then(value=>{if(!closed&&port===current)current.postMessage({id:message.id,ok:true,value,build:EXECUTING_BUILD});},error=>{if(!closed&&port===current)current.postMessage({id:message.id,ok:false,code:controllerFailureCode(message.method,error),cause:failureCause(error),build:EXECUTING_BUILD});});
  });
  current.onDisconnect.addListener(()=>{if(port!==current)return;port=null;if(!closed)retry=setTimeout(connect,1000);});
  statusKey=null;current.postMessage({hello:true,build:EXECUTING_BUILD});
 }
 const statusTimer=setInterval(()=>{if(!port||closed)return;const current=port;void snapshot().then(s=>{const nearEnd=shouldPrefetchNext(s),editId=typeof s.editId==='string'&&/^[a-f0-9-]{36}$/.test(s.editId)?s.editId:null;const identityObservation=freshPlayerIdentityObservation(s.identityObservation),now=Date.now();const version=editId&&typeof s.version==='string'&&/^\d{1,64}$/.test(s.version)?s.version:null;const key=JSON.stringify([s.state,s.canArm,s.canStop,s.sourceKey??null,editId,version,nearEnd,identityObservation?.state??null]);if((key!==statusKey||(identityObservation&&now-lastIdentityHeartbeat>=PLAYER_IDENTITY_HEARTBEAT_MS))&&current===port&&!closed){statusKey=key;lastIdentityHeartbeat=now;current.postMessage({status:{state:s.state,...(typeof s.sourceKey==='string'?{sourceKey:s.sourceKey}:{}),...(editId?{editId}:{}),...(version?{version}:{}),nearEnd,...(identityObservation?{identityObservation}:{})},build:EXECUTING_BUILD});}}).catch(()=>{});},500);
 const close=()=>{closed=true;clearInterval(statusTimer);clearTimeout(retry);const prior=port;port=null;prior?.disconnect();};signal?.addEventListener('abort',close,{once:true});connect();return {close};
}
