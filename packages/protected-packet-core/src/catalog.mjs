import { verifyCatalogPacket } from '../../browser-extension/src/catalog-packet.mjs';
import { insist, requireDescriptor, LIMITS, digest } from './contract.mjs';
import { importProtectedObjects } from './importer.mjs';
import { assertLicense } from './license.mjs';

// Read-only composition with the existing consumer. This returns verified
// quarantined inputs, NOT activated/decoded/compiled playable actions.
export async function importProtectedCatalog({ descriptor, license, entries, store, catalogTrust, capabilities, signal, onObject }) {
  const d = requireDescriptor(descriptor);
  insist(typeof store?.read === 'function', 'quarantine-reader-required');
  try {
    const evidence = await importProtectedObjects({ descriptor, license, entries, transaction: store, signal, onObject });
    const packetObject = d.objects.find(o => o.kind === 'packet');
    const packetBlob = await store.read(packetObject.object_id);
    insist(packetBlob instanceof Blob && packetBlob.size === packetObject.plaintext_bytes && packetBlob.size <= LIMITS.packet, 'packet-quarantine');
    insist(await digest(await packetBlob.arrayBuffer()) === evidence.objects.find(o => o.object_id === packetObject.object_id).sha256, 'packet-quarantine-digest');
    const packet = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await packetBlob.arrayBuffer()));
    const verification = await verifyCatalogPacket(packet, catalogTrust, { capabilities });
    insist(verification.ok, `inner-catalog-${verification.code}`);
    // Evidence came from authenticated decryption, not manifest declarations.
    const media = evidence.objects.filter(o => o.object_id !== packetObject.object_id);
    insist(media.length === packet.asset_bindings.length, 'inner-media-set');
    const byHash = new Map();
    for (const object of media) { insist(!byHash.has(object.sha256), 'inner-media-duplicate'); byHash.set(object.sha256, object); }
    for (const binding of packet.asset_bindings) {
      const object = byHash.get(binding.sha256);
      insist(object?.bytes === binding.bytes, 'inner-media-binding');
    }
    if (signal?.aborted) throw new Error('operation-cancelled');
    // Both signature verification and store I/O are async; recheck lease/trust.
    assertLicense(license, descriptor);
    return Object.freeze({ status: 'catalog-verified-quarantine', verification, media: evidence.objects });
  } catch (error) { await store.abort(); throw error; }
}
