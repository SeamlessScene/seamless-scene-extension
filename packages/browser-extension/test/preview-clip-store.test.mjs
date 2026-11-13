import test from 'node:test';
import assert from 'node:assert/strict';
import { putPreview, takePreview } from '../src/preview-clip-store.mjs';

// Just enough IndexedDB for one keyed object store.
function fakeIndexedDB() {
  const data = new Map();
  const later = fn => setImmediate(fn);
  return { data, open() {
    const request = {};
    later(() => {
      const db = { close() {}, createObjectStore() {}, transaction() {
        const tx = {};
        const store = {
          put(value, key) { data.set(key, value); return {}; },
          get(key) { const r = {}; later(() => { r.result = data.get(key); r.onsuccess?.(); }); return r; },
          delete(key) { data.delete(key); return {}; }
        };
        tx.objectStore = () => store;
        setTimeout(() => tx.oncomplete?.(), 5);
        return tx;
      } };
      request.result = db; request.onupgradeneeded?.(); request.onsuccess?.();
    });
    return request;
  } };
}

test('a preview is taken once, and stale or malformed entries are discarded', async () => {
  const indexedDB = fakeIndexedDB(), clip = new Blob(['clip'], { type: 'video/mp4' });
  await putPreview({ packet: { packet_id: 'p' }, clip, createdAt: 1000 }, { indexedDB });
  const taken = await takePreview({ indexedDB, now: 2000 });
  assert.equal(JSON.parse(taken.packet).packet_id, 'p'); assert.equal(await taken.clip.text(), 'clip');
  assert.equal(taken.name, '', 'no scene name given');
  await putPreview({ packet: { packet_id: 'p' }, clip, name: 'Scene 1', createdAt: 1000 }, { indexedDB });
  assert.equal((await takePreview({ indexedDB, now: 2000 })).name, 'Scene 1', 'the scene name travels with the clip (E57 C4)');
  assert.equal(await takePreview({ indexedDB, now: 2000 }), null, 'taken once');
  await putPreview({ packet: { packet_id: 'p' }, clip, createdAt: 1000 }, { indexedDB });
  assert.equal(await takePreview({ indexedDB, now: 1000 + 5 * 60 * 1000 + 1 }), null, 'older than five minutes');
  assert.equal(indexedDB.data.size, 0, 'removed either way');
  await assert.rejects(putPreview({ packet: {}, clip: 'not a blob' }, { indexedDB }), /preview-invalid/);
});
