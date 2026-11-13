import { hashBlobInChunks } from './src/local-file-hash-core.mjs';

// Extension-owned dedicated worker, never an externally reachable runtime port.
// Exactly one Blob/job; no names, paths, raw errors or bytes are returned.
let started = false;
globalThis.addEventListener('message', async ({ data }) => {
  if (started || !data || Object.keys(data).join(',') !== 'blob' || !(data.blob instanceof Blob)) {
    globalThis.postMessage({ type: 'error' }); globalThis.close(); return;
  }
  started = true;
  try {
    const sha256 = await hashBlobInChunks(data.blob, {
      onProgress: processedBytes => globalThis.postMessage({ type: 'progress', processedBytes })
    });
    globalThis.postMessage({ type: 'done', sha256 });
  } catch { globalThis.postMessage({ type: 'error' }); }
  finally { globalThis.close(); }
});
