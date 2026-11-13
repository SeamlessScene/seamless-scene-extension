// Private-origin cache of signed licenses containing installation-wrapped keys.
// No plaintext content keys or pairing bearer tokens are persisted here.
export function createLeaseCache({ indexedDB = globalThis.indexedDB, cryptoApi = globalThis.crypto, now = () => Date.now(),
  name = 'seamless-protected-leases-candidate-1' } = {}) {
  let db; let opening; let closed = false;
  const active = () => { if (closed) throw Error('lease-cache-closed'); };
  function open() {
    active();
    return opening ??= new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1); let failed = false;
      r.onupgradeneeded = () => r.result.createObjectStore('private');
      r.onerror = r.onblocked = () => { failed = true; reject(Error('lease-cache-unavailable')); };
      r.onsuccess = () => { if (failed || closed) { r.result.close(); reject(Error('lease-cache-closed')); return; } db = r.result; db.onversionchange = () => { closed = true; db.close(); }; resolve(db); };
    });
  }
  const key = (account, digest) => {
    if (typeof account !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(account) || !/^[a-f0-9]{64}$/.test(digest)) throw Error('lease-cache-identity');
    return `${account}:${digest}`;
  };
  function valid(s) {
    if (!s || s.version !== 1 || typeof s.generation !== 'string' || !Number.isFinite(s.floor) || s.floor < 0 || !s.entries || typeof s.entries !== 'object' || Array.isArray(s.entries) || Object.keys(s.entries).length > 32) throw Error('lease-cache-corrupt');
    for (const [id, entry] of Object.entries(s.entries)) {
      if (!/^[a-z0-9][a-z0-9._-]{0,127}:[a-f0-9]{64}$/.test(id) || !entry || Object.keys(entry).sort().join(',') !== 'expiresAt,token' ||
        typeof entry.token !== 'string' || entry.token.length > 128000 || !Number.isFinite(entry.expiresAt) || entry.expiresAt < 0) throw Error('lease-cache-corrupt');
    }
    return s;
  }
  async function transaction(operation, { clear = false, observedTime } = {}) {
    const database = await open(); active();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('private', 'readwrite'); const store = tx.objectStore('private'); const read = store.get('state'); let result; let error;
      read.onsuccess = () => {
        try {
          active(); const time = observedTime === undefined ? now() : observedTime; if (!Number.isFinite(time) || time < 0) throw Error('clock-invalid');
          const s = clear || read.result === undefined ? { version: 1, generation: cryptoApi.randomUUID(), floor: time, entries: {} } : valid(read.result);
          if (time < s.floor) throw Error('clock-regression-revalidate');
          s.floor = time; result = operation(s); store.put(s, 'state');
        } catch (e) { error = e; tx.abort(); }
      };
      tx.oncomplete = () => { try { active(); resolve(result); } catch (e) { reject(e); } };
      tx.onerror = () => {}; tx.onabort = () => reject(error ?? Error('lease-cache-write-failed'));
    });
  }
  return Object.freeze({
    async checkpoint(generation, observedTime) { return transaction(s => { if (generation !== undefined && generation !== s.generation) throw Error('lease-cache-generation-changed'); return s.generation; }, { observedTime }); },
    async read(account, digest) { const id = key(account, digest); return transaction(s => ({ generation: s.generation, entry: structuredClone(s.entries[id] ?? null) })); },
    async save({ generation, account, descriptorSha256, token, expiresAt }) {
      const id = key(account, descriptorSha256);
      if (typeof token !== 'string' || token.length > 128000 || !Number.isFinite(expiresAt)) throw Error('lease-cache-entry');
      return transaction(s => {
        if (s.generation !== generation) throw Error('lease-cache-generation-changed');
        if (expiresAt <= s.floor) throw Error('lease-cache-expired');
        for (const [k, value] of Object.entries(s.entries)) if (value.expiresAt <= s.floor) delete s.entries[k];
        if (!s.entries[id] && Object.keys(s.entries).length >= 32) throw Error('lease-cache-capacity');
        // Delayed renewal must not replace a newer grant with shorter validity.
        if (!s.entries[id] || s.entries[id].expiresAt <= expiresAt) s.entries[id] = { token, expiresAt };
      });
    },
    async clear() { await transaction(() => {}, { clear: true }); },
    close() { closed = true; db?.close(); },
  });
}
