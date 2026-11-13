import { createSHA256 } from '../vendor/hash-wasm/sha256.js';
import { assertActive } from './operation-context.mjs';
import { HASH_CHUNK_BYTES, MAX_NATIVE_FILE_BYTES } from './local-file-hash.mjs';

// Runs in the dedicated worker. Read one slice at a time, checking the exact
// returned length so a lost/truncated read cannot hash a different byte stream.
export async function hashBlobInChunks(blob, { signal, onProgress, chunkBytes = HASH_CHUNK_BYTES, createHasher = createSHA256 } = {}) {
  assertActive(signal);
  if (!Number.isSafeInteger(blob?.size) || blob.size < 0 || blob.size > MAX_NATIVE_FILE_BYTES ||
      typeof blob.slice !== 'function' || !Number.isSafeInteger(chunkBytes) ||
      chunkBytes < 1 || chunkBytes > HASH_CHUNK_BYTES) throw Error('local-hash-invalid-input');
  const size = blob.size; let hash;
  try {
    hash = await createHasher();
    // A cancelled initialization cannot start reading the selected file.
    assertActive(signal);
    for (let offset = 0; offset < size; offset += chunkBytes) {
      assertActive(signal);
      const end = Math.min(size, offset + chunkBytes);
      const buffer = await blob.slice(offset, end).arrayBuffer();
      assertActive(signal);
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== end - offset || blob.size !== size) throw Error('local-hash-read-failed');
      const bytes = new Uint8Array(buffer);
      try { hash.update(bytes); } finally { bytes.fill(0); }
      if (end === size || end % (4 * HASH_CHUNK_BYTES) === 0) onProgress?.(end);
    }
    assertActive(signal);
    return hash.digest('hex');
  } finally {
    // Packaged WASM lifetime is bounded by the dedicated worker owner.
    hash?.destroy?.();
  }
}
