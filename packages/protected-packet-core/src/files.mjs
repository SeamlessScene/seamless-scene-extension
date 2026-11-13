import sodium from 'libsodium-wrappers-sumo';
import { CHUNK, LIMITS, insist, objectAAD, ciphertextSize } from './contract.mjs';

export async function newContentKey() { await sodium.ready; return sodium.crypto_secretstream_xchacha20poly1305_keygen(); }
function checkBlob(blob, limit) { insist(blob instanceof Blob && blob.size > 0 && blob.size <= limit, 'object-size'); }
function checkKey(key) { insist(key instanceof Uint8Array && key.length === 32, 'content-key'); }
function cancelled(signal) { if (signal?.aborted) throw new Error('operation-cancelled'); }
function hashHex(state) { return sodium.to_hex(sodium.crypto_hash_sha256_final(state)); }
export async function encryptObject(blob, key, context, { signal } = {}) {
  await sodium.ready; checkKey(key);
  checkBlob(blob, context.kind === 'packet' ? LIMITS.packet : LIMITS.asset);
  const object = { object_id: context.object_id, kind: context.kind, plaintext_bytes: blob.size };
  const aad = objectAAD(context, object);
  const stream = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
  const parts = [stream.header]; const hash = sodium.crypto_hash_sha256_init();
  sodium.crypto_hash_sha256_update(hash, stream.header);
  for (let offset = 0; offset < blob.size; offset += CHUNK) {
    cancelled(signal);
    const plain = new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer());
    try {
      cancelled(signal);
      const final = offset + plain.length === blob.size;
      const encrypted = sodium.crypto_secretstream_xchacha20poly1305_push(stream.state, plain, aad,
        final ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE);
      sodium.crypto_hash_sha256_update(hash, encrypted); parts.push(encrypted);
    } finally { sodium.memzero(plain); }
  }
  cancelled(signal);
  return { blob: new Blob(parts), binding: { ...object, ciphertext_bytes: ciphertextSize(blob.size), ciphertext_sha256: hashHex(hash) } };
}

// The writer owns private tentative storage. commit is called only after complete
// authentication; abort must remove tentative data. No playable URL is returned.
export async function decryptObject(blob, key, descriptor, object, writer, { signal, authorize = () => {} } = {}) {
  await sodium.ready; checkKey(key);
  insist(writer && ['write', 'commit', 'abort'].every(k => typeof writer[k] === 'function'), 'transactional-writer-required');
  let hash; let plainHash;
  try {
    insist(blob instanceof Blob && blob.size === object.ciphertext_bytes && blob.size === ciphertextSize(object.plaintext_bytes), 'ciphertext-size');
    insist(object.plaintext_bytes > 0 && object.plaintext_bytes <= (object.kind === 'packet' ? LIMITS.packet : LIMITS.asset), 'plaintext-limit');
    cancelled(signal); authorize();
    const header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
    const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, key);
    insist(state !== false, 'ciphertext-header');
    hash = sodium.crypto_hash_sha256_init(); plainHash = sodium.crypto_hash_sha256_init();
    sodium.crypto_hash_sha256_update(hash, header);
    const aad = objectAAD(descriptor, object);
    let offset = 24;
    for (let position = 0; position < object.plaintext_bytes; position += CHUNK) {
      cancelled(signal); authorize();
      const length = Math.min(CHUNK, object.plaintext_bytes - position);
      const encrypted = new Uint8Array(await blob.slice(offset, offset + length + 17).arrayBuffer());
      cancelled(signal); authorize();
      sodium.crypto_hash_sha256_update(hash, encrypted);
      const result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, encrypted, aad);
      insist(result !== false, 'ciphertext-authentication');
      try {
        const final = position + length === object.plaintext_bytes;
        insist(result.message.length === length && result.tag === (final ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE), 'ciphertext-framing');
        sodium.crypto_hash_sha256_update(plainHash, result.message);
        await writer.write(result.message); // Writer must copy/consume before resolving.
      } finally { sodium.memzero(result.message); }
      offset += length + 17;
    }
    insist(offset === blob.size && hashHex(hash) === object.ciphertext_sha256, 'ciphertext-digest');
    const sha256 = hashHex(plainHash);
    cancelled(signal); authorize();
    await writer.commit({ sha256, bytes: object.plaintext_bytes });
    cancelled(signal); authorize();
    return { sha256, bytes: object.plaintext_bytes };
  } catch (error) {
    await writer.abort();
    throw error;
  }
}
