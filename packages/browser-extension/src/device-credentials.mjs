import {deviceLifetime} from './device-link-client.mjs';
import {EXECUTING_BUILD} from './build-info.mjs';
import {sameExecutingBuild} from './build-identity.mjs';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
// Service-worker refusal reasons, mapped to fixed load errors.
const credentialRefusals=Object.freeze({
  'device-sender-denied':'protected-renderer-not-authorized',
  'device-credentials-unavailable':'protected-link-check-interrupted',
  'device-state-changed':'protected-link-check-interrupted','device-generation-changed':'protected-link-check-interrupted','device-session-changed':'protected-link-check-interrupted',
  'device-busy':'protected-link-check-interrupted',
  'device-link-invalid':'catalog-protected-pairing-required',
  'device-link-unavailable':'protected-link-removed',
  'device-network-unavailable':'protected-link-check-offline',
  'device-subject-invalid':'protected-link-check-failed','device-response-invalid':'protected-link-check-failed'
});
/** Privileged module API only: never register this as a page/UI RPC.
 * The private renderer asks the device-link owner for fresh credentials on
 * every authoritative read; the public account and viewer endpoints cannot
 * call the broker, and a stale or malformed reply is refused, never cached. */
export async function readProtectedPairingCredentials(config,{signal,now=()=>Date.now(),runtime=globalThis.chrome?.runtime}={}){
  const lifetime=deviceLifetime(config);if(lifetime===null)throw Error('device-links-unconfigured');
  signal?.throwIfAborted();
  const reply=await runtime.sendMessage({kind:'device-credentials-v1',build:EXECUTING_BUILD});signal?.throwIfAborted();
  const v=reply?.value;
  if(!reply)throw Error('protected-credentials-no-reply');
  // The service worker runs the newest build; this page may be older.
  if(!sameExecutingBuild(reply.build))throw Error('extension-build-changed');
  if(!reply.ok)throw Error(credentialRefusals[reply.code]??'catalog-protected-pairing-required');
  if(!v||Object.keys(v).sort().join(',')!=='accessToken,accountId,expiresAt,pairingId'||!uuid(v.accountId)||!uuid(v.pairingId)||!/^[a-f0-9]{64}$/.test(v.accessToken)||!Number.isFinite(v.expiresAt)||v.expiresAt<=now()||v.expiresAt>now()+lifetime)throw Error('catalog-protected-pairing-required');
  return Object.freeze(v);
}
