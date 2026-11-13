import test from 'node:test';
import assert from 'node:assert/strict';
import { registerViewerService } from '../src/viewer-service.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';
import { createViewerStore } from '../src/viewer-store.mjs';
import { createCatalogDiscovery, releaseDisplay } from '../src/catalog-discovery.mjs';
import { matchingEdits } from '../src/viewer-candidates.mjs';
import { downloadedRows } from '../src/edits-model.mjs';
import { sourceKey } from '../src/viewer-model.mjs';
import { displayHint, keptIds, metadataGaps, recoveryEntries, needsMetadata, batches } from '../src/library-recovery.mjs';
import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';

// Lighthouse-shaped fixture: v1 was superseded by v2 (then v3); both downloads are kept.
const v1 = '662fe299-0000-4000-8000-000000000001';
const v2 = '9c3378eb-0000-4000-8000-000000000002';
const v3 = 'a3a3a3a3-0000-4000-8000-000000000003';
const stranger = 'b4b4b4b4-0000-4000-8000-000000000004';
const editId = '9a7c2e41-3b5d-4f60-8e12-6d4b0c9f1a23';
const gti = 'amzn1.dv.gti.642b66cd-63e6-4cd1-8c97-8e8ba3e95185';
const url = `https://www.amazon.com/gp/video/detail/${gti}`;
const source = { serviceId: 'prime-video', activeItemId: gti, mediaType: 'episode', season: 1, episode: 1, runtimeMs: 2967000, versionTag: null, territory: 'US', plan: 'ad-free' };
const manifestKey = sourceKey(source);
// Prime reports a slightly different runtime and no optional qualifiers.
const liveKey = sourceKey({ serviceId: 'prime-video', activeItemId: gti, mediaType: 'episode', season: 1, episode: 1, runtimeMs: 2967368 });
const NAME = 'Lighthouse 1x01 — Complete Replacement';
const display = (releaseVersion, patch = {}) => ({
  editId, name: NAME, creatorName: 'Test Creator', titleName: 'Lighthouse', episodeName: 'Premiere', releaseVersion, streamingUrl: url, source, ...patch
});
const status = (releaseId, { latest = releaseId, latestVersion = 2, availability = 'available', streamingUrl = url, ...rest } = {}) =>
  ({ releaseId, latestReleaseId: latest, latestVersion, availability, streamingUrl, ...rest });
const paired = items => ({ data: { state: 'paired', items } });
const verified = (id, version, patch = {}) => ({
  id, title: `Premiere · ${id.slice(0, 8)}`, origin: 'website', transport: 'protected', availability: 'downloaded',
  version: String(version), sourceKey: manifestKey, ...patch
});

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { for (const fn of this.listeners) fn(...args); } });
async function until(check, label, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 10)); }
  assert.fail(`timed out: ${label}`);
}
const settle = (ms = 120) => new Promise(r => setTimeout(r, ms));

async function harness({ respond = () => ({ body: paired([]) }), library = [], selections = {}, vault = [], fetchGate } = {}) {
  const id = 'a'.repeat(32), origin = `chrome-extension://${id}`;
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  for (const row of library) await store.upsert(row);
  for (const [key, choice] of Object.entries(selections)) await store.remember(key, choice.id, choice.disabled ?? false, choice.version);
  const runtime = { id, getURL: p => `${origin}/${p}`, onConnect: event(), onMessage: event() };
  const fetches = [], calls = [];
  const fetcher = async (target, init) => {
    if (target.endsWith('/catalog/matches')) return { status: 200, text: async () => JSON.stringify(paired([])) };
    const ids = JSON.parse(init.body).releaseIds;
    fetches.push(ids);
    await fetchGate?.promise;
    const reply = await respond(ids);
    if (reply instanceof Error) throw reply;
    return { status: reply.status ?? 200, text: async () => typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body) };
  };
  const journal = { read: async () => ({ active: { token: 'b'.repeat(64) }, revocations: [] }) };
  const config = { pairingOrigin: 'https://preview.seamlessscene.com', deviceLinkLifetimeSeconds: 2592000 };
  const service = registerViewerService(runtime, config, {
    store, deviceJournal: journal, discovery: createCatalogDiscovery(runtime, config, { journal, fetcher }),
    updates: { check: async () => null, forget() {} }, authorizeRenderer: sender => sender.renderer === true,
    tabs: { update: async () => {}, create: async () => ({ id: 99 }) }
  });
  const ports = [];
  const send = (method, args, sender) => new Promise(resolve =>
    runtime.onMessage.listeners[0]({ kind: 'viewer-v1', method, args, build: EXECUTING_BUILD }, sender, resolve));
  const settings = { id, origin, url: `${origin}/viewer-settings.html`, tab: { id: 90 }, frameId: 0 };
  function connect(tabId, name, handle) {
    const sender = {
      id, origin: 'https://www.amazon.com', url, tab: { id: tabId, url }, frameId: 0,
      documentId: `${tabId}`.repeat(32), documentLifecycle: 'active', renderer: name === 'viewer-renderer-v1'
    };
    const port = {
      name, sender, onMessage: event(), onDisconnect: event(),
      disconnect() { this.onDisconnect.emit(); },
      postMessage(m) {
        if (!m.id) return;
        calls.push({ tabId, port: name, method: m.method, args: m.args });
        queueMicrotask(async () => {
          try { port.onMessage.emit({ id: m.id, ok: true, value: await handle(m, port), build: EXECUTING_BUILD }); }
          catch (error) { port.onMessage.emit({ id: m.id, ok: false, code: error.message, build: EXECUTING_BUILD }); }
        });
      }
    };
    ports.push(port);
    runtime.onConnect.emit(port);
    port.onMessage.emit({ hello: true, build: EXECUTING_BUILD });
    return port;
  }
  // A renderer that acquires without opening (ready receipt only) and lists its vault.
  function renderer(tabId, { player, acquireGate } = {}) {
    return connect(tabId, 'viewer-renderer-v1', async (m, port) => {
      if (m.method === 'acquire') {
        await acquireGate?.promise;
        port.onMessage.emit({ progress: { releaseId: m.args.releaseId, state: 'ready', bytes: 10, total: 10 }, build: EXECUTING_BUILD });
        return { state: 'ready', bytes: 10 };
      }
      if (m.method === 'library') return { items: structuredClone(vault) };
      if (m.method === 'remove') { vault = vault.filter(x => x.releaseId !== m.args.releaseId); return { removed: true }; }
      if (m.method === 'load') {
        // Opening verifies the signed packet and records its own identity (recordViewerEdit).
        const version = m.args.releaseId === v1 ? 1 : 2;
        const put = await send('library-put', verified(m.args.releaseId, version), port.sender);
        assert.equal(put.ok, true);
        Object.assign(player, { state: 'loaded', editId: m.args.releaseId, version: String(version), canArm: true, canStop: true });
        return { state: 'checked' };
      }
      throw Error('viewer-method-denied');
    });
  }
  function controller(tabId, player) {
    return connect(tabId, 'viewer-controller-v1', async m => {
      if (m.method === 'arm') Object.assign(player, { state: 'armed', canArm: false });
      return { ...player };
    });
  }
  return {
    service, store, fetches, calls, runtime, renderer, controller, send,
    settings: (method, args) => send(method, args, settings),
    progress: (port, releaseId, state = 'ready') => port.onMessage.emit({ progress: { releaseId, state, bytes: 10, total: 10 }, build: EXECUTING_BUILD }),
    setVault(next) { vault = next; },
    close() { for (const port of ports) port.disconnect(); }
  };
}

test('display hints re-checked at a boundary keep only the bounded projection', () => {
  const parsed = releaseDisplay({ ...display(2), trusted: true, license: 'x' });
  assert.deepEqual(displayHint(parsed), parsed);
  assert.equal(displayHint({ ...parsed, trusted: true }).trusted, undefined);
  for (const bad of [null, {}, { ...parsed, sourceKey: '[]' }, { ...parsed, sourceKey: 'not-json' },
    { ...parsed, sourceKey: JSON.stringify(['netflix', gti, 'episode', 1, 1, 2967000, null, null, null]) },
    { ...parsed, sourceKey: ` ${parsed.sourceKey}` }, { ...parsed, releaseVersion: '2' }, { ...parsed, editId: 'x' }, { ...parsed, name: ' ' }])
    assert.equal(displayHint(bad), null, JSON.stringify(bad));
  assert.equal(displayHint({ ...parsed, streamingUrl: 'https://private.example/token' }).streamingUrl, undefined);
});

test('status items join only to kept evidence for the same release, and ambiguous duplicates name nothing', () => {
  const kept = keptIds([{ releaseId: v1 }, { releaseId: v2, problem: 'vault-object-size' }, { releaseId: 'bad' }]);
  assert.deepEqual([...kept], [v1], 'a damaged vault entry is not evidence');
  const items = [
    { releaseId: v1, display: releaseDisplay(display(1)) },
    { releaseId: v1, display: releaseDisplay(display(1)) },
    { releaseId: v2, display: releaseDisplay(display(2)) },
    { releaseId: v2, display: releaseDisplay(display(2, { name: 'Other' })) },
    { releaseId: v3 },
    { releaseId: 'not-an-id', display: releaseDisplay(display(3)) }
  ];
  assert.deepEqual(recoveryEntries(items, id => kept.has(id)).map(x => [x.releaseId, x.kept]), [[v1, true]]);
  assert.deepEqual(recoveryEntries(items).map(x => x.kept), [false], 'no evidence by default');
  assert.deepEqual(batches(Array.from({ length: 120 }, (_, i) => i)).map(x => x.length), [50, 50, 20]);
});

test('Edits page gaps are kept releases whose row is missing or incomplete', () => {
  const library = [verified(v1, 1, { name: NAME, streamingUrl: url, displayVersion: 4 }), verified(v2, 2)];
  const vault = [{ releaseId: v1 }, { releaseId: v2 }, { releaseId: v3 }, { releaseId: stranger, problem: 'vault-unreadable' }];
  assert.deepEqual(metadataGaps(library, vault), [v2, v3]);
  assert.deepEqual(metadataGaps(library, null), []);
  assert.equal(needsMetadata(library[0]), false);
  assert.equal(needsMetadata({ ...library[0], displayVersion: undefined }), true, 'a kept row learns its website display version (r30)');
});

test('the store creates rows only with kept evidence and never replaces a recorded identity with a hint', async () => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  const hint = n => releaseDisplay(display(n));
  assert.deepEqual(await store.recoverMetadata([{ releaseId: v2, display: hint(2), kept: false }]), []);
  assert.deepEqual((await store.read()).library, [], 'a hint or requested ID alone is not a download');
  assert.deepEqual(await store.recoverMetadata([{ releaseId: v2, display: hint(2), kept: true }], 5), [v2]);
  let row = (await store.read()).library[0];
  assert.deepEqual(
    [row.name, row.title, row.version, row.sourceKey, row.availability, row.transport, row.streamingUrl, row.titleName, row.episodeName, row.downloadedAt, row.metadataSource],
    [NAME, NAME, '2', manifestKey, 'downloaded', 'protected', url, 'Lighthouse', 'Premiere', 5, 'status-hint']);
  assert.deepEqual(await store.recoverMetadata([{ releaseId: v2, display: hint(2), kept: true }]), [], 'repeat is a no-op');

  // Opening the packet later records its verified identity; names stay.
  const opened = sourceKey({ ...source, runtimeMs: 2967001 });
  await store.upsert(verified(v2, 2, { sourceKey: opened }));
  row = (await store.read()).library[0];
  assert.deepEqual([row.sourceKey, row.version, row.name, row.metadataSource, row.downloadedAt], [opened, '2', NAME, undefined, 5]);

  // A verified row gains only missing descriptive fields.
  await store.upsert(verified(v1, 1, { name: 'Viewer-visible name' }));
  assert.deepEqual(await store.recoverMetadata([{ releaseId: v1, display: hint(1), kept: true }]), [v1]);
  row = (await store.read()).library.find(x => x.id === v1);
  assert.deepEqual([row.name, row.version, row.sourceKey, row.streamingUrl, row.creatorName], ['Viewer-visible name', '1', manifestKey, url, 'Test Creator']);

  // Contradicting hints describe something else and change nothing.
  await store.upsert(verified(v3, 3, { editId }));
  for (const patch of [{ releaseVersion: 4 }, { source: { ...source, episode: 2 } }, { editId: '11111111-1111-4111-8111-111111111111' }])
    assert.deepEqual(await store.recoverMetadata([{ releaseId: v3, display: releaseDisplay(display(3, patch)), kept: true }]), [], JSON.stringify(patch));
  assert.equal((await store.read()).library.find(x => x.id === v3).name, undefined);
  // Malformed hints are refused at the store gate even when they bypass the parser.
  assert.deepEqual(await store.recoverMetadata([{ releaseId: stranger, kept: true, display: { ...hint(1), sourceKey: '["x"]' } }]), []);
});

test('E51: a key only an earlier status hint supplied is replaced by a kept release\'s newer hint, never one a packet recorded', async () => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  const relisted = { ...source, activeItemId: 'amzn1.dv.gti.50946088-13e9-4b60-8edc-5948d3b66843' };
  assert.deepEqual(await store.recoverMetadata([{ releaseId: v2, display: releaseDisplay(display(2)), kept: true }], 5), [v2]);
  // The website corrected the release's source (e.g. Prime re-listed the title).
  assert.deepEqual(await store.recoverMetadata([{ releaseId: v2, display: releaseDisplay(display(2, { source: relisted })), kept: false }]), [],
    'without kept evidence a hint changes nothing');
  assert.deepEqual(await store.recoverMetadata([{ releaseId: v2, display: releaseDisplay(display(2, { source: relisted })), kept: true }]), [v2]);
  let row = (await store.read()).library[0];
  assert.deepEqual([row.sourceKey, row.version, row.metadataSource], [sourceKey(relisted), '2', 'status-hint']);
  // Once the packet is opened its recorded identity wins over any later hint.
  await store.upsert(verified(v2, 2));
  assert.deepEqual(await store.recoverMetadata([{ releaseId: v2, display: releaseDisplay(display(2, { source: relisted })), kept: true }]), []);
  row = (await store.read()).library[0];
  assert.deepEqual([row.sourceKey, row.metadataSource], [manifestKey, undefined]);
  // A hint for another edit never replaces the row.
  assert.deepEqual(await store.recoverMetadata([{ releaseId: v3, display: releaseDisplay(display(3)), kept: true }], 6), [v3]);
  assert.deepEqual(await store.recoverMetadata([{ releaseId: v3, display: releaseDisplay(display(3, { editId: '11111111-1111-4111-8111-111111111111', source: relisted })), kept: true }]), []);
  assert.equal((await store.read()).library.find(x => x.id === v3).sourceKey, manifestKey);
});

test('version labels distinguish kept editions of one edit in the library and the episode choices', async () => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  await store.recoverMetadata([
    { releaseId: v1, display: releaseDisplay(display(1)), kept: true },
    { releaseId: v2, display: releaseDisplay(display(2)), kept: true }
  ]);
  const { library } = await store.read();
  const rows = downloadedRows({ library, vault: [{ releaseId: v1, bytes: 70_900_000 }, { releaseId: v2, bytes: 77_892_767 }],
    updates: { [v1]: status(v1, { latest: v3, latestVersion: 3 }) } });
  const by = id => rows.find(r => r.releaseId === id);
  assert.deepEqual([by(v1).name, by(v1).version, by(v1).status.label, by(v1).episodeName], [NAME, '1', 'Update to v3', 'Premiere']);
  assert.deepEqual([by(v2).name, by(v2).version, by(v2).status.kind], [NAME, '2', 'ready']);
  assert.ok(by(v2).actions.includes('watch'), 'a recovered row has its Watch link');
  const matches = matchingEdits({ state: 'idle', sourceKey: liveKey }, library, null, { id: v2, version: '2', disabled: false });
  assert.deepEqual(matches.map(x => x.title), [`${NAME} · v1 · check compatibility`, `${NAME} · v2`]);
  assert.deepEqual(matchingEdits({ state: 'idle', sourceKey: liveKey }, [library[1]]).map(x => x.title), [`${NAME} · check compatibility`]);
});

test('update → ready receipt → exact metadata → candidate → remembered arm through the real store and service', async () => {
  const h = await harness({
    library: [verified(v1, 1, { name: NAME, streamingUrl: url, titleName: 'Lighthouse' })],
    selections: { [liveKey]: { id: v1, version: '1' } },
    respond: ids => ({ body: paired(ids.map(id => status(id, { latestVersion: 2, display: display(id === v2 ? 2 : 1) }))) })
  });
  try {
    h.renderer(7, { player: {} });
    await settle(30);
    await h.service.recordIntent(v2, { replaces: v1 });
    await until(async () => (await h.store.read()).selections[liveKey]?.id === v2, 'update completion');
    assert.deepEqual(h.fetches, [[v2]], 'one status request, for the ready release only');
    let data = await h.store.read();
    const row = data.library.find(x => x.id === v2);
    assert.deepEqual([row.name, row.version, row.sourceKey, row.streamingUrl, row.metadataSource], [NAME, '2', manifestKey, url, 'status-hint']);
    assert.ok(data.library.some(x => x.id === v1), 'the previous download keeps its row');
    assert.deepEqual(data.selections[liveKey], { id: v2, version: '2', disabled: false });
    assert.deepEqual(await h.store.intents(), []);
    assert.equal(h.service.job(v2).state, 'ready');

    // The player opens the episode: the remembered update loads and arms.
    const player = { state: 'idle', sourceKey: liveKey, generation: '1', canStop: false, canArm: false };
    const top = h.controller(8, player);
    h.renderer(8, { player });
    await until(() => player.state === 'armed', 'remembered arm');
    const load = h.calls.find(c => c.tabId === 8 && c.method === 'load');
    assert.deepEqual(load.args, { releaseId: v2, online: false, combined: false });
    data = await h.store.read();
    assert.equal(data.library.find(x => x.id === v2).metadataSource, undefined, 'the opened packet now owns the identity');
    const snapshot = await h.send('snapshot', {}, top.sender);
    assert.deepEqual(snapshot.value.matches.map(x => [x.id, x.title]), [[v1, `${NAME} · v1 · check compatibility`], [v2, `${NAME} · v2`]]);
    assert.deepEqual(h.fetches, [[v2]], 'no further status requests');
  } finally { h.close(); }
});

const refusals = {
  'old server without display': { body: paired([status(v2)]) },
  'no access': { body: paired([status(v2, { availability: 'no-access', streamingUrl: null })]) },
  'unknown release omitted': { body: paired([]) },
  'malformed display': { body: paired([status(v2, { display: display(2, { source: { ...source, runtimeMs: 'x' } }) })]) },
  'unrelated display only': { body: paired([status(stranger, { display: display(2) })]) },
  'unavailable link': { body: { data: { state: 'unavailable' } } },
  'rate limited': { status: 429, body: '' },
  'network failure': Error('offline')
};
for (const [label, reply] of Object.entries(refusals)) test(`${label}: the download stays ready without a row, a loop or an update completion`, async () => {
  const h = await harness({
    library: [verified(v1, 1, { name: NAME })], selections: { [liveKey]: { id: v1, version: '1' } }, respond: () => reply
  });
  try {
    h.renderer(7, { player: {} });
    await settle(30);
    await h.service.recordIntent(v2, { replaces: v1 });
    await until(() => h.fetches.length === 1, 'post-ready request');
    await settle();
    const data = await h.store.read();
    assert.equal(data.library.some(x => x.id === v2), false);
    assert.equal(h.service.job(v2).state, 'ready');
    assert.deepEqual(data.selections[liveKey], { id: v1, version: '1', disabled: false });
    assert.equal((await h.store.intents()).length, 1, 'the update waits for real metadata');
    // The Edits page's three-second refresh asks once, then not again this minute.
    for (let i = 0; i < 3; i++) await h.settings('release-metadata', { releaseIds: [v2] });
    assert.equal(h.fetches.length, 2);
    await settle();
    assert.equal(h.fetches.length, 2, 'no polling loop');
  } finally { h.close(); }
});

test('out-of-order: an opened packet recorded before the status reply keeps its verified identity', async () => {
  for (const hinted of [2, 3]) {
    const gate = deferred();
    const h = await harness({ fetchGate: gate, respond: () => ({ body: paired([status(v2, { display: display(hinted) })]) }) });
    try {
      const port = h.renderer(7, { player: {} });
      await settle(30);
      h.progress(port, v2);
      await until(() => h.fetches.length === 1, 'post-ready request');
      const opened = sourceKey({ ...source, runtimeMs: 2967001 });
      assert.equal((await h.send('library-put', verified(v2, 2, { sourceKey: opened }), port.sender)).ok, true);
      gate.resolve();
      await settle();
      const row = (await h.store.read()).library.find(x => x.id === v2);
      assert.deepEqual([row.version, row.sourceKey, row.metadataSource], ['2', opened, undefined]);
      assert.equal(row.name, undefined, 'a hint that contradicts the verified row changes nothing');
    } finally { h.close(); }
  }
});

test('out-of-order: a release removed before the status reply is not recreated', async () => {
  const gate = deferred();
  const h = await harness({ fetchGate: gate, vault: [{ releaseId: v2, bytes: 10 }], respond: () => ({ body: paired([status(v2, { display: display(2) })]) }) });
  try {
    const port = h.renderer(7, { player: {} });
    await settle(30);
    h.progress(port, v2);
    await until(() => h.fetches.length === 1, 'post-ready request');
    assert.equal((await h.settings('edits-remove', { releaseId: v2 })).ok, true);
    gate.resolve();
    await settle();
    assert.equal((await h.store.read()).library.some(x => x.id === v2), false);
  } finally { h.close(); }
});

test('Check for updates recovers orphan and held old downloads from renderer vault evidence only', async () => {
  const requested = Array.from({ length: 117 }, (_, i) => `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const h = await harness({
    vault: [{ releaseId: v1, bytes: 70_900_000 }, { releaseId: v2, bytes: 77_892_767 }],
    respond: ids => ({ body: paired(ids.map(id =>
      id === v1 ? status(v1, { latest: v3, latestVersion: 3, streamingUrl: 'https://www.amazon.com/gp/video/detail/B03566CDE8', display: display(1) })
        : id === v2 ? status(v2, { latest: v3, latestVersion: 3, display: display(2) })
          : status(id, { display: display(5) }))) })
  });
  try {
    h.renderer(7, { player: {} });
    await settle(30);
    const result = await h.settings('check-updates', { releaseIds: [stranger, stranger, 'bad', v2.toUpperCase(), ...requested] });
    assert.equal(result.ok, true);
    assert.deepEqual(h.fetches.map(x => x.length), [50, 50, 20], 'batched at 50');
    assert.deepEqual(h.fetches.flat().slice(0, 3), [v1, v2, stranger], 'vault orphans and valid distinct IDs only');
    const { library } = await h.store.read();
    assert.deepEqual(library.map(x => x.id).sort(), [v1, v2].sort(), 'requested IDs without kept evidence get no row');
    const old = library.find(x => x.id === v1);
    assert.deepEqual([old.version, old.streamingUrl, old.sourceKey], ['1', url, manifestKey], 'the held release keeps its own exact description, not its successor’s');
    assert.equal(result.value.items.find(x => x.releaseId === v1).latestReleaseId, v3);
    assert.equal((await h.settings('check-updates', { releaseIds: 'x' })).code, 'viewer-release-invalid');
    // The explicit check also answers the page's next automatic request.
    const before = h.fetches.length;
    await h.settings('release-metadata', { releaseIds: [v1, v2] });
    assert.equal(h.fetches.length, before);
  } finally { h.close(); }
});

test('without a player tab the service only asks; the Settings vault listing supplies the evidence', async () => {
  const h = await harness({ respond: ids => ({ body: paired(ids.map(id => status(id, { display: display(id === v1 ? 1 : 2) }))) }) });
  try {
    const listing = [{ releaseId: v1, bytes: 1 }, { releaseId: v2, bytes: 1, problem: 'vault-unreadable' }];
    const result = await h.settings('release-metadata', { releaseIds: metadataGaps([], listing) });
    assert.deepEqual(h.fetches, [[v1]]);
    assert.deepEqual((await h.store.read()).library, [], 'no evidence in the service');
    // edits-page recordStatus: the page's own protected vault listing is the evidence.
    const kept = keptIds(listing);
    assert.deepEqual(await h.store.recoverMetadata(recoveryEntries(result.value.items, id => kept.has(id))), [v1]);
  } finally { h.close(); }
});
