import { startPlaybackFrame } from '../playback-frame-app.mjs';
import { startCatalogControlPolling } from '../src/catalog-control-updates.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_LIMITS, validLocalMessage, validLocalResult } from '../src/local-message-schema.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';
import { sameExecutingBuild } from '../src/build-identity.mjs';
import { OperationContext, boundedOperation, assertActive } from '../src/operation-context.mjs';
import { receivedParentBinding, PRIVATE_PARENT_BINDING } from '../src/private-frame-binding.mjs';
import { protectedTrustConfig as releaseTrust } from '../protected-trust-config.mjs';

// Field testing 2026-09-24: "Watch this edit" stayed at "Downloading" and the
// server saw no protected-candidate request at all, because the release build
// then shipped protected trust disabled and the renderer refused every Watch
// acquisition up front. Release builds now ship trust enabled with public keys
// only; a build without trust must still refuse before any owner or request.
const turn = () => new Promise(resolve => setImmediate(resolve));
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const releaseId = '7e4b9c20-5a61-4d83-b2f7-0c9e1d6a4f35';

function renderer(trust, makeOwner = null, extraDeps = {}) {
  let receive, viewerReceive; const viewerSent = [], owners = [], events = new Map();
  const port = { onMessage: { addListener: fn => { receive = fn; } }, onDisconnect: { addListener() {} }, postMessage() {}, disconnect() {} };
  const viewerPort = { onMessage: { addListener: fn => { viewerReceive = fn; } }, onDisconnect: { addListener() {} }, postMessage: m => viewerSent.push(m) };
  const element = () => ({ value: 'private', classList: { add() {}, remove() {} }, addEventListener() {}, querySelector() { return {}; } });
  const nodes = new Map(); const lookup = key => { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key); };
  const parent = {}, window = { parent, top: parent, location: { ancestorOrigins: ['https://www.amazon.com'] } };
  const sandbox = { createViewerStore: () => ({ folder: async () => null }),
    startCatalogControlPolling: options => startCatalogControlPolling({ ...options, setTimer: fn => fn, clearTimer() {} }),
    LocalOverlay: class { teardown() {} }, loadFixturePacket() {}, OperationContext, boundedOperation, assertActive,
    validLocalMessage: (m, role) => validLocalMessage(structuredClone(m), role), validLocalResult: (m, c) => validLocalResult(structuredClone(m), c),
    LOCAL_LIMITS, LOCAL_CONTROL_COMMANDS: new Set(['stop', 'clear', 'teardown', 'importReady']), sameExecutingBuild, EXECUTING_BUILD, receivedParentBinding, window,
    CatalogPlaybackSession: class { clear() {} }, createCatalogRuntimeClient: () => ({ readPolicy() {} }), catalogTrustConfig: { fixtureOnly: false }, protectedTrustConfig: trust,
    createConfiguredProtectedOwner: async (...args) => { owners.push(args); if (makeOwner) return makeOwner(); throw Error('owner created'); },
    document: { querySelector: lookup, body: element() }, location: { hash: '#' + crypto.randomUUID() },
    chrome: { runtime: { id: extensionId, connect: ({ name } = {}) => name === 'viewer-renderer-v1' ? viewerPort : port, getURL: p => `chrome-extension://${extensionId}/${p}` }, storage: { onChanged: { addListener() {}, removeListener() {} } } },
    AbortController, URL, performance, setInterval: () => 0, clearInterval() {}, addEventListener: (n, fn) => events.set(n, fn), removeEventListener: n => events.delete(n), ...extraDeps };
  startPlaybackFrame({ ...sandbox, deps: sandbox });
  events.get('message')({ isTrusted: true, source: parent, origin: 'https://www.amazon.com', data: { type: PRIVATE_PARENT_BINDING, challenge: crypto.randomUUID() } });
  receive({ type: 'ready', build: EXECUTING_BUILD });
  return { viewerSent, owners, send: async (id, method, args = { releaseId }) => { viewerReceive({ id, method, args, build: EXECUTING_BUILD }); for (let i = 0; i < 6; i += 1) await turn(); return viewerSent.find(m => m.id === id); }, acquire: async () => { viewerReceive({ id: 'a1', method: 'acquire', args: { releaseId }, build: EXECUTING_BUILD }); await turn(); await turn(); return viewerSent.find(m => m.id === 'a1'); } };
}

test('the release build ships protected trust enabled with public keys only (owner decision 2026-09-24)', () => {
  assert.equal(releaseTrust.enabled, true);
  assert.equal(releaseTrust.fixtureOnly, false);
  for (const key of [...releaseTrust.descriptorKeys, ...releaseTrust.licenseKeys]) { assert.equal(key.jwk.kty, 'OKP'); assert.equal(key.jwk.d, undefined); }
});

test('with release trust, a Watch acquisition reaches the protected owner (no longer refused up front)', async () => {
  const r = renderer(releaseTrust);
  await r.acquire();
  assert.equal(r.owners.length, 1);
});

test('with trust disabled, acquisition is still refused before any owner exists', async () => {
  const r = renderer({ ...releaseTrust, enabled: false });
  const reply = await r.acquire();
  assert.deepEqual({ ok: reply?.ok, code: reply?.code }, { ok: false, code: 'viewer-renderer-unavailable' });
  assert.equal(r.owners.length, 0);
});

test('E61: the renderer reports client reconnects and stops an acquisition when the service cancels it', async () => {
  let options;
  const r = renderer(releaseTrust, () => ({
    acquire: (id, opts) => new Promise((resolve, reject) => {
      options = opts;
      opts.onProgress(1_000, 4_000);
      opts.onRetry({ attempt: 1, code: 'network-error', delayMs: 1000, written: 900, object: 1, objects: 2 });
      opts.signal.addEventListener('abort', () => reject(Error('client-cancelled')), { once: true });
    }),
    close: async () => {}
  }));
  r.send('a1', 'acquire');
  for (let i = 0; i < 6; i += 1) await turn();
  assert.ok(options?.signal, 'the acquisition can be stopped');
  const retry = r.viewerSent.find(m => m.progress?.retry);
  assert.deepEqual(retry.progress.retry, { attempt: 1, code: 'network-error', delayMs: 1000, written: 900 });
  assert.equal(retry.progress.state, 'downloading');
  const cancelled = await r.send('c1', 'cancel');
  assert.deepEqual(cancelled.value, { cancelled: true });
  for (let i = 0; i < 6; i += 1) await turn();
  const reply = r.viewerSent.find(m => m.id === 'a1');
  assert.deepEqual({ ok: reply?.ok, code: reply?.code }, { ok: false, code: 'viewer-download-cancelled' });
  assert.ok(r.viewerSent.some(m => m.progress?.state === 'failed:viewer-download-cancelled'));
  assert.deepEqual((await r.send('c2', 'cancel')).value, { cancelled: false }, 'nothing left to stop');
});

test('0.62.21: the renderer pauses and resumes a running acquisition through its pause gate (no cancel, no stall)', async () => {
  let options;
  const r = renderer(releaseTrust, () => ({
    acquire: (id, opts) => new Promise((resolve, reject) => {
      options = opts;
      opts.signal.addEventListener('abort', () => reject(Error('client-cancelled')), { once: true });
      void (async () => { await opts.pause.resumed(); })();
    }),
    close: async () => {}
  }));
  r.send('a1', 'acquire');
  for (let i = 0; i < 6; i += 1) await turn();
  const gate = options.pause;
  assert.equal(gate.paused, false);
  const before = gate.signal();
  assert.deepEqual((await r.send('p1', 'pause')).value, { paused: true });
  assert.equal(gate.paused, true);
  assert.equal(before.aborted, true, 'the request in flight stops');
  assert.equal(options.signal.aborted, false, 'the acquisition itself is not cancelled');
  let resumed = false;
  void gate.resumed().then(() => { resumed = true; });
  assert.deepEqual((await r.send('r1', 'resume')).value, { paused: false });
  await turn();
  assert.equal(resumed, true);
  assert.equal(gate.signal().aborted, false, 'a fresh request signal after Resume');
  assert.equal(r.viewerSent.find(m => m.id === 'a1'), undefined, 'still running');
  await r.send('c1', 'cancel');
  const unknown = await r.send('p2', 'pause');
  assert.deepEqual({ ok: unknown.ok, code: unknown.code }, { ok: false, code: 'viewer-download-unavailable' });
});

test('0.63.0: the renderer loads a local edit only from its stored copy, by archive_id, and says why when it cannot', async () => {
  const archiveId = 'a'.repeat(64), opened = [];
  const r = renderer(releaseTrust, null, {
    localRoot: async () => ({ root: true }),
    openLocalCopy: async (_root, id) => { opened.push(id); if (id === 'b'.repeat(64)) throw Error('viewer-local-missing'); return new File(['x'], 'edit.ss'); },
    readSsArchive: async () => ({ archiveId: 'c'.repeat(64) })
  });
  const bad = await r.send('l1', 'load-local', { archiveId: '../x' });
  assert.deepEqual({ ok: bad.ok, code: bad.code }, { ok: false, code: 'viewer-local-invalid' });
  const missing = await r.send('l2', 'load-local', { archiveId: 'b'.repeat(64) });
  assert.deepEqual({ ok: missing.ok, code: missing.code }, { ok: false, code: 'viewer-local-missing' });
  // A stored copy whose identity is not the one asked for is refused before any import.
  const mismatch = await r.send('l3', 'load-local', { archiveId });
  assert.deepEqual({ ok: mismatch.ok, code: mismatch.code }, { ok: false, code: 'viewer-local-invalid' });
  assert.deepEqual(opened, ['b'.repeat(64), archiveId]);
  const gone = await r.send('l4', 'load-folder', { manualId: 'x' });
  assert.equal(gone, undefined, 'the folder method no longer exists');
});

test('0.63.3: after a download the first-Watch checks run at once ("Checking clips n of N"), then Ready; a failed warm-up still ends Ready', async () => {
  for (const failing of [false, true]) {
    const prepared = [];
    const r = renderer(releaseTrust, () => ({
      acquire: async (id, opts) => { opts.onProgress(10, 10); return { releaseId: id, bytes: 10 }; },
      prepare: async (id, opts) => {
        prepared.push(id);
        opts.onPhase('licensing'); opts.onCheck('verifying', 1, 3);
        for (let n = 1; n <= 3; n += 1) opts.onCheck('checking', n, 3);
        if (failing) throw Error('protected-owner-busy');
        return { releaseId: id, clips: 3 };
      },
      close: async () => {}
    }));
    const reply = await r.send('w1', 'acquire');
    for (let i = 0; i < 6; i += 1) await turn();
    assert.deepEqual(prepared, [releaseId]);
    const states = r.viewerSent.filter(m => m.progress).map(m => [m.progress.state, m.progress.bytes, m.progress.total]);
    assert.deepEqual(states.filter(([s]) => s === 'checking'), [['checking', 1, 3], ['checking', 2, 3], ['checking', 3, 3]]);
    assert.deepEqual(states.at(-1), ['ready', 10, 10]);
    assert.equal((reply ?? r.viewerSent.find(m => m.id === 'w1')).ok, true);
  }
});
