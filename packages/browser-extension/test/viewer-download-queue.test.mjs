import test from 'node:test';
import assert from 'node:assert/strict';
import { registerViewerService } from '../src/viewer-service.mjs';
import { registerViewerWebBridge } from '../src/viewer-web-bridge.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';
import { createViewerStore } from '../src/viewer-store.mjs';
import { sourceKey } from '../src/viewer-model.mjs';
import { viewerView } from '../src/viewer-display.mjs';
import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';

// E61 (0.62.20): one explicit download queue with positions, stall detection
// and automatic retry, Pause/Resume/Cancel/Retry, telemetry, names, the panel showing
// this episode's download, Watch focusing an open tab, and no "Off" flash before arming.
import { A, B, gti, source, url, display, names, event, until, harness } from './helpers/download-harness.mjs';

test('E61: downloads queue one at a time across player tabs, with their position and what they wait for', async t => {
  const h = await harness(t);
  h.renderer(1); h.renderer(2);
  await h.service.recordIntent(A);
  await h.service.recordIntent(B);
  await until(() => h.acquireCalls().length === 1, 'first acquisition');
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(h.acquireCalls().map(([, r]) => r), [A], 'only one download runs, though two players could take one each');
  await until(async () => (await h.job(B))?.waitingFor === 'Avery Cut', 'queued job names what it waits for');
  const waiting = await h.job(B);
  assert.equal(waiting.state, 'queued');
  assert.equal(waiting.ahead, 1);
  assert.equal(waiting.name, 'Jordan Cut');
  assert.equal(waiting.titleName, 'Homeland');
  const snap = await h.snapshot();
  assert.deepEqual(snap.downloads.map(d => d.releaseId), [A, B], 'popup lists the running download first, then the queue');
  const [tab] = h.acquireCalls()[0];
  h.finish(tab, A);
  await until(() => h.acquireCalls().length === 2, 'second starts after the first');
  assert.equal(h.acquireCalls()[1][1], B);
  const stats = (await h.snapshot()).downloadStats;
  assert.equal(stats.length, 1);
  assert.equal(stats[0].release, A.slice(0, 8));
});

test('E61: no progress for the stall time stops the download, retries it on another tab with backoff, then reports "Download stalled"', async t => {
  const h = await harness(t, { downloadTiming: { stallMs: 60, tickMs: 10, retryBaseMs: 30, retryLimit: 1 } });
  h.renderer(1); h.renderer(2);
  await h.service.recordIntent(A);
  await until(() => h.acquireCalls().length === 1, 'acquisition');
  const first = h.acquireCalls()[0][0];
  await until(async () => (await h.job(A))?.stalled === true, 'stalled');
  const stalled = await h.job(A);
  assert.equal(stalled.state, 'queued');
  assert.ok(stalled.retryAt > Date.now() - 50, 'an automatic retry is planned');
  assert.ok(h.calls.some(c => c.method === 'cancel' && c.tabId === first), 'the stalled acquisition is stopped');
  await until(() => h.acquireCalls().length === 2, 'retry');
  assert.notEqual(h.acquireCalls()[1][0], first, 'the retry prefers another player tab (a frozen background tab cannot finish)');
  await until(async () => (await h.job(A))?.state === 'failed', 'gives up after the retry limit');
  const failed = await h.job(A);
  assert.equal(failed.error, 'viewer-download-stalled');
  assert.equal(failed.stalls, 2);
  assert.equal(failed.attempts, 2);
  const snap = await h.snapshot();
  assert.ok(snap.loadStalls.some(x => x.reason === 'download-stalled' && x.releaseId === A.slice(0, 8)));
});

test('E61: progress, reconnects and throughput are recorded; progress keeps a download from stalling; a stopped tab no longer reports', async t => {
  const h = await harness(t, { downloadTiming: { stallMs: 500, tickMs: 10, retryBaseMs: 10, retryLimit: 1 } });
  h.renderer(1); h.renderer(2);
  await h.service.recordIntent(A);
  await until(() => h.acquireCalls().length === 1, 'acquisition');
  const tab = h.acquireCalls()[0][0];
  // 200 kB every 200 ms (about 1 MB/s) for 1.2 s; each gap is shorter than the stall time.
  for (let i = 1; i <= 7; i += 1) {
    h.progress(tab, A, { state: 'downloading', bytes: i * 200_000, total: 2_000_000 });
    await new Promise(r => setTimeout(r, 200));
  }
  h.progress(tab, A, { state: 'downloading', bytes: 1_400_000, total: 2_000_000, retry: { attempt: 1, code: 'network-error', delayMs: 50, written: 1_100_000 } });
  const running = await h.job(A);
  assert.equal(running.state, 'downloading');
  assert.ok(running.bytesPerSecond > 500_000 && running.bytesPerSecond < 1_100_000, `rate ${running.bytesPerSecond}`);
  assert.equal(running.transferRetries, 1);
  assert.equal(running.lastRetryCode, 'network-error');
  assert.equal(running.stalled, undefined, 'regular progress is not a stall');
  assert.equal(running.rateFrom, undefined, 'internal bookkeeping stays inside');
  // Another tab's report for the same release (an acquisition the queue gave up) is ignored.
  const other = tab === 1 ? 2 : 1;
  await h.send('download-control', { action: 'pause', releaseId: A }, h.settings);
  h.acquires.set(`${other}|${A}`, h.acquires.get(`${tab}|${A}`));
  h.progress(tab, A, { state: 'failed:viewer-download-cancelled', bytes: 0, total: 0 });
  assert.equal((await h.job(A)).state, 'paused', 'a late failure from the stopped acquisition does not overwrite Paused');
});

test('E61: Pause, Resume, Cancel and Retry', async t => {
  const h = await harness(t);
  h.renderer(1);
  await h.service.recordIntent(A);
  await h.service.recordIntent(B);
  await until(() => h.acquireCalls().length === 1, 'A starts');
  // Pause the running one: it stops, and the next in the queue starts.
  let reply = await h.send('download-control', { action: 'pause', releaseId: A }, h.settings);
  assert.equal(reply.ok, true);
  assert.equal(reply.value.message, 'Download paused.');
  assert.ok(h.calls.some(c => c.method === 'cancel' && c.args.releaseId === A));
  await until(() => h.acquireCalls().length === 2, 'B starts while A is paused');
  assert.equal(h.acquireCalls()[1][1], B);
  assert.equal((await h.job(A)).state, 'paused');
  assert.equal(h.service.job(A).state, 'queued', 'the website\'s job contract has no paused state');
  // A paused download stays paused when players reconnect.
  h.renderer(3);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(h.acquireCalls().filter(([, r]) => r === A).length, 1);
  // Resume queues it behind B.
  reply = await h.send('download-control', { action: 'resume', releaseId: A }, h.settings);
  assert.equal(reply.value.job.state, 'queued');
  assert.equal((await h.job(A)).waitingFor, 'Jordan Cut');
  // Cancel B (running): A starts; B's Watch is withdrawn.
  reply = await h.send('download-control', { action: 'cancel', releaseId: B }, h.settings);
  assert.equal(reply.value.job.error, 'viewer-download-cancelled');
  await until(() => h.acquireCalls().length === 3, 'A resumes');
  assert.equal(h.acquireCalls()[2][1], A);
  assert.ok(!(await h.store.intents()).some(x => x.releaseId === B), 'a cancelled download is not started again');
  assert.ok(!(await h.snapshot()).downloads.some(d => d.releaseId === B), 'a cancelled download leaves the popup');
  // Retry B: a new attempt, queued behind A.
  reply = await h.send('download-control', { action: 'retry', releaseId: B }, h.settings);
  assert.equal(reply.ok, true);
  await until(async () => (await h.job(B))?.state === 'queued', 'B queued again');
  // Unknown or finished downloads refuse clearly.
  reply = await h.send('download-control', { action: 'pause', releaseId: '61616161-0000-4000-8000-0000000000ff' }, h.settings);
  assert.deepEqual([reply.ok, reply.code], [false, 'viewer-download-unavailable']);
  reply = await h.send('download-control', { action: 'explode', releaseId: A }, h.settings);
  assert.equal(reply.ok, false);
});

test('E61: the player menu shows this episode\'s queued download (never "No downloaded edit") and can pause it', async t => {
  const h = await harness(t);
  const player = { state: 'idle', sourceKey: sourceKey({ ...source(2), runtimeMs: 2_701_400 }), generation: '1', canStop: false };
  h.controller(1, player, url(2));
  h.renderer(1, url(2));
  await h.service.recordIntent(A);
  await h.service.recordIntent(B);
  const top = { id: 'a'.repeat(32), origin: 'https://www.amazon.com', url: url(2), tab: { id: 1, url: url(2) }, frameId: 0, documentId: '1'.repeat(32), documentLifecycle: 'active' };
  let load;
  await until(async () => {
    load = (await h.send('snapshot', {}, top)).value.load;
    return load?.state === 'queued' && load.name === 'Jordan Cut';
  }, 'episode download in the panel');
  assert.equal(load.busy, true);
  assert.equal(load.download, true);
  assert.equal(load.ahead, 1);
  const view = viewerView({ playback: player, load });
  assert.equal(view.kind, 'downloading');
  assert.equal(view.download.label, 'Waiting for Avery Cut to finish (1 ahead)');
  assert.deepEqual(view.download.controls, ['pause', 'cancel']);
  const reply = await h.send('command', { command: 'download', action: 'pause', releaseId: B, generation: '1' }, top);
  assert.equal(reply.ok, true);
  assert.equal((await h.send('snapshot', {}, top)).value.load.state, 'paused');
});

test('E61: Watch focuses a Prime tab already open on that title instead of opening another', async t => {
  const focused = [];
  const h = await harness(t, { windows: { update: async (windowId, args) => { focused.push([windowId, args]); } } });
  h.controller(1, { state: 'idle', sourceKey: sourceKey(source(5)), generation: '1' }, url(5));
  h.controller(2, { state: 'idle', sourceKey: sourceKey({ ...source(1), runtimeMs: 2_701_100 }), generation: '1' }, url(1));
  // The website's Watch (bridge): the answer tells it a tab was focused.
  registerViewerWebBridge(h.runtime, { pairingOrigin: 'https://preview.seamlessscene.com' }, { service: h.service });
  const answer = await new Promise(resolve => h.runtime.onMessageExternal.listeners[0](
    { kind: 'viewer-watch-v1', op: 'watch', releaseId: A }, { url: 'https://preview.seamlessscene.com/edits/x', origin: 'https://preview.seamlessscene.com' }, resolve));
  assert.equal(answer.ok, true);
  assert.equal(answer.focusedTab, true);
  assert.deepEqual(h.updates.at(-1), [2, { active: true }]);
  assert.deepEqual(focused, [[7, { focused: true }]]);
  // A title with no open tab: nothing is focused, and the website opens one as before.
  const other = await h.service.recordIntent(B, { focus: true });
  assert.equal(other.focusedTab, undefined);
  // The Library's Watch for a kept edit focuses the open tab rather than creating a new one.
  await h.store.upsert({ id: A, title: 'Avery Cut', name: 'Avery Cut', origin: 'website', transport: 'protected', availability: 'downloaded', streamingUrl: url(1), sourceKey: names[A].sourceKey, version: '1' });
  const created = h.created.length;
  const library = await h.service.recordIntent(A, { open: true });
  assert.equal(library.focusedTab, true);
  assert.equal(h.created.length, created);
});

test('E61: a finished load stays "Turning the edit on…" until the edit is armed (no Off · Watch with edit flash)', async t => {
  let release; const armGate = { promise: new Promise(r => { release = r; }) };
  const h = await harness(t);
  const player = { state: 'idle', sourceKey: names[A].sourceKey, generation: '1', canStop: false };
  await h.store.upsert({ id: A, title: 'Avery Cut', name: 'Avery Cut', origin: 'website', transport: 'protected', availability: 'downloaded', downloadedAt: 1, streamingUrl: url(1), sourceKey: names[A].sourceKey, version: '1' });
  const top = { id: 'a'.repeat(32), origin: 'https://www.amazon.com', url: url(1), tab: { id: 1, url: url(1) }, frameId: 0, documentId: '1'.repeat(32), documentLifecycle: 'active' };
  h.controller(1, player, url(1), { armGate });
  h.renderer(1, url(1));
  const watching = h.send('command', { command: 'watch', releaseId: A, generation: '1' }, top);
  await until(() => h.calls.some(c => c.method === 'load'), 'load requested');
  Object.assign(player, { state: 'loaded', editId: A, canArm: true, canStop: true, version: '1' });
  await until(() => h.calls.some(c => c.method === 'arm'), 'arm requested');
  const during = (await h.send('snapshot', {}, top)).value;
  assert.equal(during.load.state, 'arming');
  assert.equal(during.load.busy, true);
  assert.equal(viewerView({ playback: during.playback, matches: during.matches, load: during.load }).download.label, 'Turning the edit on…');
  release();
  assert.equal((await watching).ok, true);
  const after = (await h.send('snapshot', {}, top)).value;
  assert.equal(after.load.state, 'ready');
  assert.equal(after.load.busy, false);
});

test('0.62.21: Pause holds the running download in its tab; Resume continues the same acquisition (no restart, no new requests)', async t => {
  const h = await harness(t, { downloadTiming: { stallMs: 60, tickMs: 10, retryBaseMs: 10, retryLimit: 1 } });
  h.renderer(1, url(9), { holds: true });
  await h.service.recordIntent(A);
  await h.service.recordIntent(B);
  await until(() => h.acquireCalls().length === 1, 'A starts');
  h.progress(1, A, { state: 'downloading', bytes: 80_500_000, total: 99_100_000 });
  let reply = await h.send('download-control', { action: 'pause', releaseId: A }, h.settings);
  assert.equal(reply.value.job.state, 'paused');
  assert.equal(h.acquires.get(`1|${A}`).paused, true, 'the renderer holds it');
  assert.ok(!h.calls.some(c => c.method === 'cancel'), 'a held download is not cancelled');
  // The client settles its last bytes; the job stays Paused. No stall while paused.
  h.progress(1, A, { state: 'downloading', bytes: 80_600_000, total: 99_100_000 });
  await new Promise(r => setTimeout(r, 150));
  const paused = await h.job(A);
  assert.equal(paused.state, 'paused');
  assert.equal(paused.bytes, 80_600_000);
  assert.equal(paused.stalled, undefined);
  assert.equal(h.acquireCalls().length, 1, 'the queue waits behind the held download');
  const waiting = await h.job(B);
  assert.equal(waiting.waitingFor, 'Avery Cut (paused)');
  // Resume: the same acquisition continues.
  reply = await h.send('download-control', { action: 'resume', releaseId: A }, h.settings);
  assert.equal(reply.value.job.state, 'downloading');
  assert.equal(h.acquires.get(`1|${A}`).paused, false);
  assert.equal(h.acquireCalls().length, 1, 'Resume makes no new acquisition');
  h.progress(1, A, { state: 'downloading', bytes: 99_000_000, total: 99_100_000 });
  h.finish(1, A);
  await until(async () => (await h.job(A))?.state === 'ready', 'A completes after Resume');
  await until(() => h.acquireCalls().length === 2, 'then B starts');
  // Retry on a held download resumes it; Cancel stops it and lets the queue move on.
  reply = await h.send('download-control', { action: 'pause', releaseId: B }, h.settings);
  assert.equal(reply.value.job.state, 'paused');
  reply = await h.send('download-control', { action: 'retry', releaseId: B }, h.settings);
  assert.equal(reply.value.job.state, 'requesting', 'it continues the step it was paused in');
  await h.send('download-control', { action: 'pause', releaseId: B }, h.settings);
  reply = await h.send('download-control', { action: 'cancel', releaseId: B }, h.settings);
  assert.equal(reply.value.job.error, 'viewer-download-cancelled');
  assert.ok(h.calls.some(c => c.method === 'cancel' && c.args.releaseId === B));
});
