// Private extension-origin IndexedDB only. Never wire this API to page RPC.
// CryptoKey values are structured-cloned, never exported as private JWK bytes.
export function createInstallationStore({ indexedDB = globalThis.indexedDB, cryptoApi = globalThis.crypto,
  name = 'seamless-protected-installation-candidate-1' } = {}) {
  if (!indexedDB?.open || !cryptoApi?.subtle || !cryptoApi.randomUUID) throw Error('installation-storage-unavailable');
  let opening; let database; let closed = false;
  const active = () => { if (closed) throw Error('installation-store-closed'); };
  async function open() {
    active(); if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1); let failed = false;
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('private')) request.result.createObjectStore('private'); };
      request.onerror = () => { failed = true; reject(Error('installation-storage-unavailable')); };
      request.onblocked = () => { failed = true; reject(Error('installation-storage-blocked')); };
      request.onsuccess = () => {
        if (failed || closed) { request.result.close(); reject(Error('installation-store-closed')); return; }
        database = request.result; database.onversionchange = () => { closed = true; database.close(); };
        resolve(database);
      };
    });
    return opening;
  }
  function valid(record) {
    if (!record || record.version !== 1 || typeof record.generation !== 'string' || !/^[a-f0-9-]{36}$/.test(record.generation)) throw Error('installation-record-invalid');
    if (record.keys !== null) {
      const { publicKey, privateKey } = record.keys ?? {};
      if (!(publicKey instanceof CryptoKey) || !(privateKey instanceof CryptoKey) || publicKey.type !== 'public' || privateKey.type !== 'private' ||
        publicKey.algorithm.name !== 'ECDH' || privateKey.algorithm.name !== 'ECDH' || publicKey.algorithm.namedCurve !== 'P-256' || privateKey.algorithm.namedCurve !== 'P-256' ||
        privateKey.extractable || !publicKey.extractable || privateKey.usages.length !== 1 || privateKey.usages[0] !== 'deriveBits') throw Error('installation-key-invalid');
    }
    return record;
  }
  async function transact(update, discardInvalid = false) {
    const db = await open(); active();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('private', 'readwrite'); const store = transaction.objectStore('private'); let result; let error;
      const read = store.get('installation');
      read.onsuccess = () => {
        try {
          active(); const current = read.result === undefined ? null : (discardInvalid ? read.result : valid(read.result));
          const next = update(current); result = next;
          if (next !== current) store.put(next, 'installation');
        } catch (e) { error = e; transaction.abort(); }
      };
      transaction.oncomplete = () => { try { active(); resolve(valid(result)); } catch (e) { reject(e); } };
      transaction.onerror = () => { /* Abort reports a single failure below. */ };
      transaction.onabort = () => reject(error ?? Error('installation-write-failed'));
    });
  }
  const empty = () => ({ version: 1, generation: cryptoApi.randomUUID(), keys: null });
  return Object.freeze({
    async getInstallation() {
      const initial = await transact(current => current ?? empty());
      if (initial.keys) return Object.freeze(initial.keys);
      const keys = await cryptoApi.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']); active();
      const committed = await transact(current => {
        if (!current || current.generation !== initial.generation) throw Error('installation-generation-changed');
        return current.keys ? current : { ...current, keys };
      });
      return Object.freeze(committed.keys);
    },
    async clear() {
      // A tombstone generation fences any in-flight key generation in all contexts.
      await transact(() => empty(), true);
    },
    close() { closed = true; database?.close(); },
  });
}
