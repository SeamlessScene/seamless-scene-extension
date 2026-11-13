import test from 'node:test';
import assert from 'node:assert/strict';
import { createValidatedAssetCache, memoryStore, validationKey } from '../src/validated-asset-cache.mjs';
import { loadStatusMessage, loadStatusShort, downloadPercent, loadStalled, stalledMessage, etaText, LOAD_STALL_MS } from '../src/viewer-load-status.mjs';
import { viewerView } from '../src/viewer-display.mjs';

const hex = c => c.repeat(64);
const context = (patch = {}) => ({ releaseId: '68683756-0000-4000-8000-000000000001', manifestVersion: 1, manifestSha256: hex('a'), assetSetSha256: hex('b'), ...patch });
const expected = (patch = {}) => ({ sha256: hex('c'), durationMs: 5000, durationToleranceMs: 100, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', width: 624, height: 480, dynamicRange: 'SDR', ...patch });
const file = size => ({ size });
function harness({ buildId = 'sha256:build-1', result = { ok: true } } = {}) {
  const calls = [], store = memoryStore();
  const cache = createValidatedAssetCache({ store, buildId, validate: async (f, e, o) => { calls.push([f, e, o]); return typeof result === 'function' ? result(f, e, o) : result; } });
  return { cache, calls, store };
}

test('E60 cache: a miss runs the full check and is remembered; a hit skips the re-hash and probe', async () => {
  const h = harness();
  assert.deepEqual(await h.cache.validateAsset(file(10), expected(), { context: context() }), { ok: true });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(await h.cache.validateAsset(file(10), expected(), { context: context() }), { ok: true, cached: true });
  assert.equal(h.calls.length, 1, 'no second check'); assert.deepEqual(h.cache.stats, { hits: 1, misses: 1 });
});

test('E60 cache: every key component invalidates (build, release, manifest version and sha256, asset set, clip, size, expectations)', async () => {
  const h = harness();
  await h.cache.validateAsset(file(10), expected(), { context: context() });
  const variants = [
    [file(10), expected(), context({ releaseId: '68683756-0000-4000-8000-000000000002' })],
    [file(10), expected(), context({ manifestVersion: 2 })],
    [file(10), expected(), context({ manifestSha256: hex('d') })],
    [file(10), expected(), context({ assetSetSha256: hex('e') })],
    [file(10), expected({ sha256: hex('f') }), context()],
    [file(11), expected(), context()],
    [file(10), expected({ durationMs: 5001 }), context()],
    [file(10), expected({ width: 640 }), context()]
  ];
  for (const [f, e, c] of variants) {
    const before = h.calls.length;
    await h.cache.validateAsset(f, e, { context: c });
    assert.equal(h.calls.length, before + 1, JSON.stringify([f, e, c]));
  }
  const other = createValidatedAssetCache({ store: h.store, buildId: 'sha256:build-2', validate: async () => { h.calls.push('build-2'); return { ok: true }; } });
  await other.validateAsset(file(10), expected(), { context: context() });
  assert.equal(h.calls.at(-1), 'build-2', 'an extension update (new build identity) is a miss');
});

test('E60 cache: a stored size that does not match the file is a full check', async () => {
  const h = harness();
  await h.cache.validateAsset(file(10), expected(), { context: context() });
  const key = validationKey({ buildId: 'sha256:build-1', context: context(), expected: expected(), size: 10 });
  await h.store.set(key, { ok: true, size: 9, at: 0 }); // a corrupted or mismatched entry
  await h.cache.validateAsset(file(10), expected(), { context: context() });
  assert.equal(h.calls.length, 2);
});

test('E60 cache: no context (local folder imports) or a failed check is never cached; cleared storage is a cold load', async () => {
  const h = harness();
  await h.cache.validateAsset(file(10), expected(), {});
  await h.cache.validateAsset(file(10), expected(), {});
  assert.equal(h.calls.length, 2, 'without the packet context every check is full');
  const failing = harness({ result: { ok: false, code: 'decode-failed' } });
  await failing.cache.validateAsset(file(10), expected(), { context: context() });
  await failing.cache.validateAsset(file(10), expected(), { context: context() });
  assert.equal(failing.calls.length, 2, 'failures are not remembered');
  await h.cache.validateAsset(file(10), expected(), { context: context() });
  await h.store.clear();
  await h.cache.validateAsset(file(10), expected(), { context: context() });
  assert.equal(h.calls.length, 4, 'after clearing, a full check again');
});

test('E60 cache: "Check again" keeps Ready fast and re-checks in the background; a failure invalidates and reports', async () => {
  let failNext = false;
  const h = harness({ result: () => failNext ? { ok: false, code: 'decode-failed' } : { ok: true } });
  const release = context().releaseId;
  await h.cache.validateAsset(file(10), expected(), { context: context() });
  await h.cache.markRecheck(release);
  assert.equal(await h.cache.prepareLoad(release), true);
  assert.equal(await h.cache.prepareLoad(release), false, 'the flag is used once');
  assert.deepEqual(await h.cache.validateAsset(file(10), expected(), { context: context() }), { ok: true, cached: true }, 'Ready not delayed');
  failNext = true; const failures = [];
  const result = await h.cache.runBackground(release, { onFailure: code => failures.push(code) });
  assert.equal(result.status, 'failed'); assert.deepEqual(failures, ['decode-failed']);
  failNext = false; const before = h.calls.length;
  await h.cache.validateAsset(file(10), expected(), { context: context() });
  assert.equal(h.calls.length, before + 1, 'the failed release runs the full check next time');
  // A clean background check passes and keeps the cache.
  await h.cache.markRecheck(release); await h.cache.prepareLoad(release);
  await h.cache.validateAsset(file(10), expected(), { context: context() });
  assert.equal((await h.cache.runBackground(release)).status, 'passed');
});

test('E60 cache: a playback failure invalidates only that release', async () => {
  const h = harness();
  const other = context({ releaseId: '68683756-0000-4000-8000-000000000009' });
  await h.cache.validateAsset(file(10), expected(), { context: context() });
  await h.cache.validateAsset(file(10), expected(), { context: other });
  assert.equal(await h.cache.invalidateRelease(context().releaseId), 1);
  await h.cache.validateAsset(file(10), expected(), { context: other });
  assert.equal(h.calls.length, 2, 'the other release still hits');
});

test('E60 status: counted steps with a bar and an estimate, and the stall hint after 10 s', () => {
  const load = { state: 'checking', bytes: 37, total: 80, etaMs: 11_600, updatedAt: 1_000, busy: true, releaseId: '68683756-0000-4000-8000-000000000001' };
  assert.equal(loadStatusMessage(load), 'Checking clips 37 of 80 · about 12 s left');
  assert.equal(loadStatusShort(load), 'Checking clips 37 of 80');
  assert.equal(downloadPercent(load), 46);
  assert.equal(loadStatusMessage({ state: 'verifying', bytes: 12, total: 81 }), 'Checking files 12 of 81');
  assert.equal(etaText(75_000), 'about 1 min left'); assert.equal(etaText(null), '');
  assert.equal(loadStalled(load, 1_000 + LOAD_STALL_MS - 1), false);
  assert.equal(loadStalled(load, 1_000 + LOAD_STALL_MS), true);
  assert.equal(stalledMessage(load), 'Still checking clips · clip 38 of 80…');
  const view = viewerView({ playback: { state: 'idle', sourceKey: 'k' }, load, now: 1_000 + LOAD_STALL_MS + 5 });
  assert.equal(view.kind, 'downloading'); assert.equal(view.download.stalled, true); assert.equal(view.download.label, 'Still checking clips · clip 38 of 80…');
  assert.equal(view.releaseId, load.releaseId);
  const moving = viewerView({ playback: { state: 'idle', sourceKey: 'k' }, load, now: 2_000 });
  assert.equal(moving.download.stalled, undefined); assert.equal(moving.download.label, 'Checking clips 37 of 80 · about 12 s left');
});

test('E60 menu: a stalled load offers Check again (with its release) and Report', async () => {
  const { menuMarkup } = await import('../src/viewer-overlay.mjs');
  const load = { state: 'checking', bytes: 37, total: 80, updatedAt: 0, busy: true, releaseId: '68683756-0000-4000-8000-000000000001' };
  const view = viewerView({ playback: { state: 'idle', sourceKey: 'k' }, load, now: LOAD_STALL_MS + 1 });
  const { body } = menuMarkup(view, { details: 'stalled:checking:37/80 · 0.62.19 · now' });
  assert.match(body, /data-act="check-again" data-arg="68683756-0000-4000-8000-000000000001"/);
  assert.match(body, /data-act="copy-stall"/); assert.match(body, /Still checking clips · clip 38 of 80…/);
  const quiet = menuMarkup(viewerView({ playback: { state: 'idle', sourceKey: 'k' }, load, now: 5 }));
  assert.doesNotMatch(quiet.body, /check-again/);
  assert.match(quiet.body, /<i style="width:46%">/, 'the bar shows clips checked');
});
