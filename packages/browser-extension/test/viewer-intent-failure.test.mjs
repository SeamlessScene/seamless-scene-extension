import test from 'node:test';
import assert from 'node:assert/strict';
import { registerViewerService } from '../src/viewer-service.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';
import { createViewerStore } from '../src/viewer-store.mjs';
import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';

const releaseId = '11111111-1111-4111-8111-111111111111';
const previousReleaseId = '22222222-2222-4222-8222-222222222222';
const flush = () => new Promise(resolve => setImmediate(resolve));
function event() {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), emit: (...args) => listeners.forEach(fn => fn(...args)) };
}
async function harness({ sharedStore, record = true } = {}) {
  const runtime = { id: 'test-extension', onConnect: event(), onMessage: event() };
  const intents = [];
  const store = sharedStore ?? {
    read: async () => ({ preferences: {}, library: [], selections: {} }),
    intents: async () => structuredClone(intents),
    addIntent: async id => { const entry = { releaseId: id, attemptId: crypto.randomUUID() }; intents.splice(0, intents.length, entry); },
    failIntent: async (id, attemptId) => { const entry = intents.find(x => x.releaseId === id && x.attemptId === attemptId); if (!entry) return false; entry.failureCode = 'viewer-release-unavailable'; return true; },
  };
  const requests = [];
  function connect(tabId = 7) { const port = {
    name: 'viewer-renderer-v1', sender: { tab: { id: tabId } },
    onMessage: event(), onDisconnect: event(),
    postMessage: message => { if (message.method === 'acquire') requests.push(message); },
    disconnect() { this.onDisconnect.emit(); },
  }; runtime.onConnect.emit(port); port.onMessage.emit({ hello: true, build: EXECUTING_BUILD }); return port; }
  const service = registerViewerService(runtime, {}, {
    store, deviceJournal: {}, tabs: {}, authorizeRenderer: () => true,
  });
  const port = connect();
  await flush();
  if (record) await service.recordIntent(releaseId);
  await flush();
  if (record) assert.equal(requests.length, 1);
  return {
    service, requests, port, store, connect,
    put: args => new Promise(resolve => runtime.onMessage.emit(
      { kind: 'viewer-v1', method: 'library-put', args, build: EXECUTING_BUILD }, port.sender, resolve
    )),
    async reject(code = 'viewer-renderer-unavailable') {
      port.onMessage.emit({ id: requests.at(-1).id, ok: false, code, build: EXECUTING_BUILD });
      await flush();
    },
    progress(state) {
      port.onMessage.emit({ progress: { releaseId, state, bytes: 12, total: 24 }, build: EXECUTING_BUILD });
    },
  };
}

for (const hasReplacement of [false, true]) test(`update completion preserves kept files with replacement metadata ${hasReplacement ? 'present' : 'absent'}`, async () => {
  const old = { id: previousReleaseId, title: 'Complete', origin: 'website', transport: 'protected', availability: 'downloaded', name: 'Complete', sourceKey: 'exact-source', version: '1' };
  const replacement = { ...old, id: releaseId, name: 'Complete revised', version: 2 };
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  await store.upsert(old);
  if (hasReplacement) await store.upsert(replacement);
  await store.remember('exact-source', previousReleaseId, false, '1');
  await store.addIntent(releaseId, Date.now(), previousReleaseId);
  const h = await harness({ sharedStore: store, record: false });
  try {
    h.progress('ready');
    await flush();
    // Owner loss must not turn unsuccessful file removal into metadata deletion.
    h.port.disconnect();
    // Wait for the store's asynchronous transactions, not just the RPC microtask.
    await new Promise(resolve => setTimeout(resolve, 80));
    const { library, selections } = await store.read();
    const intents = await store.intents();
    assert.equal(library[0].id, previousReleaseId);
    assert.equal(library.length, hasReplacement ? 2 : 1);
    assert.equal(selections['exact-source'].id, hasReplacement ? releaseId : previousReleaseId);
    assert.equal(selections['exact-source'].version, hasReplacement ? '2' : '1');
    assert.equal(intents.length, hasReplacement ? 0 : 1);
    if (hasReplacement) {
      assert.equal(library[1].name, 'Complete revised');
      assert.equal(library[1].version, '2');
      assert.equal(library[1].sourceKey, 'exact-source');
    } else {
      const reply = await h.put(replacement);
      assert.equal(reply.ok, true);
      const recovered = await store.read();
      assert.equal(recovered.library.length, 2);
      assert.equal(recovered.library[1].name, 'Complete revised');
      assert.ok(recovered.library[1].downloadedAt > 0);
      assert.deepEqual(recovered.selections['exact-source'], { id: releaseId, version: '2', disabled: false });
      assert.deepEqual(await store.intents(), []);
    }
  } finally { h.port.disconnect(); }
});

test('acquire rejection before progress becomes failed and an explicit Watch retries', async () => {
  const h = await harness();
  await h.reject();
  assert.equal(h.service.job(releaseId).state, 'failed');
  assert.equal(h.service.job(releaseId).error, 'viewer-renderer-unavailable');
  await h.service.recordIntent(releaseId);
  await flush();
  assert.equal(h.requests.length, 2);
  await h.reject();
});

test('definitive refusal stops acquisition on reconnect and service restart, but explicit Watch retries', async () => {
  const h = await harness();
  await h.reject('viewer-release-unavailable');
  try {
    assert.equal((await h.store.intents())[0].failureCode, 'viewer-release-unavailable');
    h.port.disconnect(); const next = h.connect(); await flush();
    assert.equal(h.requests.length, 1, 'reconnect must not retry a refused intent'); next.disconnect();
    const restarted = await harness({ sharedStore: h.store, record: false });
    try {
      assert.equal(restarted.requests.length, 0, 'terminal state survives worker restart');
      assert.equal(restarted.service.job(releaseId).error, 'viewer-release-unavailable');
      await restarted.service.recordIntent(releaseId); await flush();
      assert.equal(restarted.requests.length, 1, 'fresh Watch starts a new attempt');
      await restarted.reject();
    } finally { restarted.port.disconnect(); }
  } finally { h.port.disconnect(); }
});

test('an old refusal cannot mark a newer Watch terminal', async () => {
  const h = await harness();
  try {
    const first = (await h.store.intents())[0].attemptId;
    await h.service.recordIntent(releaseId); await flush();
    const next = (await h.store.intents())[0]; assert.notEqual(next.attemptId, first);
    await h.reject('viewer-release-unavailable'); await flush();
    assert.equal((await h.store.intents())[0].failureCode, undefined);
    assert.equal(h.requests.length, 2, 'newer intent gets its own attempt after the old request settles');
    await h.reject();
  } finally { h.port.disconnect(); }
});

// 0.63.2/0.64.0 (owner): a failed download never restarts by itself; a reconnecting renderer
// leaves it failed (Retry or a new Watch starts it). The Watch itself is not refused.
test('a transient failure is not refused, and a reconnecting renderer does not restart it', async () => {
  const h = await harness(); await h.reject('viewer-download-stalled');
  assert.equal((await h.store.intents())[0].failureCode, undefined);
  h.port.disconnect(); const next = h.connect(); await flush();
  assert.equal(h.requests.length, 1); next.disconnect(); await flush();
});

test('renderer disconnect ends a downloading job', async () => {
  const h = await harness();
  h.port.disconnect();
  await flush();
  assert.equal(h.service.job(releaseId).state, 'failed');
  assert.equal(h.service.job(releaseId).error, 'viewer-controller-disconnected');
});

test('generic RPC failure does not overwrite a more specific progress failure', async () => {
  const h = await harness();
  h.progress('failed:viewer-budget-exceeded');
  await h.reject('viewer-action-failed');
  assert.equal(h.service.job(releaseId).error, 'viewer-budget-exceeded');
});

test('a late rejection cannot turn a ready job into a failure', async () => {
  const h = await harness();
  h.progress('ready');
  await h.reject('viewer-release-unavailable');
  assert.equal(h.service.job(releaseId).state, 'ready');
  assert.equal((await h.store.intents())[0].failureCode, undefined);
});

test('failed refusal persistence still stops session-local reconnect retries without an unhandled rejection', async () => {
  const h = await harness(); h.store.failIntent = async () => { throw Error('storage unavailable'); };
  await h.reject('viewer-release-unavailable'); h.port.disconnect();
  const next = h.connect(); await flush();
  assert.equal(h.requests.length, 1); assert.equal(h.service.job(releaseId).error, 'viewer-release-unavailable');
  next.disconnect();
});

test('an untrusted renderer error is never exposed to the website', async () => {
  const h = await harness();
  await h.reject('https://example.invalid/?credential=do-not-copy');
  assert.equal(h.service.job(releaseId).state, 'failed');
  assert.equal(h.service.job(releaseId).error, 'viewer-action-failed');
});

test('after a service-worker restart the pending intent is acquired again when a renderer reconnects', async () => {
  // Intents live in the store (persisted); jobs do not. A new service over the
  // same store re-requests acquisition as soon as a player renderer connects.
  const intents = [{ releaseId }];
  const store = { read: async () => ({ preferences: {}, library: [], selections: {} }), intents: async () => intents, addIntent: async () => {} };
  const requests = [];
  const runtime = { id: 'test-extension', onConnect: event(), onMessage: event() };
  const service = registerViewerService(runtime, {}, { store, deviceJournal: {}, tabs: {}, authorizeRenderer: () => true });
  assert.equal(service.job(releaseId), null);
  const port = { name: 'viewer-renderer-v1', sender: { tab: { id: 9 } }, onMessage: event(), onDisconnect: event(),
    postMessage: message => { if (message.method === 'acquire') requests.push(message); } };
  runtime.onConnect.emit(port);
  port.onMessage.emit({ hello: true, build: EXECUTING_BUILD });
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(service.job(releaseId).state, 'downloading');
  port.onDisconnect.emit();
  await flush();
});
