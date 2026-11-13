import { verifyCatalogPacket,CATALOG_PACKET_MAX_BYTES } from './catalog-packet.mjs';
import { validateLocalAsset } from './local-asset-validator.mjs';
import { assertActive } from './operation-context.mjs';
import { withoutSystemFiles } from './system-files.mjs';

/** Only call from an extension-owned, explicitly initiated local file picker.
 * No file bytes, paths or object URLs are posted to a streaming page here. */
// E60: onAssetChecked(done,total) reports each checked clip (status only; a throwing observer
// never affects the import). validateAsset also receives this packet's identity as `context`
// (release, manifest version, manifest sha256, asset-set sha256), so a caller's result cache can
// key on exactly what was verified; the packet signature is still verified above on every load.
const sha256Text=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof text==='string'?new TextEncoder().encode(text):text))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function loadCatalogPacket(selectedFiles,trustedKeys,{capabilities,expectedService,signal,validateAsset=validateLocalAsset,onAssetChecked}={}){
  const files=Array.isArray(selectedFiles)?withoutSystemFiles(selectedFiles):selectedFiles;
  if(!Array.isArray(files)||files.length<1||files.length>201)throw new Error('catalog-file-count-invalid');
  const byName=new Map();let total=0;
  for(const file of files){
    assertActive(signal);
    if(!Number.isSafeInteger(file.size)||file.size<1||file.size>250_000_000)throw new Error('catalog-file-size-invalid');
    const name=file.webkitRelativePath||file.name;
    if(typeof name!=='string'||name.length>512||name.includes('\\')||name.startsWith('/')||name.split('/').some(part=>!part||part==='.'||part==='..')||byName.has(name.toLowerCase()))throw new Error('catalog-file-path-invalid');
    byName.set(name.toLowerCase(),{name,file});total+=file.size;
    if(total>2_000_000_000+CATALOG_PACKET_MAX_BYTES)throw new Error('catalog-files-too-large');
  }
  const manifests=[...byName.values()].filter(({name})=>name.split('/').at(-1)==='edit-packet.json');
  if(manifests.length!==1||manifests[0].file.size>CATALOG_PACKET_MAX_BYTES)throw new Error('catalog-metadata-file-invalid');
  const {name,file}=manifests[0],bytes=await file.arrayBuffer();assertActive(signal);
  if(bytes.byteLength!==file.size||bytes.byteLength>CATALOG_PACKET_MAX_BYTES)throw new Error('catalog-metadata-size-mismatch');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('catalog-metadata-encoding-invalid');}
  let packet;try{packet=JSON.parse(text);}catch{throw new Error('catalog-metadata-json-invalid');}
  const verification=await verifyCatalogPacket(packet,trustedKeys,{capabilities});assertActive(signal);
  if(!verification.ok)throw new Error(verification.code);
  if(expectedService!==undefined&&packet.manifest.source.service!==expectedService)throw new Error('catalog-wrong-service');
  if(files.length!==packet.asset_bindings.length+1)throw new Error('catalog-extra-or-missing-files');
  const prefix=name.slice(0,-'edit-packet.json'.length),assets=new Map(packet.manifest.segments.filter(item=>item.asset).map(item=>[item.asset.sha256,item.asset])),validated=new Map();
  const context=Object.freeze({releaseId:packet.packet_id,manifestVersion:packet.manifest.manifest_version,manifestSha256:await sha256Text(bytes),
    assetSetSha256:await sha256Text(packet.asset_bindings.map(binding=>`${binding.sha256}:${binding.bytes}`).sort().join('\n'))});
  assertActive(signal);
  let checked=0;
  for(const binding of packet.asset_bindings){
    assertActive(signal);
    const selected=byName.get((prefix+binding.relative_path).toLowerCase()),asset=assets.get(binding.sha256);
    if(!selected||selected.file.size!==binding.bytes)throw new Error('catalog-bound-file-mismatch');
    const result=await validateAsset(selected.file,{sha256:asset.sha256,durationMs:asset.expected_duration_ms,durationToleranceMs:100,
      container:'mp4',videoCodec:'h264',audioCodec:'aac',width:asset.width,height:asset.height,dynamicRange:asset.dynamic_range},{profileClass:'catalog-v2',signal,context});
    assertActive(signal);if(!result.ok)throw new Error('catalog-local-media-invalid');
    validated.set(binding.sha256,selected.file);
    checked+=1;try{onAssetChecked?.(checked,packet.asset_bindings.length);}catch{}
  }
  return {packet,verification,files:validated};
}
