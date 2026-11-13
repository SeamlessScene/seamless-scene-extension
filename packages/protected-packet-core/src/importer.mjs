import { requireDescriptor, insist } from './contract.mjs';
import { assertLicense, copyObjectKey } from './license.mjs';
import { decryptObject } from './files.mjs';

// Both adapters supply the same object map. Archive parsing/extraction is outside
// this module; IDs are opaque signed identifiers, never filesystem paths/URLs.
export function resolveObjects(descriptor, entries) {
  const d = requireDescriptor(descriptor);
  insist(Array.isArray(entries) && entries.length === d.objects.length, 'object-set');
  const expected = new Map(d.objects.map(o => [o.object_id, o])); const objects = new Map();
  for (const entry of entries) {
    insist(Array.isArray(entry) && entry.length === 2, 'object-entry');
    const [id, blob] = entry; const binding = expected.get(id);
    insist(binding && !objects.has(id) && blob instanceof Blob && blob.size === binding.ciphertext_bytes, 'object-set');
    objects.set(id, blob);
  }
  return objects;
}
// onObject(done, total), optional: progress after each authenticated object (E60 status only;
// a throwing observer never affects the import).
export async function importProtectedObjects({ descriptor, license, entries, transaction, signal, onObject }) {
  const d = requireDescriptor(descriptor);
  insist(transaction && ['open', 'commit', 'abort'].every(k => typeof transaction[k] === 'function'), 'import-transaction-required');
  try {
    assertLicense(license, descriptor); const objects = resolveObjects(descriptor, entries);
    const evidence = [];
    for (const binding of d.objects) {
      const key = copyObjectKey(license, descriptor, binding.object_id);
      try {
        const writer = await transaction.open(binding);
        const result = await decryptObject(objects.get(binding.object_id), key, d, binding, writer,
          { signal, authorize: () => assertLicense(license, descriptor) });
        evidence.push({ object_id: binding.object_id, ...result });
        try { onObject?.(evidence.length, d.objects.length); } catch {}
      } finally { key.fill(0); }
    }
    if (signal?.aborted) throw new Error('operation-cancelled');
    assertLicense(license, descriptor);
    // Still quarantine. Caller must verify nested catalog signatures, exact media
    // hash/bindings, decode, source, activation and action authority before playback.
    await transaction.commit(evidence);
    if (signal?.aborted) throw new Error('operation-cancelled');
    assertLicense(license, descriptor);
    return Object.freeze({ status: 'authenticated-quarantine', objects: Object.freeze(evidence.map(Object.freeze)) });
  } catch (error) { await transaction.abort(); throw error; }
}
