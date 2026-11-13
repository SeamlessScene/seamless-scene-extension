// E60: fast re-load of website edits. A protected load always reads the vault, checks the
// licence online, verifies the signed descriptor and packet, and decrypts every object with
// authenticated encryption; decryption hashes each clip and binds the hash to the signed
// packet (protected-packet-core catalog.mjs). After that, catalog-file-import re-hashed and
// probed/decoded every clip again (validateLocalAsset), which dominated a warm load.
//
// This cache remembers that second check's result. It is used only for protected loads (the
// renderer passes it in the protected owner's catalogOptions; local folder imports always run
// the full check, since there the re-hash is the integrity check). Its key is everything the
// result depends on: build identity, release, manifest version, manifest sha256, the set of
// asset sha256s and sizes, the asset's sha256 and size, and the expectations it was checked
// against. A hit still requires the file to be present at its signed size (checked by the
// caller just before). Clearing the extension's storage loses the cache (a cold load); an
// extension update changes the build identity (a miss).
import { validateLocalAsset } from './local-asset-validator.mjs';

export const CACHE_DB = 'seamless-validated-assets-v1';
const STORE = 'results';
const LIMIT = 4000;

const plainKey = parts => JSON.stringify(parts);

/** The exact key for one clip's validation, or null when the context is incomplete. */
export function validationKey({ buildId, context, expected, size }) {
  if (typeof buildId !== 'string' || !buildId) return null;
  const c = context ?? {};
  if (typeof c.releaseId !== 'string' || !Number.isSafeInteger(c.manifestVersion) || !/^[a-f0-9]{64}$/.test(c.manifestSha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(c.assetSetSha256 ?? '') || !/^[a-f0-9]{64}$/.test(expected?.sha256 ?? '') || !Number.isSafeInteger(size)) return null;
  const expectation = ['durationMs', 'durationToleranceMs', 'container', 'videoCodec', 'audioCodec', 'width', 'height', 'dynamicRange']
    .map(name => expected[name] ?? null);
  return plainKey([buildId, c.releaseId, c.manifestVersion, c.manifestSha256, c.assetSetSha256, expected.sha256, size, expectation]);
}

/** An IndexedDB-backed key set; any storage failure behaves as a miss (a full check). */
export function indexedDbStore(indexedDB, name = CACHE_DB) {
  let opening = null;
  const open = () => opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(request.error ?? Error('cache-open-failed')); };
  });
  const run = (mode, action) => open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode), store = tx.objectStore(STORE); let result;
    const request = action(store); if (request) request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result); tx.onabort = tx.onerror = () => reject(tx.error ?? Error('cache-io-failed'));
  }));
  return {
    get: key => run('readonly', store => store.get(key)),
    set: (key, value) => run('readwrite', store => store.put(value, key)),
    entries: () => run('readonly', store => store.getAllKeys()),
    delete: key => run('readwrite', store => store.delete(key)),
    clear: () => run('readwrite', store => store.clear())
  };
}

export function memoryStore() {
  const map = new Map();
  return { get: async key => map.get(key), set: async (key, value) => { map.set(key, value); }, entries: async () => [...map.keys()],
    delete: async key => { map.delete(key); }, clear: async () => map.clear(), map };
}

/**
 * validateAsset: drop-in for catalog-file-import's validator.
 * - hit: no re-hash or probe ({ ok: true, cached: true });
 * - miss, or a release marked for a full check: the full validator, cached on success;
 * - "Check again" (requestRecheck): the load still uses hits so Ready is not delayed, and
 *   runBackground() then re-runs the full validator on every clip of that load.
 * invalidateRelease() removes a release's entries (playback failure, failed background check).
 */
export function createValidatedAssetCache({ store, buildId, validate = validateLocalAsset, now = () => Date.now() } = {}) {
  const fullCheck = new Set(), recheck = new Set();
  let pending = [], stats = { hits: 0, misses: 0 };
  const releaseOf = key => { try { return JSON.parse(key)[1]; } catch { return null; } };
  async function validateAsset(file, expected, options = {}) {
    const key = validationKey({ buildId, context: options.context, expected, size: file?.size });
    const release = options.context?.releaseId;
    if (key && !fullCheck.has(release)) {
      let entry = null;
      try { entry = await store.get(key); } catch {}
      if (entry?.ok === true && entry.size === file.size) {
        stats.hits += 1;
        if (recheck.has(release)) pending.push({ release, key, file, expected, options: { ...options } });
        return Object.freeze({ ok: true, cached: true });
      }
    }
    stats.misses += 1;
    const result = await validate(file, expected, options);
    if (key && result?.ok === true) {
      try { await store.set(key, { ok: true, size: file.size, at: now() }); } catch {}
      try { await prune(); } catch {}
    }
    return result;
  }
  async function prune() {
    const keys = await store.entries();
    if (keys.length > LIMIT) for (const key of keys.slice(0, keys.length - LIMIT)) await store.delete(key);
  }
  async function invalidateRelease(releaseId) {
    let keys = [];
    try { keys = await store.entries(); } catch { return 0; }
    let removed = 0;
    for (const key of keys) if (releaseOf(key) === releaseId) { try { await store.delete(key); removed += 1; } catch {} }
    return removed;
  }
  return {
    validateAsset,
    invalidateRelease,
    /** The next load of this release runs the full check in the foreground (playback failed). */
    requireFullCheck(releaseId) { fullCheck.add(releaseId); },
    /** The next load of this release re-checks everything in the background after Ready. */
    requestRecheck(releaseId) { recheck.add(releaseId); },
    loadFinished(releaseId) { fullCheck.delete(releaseId); },
    /** Persisted "Check again" (survives the page reload that follows it). */
    async markRecheck(releaseId) { await store.set(`flag:recheck:${releaseId}`, { at: now() }); },
    /** Before a load: applies a persisted "Check again" to this load. */
    async prepareLoad(releaseId) {
      let flag = null;
      try { flag = await store.get(`flag:recheck:${releaseId}`); } catch {}
      if (flag) { recheck.add(releaseId); try { await store.delete(`flag:recheck:${releaseId}`); } catch {} }
      return Boolean(flag);
    },
    /**
     * Re-runs the full validator for the clips a "Check again" load took from the cache.
     * On the first failure the release's entries are removed and onFailure(code) is called.
     */
    async runBackground(releaseId, { signal, onProgress, onFailure } = {}) {
      const jobs = pending.filter(job => job.release === releaseId); pending = pending.filter(job => job.release !== releaseId);
      recheck.delete(releaseId);
      let done = 0;
      for (const job of jobs) {
        if (signal?.aborted) return { status: 'cancelled', checked: done, total: jobs.length };
        let result;
        try { result = await validate(job.file, job.expected, { ...job.options, signal }); }
        catch (error) { if (signal?.aborted) return { status: 'cancelled', checked: done, total: jobs.length }; result = { ok: false, code: error?.code ?? 'validation-failed' }; }
        if (result?.ok !== true) {
          await invalidateRelease(releaseId);
          try { onFailure?.(result?.code ?? 'catalog-local-media-invalid'); } catch {}
          return { status: 'failed', checked: done, total: jobs.length };
        }
        done += 1; try { onProgress?.(done, jobs.length); } catch {}
      }
      return { status: 'passed', checked: done, total: jobs.length };
    },
    get stats() { return { ...stats }; },
    resetStats() { stats = { hits: 0, misses: 0 }; }
  };
}
