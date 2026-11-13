import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTiming, createTransitionTiming, TIMING_SCHEMA } from '../src/transition-timing.mjs';
import { preferences, preferenceChange } from '../src/viewer-model.mjs';
import { validLocalMessage, validLocalResult } from '../src/local-message-schema.mjs';

// 24 fps native presented on a 60 Hz display: alternating 33/50 ms steps.
function nativeFrames(fromS, toS, startT) {
  const frames = []; let t = startT;
  for (let i = 0, m = fromS; m < toS - 1e-9; i += 1, m += 1 / 24) { frames.push([t, Math.round(m * 1000) / 1000]); t += i % 2 ? 50 : 33.3; }
  return frames;
}

const stream = (frames, from, to, id = 1) => ({
  frames: frames.map((row, i) => [row[0], row[1], row[2] ?? id, i + 1]),
  states: [[from, id, 'video', null]], spans: [[from, to]], losses: [], playback: [[from, id, false, false, false]],
  dropped: { frames: 0, states: 0, spans: 0, losses: 0, playback: 0 }, maximumHeartbeatGapMs: 100
});

test('a clean planned cut and join analyze as native cadence with no removed frames', () => {
  const T0 = 1.7e12;
  const before = nativeFrames(9, 10, T0);                       // up to 9.958 s
  const on = before.at(-1)[0] + 5;                               // cover right after the last frame
  const clip = nativeFrames(0, 5, on - 8).map(([t, m]) => [t, m, 1]);
  const off = clip.at(-1)[0] + 20;
  const after = nativeFrames(15, 16, off - 5);
  const result = analyzeTiming({ native: stream([...before, ...after], T0 - 100, after.at(-1)[0]), clip: stream(clip, T0 - 100, after.at(-1)[0]), cover: [[T0 - 100, 'open'], [on, 'covered'], [off, 'open']],
    events: [[on + 3, 'transition', { triggerMs: 10_000, resumeMs: 15_000, action: 'REPLACE', entry: false }]] });
  const [cut] = result.transitions;
  assert.equal(cut.kind, 'replace');
  assert.equal(cut.removedFramesShown, null, 'callback evidence cannot certify displayed pixels');
  assert.equal(cut.removedNativeCallbacks, 0);
  assert.equal(cut.entry.status, 'observed'); assert.equal(cut.exit.status, 'observed');
  assert.ok(cut.entryLargestGapMs <= 50, `entry gap ${cut.entryLargestGapMs}`);
  assert.ok(cut.exitLargestGapMs <= 50, `exit gap ${cut.exitLargestGapMs}`);
  assert.equal(cut.lastNativeBeforeCover, 9.958);
  assert.ok(cut.frames.entry.native.length > 0 && cut.frames.exit.native.length > 0);
});

test('removed footage and a held frame are reported', () => {
  const T0 = 1.7e12, native = nativeFrames(9.5, 10.2, T0);    // plays 5 frames into the scene
  const on = native.at(-1)[0] + 5;
  const clip = [[on - 50, 0, 1], [on + 160, 0.042, 1], [on + 200, 0.083, 1], [on + 240, .125, 1], [on + 280, .167, 1], [on + 320, .208, 1]];
  const [cut] = analyzeTiming({ native: stream(native, T0, on + 400), clip: stream(clip, T0, on + 400), cover: [[T0, 'open'], [on, 'covered']], events: [[on, 'transition', { triggerMs: 10_000, resumeMs: 15_000 }]] }).transitions;
  assert.equal(cut.removedNativeCallbacks, 5);
  assert.equal(cut.entryLargestGapMs, 160);
  assert.equal(cut.exitLargestGapMs, undefined, 'still covered');
});

test('a seek entry reports seek-to-cover, native landing and first clip frame', () => {
  const T0 = 1.7e12, seekAt = T0 + 1000;
  const native = [[T0, 5], [seekAt + 150, 12], [seekAt + 190, 12.04]];
  const on = seekAt + 40;
  const [entry] = analyzeTiming({ native, clip: [[seekAt + 300, 2.5, 1]], cover: [[on, 'covered']],
    events: [[seekAt, 'native-seeking', { toMs: 12_000 }], [seekAt + 20, 'transition', { triggerMs: 10_000, resumeMs: 15_000, entry: true }]] }).transitions;
  assert.equal(entry.kind, 'seek-entry');
  assert.equal(entry.removedFramesShown, null);
  assert.equal(entry.entryLargestGapMs, null, 'legacy traces have no mapping or observation bounds');
  assert.equal(entry.seekToCoverMs, 40); assert.equal(entry.nativeLandedAfterSeekMs, 150); assert.equal(entry.firstClipFrameAfterSeekMs, 300);
});

test('the recorder only records while enabled and reports its schema', () => {
  const frames = []; const player = { requestVideoFrameCallback: cb => { frames.push(cb); return frames.length; }, cancelVideoFrameCallback() {} };
  const animations = []; const window = { requestAnimationFrame: cb => { animations.push(cb); return animations.length; }, cancelAnimationFrame() {} };
  const timing = createTransitionTiming({ window, getPlayer: () => player, getHost: () => null });
  timing.mark('ignored');
  timing.setEnabled(true); animations.splice(0).forEach(callback => callback(16));
  frames.shift()(0, { mediaTime: 1, expectedDisplayTime: 5 });
  const report = timing.report();
  assert.equal(report.schema, TIMING_SCHEMA); assert.equal(report.recording, true); assert.equal(report.transitionCount, 0);
  timing.setEnabled(false); assert.equal(timing.enabled, false);
});

test('a recorder with no animation callbacks retains an engine attempt without fabricated edges', () => {
  const window = { requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
  const timing = createTransitionTiming({ window, getPlayer: () => null, getHost: () => null, clock: () => 1000 });
  timing.setEnabled(true);
  timing.mark('transition', { triggerMs: 5000, resumeMs: 7000, action: 'REPLACE' });
  timing.mark('state', { state: 'COMPLETE' });
  const report = timing.report();
  assert.equal(report.schema, 'seamless-timing-v4');
  assert.equal(report.transitionCount, 1); assert.equal(report.sampledTransitionCount, 0);
  assert.equal(report.unobservedTransitionCount, 1);
  const missing = report.transitions[0];
  assert.equal(missing.triggerMs, 5000); assert.equal(missing.coveredMs, null);
  assert.equal(missing.observation, 'cover-not-observed');
  for (const edge of [missing.entry, missing.exit]) {
    assert.equal(edge.status, 'insufficient-evidence'); assert.equal(edge.reason, 'cover-boundary-not-observed');
    assert.equal(edge.largestGapMs, null); assert.equal(edge.lowerBoundMs, null);
  }
  assert.deepEqual(analyzeTiming(JSON.parse(JSON.stringify(report.observations))).transitions, report.transitions);
  timing.setEnabled(false);
});

test('mixed sampled and unsampled attempts retain chronological bounded detail without double counting old covers', () => {
  const events = [], cover = [[0, 'open']];
  for (let i = 0; i < 16; i++) {
    const time = 10000 * (i + 1);
    events.push([time, 'transition', { triggerMs: time, resumeMs: time + 1000, action: i % 2 ? 'INSERT' : 'REPLACE' }]);
    if (i % 2 === 0) cover.push([time + 10, 'covered'], [time + 1010, 'open']);
  }
  const result = analyzeTiming({ events, cover });
  assert.equal(result.transitionCount, 16); assert.equal(result.sampledTransitionCount, 8);
  assert.equal(result.unobservedTransitionCount, 8); assert.equal(result.transitions.length, 12);
  assert.deepEqual(result.transitions.map(t => t.triggerMs), events.slice(-12).map(e => e[2].triggerMs));
  assert.equal(result.transitions.filter(t => t.observation === 'cover-not-observed').length, 6);
  assert.equal(result.transitions.at(-1).kind, 'insert');
});

test('one marker is not reused by two cover intervals and an unmatched earlier attempt remains visible', () => {
  const result = analyzeTiming({ cover: [[0, 'open'], [200, 'covered'], [250, 'open'], [7000, 'covered'], [7100, 'open']],
    events: [[100, 'transition', { triggerMs: 1000, resumeMs: 2000 }], [190, 'transition', { triggerMs: 3000, resumeMs: 4000 }]] });
  assert.equal(result.transitionCount, 3); assert.equal(result.unobservedTransitionCount, 1);
  assert.equal(result.transitions[0].triggerMs, 1000); assert.equal(result.transitions[0].observation, 'cover-not-observed');
  assert.equal(result.transitions[1].triggerMs, 3000); assert.equal(result.transitions[2].kind, 'unknown');
});

test('the timing preference and renderer commands are validated', () => {
  assert.equal(preferences({}).timing, false);
  assert.equal(preferenceChange(preferences({}), { timing: true }).timing, true);
  assert.throws(() => preferenceChange(preferences({}), { timing: 'yes' }), /preference-invalid/);
  assert.equal(validLocalMessage({ type: 'command', id: 1, command: 'timing', args: [true] }, 'controller'), true);
  assert.equal(validLocalMessage({ type: 'command', id: 1, command: 'timing', args: [1] }, 'controller'), false);
  const result = value => ({ type: 'result', id: 1, ok: true, value });
  const log = stream([[1.7e12, 1.25, 1]], 1.7e12, 1.7e12 + 1000);
  assert.equal(validLocalResult(result(log), 'timingLog'), true);
  assert.equal(validLocalResult(result({ ...log, frames: [[1.7e12, 1.25, 1]] }), 'timingLog'), false);
  assert.equal(validLocalResult(result({ ...log, spans: [[1.7e12 + 1, 1.7e12]] }), 'timingLog'), false);
  assert.equal(validLocalResult(result({ ...log, dropped: { ...log.dropped, frames: -1 } }), 'timingLog'), false);
  assert.equal(validLocalResult(result({ ...log, playback: [[1.7e12, 1, 'paused', false, false]] }), 'timingLog'), false);
  assert.equal(validLocalResult(result({ ...log, playback: [[1.7e12, 1, null, null, null]] }), 'timingLog'), true);
  assert.equal(validLocalResult(result({ frames: [[1.7e12, 1.25, 'a']] }), 'timingLog'), false);
  assert.equal(validLocalResult(result({ frames: [], extra: 1 }), 'timingLog'), false);
});
