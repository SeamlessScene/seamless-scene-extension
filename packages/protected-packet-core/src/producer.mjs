import { verifyCatalogPacket } from '../../browser-extension/src/catalog-packet.mjs';
import { FORMAT, PROFILE, insist, isId, jsonBytes, signDescriptor } from './contract.mjs';
import { encryptObject, newContentKey } from './files.mjs';
import sodium from 'libsodium-wrappers-sumo';

// Input is an ALREADY approved and signed catalog packet. This primitive does not
// replace worker decode, staff approval, publication commit or key custody.
export async function protectCatalog({ packet, assets, catalogTrust, capabilities, releaseId, signingKey, kid, signal }) {
  await sodium.ready;
  insist(isId(releaseId), 'release-identity');
  const snapshot = structuredClone(packet);
  const verification = await verifyCatalogPacket(snapshot, catalogTrust, { capabilities });
  insist(verification.ok, `inner-catalog-${verification.code}`);
  insist(assets instanceof Map && assets.size === snapshot.asset_bindings.length, 'producer-media-set');
  const context = { format: FORMAT, release_id: releaseId, key_access: 'platform-key', publication: 'reviewed-catalog-v2',
    crypto_profile: PROFILE, required_capabilities: [PROFILE, 'platform-key'] };
  const contentKeys = new Map(); const entries = []; const objects = [];
  async function add(id, kind, blob) {
    if (signal?.aborted) throw new Error('operation-cancelled');
    const key = await newContentKey(); contentKeys.set(id, key);
    const encrypted = await encryptObject(blob, key, { ...context, object_id: id, kind }, { signal });
    entries.push([id, encrypted.blob]); objects.push(encrypted.binding);
  }
  try {
    await add('packet', 'packet', new Blob([jsonBytes(snapshot)]));
    let index = 0;
    for (const binding of snapshot.asset_bindings) {
      const blob = assets.get(binding.sha256);
      insist(blob instanceof Blob && blob.size === binding.bytes, 'producer-media-binding');
      const hash = sodium.crypto_hash_sha256_init();
      for (let offset = 0; offset < blob.size; offset += 1_048_576) {
        if (signal?.aborted) throw new Error('operation-cancelled');
        sodium.crypto_hash_sha256_update(hash, new Uint8Array(await blob.slice(offset, offset + 1_048_576).arrayBuffer()));
      }
      insist(sodium.to_hex(sodium.crypto_hash_sha256_final(hash)) === binding.sha256, 'producer-media-digest');
      await add(`media-${index++}`, 'media', blob);
    }
    // Reverify after all async preparation so an intervening key revocation
    // cannot silently produce a new protected publication.
    insist((await verifyCatalogPacket(snapshot, catalogTrust, { capabilities })).ok, 'catalog-trust-changed');
    const token = await signDescriptor({ ...context, objects }, signingKey, kid);
    if (signal?.aborted) throw new Error('operation-cancelled');
    return { token, entries, contentKeys }; // Secret map goes to trusted key custody, never public transport.
  } catch (error) { for (const key of contentKeys.values()) key.fill(0); contentKeys.clear(); throw error; }
}
