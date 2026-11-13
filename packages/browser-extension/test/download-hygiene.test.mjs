import test from 'node:test';
import assert from 'node:assert/strict';
import { A, B, event, until, harness } from './helpers/download-harness.mjs';
import { createViewerStore } from '../src/viewer-store.mjs';
import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';
import { createLibraryRemoval, vaultRemover } from '../src/library-removal.mjs';
import { viewerView } from '../src/viewer-display.mjs';
import { menuMarkup } from '../src/viewer-overlay.mjs';
import { previousRows, downloadRows } from '../src/edits-model.mjs';

// 0.63.2 (owner, desktop): Clear for failed downloads; stale queue entries expire instead of
// restarting days later; Remove works with no Prime tab open.
const HOUR = 3_600_000;

test('a failed download stays failed (no silent restart), and Clear / Clear all remove it with its Watch', async t => {
  const h = await harness(t);
  h.renderer(1);
  await h.service.recordIntent(A);
  await until(() => h.acquireCalls().length === 1, 'A starts');
  h.acquires.get(`1|${A}`).reject(Error('viewer-server-unavailable'));
  await until(async () => (await h.job(A))?.state === 'failed', 'A failed');
  const [intent] = await h.store.intents();
  assert.ok(Number.isSafeInteger(intent.failedAt), 'the Watch is marked failed');
  // A new player tab (or a service restart) does not start it again.
  h.renderer(2);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(h.acquireCalls().length, 1);
  assert.deepEqual(downloadRows({ jobs: [await h.job(A)] })[0].actions, ['retry', 'clear']);
  let reply = await h.send('download-control', { action: 'clear', releaseId: A }, h.settings);
  assert.deepEqual([reply.ok, reply.value.message], [true, 'Cleared.']);
  assert.equal(await h.job(A), undefined, 'the row is gone');
  assert.deepEqual(await h.store.intents(), [], 'and its Watch');
  // Clear refuses a running download; Clear all clears every failed one.
  await h.service.recordIntent(B);
  await until(() => h.acquireCalls().length === 2, 'B starts');
  reply = await h.send('download-control', { action: 'clear', releaseId: B }, h.settings);
  assert.deepEqual([reply.ok, reply.code], [false, 'viewer-download-unavailable']);
  const tab = h.acquireCalls()[1][0];
  h.acquires.get(`${tab}|${B}`).reject(Error('viewer-server-unavailable'));
  await until(async () => (await h.job(B))?.state === 'failed', 'B failed');
  reply = await h.send('download-control', { action: 'clear-all' }, h.settings);
  assert.equal(reply.value.message, 'Cleared 1 failed download.');
  assert.equal(await h.job(B), undefined);
});

test('a browser restart drops queued Watches (listed once as "Previously queued"); a paused one waits for Resume', async t => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  await store.addIntent(A, Date.now() - HOUR);
  await store.addIntent(B, Date.now() - HOUR);
  await store.markIntent(B, { paused: true });
  const onStartup = event();
  const h = await harness(t, { store, runtimeExtra: { onStartup } });
  onStartup.emit();
  await until(async () => (await store.intents()).length === 1, 'A expired');
  h.renderer(1);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(h.acquireCalls().length, 0, 'nothing starts by itself');
  await until(async () => (await h.snapshot()).previouslyQueued?.[0]?.name === 'Avery Cut', 'named');
  const snap = await h.snapshot();
  assert.deepEqual(snap.previouslyQueued.map(p => p.releaseId), [A]);
  assert.deepEqual(previousRows(snap.previouslyQueued).map(r => [r.label, r.name, r.actions]), [['Previously queued', 'Avery Cut', ['again', 'clear']]]);
  assert.equal((await h.job(B)).state, 'paused', 'the paused Watch is shown paused');
  // Resume (the user) starts it; Download again (the user) starts A and clears its entry.
  await h.send('download-control', { action: 'resume', releaseId: B }, h.settings);
  await until(() => h.acquireCalls().some(([, r]) => r === B), 'B resumed');
  await h.send('watch-intent', { releaseId: A }, h.settings);
  assert.deepEqual((await h.snapshot()).previouslyQueued, []);
  await h.send('previous-clear', {}, h.settings);
});

test('after 12 hours a queued Watch that is not downloading leaves the queue; within 12 hours it still starts', async t => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  await store.addIntent(A, Date.now() - 13 * HOUR);
  const h = await harness(t, { store });
  h.renderer(1);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(h.acquireCalls().length, 0);
  assert.deepEqual((await store.intents()).map(x => x.releaseId), []);
  assert.deepEqual((await h.snapshot()).previouslyQueued.map(p => p.releaseId), [A]);
  const fresh = createViewerStore({ indexedDB: fakeIndexedDB() });
  await fresh.addIntent(B, Date.now() - 2 * HOUR);
  const h2 = await harness(t, { store: fresh });
  h2.renderer(1);
  await until(() => h2.acquireCalls().length === 1, 'a recent Watch starts');
  // A user pause is remembered on the Watch: a service restart keeps it paused.
  await h2.send('download-control', { action: 'pause', releaseId: B }, h2.settings);
  assert.equal((await fresh.intents())[0].paused, true);
});

test('Remove works with no Prime tab: the vault is reached directly, and a removal left pending when the page closed is finished next time', async () => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  await store.upsert({ id: A, title: 'Avery Cut', origin: 'website', transport: 'protected', availability: 'downloaded', version: '1', sourceKey: 'k' });
  const removed = [], asked = [];
  const remover = vaultRemover({ viewerRequest: async (method, args) => { asked.push([method, args.releaseId]); throw Error('viewer-no-owner'); },
    openManager: async () => ({ remove: async id => removed.push(id) }) });
  // The page schedules the removal (Undo window), then closes before it ends: no timer fires.
  const page1 = createLibraryRemoval({ store, removeFromVault: remover, setTimer: () => 1, clearTimer() {} });
  await page1.schedule(A);
  assert.deepEqual([...(await page1.pendingIds())], [A], 'the row is hidden meanwhile');
  assert.deepEqual(removed, []);
  // The next Settings visit finishes it with no player tab open.
  const page2 = createLibraryRemoval({ store, removeFromVault: remover, setTimer: () => 1, clearTimer() {} });
  assert.deepEqual(await page2.resume(), []);
  assert.deepEqual(asked, [['edits-remove', A]]);
  assert.deepEqual(removed, [A]);
  assert.deepEqual((await store.read()).library, []);
  assert.deepEqual(await store.pendingRemovals(), []);
  // Undo keeps the edit; a busy owner is reported and the removal stays pending.
  await store.upsert({ id: B, title: 'Jordan Cut', origin: 'website', transport: 'protected', availability: 'downloaded', version: '1', sourceKey: 'k' });
  await page2.schedule(B); await page2.undo(B);
  assert.deepEqual(await store.pendingRemovals(), []);
  const busy = createLibraryRemoval({ store, removeFromVault: vaultRemover({ viewerRequest: async () => { throw Error('viewer-no-owner'); }, openManager: async () => ({ remove: async () => { throw Error('protected-owner-busy'); } }) }), setTimer: () => 1, clearTimer() {} });
  await busy.schedule(B);
  const failures = await createLibraryRemoval({ store, removeFromVault: vaultRemover({ viewerRequest: async () => { throw Error('viewer-no-owner'); }, openManager: async () => ({ remove: async () => { throw Error('protected-owner-busy'); } }) }), setTimer: () => 1, clearTimer() {} }).resume();
  assert.deepEqual(failures.map(f => [f.releaseId, f.error.message]), [[B, 'protected-owner-busy']]);
  assert.deepEqual((await store.pendingRemovals()).map(r => r.releaseId), [B]);
  // A player tab that holds the files removes them itself.
  const viaTab = [];
  await vaultRemover({ viewerRequest: async (m, a) => { viaTab.push(a.releaseId); }, openManager: async () => assert.fail('not needed') })(B);
  assert.deepEqual(viaTab, [B]);
});

test('the service no longer records the expected viewer-no-owner of a Remove as a command failure', async t => {
  const h = await harness(t);
  const reply = await h.send('edits-remove', { releaseId: A }, h.settings);
  assert.deepEqual([reply.ok, reply.code], [false, 'viewer-no-owner']);
  assert.ok(!(await h.snapshot()).commandFailures.some(f => f.method === 'edits-remove'));
});

test('the player menu offers Clear for this episode\'s failed download', () => {
  const playback = { state: 'idle', sourceKey: JSON.stringify(['prime-video', 'x', 'episode', 1, 2, 1, null, null, null]), generation: '1' };
  const view = viewerView({ playback, load: { state: 'failed', error: 'viewer-server-unavailable', download: true, releaseId: A, busy: false, failedAt: Date.now() } });
  assert.equal(view.kind, 'problem');
  assert.equal(view.clearRelease, A);
  assert.match(menuMarkup(view).body, new RegExp(`data-act="dl-clear"[^>]*data-arg="${A}"`));
  assert.equal(viewerView({ playback, load: { state: 'failed', error: 'viewer-server-unavailable', releaseId: A, busy: false, failedAt: Date.now() } }).clearRelease, undefined, 'a failed load of a kept edit has nothing to clear');
});
