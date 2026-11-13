import {verifyCatalogPacket,CATALOG_PACKET_MAX_BYTES} from './catalog-packet.mjs';
import {canonicalizeManifest} from './manifest-security.mjs';
import {assertActive} from './operation-context.mjs';
export const CATALOG_CONTROL_TIMEOUT_MS=4000;
export const CATALOG_CONTROL_POLL_MS=30000;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function catalogControlOrigin(value,{fixtureOnly=false}={}){
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||value.length>2048)throw Error('catalog-control-origin-invalid');
 let url;try{url=new URL(value);}catch{throw Error('catalog-control-origin-invalid');}
 const loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!([url.origin,url.origin+'/'].includes(value))||
  (url.protocol!=='https:'&&!(fixtureOnly&&loopback&&url.protocol==='http:'))||(!fixtureOnly&&(loopback||url.hostname.endsWith('.localhost'))))throw Error('catalog-control-origin-invalid');
 return url.origin;
}
async function fetchControl(origin,editId,fetcher,signal){
 const combined=AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(CATALOG_CONTROL_TIMEOUT_MS)]);
 let response;
 try{response=await fetcher(`${origin}/api/v1/playback/${editId}/disable`,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error',signal:combined});}
 catch{assertActive(signal);return {status:'unavailable'};}
 if(response.status===204)return {status:'absent'};
 if(response.status!==200){await response.body?.cancel().catch(()=>{});return {status:'unavailable'};}
 const reader=response.body?.getReader();if(!reader)throw Error('catalog-control-invalid');
 let size=0;const chunks=[];
 try{
  if(Number(response.headers.get('content-length'))>CATALOG_PACKET_MAX_BYTES)throw Error('catalog-control-too-large');
  for(;;){assertActive(combined);const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>CATALOG_PACKET_MAX_BYTES)throw Error('catalog-control-too-large');chunks.push(value);}
 }catch(error){await reader.cancel().catch(()=>{});assertActive(signal);if(combined.aborted)return {status:'unavailable'};throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return {status:'received',packet:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};}catch{throw Error('catalog-control-invalid');}
}
function matches(packet,entry){return packet.creative_edit_id===entry.creativeEditId&&packet.source_variant_id===entry.sourceVariantId&&canonicalizeManifest(packet.manifest.source)===canonicalizeManifest(entry.manifest.source);}
/** Runs only in the extension worker, from release configuration and verified stored identity. */
export async function refreshCatalogControl({editId,store,policy,origin,fixtureOnly=false,fetcher=globalThis.fetch,signal,assertAuthority=()=>{}}){
 if(typeof editId!=='string'||!uuid.test(editId))throw Error('catalog-edit-id-invalid');
 const check=()=>{assertActive(signal);assertAuthority();};check();
 const endpoint=catalogControlOrigin(origin,{fixtureOnly});if(!endpoint)return {status:'unconfigured'};
 const cached=await store.read(editId,policy);check();if(!cached)throw Error('catalog-control-import-required');
 if(cached.current.manifest.source.service!==policy.service)throw Error('catalog-wrong-service');
 const result=await fetchControl(endpoint,editId,fetcher,signal);check();if(result.status!=='received')return result;
 const packet=result.packet;
 if(packet?.manifest?.edit_id!==editId||packet?.manifest?.feature_flags?.emergency_disable!==true||!Array.isArray(packet.asset_bindings)||packet.asset_bindings.length!==0)throw Error('catalog-control-invalid');
 if(!(await verifyCatalogPacket(packet,policy.trustedKeys,{capabilities:policy.capabilities})).ok)throw Error('catalog-control-signature-invalid');check();
 if(!matches(packet,cached.current))throw Error('catalog-control-identity-conflict');
 if(packet.manifest.manifest_version<cached.current.manifest.manifest_version)return {status:'stale'};
 try{return await store.accept(packet,{...policy,signal,assertAuthority});}
 catch(error){
  // Another verified writer may have advanced the floor during fetch/verification.
  check();if(error?.message==='downgrade-rejected'){const latest=await store.read(editId,policy);check();if(latest&&matches(packet,latest.current)&&latest.current.manifest.manifest_version>packet.manifest.manifest_version)return {status:'stale'};}
  throw error;
 }
}
/** One owned request at a time. Timers are scheduling, not a delivery deadline. */
export function startCatalogControlPolling({current,refresh,signal,onError=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
 let timer=null,stopped=false;const controller=new AbortController();const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 async function tick(){if(stopped||combined.aborted)return;try{const id=current();if(id)await refresh(id,{signal:combined});}catch(error){if(!combined.aborted)onError(error);}finally{if(!stopped&&!combined.aborted)timer=setTimer(tick,CATALOG_CONTROL_POLL_MS);}}
 const stop=()=>{stopped=true;controller.abort();if(timer!==null)clearTimer(timer);signal?.removeEventListener('abort',stop);};
 if(signal?.aborted)stop();else{signal?.addEventListener('abort',stop,{once:true});timer=setTimer(tick,CATALOG_CONTROL_POLL_MS);}
 return stop;
}
