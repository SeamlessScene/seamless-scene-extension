// Account selection and sign-out generation are one private IndexedDB transaction.
async function transact(operation, indexedDB = globalThis.indexedDB) {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open('seamless-protected-account-candidate-1', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('private');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(Error('protected-account-storage'));
  });
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('private', 'readwrite'), store = tx.objectStore('private'); let result,error;
    const epoch = store.get('generation');
    epoch.onsuccess = () => {
      const generation = epoch.result ?? crypto.randomUUID();
      if (!epoch.result) store.put(generation, 'generation');
      const read = store.get('account');
      read.onsuccess = () => { try { result = operation({ account: read.result ?? null, generation }, store); } catch(e) {error=e;tx.abort();} };
    };
    tx.oncomplete = () => resolve(result); tx.onabort = tx.onerror = () => reject(error ?? Error('protected-account-storage'));
  }); } finally { db.close(); }
}
export const privateAccountState = indexedDB => transact(state => state, indexedDB);
export function selectPrivateAccount(account, generation, indexedDB) {
  return transact((state, store) => {
    if (state.generation !== generation) throw Error('protected-account-generation-changed');
    if (!/^[a-f0-9-]{36}$/.test(account) || (state.account && state.account !== account)) throw Error('protected-account-changed');
    store.put(account,'account'); return account;
  }, indexedDB);
}
export function rollbackPrivateAccount(account, generation, indexedDB) {
  return transact((state, store) => { if (state.generation === generation && state.account === account) store.delete('account'); }, indexedDB);
}
export function privateAccount(value, indexedDB) {
  return transact((state, store) => {
    if (value === undefined) return state.account;
    if (value !== null) throw Error('protected-account-generation-required');
    store.put(crypto.randomUUID(),'generation');store.delete('account');return null;
  }, indexedDB);
}
