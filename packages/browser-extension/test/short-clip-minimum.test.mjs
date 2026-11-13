import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MIN_ASSET_DURATION_MS, LOCAL_USER_MIN_ASSET_DURATION_MS, CATALOG_V2_MIN_ASSET_DURATION_MS, minimumAssetDurationMs, supportsAssetDuration, localPlaybackTimeoutMs } from '../src/asset-duration-policy.mjs';
import { validateManifestSchema } from '../src/manifest-security.mjs';
import { validateAuthoredAssetProfile, validateMeasuredAsset } from '../src/local-asset-validator.mjs';
import { validateLocalUserEditPacket, compileLocalUserEditActions } from '../src/local-edit-packet.mjs';
import { fixtureManifest } from '../src/fixture-signed-manifest.mjs';
import { readSsArchive, writeSsArchive, SS_SHORT_CLIP_MIN_EXTENSION } from '../src/ss-archive.mjs';
import { validLocalResult } from '../src/local-message-schema.mjs';
import { TransitionEngine, joinSeekDelayMs } from '../src/transition-engine.mjs';
import { ManifestActionScheduler } from '../src/manifest-action-scheduler.mjs';
import { importLocalEdit } from '../src/local-library.mjs';
import { zipStored } from '../src/ss-archive.mjs';
import { memoryStage } from '../src/ss-normalize.mjs';
import { createViewerStore } from '../src/viewer-store.mjs';
import { preferences } from '../src/viewer-model.mjs';
import { createHash } from 'node:crypto';
import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';
import { localPacket, memoryRoot } from './helpers/ss-fixture.mjs';
import { withMvhdDurationMs } from './helpers/mp4-duration.mjs';

// E71 (0.64.2): per-profile clip minimum. local-user 1.5 s; legacy (mvp) 5 s. 0.65.0 (W9): catalog-v2 1.5 s.
const BOUNDARIES = [999, 1_000, 1_499, 1_500, 4_999, 5_000];
const EXPECTED = { 'local-user': 1_500, 'catalog-v2': 1_500, mvp: 5_000 };

test('the policy has one minimum per profile; unknown profiles get the legacy 5 s', () => {
  assert.equal(MIN_ASSET_DURATION_MS, 5_000);
  assert.equal(LOCAL_USER_MIN_ASSET_DURATION_MS, 1_500);
  assert.equal(CATALOG_V2_MIN_ASSET_DURATION_MS, 1_500);
  for (const [profile, minimum] of Object.entries(EXPECTED)) {
    assert.equal(minimumAssetDurationMs(profile), minimum, profile);
    for (const ms of BOUNDARIES) assert.equal(supportsAssetDuration(ms, profile), ms >= minimum, `${profile} ${ms}`);
  }
  assert.equal(minimumAssetDurationMs('unknown'), 5_000);
  assert.equal(supportsAssetDuration(1_500), false, 'the default profile is the legacy one');
  // A short local clip keeps the historical 65 s watchdog.
  assert.equal(localPlaybackTimeoutMs(1_500, 'local-user'), 65_000);
});

function localUserPacket(durationMs) {
  const { packet } = localPacket({ count: 1 });
  packet.manifest.segments[0].asset.expected_duration_ms = durationMs;
  packet.manifest.segments[0].resume_time_ms = packet.manifest.segments[0].trigger_time_ms + durationMs;
  return packet;
}

test('manifest schema (protected): authored durations at each boundary, per profile', () => {
  for (const ms of BOUNDARIES) {
    assert.equal(validateLocalUserEditPacket(localUserPacket(ms)).ok, ms >= 1_500, `local-user ${ms}`);
    const legacy = structuredClone(fixtureManifest);
    legacy.segments.find(s => s.asset).asset.expected_duration_ms = ms;
    assert.equal(validateManifestSchema(legacy).ok, ms >= 5_000, `mvp ${ms}`);
    const errors = validateManifestSchema(legacy, { profileClass: 'catalog-v2' }).errors ?? [];
    assert.equal(errors.some(e => /expected_duration_ms/.test(e.path)), ms < 1_500, `catalog-v2 ${ms}`);
  }
  const [action] = compileLocalUserEditActions(localUserPacket(1_500), { resolveAssetUrl: () => 'blob:short' });
  assert.deepEqual([action.expectedDurationMs, action.profileClass], [1_500, 'local-user']);
});

test('clip validator (protected): authored and measured durations at each boundary, per profile', () => {
  const expected = { sha256: 'a'.repeat(64), container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', width: 1280, height: 720, dynamicRange: 'sdr' };
  const measured = { mediaType: 'video/mp4', width: 1280, height: 720, initialSampleDecoded: true, audioPresent: true, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', dynamicRange: 'sdr' };
  for (const [profile, minimum] of Object.entries(EXPECTED)) for (const ms of BOUNDARIES) {
    assert.equal(validateAuthoredAssetProfile({ ...expected, durationMs: ms }, { profileClass: profile }).ok, ms >= minimum, `${profile} authored ${ms}`);
    const result = validateMeasuredAsset({ ...measured, durationMs: ms }, { ...expected, durationMs: ms }, expected.sha256, { profileClass: profile });
    assert.equal(result.ok, ms >= minimum, `${profile} measured ${ms}`);
  }
  // The 100 ms match tolerance never carries a measured clip under the minimum.
  const result = validateMeasuredAsset({ ...measured, durationMs: 1_450 }, { ...expected, durationMs: 1_500 }, expected.sha256, { profileClass: 'local-user' });
  assert.ok(result.errors.includes('measured-duration-out-of-range'));
});

test('.ss round trip: a 1.5 s clip writes and reads back, and asks older readers for 0.64.2', async () => {
  const { packet, clips } = localPacket({ count: 1 });
  Object.assign(packet.manifest.segments[0], { resume_time_ms: packet.manifest.segments[0].trigger_time_ms + 1_500 });
  packet.manifest.segments[0].asset.expected_duration_ms = 1_500;
  const { blob, archiveId } = await writeSsArchive({ packet, clips, createdAt: '2026-10-13T12:00:00.000Z', generator: 'test' });
  const file = new File([blob], 'short.ss');
  assert.equal((await readSsArchive(file, { extensionVersion: '0.64.2' })).archiveId, archiveId);
  await assert.rejects(readSsArchive(file, { extensionVersion: '0.64.1' }), error => /newer/.test(error.code ?? '') || /0\.64\.2/.test(String(error.detail ?? error.message)));
  assert.equal(SS_SHORT_CLIP_MIN_EXTENSION, '0.64.2');
  // 5 s and longer clips keep the 0.63.0 minimum reader; 1,499 ms cannot be written at all.
  const long = localPacket({ count: 1 });
  const header = async b => JSON.parse(await new Blob([b]).slice(30 + 'seamless-edit.json'.length).text().then(t => t.slice(0, t.indexOf('}') + 1)));
  assert.equal((await header((await writeSsArchive({ ...long, createdAt: '2026-10-13T12:00:00.000Z', generator: 'test' })).blob)).min_extension, '0.63.0');
  assert.equal((await header(blob)).min_extension, '0.64.2');
  packet.manifest.segments[0].asset.expected_duration_ms = 1_499;
  await assert.rejects(writeSsArchive({ packet, clips }), /ss-packet-invalid|out-of-range/);
});

test('edit packs: 1.5 s and 3 s clips are accepted, 1.499 s is refused with the new range', async () => {
  const vectors = new URL('./fixtures/edit-pack-vectors/', import.meta.url);
  const short = new Uint8Array(await readFile(new URL('_source/clip-short.mp4', vectors)));
  const EPISODE = { service: 'prime-video', gti: 'amzn1.dv.gti.360dbdfd-a44e-4885-81e6-c4eb0e493909', show: 'Synthetic Show', season: 1, episode: 3, runtime_ms: 1_800_000 };
  const hash = async b => createHash('sha256').update(Buffer.from(await b.arrayBuffer())).digest('hex');
  const store = createViewerStore({ indexedDB: fakeIndexedDB() }), root = memoryRoot();
  const add = async (id, bytes) => importLocalEdit(new File([await zipStored([['edit.json', new Blob([JSON.stringify({ id, title: id, episode: EPISODE,
    scenes: [{ action: 'INSERT', at: 1000, clip: 'clips/c.mp4' }] })])], ['clips/c.mp4', new Blob([bytes])]])], `${id}.zip`),
  { store, root, preferences: preferences(), hash, validate: async () => ({ ok: true }), stage: memoryStage() });
  assert.equal((await add('three', short)).status, 'added');
  assert.equal((await add('onefive', withMvhdDurationMs(short, 1_500))).status, 'added');
  const refused = await add('under', withMvhdDurationMs(short, 1_499));
  assert.deepEqual([refused.status, refused.code, refused.message], ['refused', 'pack-clip-duration', 'clips/c.mp4: 1.499 s; clips must be 1.5–120 s.']);
});

test('0.65.0: the renderer protocol bounds catalog actions at 1.5–120 s (W9)', () => {
  const action = ms => ({ id: 'scene-1', type: 'REPLACE', triggerMs: 1000, resumeMs: 1000 + ms, clipUrl: `asset:${'a'.repeat(64)}`, gainDb: 0, expectedDurationMs: ms, profileClass: 'catalog-v2' });
  for (const ms of BOUNDARIES) assert.equal(validLocalResult({ type: 'result', id: 1, ok: true, value: [action(ms)] }, 'catalogActions'), ms >= 1_500, String(ms));
});

test('runtime: the engine arms a 1.5 s local-user or catalog-v2 segment and refuses 1,499 ms; mvp still needs 5 s', () => {
  const engine = new TransitionEngine({ adapter: {}, overlay: {}, metrics: { mark() {} } });
  const segment = (ms, profileClass) => ({ id: 's', action: 'REPLACE', triggerMs: 1000, resumeMs: 1000 + ms, clipUrl: 'blob:x', expectedDurationMs: ms, profileClass });
  engine.arm(segment(1_500, 'local-user'));
  assert.throws(() => engine.arm(segment(1_499, 'local-user')), /outside its playback profile/);
  assert.throws(() => engine.arm(segment(1_499, 'catalog-v2')), /outside its playback profile/);
  engine.arm(segment(1_500, 'catalog-v2'));
  assert.throws(() => engine.arm(segment(4_999, 'mvp')), /outside its playback profile/);
});

test('W5: the join seek starts sooner only for clips under 955 ms', () => {
  assert.equal(joinSeekDelayMs(5_000), 500);
  assert.equal(joinSeekDelayMs(1_500), 500);
  assert.equal(joinSeekDelayMs(955), 500);
  assert.equal(joinSeekDelayMs(954), 499);
  assert.equal(joinSeekDelayMs(792), 337);
  assert.equal(joinSeekDelayMs(500), 150);
  assert.equal(joinSeekDelayMs(undefined), 500, 'unknown duration keeps the default');
  assert.equal(joinSeekDelayMs(800, 0), 0, 'a disabled delay stays disabled');
  assert.equal(joinSeekDelayMs(800, 200), 200, 'never later than the configured delay');
});

test('bug D: a running chain keeps its standby decoder; the next scene preloads once the last member plays', async () => {
  const action = (id, triggerMs, resumeMs) => ({ id, type: 'REPLACE', triggerMs, resumeMs, clipUrl: `blob:${id}`, gainDb: 0, expectedDurationMs: resumeMs - triggerMs, profileClass: 'local-user' });
  const actions = [action('a1', 8_000, 9_668), action('a2', 9_668, 13_797), action('a3', 16_800, 18_802)];
  const preloadedNext = [];
  let release, chained;
  const executor = {
    preloadLocal: async () => {},
    preloadNextLocal: async next => { preloadedNext.push(next.id); },
    executeLocal: (_action, _observed, options = {}) => { chained = options; return new Promise(resolve => { release = resolve; }); },
    cancelPreload: async () => {}
  };
  const scheduler = new ManifestActionScheduler({ actions, executor, chainGapMs: 50 });
  await scheduler.observe({ currentTimeMs: 0, paused: false });
  await scheduler.observe({ currentTimeMs: 7_990, paused: false });
  void scheduler.observe({ currentTimeMs: 8_010, paused: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(chained.chain.map(a => a.id), ['a2'], 'a1 and a2 play in one cover');
  // While a1 plays, the engine is loading a2 into the standby decoder: a3 must wait.
  for (const t of [8_100, 8_500, 9_000]) scheduler.observe({ currentTimeMs: t, paused: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(preloadedNext, []);
  // The last chain member is playing: the scene after the chain can load now.
  chained.onAdvance('a2');
  scheduler.observe({ currentTimeMs: 9_800, paused: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(preloadedNext, ['a3']);
  release({ status: 'success', chained: ['a2'] });
});
