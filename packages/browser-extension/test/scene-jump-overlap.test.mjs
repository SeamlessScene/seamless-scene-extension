import test from 'node:test';
import assert from 'node:assert/strict';
import { jumpTargetMs, supersededByEntry } from '../src/jump-target.mjs';
import { sceneList, sceneJump } from '../src/viewer-display.mjs';
import { buildReplacementNavigationItems } from '../src/replacement-navigator.mjs';
import { fixtureManifest } from '../src/fixture-signed-manifest.mjs';
import { compileManifestActions, ManifestActionScheduler } from '../src/manifest-action-scheduler.mjs';

// Field testing on 0.61.1, real Prime, "Rowan's Video Diary": scene 2 starts 250 ms after scene 1
// resumes. Jumping to scene 2 with a 5 s lead-in landed inside scene 1, the scheduler entered
// scene 1 part-way, its entry superseded the jump's seek and the menu said the jump failed.
const ROWAN = [
  { type: 'REPLACE', startMs: 2_182_621, resumeMs: 2_198_345 },
  { type: 'REPLACE', startMs: 2_198_595, resumeMs: 2_205_185 }
];
const withStatus = (...statuses) => ROWAN.map((s, i) => ({ ...s, status: statuses[i] ?? 'pending' }));

test('a lead-in never lands inside the scene before: Rowan scene 2 lands where scene 1 resumes', () => {
  for (const lead of [3_000, 5_000, 10_000]) {
    assert.equal(jumpTargetMs(ROWAN, 0, lead), 2_182_621 - lead, `scene 1 keeps its ${lead} ms lead-in`);
    assert.equal(jumpTargetMs(ROWAN, 1, lead), 2_198_345, `scene 2 at ${lead} ms lands on scene 1's resume`);
  }
  const rows = sceneList({ scenes: withStatus('pending', 'pending') }, { leadInMs: 5_000 });
  assert.equal(rows[1].targetMs, 2_198_345);
  assert.match(rows[1].title, /right after the scene before/);
  assert.match(rows[0].title, /\(5 s before\)/);
});

test('Next and numbered jumps use the same safe target; scene 1 is never entered part-way by a jump', () => {
  const from = (currentMs, statuses, which) => sceneJump(withStatus(...statuses), { currentMs, leadInMs: 5_000 }, which);
  assert.deepEqual(from(2_150_000, [], 1), { index: 1, targetMs: 2_198_345 });
  assert.deepEqual(from(2_150_000, [], 'next'), { index: 0, targetMs: 2_177_621 });
  // Next while scene 1 plays: scene 2, landing after scene 1 rather than inside it.
  assert.deepEqual(from(2_190_000, ['playing'], 'next'), { index: 1, targetMs: 2_198_345 });
  for (const lead of [5_000, 10_000]) {
    const target = sceneJump(withStatus(), { currentMs: 0, leadInMs: lead }, 1).targetMs;
    assert.ok(!(target > ROWAN[0].startMs && target < ROWAN[0].resumeMs), `${lead} ms: ${target} is not inside scene 1`);
  }
});

test('an insertion point before a scene is a floor too: the jump lands just past it, not on it', () => {
  const scenes = [{ type: 'INSERT', startMs: 50_000, resumeMs: 50_000 }, { type: 'REPLACE', startMs: 52_000, resumeMs: 60_000 }];
  assert.equal(jumpTargetMs(scenes, 1, 5_000), 50_001);
  assert.equal(jumpTargetMs(scenes, 0, 5_000), 45_000);
  assert.equal(jumpTargetMs([{ type: 'REPLACE', startMs: 2_000, resumeMs: 4_000 }], 0, 5_000), 0, 'never before 0');
});

test('Previous replays a scene that has just finished, even a short one, instead of skipping back two', () => {
  const scenes = [{ type: 'REPLACE', startMs: 90_000, resumeMs: 95_000, status: 'played' },
    { type: 'REPLACE', startMs: 100_000, resumeMs: 100_500, status: 'played' }];
  // Scene 2 lands at 95 000 (scene 1's resume); 600 ms after it finishes is within 2 s of that.
  assert.deepEqual(sceneJump(scenes, { currentMs: 101_100, leadInMs: 5_000 }, 'previous'), { index: 1, targetMs: 95_000 });
  // Rowan: just after scene 2 finished, Previous is scene 2.
  assert.deepEqual(sceneJump(withStatus('played', 'played'), { currentMs: 2_205_600, leadInMs: 5_000 }, 'previous'), { index: 1, targetMs: 2_198_345 });
});

test('the developer scene list lands on the same targets', () => {
  const packet = { manifest: { segments: ROWAN.map((s, i) => ({ segment_id: `s${i + 1}`, action: s.type, trigger_time_ms: s.startMs, resume_time_ms: s.resumeMs })) } };
  for (const lead of [5_000, 10_000])
    assert.deepEqual(buildReplacementNavigationItems(packet, lead).map(item => item.targetMs), [2_182_621 - lead, 2_198_345]);
});

function rowanScheduler(calls, hold = null) {
  const [local] = compileManifestActions({ status: 'activated', manifest: structuredClone(fixtureManifest) }, { resolveAssetUrl: (_h, id) => `blob:${id}` })
    .filter(action => action.type === 'REPLACE');
  const actions = ROWAN.map((s, i) => Object.freeze({ ...local, id: `scene-${i + 1}`, triggerMs: s.startMs, resumeMs: s.resumeMs }));
  const executor = {
    async preloadLocal(action) { calls.push(`preload:${action.id}`); }, async cancelPreload() {}, async honorNativeSeek() {},
    async executeLocal(action, observed, options) { calls.push(`execute:${action.id}:${options?.entryFraction ?? 'start'}`); await hold; },
    async executeSkip() {}, async startMute() {}, async finishMute() {}
  };
  return new ManifestActionScheduler({ actions, executor, enterReplacedOnSeek: true });
}

test('with the real scheduler: the old 5 s target enters scene 1 part-way, the new target does not', async () => {
  const before = [], old = rowanScheduler(before);
  await old.observe({ currentTimeMs: 2_193_595, paused: false, event: 'seek' }); await old.running;
  assert.ok(before.some(call => call.startsWith('execute:scene-1:')), 'the 0.61.1 target entered scene 1 (the reported failure)');
  const after = [], fixed = rowanScheduler(after);
  await fixed.observe({ currentTimeMs: jumpTargetMs(ROWAN, 1, 5_000), paused: false, event: 'seek' }); await fixed.running;
  assert.equal(after.some(call => call.startsWith('execute:scene-1')), false, 'scene 1 is not replayed');
  assert.equal(fixed.snapshot().statuses['scene-2'], 'pending', 'scene 2 is still ahead');
});

test('a seek superseded because playback entered a scene is a successful jump; other aborts still fail', async () => {
  const abort = new DOMException('Native command superseded', 'AbortError');
  let release; const hold = new Promise(resolve => { release = resolve; });
  const calls = [], scheduler = rowanScheduler(calls, hold);
  await scheduler.observe({ currentTimeMs: 2_193_595, paused: false, event: 'seek' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(supersededByEntry(abort, scheduler, null), true, 'scene 1 entered and playing');
  release(); await scheduler.running;
  assert.equal(supersededByEntry(abort, rowanScheduler([]), null), false, 'nothing entered: still a failure');
  assert.equal(supersededByEntry(Error('seek-timeout'), scheduler, { running: true }), false, 'a real error is a failure');
  assert.equal(supersededByEntry(abort, { snapshot: () => ({ runningActionId: null }) }, { running: Promise.resolve() }), true, 'engine took over');
});
