// E51 (0.62.4): a website Watch whose download is kept but matches nothing on the
// player. In testing, every edit of one series showed Ready in the Library while
// the player said "No downloaded edit for this episode". The Prime page the website
// opened is the edits' recorded title, but Prime now plays S1E1 and S1E2 under
// other title IDs.
// The service now opens the kept edit on that page and lets the player's own
// source check answer, and it reports the live and stored keys in diagnostics.
// Also E50: a chooser answer drops an older failed load's Problem view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerViewerService } from '../src/viewer-service.mjs';
import { sourceKey } from '../src/viewer-model.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';

const releaseId = '4a7774eb-1111-4111-8111-111111111111', otherId = '0fb59c4d-2222-4222-8222-222222222222';
const recorded = 'amzn1.dv.gti.b4689d1b-576e-41be-8564-68a3dd914a61', live = 'amzn1.dv.gti.50946088-13e9-4b60-8edc-5948d3b66843';
const deepCurrentPage = `https://www.amazon.com/gp/video/detail/${recorded}`;
// The website's status hint: the signed manifest's source (as library-recovery stores it).
const hintKey = sourceKey({ serviceId: 'prime-video', activeItemId: recorded, mediaType: 'episode', season: 1, episode: 1, runtimeMs: 2967368, versionTag: 'creator-reported', territory: 'US', plan: 'ad-free' });
// What Prime's player reports now: same season/episode, another title ID.
const liveKey = sourceKey({ serviceId: 'prime-video', activeItemId: live, mediaType: 'episode', season: 1, episode: 1, runtimeMs: 2967400 });
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(v) { for (const fn of this.listeners) fn(v); } });

async function harness({ page = deepCurrentPage, armError = 'viewer-title-id-changed', rows, intents: initialIntents = [{ releaseId, attemptId: 'attempt-1' }], failRendererLibrary = false } = {}) {
  const id = 'a'.repeat(32), origin = `chrome-extension://${id}`;
  const runtime = { id, getURL: p => `${origin}/${p}`, onConnect: event(), onMessage: event() };
  const calls = [], remembered = [];
  let intents = structuredClone(initialIntents);
  const data = {
    preferences: { autoArm: false }, selections: {},
    library: rows ?? [{ id: releaseId, title: 'Highlights', name: 'Highlights', version: '3', sourceKey: hintKey, origin: 'website', transport: 'protected',
      availability: 'downloaded', streamingUrl: deepCurrentPage, metadataSource: 'status-hint', downloadedAt: 1 }]
  };
  const store = {
    read: async () => structuredClone(data),
    remember: async (...args) => { remembered.push(args); },
    annotate: async () => null,
    intents: async () => structuredClone(intents),
    consumeIntent: async (rid, attempt) => { intents = intents.filter(x => x.releaseId !== rid || x.attemptId !== attempt); },
    manualEdits: async () => []
  };
  registerViewerService(runtime, {}, { store, deviceJournal: {}, authorizeRenderer: () => true,
    tabs: { update: async () => {}, create: async () => ({ id: 90 }), get: async () => ({ url: page }) } });
  const player = { state: 'idle', sourceKey: liveKey, generation: 'g1', canStop: false, canArm: false };
  const ports = {};
  for (const name of ['viewer-controller-v1', 'viewer-renderer-v1']) {
    const port = {
      name,
      sender: { id, origin: 'https://www.amazon.com', url: page, tab: { id: 1, url: page }, frameId: 0, documentId: '1'.repeat(32), documentLifecycle: 'active' },
      onMessage: event(), onDisconnect: event(), disconnect() { this.onDisconnect.emit(); },
      postMessage(m) {
        if (!m.id) return;
        calls.push({ port: name, method: m.method, args: m.args });
        queueMicrotask(() => {
          let error = null;
          if (m.method === 'load') {
            if (m.args.releaseId === 'fail') error = 'viewer-owner-busy';
            else Object.assign(player, { state: 'loaded', editId: m.args.releaseId, version: '3', canArm: true, canStop: true });
          }
          if (m.method === 'arm') {
            if (armError) error = armError;
            else Object.assign(player, { state: 'armed', canArm: false });
          }
          if (m.method === 'library' && failRendererLibrary) error = 'viewer-no-owner';
          // A kept release: acquiring it again answers at once with a ready receipt.
          if (m.method === 'acquire') port.onMessage.emit({ progress: { releaseId: m.args.releaseId, state: 'ready', bytes: 2, total: 2, operation: 'acquire' }, build: EXECUTING_BUILD });
          port.onMessage.emit(error ? { id: m.id, ok: false, code: error, build: EXECUTING_BUILD }
            : { id: m.id, ok: true, value: m.method === 'library' ? { items: [] } : { ...player }, build: EXECUTING_BUILD });
        });
      }
    };
    ports[name] = port;
    runtime.onConnect.emit(port);
    port.onMessage.emit({ hello: true, build: EXECUTING_BUILD });
  }
  await flush();
  const status = () => ports['viewer-controller-v1'].onMessage.emit({ status: { ...player }, build: EXECUTING_BUILD });
  const call = (method, args) => new Promise(resolve => runtime.onMessage.listeners[0](
    { kind: 'viewer-v1', method, args, build: EXECUTING_BUILD }, { id, origin, url: `${origin}/viewer-settings.html`, tab: { id: 90 }, frameId: 0 }, resolve));
  return { calls, remembered, player, data, status, call, intents: () => intents, ports,
    loads: () => calls.filter(c => c.method === 'load'), arms: () => calls.filter(c => c.method === 'arm'),
    close() { for (const port of Object.values(ports)) port.disconnect(); } };
}

test('E51: a kept Watch edit that matches nothing is opened on the page it was made for, and the source check decides', async () => {
  const h = await harness();
  try {
    h.status(); await flush();
    assert.deepEqual(h.loads().map(c => c.args), [{ releaseId, online: false, combined: false }], 'the kept edit is opened offline, once');
    assert.equal(h.arms().length, 1, 'turning it on runs the player source check');
    assert.equal(h.intents().length, 1, 'a refused check keeps the Watch for a later fix');
    // The same episode and Watch are not retried on every status heartbeat.
    h.player.state = 'idle'; h.player.editId = undefined; h.player.canArm = false; h.player.canStop = false;
    h.status(); await flush();
    h.ports['viewer-controller-v1'].onMessage.emit({ status: { state: 'unavailable' }, build: EXECUTING_BUILD }); await flush();
    h.status(); await flush();
    assert.equal(h.loads().length, 1);
  } finally { h.close(); await flush(); }
});

test('E51: when the player accepts the kept edit it turns on, is remembered and the Watch is used', async () => {
  const h = await harness({ armError: null });
  try {
    h.status(); await flush();
    assert.equal(h.loads().length, 1); assert.equal(h.arms().length, 1);
    assert.equal(h.player.state, 'armed');
    assert.deepEqual(h.remembered.at(-1), [liveKey, releaseId, false, '3']);
    assert.deepEqual(h.intents(), []);
  } finally { h.close(); await flush(); }
});

test('E51: another title page never opens a Watch it does not name; a running download waits for its ready receipt', async () => {
  const series1 = await harness({ page: 'https://www.amazon.com/gp/video/detail/amzn1.dv.gti.5d4da14b-1720-4718-8554-7b231191ff5e' });
  try { series1.status(); await flush(); assert.equal(series1.loads().length, 0); }
  finally { series1.close(); await flush(); }
  // No row yet (download running): nothing is opened until the ready receipt and its metadata.
  const running = await harness({ rows: [] });
  try {
    running.ports['viewer-renderer-v1'].onMessage.emit({ progress: { releaseId, state: 'downloading', bytes: 1, total: 2 }, build: EXECUTING_BUILD });
    running.status(); await flush();
    assert.equal(running.loads().length, 0);
    running.data.library.push({ id: releaseId, title: 'Highlights', version: '3', sourceKey: hintKey, origin: 'website', transport: 'protected',
      availability: 'downloaded', streamingUrl: deepCurrentPage, metadataSource: 'status-hint' });
    running.ports['viewer-renderer-v1'].onMessage.emit({ progress: { releaseId, state: 'ready', bytes: 2, total: 2 }, build: EXECUTING_BUILD });
    await flush();
    assert.equal(running.loads().length, 1, 'the ready receipt re-runs the waiting Watch');
  } finally { running.close(); await flush(); }
});

test('E51: diagnostics carry the live and stored source keys; the Edits page poll is not a command failure', async () => {
  const h = await harness({ intents: [], failRendererLibrary: true });
  try {
    h.status(); await flush();
    assert.equal((await h.call('edits-library', {})).code, 'viewer-no-owner');
    const snap = (await h.call('snapshot', { tabId: 1 })).value;
    assert.deepEqual(snap.commandFailures, [], 'edits-library viewer-no-owner is a normal answer, not a failure');
    assert.deepEqual(snap.sourceCheck, { live: liveKey,
      stored: [{ release: releaseId.slice(0, 8), sourceKey: hintKey, from: 'status-hint', sameKey: false, sameTitleId: false }] });
    // Other failures are still recorded.
    assert.equal((await h.call('edits-remove', { releaseId: 'not-a-release' })).code, 'viewer-release-invalid');
    assert.equal((await h.call('snapshot', { tabId: 1 })).value.commandFailures.length, 1);
  } finally { h.close(); await flush(); }
});

test('E50: a chooser answer clears the stale failed load so the downloaded choices show again', async () => {
  const both = [hintKey, hintKey].map((key, i) => ({ id: [releaseId, otherId][i], title: `Edit ${i}`, version: '1', sourceKey: liveKey, origin: 'website', transport: 'protected', availability: 'downloaded' }));
  const h = await harness({ rows: both, intents: [] });
  try {
    h.status(); await flush();
    // A failed load of a real release (another tab holds the edits).
    h.ports['viewer-renderer-v1'].postMessage = (orig => m => orig({ ...m, args: m.method === 'load' ? { ...m.args, releaseId: 'fail' } : m.args }))(h.ports['viewer-renderer-v1'].postMessage.bind(h.ports['viewer-renderer-v1']));
    assert.equal((await h.call('load', { tabId: 1, releaseId, generation: 'g1' })).code, 'viewer-owner-busy');
    assert.equal((await h.call('snapshot', { tabId: 1 })).value.load.state, 'failed');
    const answer = await h.call('command', { tabId: 1, command: 'watch', generation: 'g1' });
    assert.equal(answer.ok, true); assert.equal(answer.value.matches.length, 2);
    assert.equal((await h.call('snapshot', { tabId: 1 })).value.load, null, 'the chooser replaces the two-minute Problem view');
  } finally { h.close(); await flush(); }
});
