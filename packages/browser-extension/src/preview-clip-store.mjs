// One pending "preview this clip over the stream" hand-off from the creator side
// panel to the private renderer. Both are extension documents, so they share this
// IndexedDB (the renderer embedded in the player page has the viewer's host grant).
// The renderer takes the entry once and re-validates the packet and clip exactly as
// a folder import; nothing here is trusted.
const DB = 'seamless-scene-preview', STORE = 'pending', KEY = 'current';

function open(indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? Error('preview-store-unavailable'));
  });
}
function run(db, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode), store = tx.objectStore(STORE);
    let value; const request = work(store);
    if (request) request.onsuccess = () => { value = request.result; };
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? Error('preview-store-failed')); };
  });
}

// `name` is the scene's name for the player menu ("Preview · Scene 1").
export async function putPreview({ packet, clip, name = '', createdAt = Date.now() }, { indexedDB = globalThis.indexedDB } = {}) {
  if (!packet || !(clip instanceof Blob)) throw Error('preview-invalid');
  await run(await open(indexedDB), 'readwrite', store => store.put({ packet: JSON.stringify(packet), clip, name: String(name ?? '').slice(0, 120), createdAt }, KEY));
}

/** Reads and removes the pending preview; entries older than maxAgeMs are discarded. */
export async function takePreview({ indexedDB = globalThis.indexedDB, now = Date.now(), maxAgeMs = 5 * 60 * 1000 } = {}) {
  const db = await open(indexedDB);
  let entry;
  await run(db, 'readwrite', store => { const get = store.get(KEY); get.onsuccess = () => { entry = get.result; store.delete(KEY); }; return null; });
  if (!entry || !(now - entry.createdAt <= maxAgeMs) || typeof entry.packet !== 'string' || !(entry.clip instanceof Blob)) return null;
  return { packet: entry.packet, clip: entry.clip, name: typeof entry.name === 'string' ? entry.name.slice(0, 120) : '' };
}
