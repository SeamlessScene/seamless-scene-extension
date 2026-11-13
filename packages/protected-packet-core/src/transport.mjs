import { bytes, insist, requireDescriptor, verifyDescriptor, descriptorToken } from './contract.mjs';
import { resolveObjects } from './importer.mjs';

const MAGIC = bytes('SSPC0001');
const u32 = value => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value); return b; };
const decoder = new TextDecoder('utf-8', { fatal: true });

// Candidate combined transport: magic, uint32 JWS byte length, JWS UTF-8,
// then one record per descriptor object: uint32 ID length, ID UTF-8,
// uint32 ciphertext length, ciphertext. No compression or filesystem paths.
export function combineTransport(token, descriptor, entries) {
  const d = requireDescriptor(descriptor); const objects = resolveObjects(descriptor, entries);
  insist(typeof token === 'string' && token.length <= 180_000, 'descriptor-token-limit');
  insist(token === descriptorToken(descriptor), 'combined-descriptor-mismatch');
  const encoded = bytes(token); const parts = [MAGIC, u32(encoded.length), encoded];
  for (const o of d.objects) {
    const id = bytes(o.object_id); const blob = objects.get(o.object_id);
    parts.push(u32(id.length), id, u32(blob.size), blob);
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}
export async function splitTransport(blob, trustedKeys) {
  insist(blob instanceof Blob && blob.size >= 12 && blob.size <= 2_003_000_000, 'combined-size');
  let offset = 0;
  async function take(length) {
    insist(Number.isSafeInteger(length) && length >= 0 && offset + length <= blob.size, 'combined-truncated');
    const part = blob.slice(offset, offset + length); offset += length; return part;
  }
  async function readNumber() { return new DataView(await (await take(4)).arrayBuffer()).getUint32(0); }
  insist(decoder.decode(await (await take(8)).arrayBuffer()) === 'SSPC0001', 'combined-magic');
  const length = await readNumber(); insist(length > 0 && length <= 180_000, 'descriptor-token-limit');
  const token = decoder.decode(await (await take(length)).arrayBuffer());
  const descriptor = await verifyDescriptor(token, trustedKeys);
  const d = requireDescriptor(descriptor); const bindings = new Map(d.objects.map(o => [o.object_id, o]));
  const entries = [];
  for (let i = 0; i < d.objects.length; i++) {
    const size = await readNumber(); insist(size >= 1 && size <= 128, 'combined-id');
    const id = decoder.decode(await (await take(size)).arrayBuffer()); const object = bindings.get(id);
    insist(object && bindings.delete(id), 'combined-object');
    const ciphertextLength = await readNumber(); insist(ciphertextLength === object.ciphertext_bytes, 'combined-object-size');
    entries.push([id, await take(ciphertextLength)]);
  }
  insist(offset === blob.size && bindings.size === 0, 'combined-trailing');
  resolveObjects(descriptor, entries);
  return { descriptor, token, entries };
}
