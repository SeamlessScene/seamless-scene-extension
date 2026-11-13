import { canonicalizeManifest,validateManifestSchema,verifyCatalogManifest,verifyEd25519Document,evaluateAdapterCompatibility,evaluateManifestVersion } from './manifest-security.mjs';
import { evaluateSourceCompatibility } from './source-identity.mjs';
import { RULES, requiredClientFor } from './seamless-rules.mjs';

export const CATALOG_PACKET_SCHEMA=RULES.catalog.packet_schema;
export const CATALOG_MEDIA_PROFILE=RULES.catalog.media_profile;
export const CATALOG_MIN_CLIENT_VERSION=RULES.catalog.min_client;
// 0.65.0 (W9): the first client that accepts catalog clips under 5 s (rules relaxation clip-under-5000).
export const CATALOG_SHORT_CLIP_MIN_CLIENT_VERSION=RULES.relaxations.find(r=>r.profile==='catalog-v2'&&r.id==='clip-under-5000').requires_client;
export const CATALOG_PACKET_MAX_BYTES=2_000_000;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const id=/^[a-z0-9][a-z0-9._-]{0,127}$/;
const verifiedPackets=new WeakMap();
const failure=(code,errors=[])=>Object.freeze({ok:false,code,errors:Object.freeze(errors)});
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function version(value){return typeof value==='string'&&value.length<=32&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)&&value.split('.').every(part=>Number.isSafeInteger(Number(part)))?value.split('.').map(Number):null;}
function atLeast(actual,minimum){const a=version(actual),b=version(minimum);if(!a||!b)return false;for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return true;}
export function isSafeCatalogMediaPath(value){
  return typeof value==='string'&&value.length<=256&&/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*\.mp4$/.test(value)&&
    !/(^|\/)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|\/|$)/i.test(value)&&!(/\.(\/|$)/).test(value);
}
// The envelope alone (size, exact keys, schema/profile, identities and a well-formed
// required_client_version): enough to decide whether this client may read the rest (0.65.0, A2).
function validateCatalogEnvelope(packet){
  try{if(new TextEncoder().encode(JSON.stringify(packet)).length>CATALOG_PACKET_MAX_BYTES)return failure('packet-too-large');}catch{return failure('packet-invalid');}
  if(!exact(packet,['packet_schema_version','packet_id','purpose','creative_edit_id','source_variant_id','media_profile','required_client_version','manifest','asset_bindings','signature']))return failure('packet-invalid');
  if(packet.packet_schema_version!==CATALOG_PACKET_SCHEMA||packet.purpose!=='catalog-distribution'||packet.media_profile!==CATALOG_MEDIA_PROFILE)return failure('packet-schema-unsupported');
  if(![packet.packet_id,packet.creative_edit_id,packet.source_variant_id].every(value=>typeof value==='string'&&uuid.test(value))||!atLeast(packet.required_client_version,CATALOG_MIN_CLIENT_VERSION))return failure('packet-identity-invalid');
  return null;
}
export function validateCatalogPacket(packet){
  const envelope=validateCatalogEnvelope(packet);if(envelope)return envelope;
  const schema=validateManifestSchema(packet.manifest,{profileClass:'catalog-v2'});
  if(!schema.ok)return failure('manifest-invalid',schema.errors);
  // 0.65.0 (W9): a packet using a relaxation (a clip under 5 s) must ask for a client that accepts it,
  // or 0.42–0.64 clients would refuse it as a broken manifest instead of asking for an update.
  if(!atLeast(packet.required_client_version,requiredClientFor(packet.manifest,'catalog-v2')))return failure('packet-client-version-too-low');
  if(!uuid.test(packet.manifest.edit_id))return failure('playback-identity-invalid');
  const signature=packet.signature;
  if(!exact(signature,['algorithm','key_id','value'])||signature.algorithm!=='Ed25519'||typeof signature.key_id!=='string'||!id.test(signature.key_id)||typeof signature.value!=='string'||!(/^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/).test(signature.value))return failure('packet-signature-invalid');
  if(!Array.isArray(packet.asset_bindings)||packet.asset_bindings.length>200)return failure('packet-bindings-invalid');
  const required=new Map();
  for(const segment of packet.manifest.segments){
    if(!segment.asset)continue;
    const previous=required.get(segment.asset.sha256);
    if(previous&&canonicalizeManifest(previous)!==canonicalizeManifest(segment.asset))return failure('asset-declaration-conflict');
    required.set(segment.asset.sha256,segment.asset);
  }
  const hashes=new Set(),paths=new Set();let bytes=0;
  for(const binding of packet.asset_bindings){
    if(!exact(binding,['sha256','relative_path','bytes'])||!hash.test(binding.sha256)||!isSafeCatalogMediaPath(binding.relative_path)||
      !Number.isSafeInteger(binding.bytes)||binding.bytes<1||binding.bytes>250_000_000)return failure('packet-binding-invalid');
    if(hashes.has(binding.sha256)||paths.has(binding.relative_path.toLowerCase())||!required.has(binding.sha256))return failure('packet-binding-conflict');
    hashes.add(binding.sha256);paths.add(binding.relative_path.toLowerCase());bytes+=binding.bytes;
  }
  if(bytes>2_000_000_000||hashes.size!==required.size)return failure('packet-bindings-incomplete');
  return Object.freeze({ok:true,code:'schema-valid',errors:Object.freeze([])});
}
export function catalogCapabilityDecision(packet,capabilities){
  return atLeast(capabilities?.clientVersion,packet.required_client_version)&&Array.isArray(capabilities.packetSchemas)&&capabilities.packetSchemas.includes(CATALOG_PACKET_SCHEMA)&&
    Array.isArray(capabilities.mediaProfiles)&&capabilities.mediaProfiles.includes(CATALOG_MEDIA_PROFILE)?{ok:true,code:'supported'}:{ok:false,code:'client-update-required'};
}
export async function verifyCatalogPacket(packet,trustedKeys,{capabilities,cryptoApi=globalThis.crypto}={}){
  let snapshot;try{snapshot=structuredClone(packet);}catch{return failure('packet-invalid');}
  // 0.65.0 (A2): the client-version gate runs on the envelope, before the manifest, so a packet
  // made for a newer client gives "update the extension", never "manifest invalid".
  const shape=validateCatalogEnvelope(snapshot);if(shape)return shape;
  const capability=catalogCapabilityDecision(snapshot,capabilities);
  if(!capability.ok)return Object.freeze({ok:false,code:capability.code,errors:Object.freeze([]),requiredClientVersion:snapshot.required_client_version});
  const schema=validateCatalogPacket(snapshot);if(!schema.ok)return schema;
  const envelope=await verifyEd25519Document(snapshot,trustedKeys,cryptoApi);if(!envelope.ok)return failure(envelope.code);
  const manifest=await verifyCatalogManifest(snapshot.manifest,trustedKeys,cryptoApi);if(!manifest.ok)return failure(manifest.code,manifest.errors);
  const result=Object.freeze({ok:true,code:'verified',errors:Object.freeze([])});
  // The verified snapshot is inaccessible to caller mutation; a JSON object
  // claiming ok:true cannot be used as an action-compilation authorization.
  verifiedPackets.set(result,{packet:snapshot,trustedKeys,cryptoApi});return result;
}
export async function compileVerifiedCatalogActions(verification,{observedSource,adapterVersion,currentManifest=null,revokedVersions=[],resolveAssetUrl=()=>null}={}){
  const verified=verifiedPackets.get(verification);if(!verified)throw new Error('catalog-verification-required');
  const {packet,trustedKeys,cryptoApi}=verified,manifest=packet.manifest;
  if(!(await verifyEd25519Document(packet,trustedKeys,cryptoApi)).ok||!(await verifyCatalogManifest(manifest,trustedKeys,cryptoApi)).ok)throw new Error('catalog-trust-changed');
  if(manifest.feature_flags.emergency_disable)throw new Error('catalog-playback-disabled');
  const decision=evaluateManifestVersion(manifest,currentManifest,{revokedVersions});if(!decision.ok)throw new Error(decision.code);
  if(!evaluateAdapterCompatibility(adapterVersion,manifest.compatibility).ok)throw new Error('catalog-adapter-incompatible');
  const source=manifest.source,match=evaluateSourceCompatibility(observedSource,{serviceId:source.service,serviceContentId:source.service_content_id,
    runtimeMs:source.expected_runtime_ms,runtimeToleranceMs:source.runtime_tolerance_ms,season:source.season,episode:source.episode,
    mediaType:source.season===null?'movie':'episode',versionTag:source.version_tag,territory:source.territory,plan:source.service_tier});
  if(match.status!=='compatible')throw new Error(`catalog-source-${match.reason}`);
  return Object.freeze(manifest.segments.map(segment=>{
    const clipUrl=segment.asset?resolveAssetUrl(segment.asset.sha256,segment.segment_id):null;
    if(segment.asset&&(typeof clipUrl!=='string'||!clipUrl))throw new Error('catalog-local-asset-unresolved');
    return Object.freeze({id:segment.segment_id,type:segment.action,triggerMs:segment.trigger_time_ms,resumeMs:segment.resume_time_ms,clipUrl,
      ...(segment.asset?{expectedDurationMs:segment.asset.expected_duration_ms,profileClass:'catalog-v2'}:{}),gainDb:segment.transition.gain_db??0});
  }));
}
