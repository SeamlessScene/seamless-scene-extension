import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewerStore } from '../src/viewer-store.mjs';
import { sourceKey } from '../src/viewer-model.mjs';
import { importLocalEdit, removeLocalEdit, cleanupLocalOrphans, localRows, openLocalCopy } from '../src/local-library.mjs';
import { readSsArchive } from '../src/ss-archive.mjs';
import { downloadFailureCode, viewerLoadMessage } from '../src/viewer-load-error.mjs';
import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';
import { ssFile, memoryRoot } from './helpers/ss-fixture.mjs';
import { harness, until } from './helpers/local-harness.mjs';
import { harness as downloads, A, until as untilDownload } from './helpers/download-harness.mjs';

// 0.63.3: local .ss offers and removal, and download problems.
// Catalog bindings shaped like real ones seen in 0.63.2 diagnostics (sourceCheck.stored) and
// in an E51 republish.
const VALE_LIVE = { service: 'prime-video', territory: 'US', title: 'Deep Current', season: 1, episode: 2, service_tier: 'ad-free', version_tag: 'creator-reported',
  runtime_tolerance_ms: 3000, service_content_id: 'amzn1.dv.gti.4a8535a2-1dac-42fe-8783-3101673b0f08', expected_runtime_ms: 3047656 };
const VALE_PRE_E51 = { ...VALE_LIVE, runtime_tolerance_ms: 1000, service_content_id: 'amzn1.dv.gti.f14ea779-920d-4779-8429-0ce2ed6d1705' };
// What Prime's player reports on S1E2 (prime-identity-reader: no qualifiers; runtime drifts by about a second).
const liveKey = (gti = VALE_LIVE.service_content_id, runtimeMs = 3_047_400) => sourceKey({ serviceId: 'prime-video', activeItemId: gti, mediaType: 'episode', season: 1, episode: 2, runtimeMs, versionTag: null, territory: null, plan: null });
const okCheck = async () => ({ ok: true });
async function addTo(store, root, options) {
  const made = await ssFile(options);
  const result = await importLocalEdit(made.file, { store, root, preferences: (await store.read()).preferences, validate: okCheck });
  return { ...made, result };
}

test('the local Vale built on the live (E51) catalog binding is offered on Prime S1E2 through the real service wiring; the 0.63.0 fixture key (pre-E51 GTI) was the cause', async t => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() }), root = memoryRoot();
  const live = await addTo(store, root, { packetId: 'marlow-local', title: 'Captain Vale, Night Shift', source: VALE_LIVE });
  const old = await addTo(store, root, { packetId: 'marlow-old-fixture', title: 'Old Vale fixture', source: VALE_PRE_E51, seed: 'o' });
  assert.equal(live.result.status, 'added');
  const h = await harness(t, { store });
  const { p } = h.player(1, liveKey());
  const names = (await h.send('snapshot', {}, h.top(1))).value.matches.map(m => m.name);
  assert.deepEqual(names, ['Local: Captain Vale, Night Shift'], 'offered; the pre-E51 copy is not (Prime plays S1E2 under a new title ID)');
  // Local tab → Watch with the episode open turns it on in that tab.
  const watched = await h.send('local-watch', { archiveId: live.archiveId }, h.settings);
  assert.equal(watched.ok, true, JSON.stringify(watched));
  assert.equal(p.state, 'armed');
  assert.deepEqual(h.calls.find(c => c.method === 'load-local').args, { archiveId: live.archiveId });
  void old;
});

test('local and cloud edits for the same episode are both offered and nothing turns on by itself; only a remembered choice does', async t => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() }), root = memoryRoot();
  const local = await addTo(store, root, { packetId: 'cr-local', title: 'Pilot Swap (local)', source: VALE_LIVE });
  const release = '11111111-1111-4111-8111-111111111111';
  await store.upsert({ id: release, title: 'Pilot Swap (cloud)', name: 'Pilot Swap (cloud)', origin: 'website', transport: 'protected', availability: 'downloaded', version: '5',
    sourceKey: sourceKey({ serviceId: 'prime-video', activeItemId: VALE_LIVE.service_content_id, mediaType: 'episode', season: 1, episode: 2, runtimeMs: 3047656, versionTag: 'creator-reported', territory: 'US', plan: 'ad-free' }), editSignature: 'f'.repeat(64) });
  await store.annotate(release, 'website', { downloadedAt: 1 });
  assert.equal(localRows(await store.localEdits(), { library: (await store.read()).library })[0].status.label, 'Also downloaded from the website');
  const h = await harness(t, { store });
  const { p } = h.player(1, liveKey());
  const snap = (await h.send('snapshot', {}, h.top(1))).value;
  assert.deepEqual(snap.matches.map(m => m.id).sort(), [release, `local:${local.archiveId}`].sort(), 'both offered');
  const r = await h.send('command', { command: 'watch', generation: '1' }, h.top(1));
  assert.equal(r.ok, true);
  assert.equal(r.value.message, 'Choose a downloaded edit to watch.');
  assert.equal(p.state, 'idle', 'nothing turned on');
  // A remembered per-episode choice (the cloud edit) is the exception; the local one stays offered.
  const h2 = await harness(t, { store, prefs: { autoArm: true } });
  await store.remember(liveKey(), release, false, '5');
  const tab = h2.player(2, liveKey());
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.ok(h2.calls.some(c => c.method === 'load' && c.args.releaseId === release), 'the remembered cloud edit loads');
  assert.ok((await h2.send('snapshot', {}, h2.top(2))).value.matches.some(m => m.id === `local:${local.archiveId}`));
  void tab;
});

test('a file with the same archive_id but different clip bytes is checked (and refused), not "already added"', async () => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() }), root = memoryRoot();
  // A real clip check: every clip's SHA-256 against its binding (as the local validation does).
  const hashCheck = async files => {
    for (const f of files.slice(1)) {
      const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (!f.webkitRelativePath.includes(hex)) throw Error('Local clip rejected: hash-mismatch');
    }
    return { ok: true };
  };
  const good = await ssFile({ count: 3 });
  const archive = await readSsArchive(good.file), clip = archive.entries.find(e => e.path.startsWith('clips/'));
  const bytes = new Uint8Array(await good.file.arrayBuffer()); bytes[clip.offset + 5] ^= 0xff;
  const tampered = new File([bytes], 'TAMPERED clip.ss');
  assert.equal((await readSsArchive(tampered)).archiveId, good.archiveId, 'precondition: the same identity');
  const add = file => importLocalEdit(file, { store, root, preferences: {}, validate: hashCheck });
  // With no good copy present: refused by the clip check.
  const alone = await add(tampered);
  assert.equal(alone.status, 'refused');
  assert.match(alone.message, /clips did not pass the check.*hash-mismatch/);
  // With the good copy present: still refused, and the good copy is untouched.
  assert.equal((await add(good.file)).status, 'added');
  const again = await add(tampered);
  assert.equal(again.status, 'refused');
  assert.match(again.message, /clips did not pass the check/);
  assert.deepEqual(new Uint8Array(await (await openLocalCopy(root, good.archiveId)).arrayBuffer()), new Uint8Array(await good.file.arrayBuffer()));
  // The very same bytes are "already added" (no check).
  let checks = 0;
  const same = await importLocalEdit(new File([good.file], 'copy.ss'), { store, root, preferences: {}, validate: async () => { checks += 1; return { ok: true }; } });
  assert.deepEqual([same.status, checks], ['already', 0]);
});

test('Remove of a local edit that is on stops it in its tab first; a copy still in use is deleted later, never a generic error', async t => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() }), root = memoryRoot();
  const added = await addTo(store, root, { packetId: 'marlow-local', title: 'Captain Vale, Night Shift', source: VALE_LIVE });
  const h = await harness(t, { store });
  const { p } = h.player(1, liveKey());
  await h.send('local-watch', { archiveId: added.archiveId }, h.settings);
  assert.equal(p.state, 'armed');
  const stopped = await h.send('local-stop', { archiveId: added.archiveId }, h.settings);
  assert.deepEqual(stopped.value, { stopped: 1 });
  assert.equal(p.state, 'idle');
  // The storage refuses to delete the copy (still open): the row goes, the copy is deleted later.
  let locked = true;
  const lockedRoot = { ...root, removeEntry: async name => { if (locked) throw Object.assign(Error('in use'), { name: 'NoModificationAllowedError' }); return root.removeEntry(name); } };
  const result = await removeLocalEdit(added.archiveId, { store, root: lockedRoot, wait: async () => {} });
  assert.deepEqual(result, { deferred: true });
  assert.deepEqual(await store.localEdits(), []);
  assert.deepEqual(await store.localOrphans(), [added.archiveId]);
  locked = false;
  assert.equal(await cleanupLocalOrphans({ store, root: lockedRoot }), 0);
  assert.deepEqual(await store.localOrphans(), []);
  await assert.rejects(openLocalCopy(root, added.archiveId), /viewer-local-missing/);
});

test('"Previously queued" never lists an edit that is kept or ready', async t => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  await store.addIntent(A, Date.now() - 13 * 3_600_000);
  await store.expireIntents(() => true);
  await store.upsert({ id: A, title: 'Avery Cut', origin: 'website', transport: 'protected', availability: 'downloaded', version: '1', sourceKey: 'k' });
  const h = await downloads(t, { store });
  assert.deepEqual((await h.snapshot()).previouslyQueued, []);
  await untilDownload(async () => (await store.previousQueue()).length === 0, 'the entry is dropped');
});

test('a network loss reads "Download interrupted" with Retry, not "could not be opened… restart Chrome"', () => {
  assert.equal(downloadFailureCode(new TypeError('Failed to fetch')), 'viewer-download-interrupted');
  assert.equal(downloadFailureCode(Object.assign(Error('The operation was aborted.'), { name: 'AbortError' })), 'viewer-download-interrupted');
  assert.equal(downloadFailureCode(Error('net::ERR_INTERNET_DISCONNECTED')), 'viewer-download-interrupted');
  assert.equal(downloadFailureCode(Error('protected-server-unavailable')), 'viewer-server-unavailable');
  assert.equal(downloadFailureCode(Error('protected-access-refused')), 'viewer-access-refused');
  assert.equal(downloadFailureCode(Error('something-else')), 'viewer-protected-open-failed');
  assert.equal(viewerLoadMessage('viewer-download-interrupted'), 'Download interrupted. Choose Retry to continue.');
});

test('release names and download statistics survive a service restart; Clear never removes statistics', async t => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  const h = await downloads(t, { store });
  h.renderer(1);
  await h.service.recordIntent(A);
  await untilDownload(async () => (await h.job(A))?.name === 'Avery Cut', 'named');
  h.finish(h.acquireCalls()[0][0], A);
  await untilDownload(async () => (await h.snapshot()).downloadStats?.length === 1, 'stat kept');
  await h.send('download-control', { action: 'clear-all' }, h.settings);
  // A new service (restart) with the same storage and no website: names and stats remain.
  const failing = { discover: async () => ({ items: [] }), checkReleases: async () => { throw Error('offline'); } };
  const again = await downloads(t, { store, discovery: failing });
  const snap = await again.snapshot();
  assert.equal(snap.downloadStats.length, 1);
  assert.equal(snap.downloadStats[0].release, A.slice(0, 8));
  assert.ok(snap.downloadHistory.some(e => e.release === A.slice(0, 8) && e.state === 'ready' && Number.isFinite(e.at)));
  assert.equal((await store.read()).releaseNames[A].name, 'Avery Cut');
});
