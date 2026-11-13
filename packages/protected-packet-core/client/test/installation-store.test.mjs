import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createInstallationStore } from '../installation-store.mjs';
async function fingerprint(keys) { return JSON.stringify(await crypto.subtle.exportKey('jwk', keys.publicKey)); }
const fresh = () => `protected-test-${crypto.randomUUID()}`;

test('nonextractable installation key survives database close/reopen and still decrypts', async () => {
  const name = fresh(); const a = createInstallationStore({ indexedDB, name }); const first = await a.getInstallation();
  assert.equal(first.privateKey.extractable, false); await assert.rejects(crypto.subtle.exportKey('jwk', first.privateKey));
  a.close(); const b = createInstallationStore({ indexedDB, name }); const second = await b.getInstallation();
  assert.equal(await fingerprint(first), await fingerprint(second));
  const peer = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const x = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer.publicKey }, second.privateKey, 256);
  const y = await crypto.subtle.deriveBits({ name: 'ECDH', public: second.publicKey }, peer.privateKey, 256);
  assert.deepEqual(new Uint8Array(x), new Uint8Array(y)); b.close();
});

test('concurrent contexts converge on one installation identity', async () => {
  const name = fresh(); const stores = Array.from({ length: 5 }, () => createInstallationStore({ indexedDB, name }));
  const keys = await Promise.all(stores.map(s => s.getInstallation())); const hashes = await Promise.all(keys.map(fingerprint));
  assert.equal(new Set(hashes).size, 1); stores.forEach(s => s.close());
});

test('explicit clear replaces installation without deleting unrelated databases', async () => {
  const name = fresh(); const store = createInstallationStore({ indexedDB, name }); const first = await fingerprint(await store.getInstallation());
  await store.clear(); assert.notEqual(await fingerprint(await store.getInstallation()), first); store.close();
});

test('sign-out tombstone prevents late generation from resurrecting keys', async () => {
  const name = fresh(); let started; const waiting = new Promise(resolve => started = resolve); let release;
  const gate = new Promise(resolve => release = resolve);
  const slow = { randomUUID: () => crypto.randomUUID(), subtle: { async generateKey(...args) { started(); await gate; return crypto.subtle.generateKey(...args); } } };
  const first = createInstallationStore({ indexedDB, name, cryptoApi: slow }); const second = createInstallationStore({ indexedDB, name });
  const pending = first.getInstallation(); await waiting; await second.clear(); release();
  await assert.rejects(pending, /generation-changed/); first.close(); second.close();
});

test('closing a store prevents further reads and creation', async () => {
  const store = createInstallationStore({ indexedDB, name: fresh() }); store.close(); await assert.rejects(store.getInstallation(), /closed/);
});

test('malformed persisted identity refuses rather than silently resets', async () => {
  const name = fresh(); const store = createInstallationStore({ indexedDB, name }); await store.getInstallation(); store.close();
  const db = await new Promise((resolve, reject) => { const request = indexedDB.open(name, 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
  await new Promise((resolve, reject) => { const t = db.transaction('private', 'readwrite'); t.objectStore('private').put({ version: 1, generation: crypto.randomUUID(), keys: { publicKey: {}, privateKey: {} } }, 'installation'); t.oncomplete = resolve; t.onabort = reject; }); db.close();
  const next = createInstallationStore({ indexedDB, name }); await assert.rejects(next.getInstallation(), /key-invalid/);
  await next.clear(); assert.equal((await next.getInstallation()).privateKey.extractable, false); next.close();
});
