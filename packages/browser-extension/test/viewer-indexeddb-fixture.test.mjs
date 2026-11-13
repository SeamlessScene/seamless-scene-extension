import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';
import { createViewerStore } from '../src/viewer-store.mjs';

test('overlapping viewer transactions preserve every remembered choice', async () => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.remember(`source-${i}`, `edit-${i}`)));
  const state = await store.read();
  assert.equal(Object.keys(state.selections).length, 20);
  for (let i = 0; i < 20; i++) assert.equal(state.selections[`source-${i}`].id, `edit-${i}`);
});

test('requests enqueued by a read callback finish before transaction completion', async () => {
  const fake = fakeIndexedDB();
  const db = await new Promise(resolve => { const r = fake.open(); r.onsuccess = () => resolve(r.result); });
  const events = [];
  await new Promise(resolve => {
    const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state');
    store.get('model').onsuccess = () => {
      events.push('read');
      store.put({ saved: true }, 'model').onsuccess = () => events.push('write');
    };
    tx.oncomplete = () => { events.push('complete'); resolve(); };
  });
  assert.deepEqual(events, ['read', 'write', 'complete']);
  assert.deepEqual(fake.data.get('model'), { saved: true });
});

test('an aborted transaction discards writes and releases the next transaction', async () => {
  const fake = fakeIndexedDB();
  const db = await new Promise(resolve => { const r = fake.open(); r.onsuccess = () => resolve(r.result); });
  const aborted = new Promise(resolve => {
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put('discard', 'model').onsuccess = () => tx.abort();
    tx.onabort = resolve;
    tx.oncomplete = () => assert.fail('aborted transaction completed');
  });
  const next = new Promise(resolve => {
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put('keep', 'next');
    tx.oncomplete = resolve;
  });
  await Promise.all([aborted, next]);
  assert.equal(fake.data.has('model'), false);
  assert.equal(fake.data.get('next'), 'keep');
});
