import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync,sign } from 'node:crypto';
import { fixtureManifest } from '../src/fixture-signed-manifest.mjs';
import { canonicalizeManifest,validateManifestSchema,verifySignedManifest } from '../src/manifest-security.mjs';
import { validateLocalEditPacket } from '../src/local-edit-packet.mjs';
import { validateCatalogPacket,verifyCatalogPacket,compileVerifiedCatalogActions,CATALOG_MIN_CLIENT_VERSION } from '../src/catalog-packet.mjs';
import { loadCatalogPacket } from '../src/catalog-file-import.mjs';
import { validateMeasuredAsset } from '../src/local-asset-validator.mjs';
import { localPlaybackTimeoutMs } from '../src/asset-duration-policy.mjs';

const identity=n=>`50000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const capabilities={clientVersion:CATALOG_MIN_CLIENT_VERSION,packetSchemas:['2.0.0'],mediaProfiles:['catalog-av-v2']};
function keys(){const pair=generateKeyPairSync('ed25519');return {...pair,trusted:{'catalog-isolated-test':{status:'active',publicKey:Buffer.from(pair.publicKey.export({format:'jwk'}).x,'base64url').toString('base64')}}};}
function signed(packet,key){packet.manifest.signature.value=sign(null,Buffer.from(canonicalizeManifest(packet.manifest)),key.privateKey).toString('base64');packet.signature.value=sign(null,Buffer.from(canonicalizeManifest(packet)),key.privateKey).toString('base64');return packet;}
function fixture(key,{duration=120000,media=true}={}){
  const manifest=structuredClone(fixtureManifest);manifest.schema_version='2.0.0';manifest.edit_id=identity(4);
  manifest.segments=manifest.segments.filter(segment=>segment.action===(media?'INSERT':'SKIP'));
  if(media)Object.assign(manifest.segments[0].asset,{expected_duration_ms:duration,width:624,height:480});
  const signature={algorithm:'Ed25519',key_id:'catalog-isolated-test',value:Buffer.alloc(64).toString('base64')};manifest.signature={...signature};
  return signed({packet_schema_version:'2.0.0',packet_id:identity(1),purpose:'catalog-distribution',creative_edit_id:identity(2),source_variant_id:identity(3),
    media_profile:'catalog-av-v2',required_client_version:CATALOG_MIN_CLIENT_VERSION,manifest,
    asset_bindings:media?[{sha256:manifest.segments[0].asset.sha256,relative_path:'clips/one.mp4',bytes:3}]:[],signature:{...signature}},key);
}
function observed(packet){const s=packet.manifest.source;return {serviceId:s.service,activeItemId:s.service_content_id,runtimeMs:s.expected_runtime_ms,season:s.season,episode:s.episode,mediaType:s.season===null?'movie':'episode',versionTag:s.version_tag,territory:s.territory,plan:s.service_tier};}
test('explicit v2 signatures accept source-sized 60/90/120-second clips while legacy verifiers reject them',async()=>{
  const key=keys();
  for(const duration of [60000,90000,120000]){
    const packet=fixture(key,{duration});assert.equal(validateCatalogPacket(packet).ok,true);
    assert.equal((await verifyCatalogPacket(packet,key.trusted,{capabilities})).ok,true);
    assert.equal(validateManifestSchema(packet.manifest).ok,false);assert.equal((await verifySignedManifest(packet.manifest,key.trusted)).ok,false);
    assert.equal(validateLocalEditPacket(packet).ok,false);
    assert.equal(localPlaybackTimeoutMs(duration,'catalog-v2'),Math.max(65000,duration+13000));
  }
  for(const properties of [{expected_duration_ms:120001},{expected_duration_ms:4999},{width:623},{height:2162},{width:318},{video_codec:'vp9'},{audio_codec:'opus'},{dynamic_range:'hdr'}]){
    const packet=fixture(key);Object.assign(packet.manifest.segments[0].asset,properties);signed(packet,key);assert.equal(validateCatalogPacket(packet).ok,false);
  }
  const special=fixture(key);special.manifest.source.season=0;special.manifest.source.episode=0;signed(special,key);assert.equal((await verifyCatalogPacket(special,key.trusted,{capabilities})).ok,true);
});
test('the envelope binds names, sizes and release identity and refuses revoked keys or missing client capabilities',async()=>{
  const key=keys(),packet=fixture(key);
  for(const mutate of [p=>p.asset_bindings[0].relative_path='clips/changed.mp4',p=>p.asset_bindings[0].bytes++,p=>p.creative_edit_id=identity(9),p=>p.manifest.segments[0].trigger_time_ms++]){
    const changed=structuredClone(packet);mutate(changed);assert.equal((await verifyCatalogPacket(changed,key.trusted,{capabilities})).ok,false);
  }
  for(const caps of [undefined,{...capabilities,clientVersion:'0.41.0'},{...capabilities,packetSchemas:['1.0.0']},{...capabilities,mediaProfiles:['local-user']}]){
    assert.equal((await verifyCatalogPacket(packet,key.trusted,{capabilities:caps})).code,'client-update-required');
  }
  key.trusted['catalog-isolated-test'].status='revoked';assert.equal((await verifyCatalogPacket(packet,key.trusted,{capabilities})).code,'signing-key-revoked');
});
test('catalog bindings reject unsafe paths, duplicate hashes, omitted assets and inconsistent declarations',()=>{
  const key=keys();
  for(const path of ['../one.mp4','clips/CON.mp4','clips./one.mp4','https://example.com/a.mp4','C:/a.mp4','clips\\one.mp4']){
    const packet=fixture(key);packet.asset_bindings[0].relative_path=path;assert.equal(validateCatalogPacket(packet).ok,false);
  }
  const missing=fixture(key);missing.asset_bindings=[];assert.equal(validateCatalogPacket(missing).ok,false);
  const duplicate=fixture(key);duplicate.asset_bindings.push({...duplicate.asset_bindings[0]});assert.equal(validateCatalogPacket(duplicate).ok,false);
  const inconsistent=fixture(key);const other=structuredClone(inconsistent.manifest.segments[0]);other.segment_id='other';other.trigger_time_ms=other.resume_time_ms=18000;other.asset.width=626;inconsistent.manifest.segments.push(other);assert.equal(validateCatalogPacket(inconsistent).code,'asset-declaration-conflict');
  const sameAnchor=fixture(key);sameAnchor.manifest.segments.push({...sameAnchor.manifest.segments[0],segment_id:'second'});assert.equal(validateCatalogPacket(sameAnchor).ok,false);
});
test('only verified immutable packets compile; source/version/revocation checks precede local action execution',async()=>{
  const key=keys(),packet=fixture(key),verification=await verifyCatalogPacket(packet,key.trusted,{capabilities});
  const options={observedSource:observed(packet),adapterVersion:'0.42.0',resolveAssetUrl:hash=>`asset:${hash}`};
  const actions=await compileVerifiedCatalogActions(verification,options);assert.equal(actions[0].profileClass,'catalog-v2');assert.equal(actions[0].expectedDurationMs,120000);
  packet.manifest.segments[0].asset.expected_duration_ms=5000;assert.equal((await compileVerifiedCatalogActions(verification,options))[0].expectedDurationMs,120000);
  await assert.rejects(compileVerifiedCatalogActions({ok:true},options),/verification-required/);
  for(const delta of [{serviceId:'another-service'},{activeItemId:'another-episode'},{runtimeMs:30000},{territory:'CA'},{versionTag:'different-cut'},{plan:'ad-supported'},{season:9}]){
    await assert.rejects(compileVerifiedCatalogActions(verification,{...options,observedSource:{...options.observedSource,...delta}}),/catalog-source-/);
  }
  await assert.rejects(compileVerifiedCatalogActions(verification,{...options,currentManifest:{...packet.manifest,manifest_version:3}}),/downgrade-rejected/);
  await assert.rejects(compileVerifiedCatalogActions(verification,{...options,revokedVersions:[2]}),/manifest-version-revoked/);
  key.trusted['catalog-isolated-test'].status='revoked';await assert.rejects(compileVerifiedCatalogActions(verification,options),/trust-changed/);
});
test('catalog measured-duration tolerance cannot extend the 120-second limit',()=>{
  const expected={sha256:'a'.repeat(64),durationMs:120000,width:624,height:480,container:'mp4',videoCodec:'h264',audioCodec:'aac',dynamicRange:'sdr'};
  const measured={mediaType:'video/mp4',durationMs:120000,width:624,height:480,initialSampleDecoded:true,audioPresent:true,container:'mp4',videoCodec:'h264',audioCodec:'aac',dynamicRange:'sdr'};
  assert.equal(validateMeasuredAsset(measured,expected,expected.sha256,{profileClass:'catalog-v2'}).ok,true);
  assert.equal(validateMeasuredAsset({...measured,durationMs:120001},expected,expected.sha256,{profileClass:'catalog-v2'}).ok,false);
  assert.equal(validateMeasuredAsset({...measured,audioPresent:false},expected,expected.sha256,{profileClass:'catalog-v2'}).ok,false);
});
test('explicit file import allows metadata-only edits and validates exact local media bindings without uploads',async()=>{
  const key=keys(),metadata=packet=>new File([JSON.stringify(packet)],'edit-packet.json',{type:'application/json'});
  const skip=fixture(key,{media:false});assert.equal((await loadCatalogPacket([metadata(skip)],key.trusted,{capabilities})).files.size,0);
  const packet=fixture(key);packet.asset_bindings[0].relative_path='one.mp4';signed(packet,key);
  const file=new File(['abc'],'one.mp4',{type:'video/mp4'});let checks=0;
  const options={capabilities,validateAsset:async(actual,expected,context)=>{checks++;assert.equal(actual,file);assert.equal(expected.durationMs,120000);assert.equal(context.profileClass,'catalog-v2');return {ok:true};}};
  const loaded=await loadCatalogPacket([metadata(packet),file],key.trusted,options);assert.equal(checks,1);assert.equal(loaded.files.size,1);
  await assert.rejects(loadCatalogPacket([metadata(packet),new File(['abcd'],'one.mp4')],key.trusted,options),/bound-file-mismatch/);
  await assert.rejects(loadCatalogPacket([metadata(packet),file,new File(['x'],'extra.mp4')],key.trusted,options),/extra-or-missing/);
  await assert.rejects(loadCatalogPacket([new File([new Uint8Array([255])],'edit-packet.json')],key.trusted,options),/encoding-invalid/);
  assert.equal(checks,1);
  // Finder and Explorer litter folders; those files are skipped rather than counted as extras.
  const junk=[new File(['x'],'.DS_Store'),new File(['x'],'._one.mp4'),new File(['x'],'Thumbs.db')];
  assert.equal((await loadCatalogPacket([metadata(packet),file,...junk],key.trusted,options)).files.size,1);
  // A case-only difference (Windows authors, camera .MP4) still binds; the digest check pins the bytes.
  const upper=new File(['abc'],'ONE.MP4',{type:'video/mp4'});
  assert.equal((await loadCatalogPacket([metadata(packet),upper],key.trusted,{capabilities,validateAsset:async actual=>{assert.equal(actual,upper);return {ok:true};}})).files.size,1);
  const controller=new AbortController();controller.abort();await assert.rejects(loadCatalogPacket([metadata(skip)],key.trusted,{capabilities,signal:controller.signal}));
});

test('E60: each checked clip is reported, and the validator gets this packet\'s identity as its cache context', async () => {
  const key = keys(), metadata = packet => new File([JSON.stringify(packet)], 'edit-packet.json', { type: 'application/json' });
  const packet = fixture(key); packet.asset_bindings[0].relative_path = 'one.mp4'; signed(packet, key);
  const file = new File(['abc'], 'one.mp4', { type: 'video/mp4' }), progress = [], contexts = [];
  await loadCatalogPacket([metadata(packet), file], key.trusted, { capabilities, onAssetChecked: (done, total) => progress.push([done, total]),
    validateAsset: async (actual, expected, options) => { contexts.push(options.context); return { ok: true }; } });
  assert.deepEqual(progress, [[1, 1]]);
  const [context] = contexts;
  assert.equal(context.releaseId, packet.packet_id); assert.equal(context.manifestVersion, packet.manifest.manifest_version);
  assert.match(context.manifestSha256, /^[a-f0-9]{64}$/); assert.match(context.assetSetSha256, /^[a-f0-9]{64}$/);
  // A throwing observer changes nothing.
  assert.equal((await loadCatalogPacket([metadata(packet), file], key.trusted, { capabilities, onAssetChecked: () => { throw Error('x'); }, validateAsset: async () => ({ ok: true }) })).files.size, 1);
});
