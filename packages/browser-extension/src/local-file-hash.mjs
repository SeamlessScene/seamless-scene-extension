import { assertActive, abortError } from './operation-context.mjs';

export const HASH_CHUNK_BYTES = 1024 * 1024;
export const MAX_NATIVE_FILE_BYTES = 2_147_483_648;
export const MAX_LOCAL_ASSET_BYTES = 536_870_912;
const MAX_WORKERS = 2;
let activeWorkers = 0;

const createWorker = () => new Worker(new URL('../local-hash-worker.mjs', import.meta.url), { type: 'module' });

// One private, same-origin dedicated worker per admitted job. No queued File
// references, runtime relay, whole-file ArrayBuffer or main-thread hash fallback.
// Termination stops the worker's read/CPU continuation; browser/OS reclamation
// of an already-issued slice read is implementation-dependent.
export async function sha256Hex(blob, {
  signal, maxBytes = MAX_NATIVE_FILE_BYTES, timeoutMs = 30_000,
  workerFactory = createWorker, onProgress
} = {}) {
  assertActive(signal);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_NATIVE_FILE_BYTES ||
      !Number.isSafeInteger(blob?.size) || blob.size < 0 || blob.size > maxBytes ||
      typeof blob.slice !== 'function') throw Error('local-hash-invalid-input');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw Error('local-hash-invalid-deadline');
  if (activeWorkers >= MAX_WORKERS) throw Error('local-hash-busy');
  activeWorkers++;
  let worker;
  try {
    worker = workerFactory();
    return await new Promise((resolve, reject) => {
      let settled = false, processedBytes = 0;
      const finish = (error, hash) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onFailure);
        worker.removeEventListener('messageerror', onFailure);
        error ? reject(error) : resolve(hash);
      };
      const onAbort = () => finish(signal.reason ?? abortError());
      const onFailure = () => finish(Error('local-hash-worker-failed'));
      const onMessage = ({ data }) => {
        if (settled) return;
        if (!data || typeof data !== 'object' || Array.isArray(data)) return onFailure();
        const keys = Object.keys(data).sort().join(',');
        if (data.type === 'progress' && keys === 'processedBytes,type' &&
            Number.isSafeInteger(data.processedBytes) && data.processedBytes > processedBytes &&
            data.processedBytes <= blob.size) {
          processedBytes = data.processedBytes;
          try { onProgress?.(processedBytes, blob.size); } catch { onFailure(); }
        } else if (data.type === 'done' && keys === 'sha256,type' && typeof data.sha256 === 'string' && /^[a-f0-9]{64}$/.test(data.sha256)) {
          finish(null, data.sha256);
        } else onFailure();
      };
      const timer = setTimeout(() => finish(Error('local-hash-timeout')), timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onFailure);
      worker.addEventListener('messageerror', onFailure);
      if (signal?.aborted) return onAbort();
      // Slice preserves a Blob-backed reference without materializing bytes and
      // strips File name/lastModified before crossing this private worker boundary.
      try { worker.postMessage({ blob: blob.slice(0, blob.size) }); } catch { onFailure(); }
    });
  } finally {
    try { worker?.terminate(); } finally { activeWorkers--; }
  }
}
