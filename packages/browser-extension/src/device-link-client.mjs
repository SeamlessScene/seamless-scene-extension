import { sessionCheckIn } from './player-identity-observation.mjs';
const hex=v=>[...v].map(x=>x.toString(16).padStart(2,'0')).join('');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function deviceLifetime(config) {
 if(config.deviceLinkLifetimeSeconds===undefined)return null;
 if(![86400,2592000].includes(config.deviceLinkLifetimeSeconds))throw Error('device-policy-invalid');
 // Fixture (test-player) builds keep one-day links. Their pairing origin is the release-managed
 // config's, like any build; it is not pinned to one host, so a site move needs no code change.
 if(config.fixtureOnly===true&&config.deviceLinkLifetimeSeconds!==86400)throw Error('device-policy-invalid');
 if(new URL(config.pairingOrigin).protocol!=='https:')throw Error('device-policy-invalid');return config.deviceLinkLifetimeSeconds*1000;
}
/** E95 (0.66.1): the latest a new approval code may expire. The website issues 5-minute codes today and
 * may move to 30 minutes; a code further ahead than this is refused as invalid. */
export const PENDING_CODE_MAX_MS=1800000;
/** How long a successful website link check is reused by credentials(). */
export const sessionRecheckMs=60000;
export function createDeviceLinkClient({journal,config,request,cleanup,now=()=>Date.now(),cryptoApi=crypto,clientVersion=null,getPlayerIdentityState}) {
 let epoch=0,poisoned=false,checked={token:null,epoch:-1,at:0};
 // Session checks report this build's version, so the website can show which build each linked device runs.
 const checkIn=()=>sessionCheckIn({clientVersion,getPlayerIdentityState});
 const read=async()=>{if(poisoned)throw Error('device-local-cleanup-required');const localEpoch=epoch,value=await journal.read();if(poisoned||localEpoch!==epoch)throw Error('device-generation-changed');return {...value,epoch:localEpoch};};
 const change=(state,fn)=>journal.change(state.generation,v=>{if(state.epoch!==epoch||poisoned)throw Error('device-generation-changed');return fn(v);});
 const max=deviceLifetime(config);if(!max)throw Error('device-links-unconfigured');const origin=config.pairingOrigin;
 // A link recorded under an earlier pairing origin of the same website (see catalog-trust-config.mjs).
 const legacy=new Set(config.legacyPairingOrigins??[]);legacy.delete(origin);
 const fresh=(expiry,limit=max)=>typeof expiry==='string'&&Number.isFinite(Date.parse(expiry))&&Date.parse(expiry)>now()&&Date.parse(expiry)<=now()+limit;
 const random=()=>hex(cryptoApi.getRandomValues(new Uint8Array(32)));
 const digest=async v=>hex(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(v))));
 function validActive(a){if(!a||(a.origin!==origin&&!legacy.has(a.origin))||a.state!=='paired'||!/^[a-f0-9]{64}$/.test(a.token)||!uuid(a.accountId)||!uuid(a.pairingId)||!fresh(a.expiresAt))throw Error('device-link-invalid');return a;}
 function publicActive(a){validActive(a);return {state:'paired',displayName:a.displayName,expiresAt:a.expiresAt,remembered:true};}
 // Recheck the fixed deadline after transport and inside the journal transaction.
 // Natural device expiry retires online authority, not the separate playback lease.
 async function sessionResult(s,r){
  return change(s,v=>{
   if(JSON.stringify(v.active)!==JSON.stringify(s.active))throw Error('device-session-changed');
   if(!fresh(s.active.expiresAt)){v.active=null;return 'expired';}
   if(r.state!=='paired'){v.active=null;return 'unavailable';}
   if(r.id!==s.active.pairingId||r.accountId!==s.active.accountId||r.expiresAt!==s.active.expiresAt||r.scope!=='catalog:read')throw Error('device-subject-invalid');
   if(v.active.origin!==origin)v.active={...v.active,origin}; // The website confirmed it: record the current origin.
   return 'paired';
  });
 }
 const pendingPublic=p=>({state:'pending',code:p.code??null,expiresAt:p.expiresAt??null,approvalUrl:origin+'/account/device-links'+(p.code?'?code='+encodeURIComponent(p.code):''),replacing:Boolean(p.replacesId)});
 async function saveResult(s,result){
  if(!exact(result,['state','id','expiresAt','scope'])||result.state!=='paired'||!uuid(result.id)||result.scope!=='catalog:read'||!fresh(result.expiresAt))throw Error('device-response-invalid');
  const p=s.pending;const a=await request('session',checkIn(),p.token);
  if(a.state!=='paired'||a.id!==result.id||a.expiresAt!==result.expiresAt||a.scope!=='catalog:read'||!uuid(a.accountId)||typeof a.displayName!=='string'||a.displayName.length>160||(s.active&&s.active.accountId!==a.accountId))throw Error('device-subject-invalid');
  const next={state:'paired',origin,token:p.token,pairingId:a.id,accountId:a.accountId,expiresAt:a.expiresAt,displayName:a.displayName};
  await change(s,v=>{if(JSON.stringify(v.pending)!==JSON.stringify(p))throw Error('device-pending-changed');validActive(next);v.active=next;v.pending=null;});
  return publicActive(next);
 }
 async function pendingResult(s,operation){
  const p=s.pending;if(!p?.id)return pendingPublic(p);
  const r=await request(operation,{id:p.id,proof:p.proof},p.token);
  if(r.state==='paired')return saveResult(s,r);
  if(exact(r,['state'])&&r.state==='pending')return pendingPublic(p);
  if(exact(r,['state'])&&r.state==='limit')return {state:'limit'};
  if(exact(r,['state'])&&['unavailable','cancelled'].includes(r.state)){await change(s,v=>{if(JSON.stringify(v.pending)!==JSON.stringify(p))throw Error('device-pending-changed');v.pending=null;});return {state:r.state};}
  throw Error('device-response-invalid');
 }
 return Object.freeze({
  async credentials(){
   let s=await read();if(s.pending?.id){await pendingResult(s,'device-recover');s=await read();}
   const a=validActive(s.active);
   // Every catalog call needs credentials; recheck the link with the website at most once a minute,
   // not per call, so ordinary viewing stays far below the website's per-network pairing limit.
   if(!(checked.token===a.token&&checked.epoch===s.epoch&&now()-checked.at<sessionRecheckMs)){
    const r=await request('session',checkIn(),a.token);
    const state=await sessionResult(s,r);
    if(state==='expired')throw Error('device-link-invalid');
    if(state==='unavailable'){await cleanup();throw Error('device-link-unavailable');}
    checked={token:a.token,epoch:s.epoch,at:now()};
   }
   validActive(a); // Also refuse a deadline crossed while the journal commit awaited.
   return {accountId:a.accountId,pairingId:a.pairingId,accessToken:a.token,expiresAt:Date.parse(a.expiresAt)};
  },
  async start({replace=false}={}){
   let s=await read();if(s.revocations.length)throw Error('device-revocation-pending');
   if(!s.pending){if(replace)validActive(s.active);else if(s.active&&fresh(s.active.expiresAt))return publicActive(s.active);
    const p={token:random(),proof:random(),replacesId:replace?s.active.pairingId:null};
    await change(s,v=>{if(v.pending)throw Error('device-pending-changed');v.pending=p;});s=await read();
   }
   const p=s.pending;if(p.id)return pendingPublic(p);
   // The website shows the build version on the approval page and keeps it with the link; it is informational, never an authority.
   const body={proofHash:await digest(p.proof),tokenHash:await digest(p.token),replacesId:p.replacesId,...(typeof clientVersion==='string'&&/^\d+\.\d+\.\d+(\.\d+)?$/.test(clientVersion)?{clientVersion}:{})};
   const r=await request('device-start',body,p.replacesId?validActive(s.active).token:null);
   if(!exact(r,['state','id','code','expiresAt','replacesId'])||r.state!=='pending'||!uuid(r.id)||!/^[A-F0-9]{12}$/.test(r.code)||!fresh(r.expiresAt,PENDING_CODE_MAX_MS)||r.replacesId!==p.replacesId)throw Error('device-response-invalid');
   await change(s,v=>{if(JSON.stringify(v.pending)!==JSON.stringify(p))throw Error('device-pending-changed');v.pending={...p,id:r.id,code:r.code,expiresAt:r.expiresAt};});
   return pendingPublic({...p,...r});
  },
  async finish(){const s=await read();if(!s.pending?.id)throw Error('device-pending-required');return pendingResult(s,'device-exchange');},
  async status(){const s=await read();if(s.pending?.id)return pendingResult(s,'device-recover');if(s.pending)return pendingPublic(s.pending);if(!s.active)return {state:s.revocations.length?'revocation-pending':'unpaired'};
   if(!fresh(s.active.expiresAt)){await sessionResult(s,{state:'unavailable'});return {state:'expired'};}
   validActive(s.active);const r=await request('session',checkIn(),s.active.token);
   const state=await sessionResult(s,r);
   if(state==='expired')return {state:'expired'};
   if(state==='unavailable'){await cleanup();return {state:'unavailable'};}
   return publicActive(s.active);
  },
  async cancel(){const s=await read();if(!s.pending)return {state:'unpaired'};if(!s.pending.id){await change(s,v=>{v.pending=null;});return {state:'cancelled'};}return pendingResult(s,'device-cancel');},
  async disconnect(){
   epoch++;poisoned=true;let s=null,localError=null,remoteError=false;
   try{s=await journal.invalidate();}catch(e){localError=e;}
   try{await cleanup();}catch(e){localError=e;}
   if(!s)throw Error('catalog-protected-signout-incomplete');
   for(const entry of s.revocations){try{
     if(entry.active){const r=await request('session',{disconnect:true},entry.active.token);if(!exact(r,['state'])||!['disconnected','unavailable'].includes(r.state))throw Error('device-revocation-invalid');}
     if(entry.pending?.id){const p=entry.pending,r=await request('device-cancel',{id:p.id,proof:p.proof},p.token);if(r.state==='paired'){const revoked=await request('session',{disconnect:true},p.token);if(!exact(revoked,['state'])||!['disconnected','unavailable'].includes(revoked.state))throw Error('device-revocation-invalid');}else if(!['cancelled','unavailable'].includes(r.state))throw Error('device-revocation-invalid');}
     await journal.change(s.generation,v=>{const key=JSON.stringify(entry);v.revocations=v.revocations.filter(x=>JSON.stringify(x)!==key);});
    }catch{remoteError=true;}}
   if(localError)throw Error('catalog-protected-signout-incomplete');
   poisoned=false;return {state:remoteError?'revocation-pending':'disconnected'};
  }
 });
}
