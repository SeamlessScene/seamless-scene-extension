import test from 'node:test';
import assert from 'node:assert/strict';
import { StandardTransitionAdapter } from '../src/standard-transition-adapter.mjs';
import { exitPrerollLeadMs, exitParkMs, EXIT_PARK_DEFAULT_DELAY_MS, EXIT_PARK_LATE_BIAS_MS, EXIT_PARK_MAX_MS, EXIT_PARK_DELAY_MAX_MS, nativeFrameLengthMs, NATIVE_FRAME_MIN_MS, NATIVE_FRAME_MAX_MS, EXIT_PREROLL_LEAD_MS, EXIT_OUTPUT_STARTUP_MS, EXIT_CLIP_DROPPED_TAIL_MS, EXIT_CLIP_TAIL_MARGIN_MS } from '../src/audio-crossfade.mjs';

// 0.65.7 X1 (E72): Exit reveal 'precise'. 'new' and 'previous' keep their 0.65.6 tests
// (seamless-cut.test.mjs, audio-crossfade.test.mjs) unchanged.

const FRAME = 1000 / 24; // 41.7 ms native frames

function harness(policy) {
  const frames = new Map(); let id = 0;
  const player = new EventTarget();
  Object.assign(player, { muted: false, paused: false, seeking: false, playbackRate: 1, currentTime: 9.8, readyState: 4, volume: 1,
    requestVideoFrameCallback(callback) { frames.set(++id, callback); return id; }, cancelVideoFrameCallback(handle) { frames.delete(handle); },
    pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } });
  const adapter = new StandardTransitionAdapter({ document: { defaultView: {} }, passiveAdapter: { activePlayer: () => player },
    commandAdapter: { readState: () => ({ currentTimeMs: Math.round(player.currentTime * 1000), paused: player.paused, muted: player.muted, volume: 1, readyState: 4 }),
      pause: async () => { player.paused = true; }, play: async () => { player.paused = false; }, seekToWithPlaybackWarmup: async () => {} } });
  if (policy) adapter.setExitRevealPolicy(policy);
  adapter.nativeFrameMs = FRAME;
  // One native frame callback: `now` is the callback time, `shown` its expectedDisplayTime (performance clock).
  const present = (mediaTime, presentedFrames, { now = performance.now(), shown = now } = {}) => {
    for (const [handle, callback] of [...frames]) { frames.delete(handle); callback(now, { mediaTime, presentedFrames, expectedDisplayTime: shown }); }
  };
  const host = { style: { visibility: 'visible' }, dataset: {}, isConnected: true, remove() {} };
  return { player, adapter, present, host };
}

async function exitAt(h, { joinMs, pausedAt, endInMs = 60 }) {
  const snapshot = await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = h.host;
  h.player.currentTime = pausedAt;
  const endAtPerf = performance.now() + endInMs;
  assert.equal(h.adapter.prerollNative(performance.timeOrigin + endAtPerf, { joinMs }), true);
  return { snapshot, endAtPerf };
}

test("precise: a correct first frame that arrives 30 ms early, shown within half a frame of the clip's end, uncovers on that frame", async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const policy of ['precise', 'new']) {
    const h = harness(policy);
    const { snapshot, endAtPerf } = await exitAt(h, { joinMs: 14_999, pausedAt: 14.999 });
    t.mock.timers.tick(1); // 105 ms lead: native starts at once
    // Native's first new frame (the expected next picture), its callback 30 ms before the clip's end,
    // to be shown 14 ms before it (within half a 41.7 ms frame).
    h.present(15.025, 10, { now: endAtPerf - 30, shown: endAtPerf - 14 });
    assert.equal(h.host.style.visibility, policy === 'precise' ? 'hidden' : 'visible', `${policy}: uncovered on the early correct frame`);
    if (policy === 'new') { t.mock.timers.reset(); t.mock.timers.enable({ apis: ['setTimeout'] }); continue; }
    t.mock.timers.reset();
    const receipt = await h.adapter.restore(snapshot, { targetTimeMs: 14_999, resumePlayback: true, awaitPresentedFrame: true });
    assert.equal(receipt.audioFade.revealPolicy, 'precise');
    assert.equal(receipt.audioFade.uncoverFrameMediaTimeMs, 15_025, 'no extra frame held');
    assert.equal(receipt.audioFade.frames.length, 1);
    assert.equal(receipt.audioFade.revealFrameMs, 41.7);
    t.mock.timers.enable({ apis: ['setTimeout'] });
  }
});

test('precise: a frame shown more than half a frame before the clip ends keeps the cover (the last clip frame keeps its slot)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness('precise');
  const { endAtPerf } = await exitAt(h, { joinMs: 14_999, pausedAt: 14.999 });
  t.mock.timers.tick(1);
  h.present(15.025, 10, { now: endAtPerf - 40, shown: endAtPerf - 25 });
  assert.equal(h.host.style.visibility, 'visible', 'shown 25 ms before the end: more than half a frame early');
  h.present(15.067, 11, { now: endAtPerf - 2, shown: endAtPerf + 16 });
  assert.equal(h.host.style.visibility, 'hidden');
});

test('precise: on a frame-aligned join the paused join frame is the target; the frame before the join never uncovers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness('precise');
  const { snapshot, endAtPerf } = await exitAt(h, { joinMs: 15_000, pausedAt: 15.0 });
  t.mock.timers.tick(1);
  // A frame before the join, even at the clip's end, stays covered.
  h.present(14.958, 9, { now: endAtPerf + 1, shown: endAtPerf + 5 });
  assert.equal(h.host.style.visibility, 'visible', 'never a frame before the join');
  // The paused join frame (re-presented, not "moving") is the intended picture.
  h.present(15.0, 10, { now: endAtPerf + 3, shown: endAtPerf + 10 });
  assert.equal(h.host.style.visibility, 'hidden');
  t.mock.timers.reset();
  const receipt = await h.adapter.restore(snapshot, { targetTimeMs: 15_000, resumePlayback: true, awaitPresentedFrame: true });
  assert.equal(receipt.audioFade.uncoverFrameMediaTimeMs, 15_000, 'the paused frame at the join, not the one after it');
  // Under 'new' the same paused frame is not "newer than the paused position": it waits a frame more.
  const n = harness('new');
  const exit = await exitAt(n, { joinMs: 15_000, pausedAt: 15.0 });
  t.mock.timers.enable({ apis: ['setTimeout'] }); t.mock.timers.tick(1);
  n.present(15.0, 10, { now: exit.endAtPerf + 3, shown: exit.endAtPerf + 10 });
  assert.equal(n.host.style.visibility, 'visible');
});

test('precise: a frame 1 ms before a rounded join counts as the join frame', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness('precise');
  const { endAtPerf } = await exitAt(h, { joinMs: 15_015, pausedAt: 15.015 });
  t.mock.timers.tick(1);
  h.present(15.01458, 10, { now: endAtPerf, shown: endAtPerf + 8 }); // 23.976 fps frame 360 starts at 15014.58 ms
  assert.equal(h.host.style.visibility, 'hidden');
});

// 0.65.8: 0.65.7's shorter precise lead (max(40, start-up - one frame), capped at 105 ms) is
// retired. Precise keeps its reveal gate (the tests above) and uses R4's lead, exactly as 'new'.
const STARTUPS = [[], [170], [44, 60], [60, 70, 65], [91, 95, 100], [114.6, 131, 127.1], [120, 130, 125], [150, 160, 170], [170, 180, 190], [181, 200, 260], [300, 320, 310]];

test("precise: the exit lead is R4's lead, the same as 'new', for every start-up", async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const latencies of STARTUPS) {
    const leads = {};
    for (const policy of ['precise', 'new']) {
      const h = harness(policy);
      h.adapter.exitStartLatencies = latencies;
      h.adapter.nativeFrameMs = 80; // a doubled frame estimate no longer shortens anything
      await exitAt(h, { joinMs: 14_999, pausedAt: 14.999, endInMs: 300 });
      t.mock.timers.tick(300);
      leads[policy] = h.adapter.nativePreroll.leadMs;
      h.adapter.prerollNative(null);
    }
    assert.equal(leads.precise, exitPrerollLeadMs(latencies), `precise ${latencies}`);
    assert.equal(leads.precise, leads.new, `precise and new ${latencies}`);
    assert.ok(leads.precise >= EXIT_PREROLL_LEAD_MS && leads.precise <= 200, `lead ${leads.precise} for ${latencies}`);
  }
  assert.equal(exitPrerollLeadMs([114.6, 131, 127.1]), 137, "FS 29's start-ups: 137 ms (0.65.7's precise lead was 47)");
});

test("precise: native is audible before the clip's audio ends (the adapter's 0.62.15 model predicts no gap)", async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // The clip is silent from 30 ms before its end; native becomes audible 41 ms after play().
  const silentBeforeEnd = Math.max(EXIT_CLIP_DROPPED_TAIL_MS, EXIT_CLIP_TAIL_MARGIN_MS);
  for (const latencies of STARTUPS) {
    const h = harness('precise');
    h.adapter.exitStartLatencies = latencies;
    await exitAt(h, { joinMs: 14_999, pausedAt: 14.999, endInMs: 300 });
    t.mock.timers.tick(300);
    const preroll = h.adapter.nativePreroll;
    assert.equal(preroll.started, true);
    // play() on time, lead ms before the clip's end (the mocked timers do not move the page clock).
    preroll.playAt = preroll.endAt - preroll.leadMs;
    const predicted = h.adapter.exitAudioReport(preroll).predicted;
    assert.equal(predicted.gapMs, 0, `${latencies}: lead ${preroll.leadMs}, audible at ${predicted.audibleAtMs}`);
    assert.ok(predicted.audibleAtMs < -silentBeforeEnd);
    h.adapter.prerollNative(null);
  }
  // 0.65.7's 47 ms lead (FS 29) would have predicted a gap: the reason it is retired.
  assert.ok(-47 + EXIT_OUTPUT_STARTUP_MS > -silentBeforeEnd);
});

// 0.65.8: native's frame length (the precise gate's half frame) from the last few frames, so one
// dropped frame cannot double it (FS 29 read 80 ms against its real 40 ms in 0.65.7).
test('the native frame length is the lower median of recent per-frame deltas, clamped to 16..50 ms', () => {
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.01, `${message}: ${actual} vs ${expected}`);
  near(nativeFrameLengthMs([40, 40, 80, 40, 40]), 40, 'one dropped frame among 40 ms frames');
  near(nativeFrameLengthMs([40, 80]), 40, 'a dropped frame in the first pair');
  near(nativeFrameLengthMs([40, 40, 40, 40, 40, 80, 40, 80]), 40, 'two drops in eight');
  near(nativeFrameLengthMs(Array(6).fill(1001 / 30)), 33.367, '29.97 fps');
  near(nativeFrameLengthMs(Array(6).fill(1000 / 30)), 33.333, '30 fps');
  near(nativeFrameLengthMs([...Array(5).fill(1001 / 24), 2002 / 24]), 41.708, '23.976 fps with a drop');
  near(nativeFrameLengthMs(Array(6).fill(1000 / 24)), 41.667, '24 fps');
  near(nativeFrameLengthMs(Array(4).fill(1001 / 60)), 16.683, '59.94 fps');
  assert.equal(nativeFrameLengthMs([80]), NATIVE_FRAME_MAX_MS, 'never above 50 ms');
  assert.equal(nativeFrameLengthMs([5, 5, 5]), NATIVE_FRAME_MIN_MS, 'never below 16 ms');
  assert.equal(nativeFrameLengthMs([]), null, 'unmeasured');
  assert.equal(nativeFrameLengthMs([0, -40, NaN, Infinity]), null, 'no valid sample');
  near(nativeFrameLengthMs([...Array(8).fill(80), ...Array(8).fill(40)]), 40, 'only the last eight count');
});

test("precise: a frame dropped before the planned cut no longer doubles the reveal's frame length", async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness('precise');
  h.adapter.nativeFrameMs = undefined;
  h.adapter.stagedHost = { style: {}, dataset: {}, isConnected: true, remove() {} };
  // FS 29 before its entry cut: 40 ms frames, then one dropped before presentation (media +80 ms,
  // presentedFrames +1) as the last pair. 0.65.7 read 80 ms here.
  assert.equal(h.adapter.planCut(1_470_000), true);
  let count = 100;
  for (const media of [1463.400, 1463.440, 1463.480, 1463.520, 1463.560]) h.present(media, count++);
  h.present(1463.640, count++);
  assert.ok(Math.abs(h.adapter.nativeFrameMs - 40) < 0.01, `frame ${h.adapter.nativeFrameMs}`);
  h.adapter.cancelPlannedCut(); h.adapter.stagedHost = null;
  // The exit then judges "late enough" against half of 40 ms, not half of 80.
  const { snapshot, endAtPerf } = await exitAt(h, { joinMs: 14_999, pausedAt: 14.999 });
  t.mock.timers.tick(1);
  h.present(15.025, 10, { now: endAtPerf - 40, shown: endAtPerf - 25 });
  assert.equal(h.host.style.visibility, 'visible', 'shown 25 ms early: more than half a 40 ms frame');
  h.present(15.065, 11, { now: endAtPerf - 1, shown: endAtPerf + 15 });
  assert.equal(h.host.style.visibility, 'hidden');
  t.mock.timers.reset();
  const receipt = await h.adapter.restore(snapshot, { targetTimeMs: 14_999, resumePlayback: true, awaitPresentedFrame: true });
  assert.equal(receipt.audioFade.revealFrameMs, 40);
});

// 0.66.2 (exit jump): from a pause at the join native's clock was 35-135 ms past the join at the
// clip's end (22 logged exits), so the join frame was never the one presented. With Exit reveal
// 'precise' native now waits before the join by the media its clock covers before the clip's end.
test('exit park: the lead less the measured clock start delay, biased late, bounded', () => {
  assert.equal(exitParkMs(105), 105 - EXIT_PARK_DEFAULT_DELAY_MS + EXIT_PARK_LATE_BIAS_MS, 'unmeasured: the default delay');
  assert.equal(exitParkMs(105, []), 65);
  assert.equal(exitParkMs(105, [64.7]), 50, 'one measurement is used at once');
  assert.equal(exitParkMs(105, [64.7, 65.8]), 50, 'the lower median of two');
  assert.equal(exitParkMs(125, [43.4, 52.8, 70.4]), 82, 'the median of the last three');
  assert.equal(exitParkMs(125, [5, 43.4, 52.8, 70.4]), 82, 'only the last three');
  assert.equal(exitParkMs(174, [70.4, 43.8, 69.7]), 114);
  assert.equal(exitParkMs(200, [0, 0, 0]), EXIT_PARK_MAX_MS, 'never more than the cap');
  assert.equal(exitParkMs(105, [140, 140, 140]), 0, 'a clock that starts after the clip ends needs no park');
  assert.equal(exitParkMs(60, [0]), 60, 'never more than the lead');
  assert.equal(exitParkMs(105, [NaN, -4, 900, 'x']), 65, 'implausible measurements are ignored');
  assert.equal(exitParkMs(NaN, [50]), 0);
  assert.equal(exitParkMs(0, [50]), 0);
});

test("exit park: only Exit reveal 'precise' parks, and only where native is muted or under the exit ramp", async () => {
  for (const policy of ['new', 'previous']) {
    const h = harness(policy); await h.adapter.snapshot();
    assert.equal(h.adapter.exitParkMs(), 0, `${policy}: native waits at the join itself`);
  }
  const h = harness('precise');
  assert.equal(h.adapter.exitParkMs(), 0, 'no transition');
  await h.adapter.snapshot();
  assert.equal(h.adapter.exitParkMs(), 65, 'Smooth audio on: lead 105, default delay');
  h.adapter.exitClockDelays = [64.7, 65.8, 64.5];
  assert.equal(h.adapter.exitParkMs(), 50, 'the measured delay');
  h.adapter.exitStartLatencies = [162.6, 136.6, 120.2];
  assert.equal(h.adapter.exitParkMs(), exitPrerollLeadMs([162.6, 136.6, 120.2]) - 64.7 + 10 | 0, 'it follows the learned lead');
  h.adapter.crossfadeEnabled = false;
  assert.equal(h.adapter.exitParkMs(), 0, "Smooth audio off: native would be heard at the viewer's level before the join");
  const muted = harness('precise'); muted.player.muted = true; await muted.adapter.snapshot();
  muted.adapter.crossfadeEnabled = false;
  assert.equal(muted.adapter.exitParkMs(), 65, 'viewer-muted native makes no sound either way');
  const paused = harness('precise'); paused.player.paused = true; await paused.adapter.snapshot();
  assert.equal(paused.adapter.exitParkMs(), 0, 'a paused viewer has no exit pre-roll');
});

test("exit park: parked native stays covered through its pre-join frames and uncovers on the join frame at the clip's end", async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness('precise');
  const snapshot = await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = h.host;
  h.player.currentTime = 14.935; // parked 65 ms before the join
  let clock = performance.now(); // the page clock, moved by hand from here
  t.mock.method(performance, 'now', () => clock);
  const endAtPerf = clock + 105;
  assert.equal(h.adapter.prerollNative(performance.timeOrigin + endAtPerf, { joinMs: 15_000, parkMs: 65 }), true);
  t.mock.timers.tick(1); // 105 ms lead, unchanged by the park: native starts at once
  const preroll = h.adapter.nativePreroll;
  assert.equal(preroll.started, true);
  assert.equal(preroll.leadMs, 105, 'the park does not lengthen the lead');
  assert.equal(h.player.paused, false);
  // Native's first frames are before the join: covered, even one shown after the clip's end.
  h.present(14.917, 9, { now: endAtPerf - 45, shown: endAtPerf - 40 });
  h.present(14.958, 10, { now: endAtPerf + 2, shown: endAtPerf + 4 });
  assert.equal(h.host.style.visibility, 'visible', 'never a frame before the join');
  // The join frame, presented at the clip's end: this is the one revealed.
  clock = endAtPerf + 3; h.player.currentTime = 15.004;
  h.present(15.0, 11, { now: endAtPerf + 3, shown: endAtPerf + 6 });
  // Parked: the cover goes once the join frame is confirmed on screen (here by native's next frame
  // callback, at the same instant so the figures below are unchanged); test/exit-uncover-confirm.
  assert.equal(h.host.style.visibility, 'visible');
  h.present(15.042, 12, { now: endAtPerf + 3, shown: endAtPerf + 6 });
  assert.equal(h.host.style.visibility, 'hidden');
  t.mock.timers.reset();
  const receipt = await h.adapter.restore(snapshot, { targetTimeMs: 15_000, resumePlayback: true, awaitPresentedFrame: true });
  const exit = receipt.audioFade;
  assert.equal(exit.parkMs, 65);
  assert.equal(exit.pausedVsJoinMs, -65);
  assert.equal(exit.uncoverFrameMediaTimeMs, 15_000);
  assert.equal(exit.uncover.frameVsJoinMs, 0);
  assert.equal(exit.uncover.frameVsJoinFrames, 0, 'the join frame, none skipped');
  assert.equal(exit.uncover.clockVsJoinMs, 4);
  assert.equal(exit.uncover.clockVsJoinFrames, 0.1);
  assert.equal(exit.uncover.frameMs, 41.7);
  assert.equal(exit.uncover.clipRemainingMs, -3, 'the clip had ended 3 ms earlier: its last frame was held that long');
  assert.equal(exit.uncover.clipFramesRemaining, -0.07);
  assert.equal(exit.uncover.clockAtClipEndVsJoinMs, 1, "native's clock was 1 ms past the join at the clip's end");
  // play() 105 ms before the clip's end; native covered 66 ms of media by then: its clock
  // started 39 ms after play(). Kept for the next exits' park.
  assert.equal(exit.uncover.clockDelayMs, 39);
  assert.deepEqual(h.adapter.exitClockDelays, [39]);
  assert.equal(h.adapter.exitParkMs(), 105 - 39 + 10, 'the next exit parks by the lead less this delay, biased late');
});

// A clock that always starts later than EXIT_PARK_DELAY_MAX_MS used to teach nothing: every exit
// parked by the unmeasured default and held the clip's last frame for the difference.
test('exit park: a clock start slower than the limit is learned at the limit, not discarded', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness('precise');
  h.adapter.exitStartLatencies = [190, 190, 190]; // a slow start-up: the lead is 200 ms
  const snapshot = await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = h.host;
  assert.equal(h.adapter.exitParkMs(), EXIT_PARK_MAX_MS, 'unmeasured: 200 - 50 + 10, capped');
  h.player.currentTime = 14.85;
  let clock = performance.now();
  t.mock.method(performance, 'now', () => clock);
  const endAtPerf = clock + 200;
  assert.equal(h.adapter.prerollNative(performance.timeOrigin + endAtPerf, { joinMs: 15_000, parkMs: 150 }), true);
  t.mock.timers.tick(1);
  assert.equal(h.adapter.nativePreroll.leadMs, 200);
  // Native's clock started 160 ms after play(): it reaches the join 110 ms after the clip's end.
  clock = endAtPerf + 120; h.player.currentTime = 15.01;
  h.present(15.0, 11, { now: endAtPerf + 120, shown: endAtPerf + 124 });
  h.present(15.042, 12, { now: endAtPerf + 120, shown: endAtPerf + 124 }); // parked: the confirming frame callback
  assert.equal(h.host.style.visibility, 'hidden');
  t.mock.timers.reset();
  const exit = (await h.adapter.restore(snapshot, { targetTimeMs: 15_000, resumePlayback: true, awaitPresentedFrame: true })).audioFade;
  assert.equal(exit.uncover.clockDelayMs, 160, 'the export keeps the measured value');
  assert.deepEqual(h.adapter.exitClockDelays, [EXIT_PARK_DELAY_MAX_MS], 'learned, at the limit');
  assert.equal(h.adapter.exitParkMs(), 200 - EXIT_PARK_DELAY_MAX_MS + EXIT_PARK_LATE_BIAS_MS, 'the next exit parks 60 ms, not 150');
  // A negative measurement (a clock ahead of play(): not plausible) is still ignored.
  h.adapter.exitClockDelays = [];
  assert.equal(exitParkMs(200, [-5]), EXIT_PARK_MAX_MS);
});

test('exit park: an unparked exit reports how far past the join its revealed frame and clock are, in frames', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness('precise');
  const { snapshot, endAtPerf } = await exitAt(h, { joinMs: 15_000, pausedAt: 15.0 });
  t.mock.timers.tick(1);
  // Today's fault: the first frame native can show is two frames past the join.
  h.player.currentTime = 15.094;
  h.present(15.0834, 12, { now: endAtPerf + 1, shown: endAtPerf + 5 });
  assert.equal(h.host.style.visibility, 'hidden');
  t.mock.timers.reset();
  const exit = (await h.adapter.restore(snapshot, { targetTimeMs: 15_000, resumePlayback: true, awaitPresentedFrame: true })).audioFade;
  assert.equal('parkMs' in exit, false);
  assert.equal(exit.uncover.frameVsJoinMs, 83.4);
  assert.equal(exit.uncover.frameVsJoinFrames, 2);
  assert.equal(exit.uncover.clockVsJoinFrames, 2.26);
});

test('exit park: parked native that would be heard before the join is not started early', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness('precise');
  await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = h.host;
  h.player.currentTime = 14.935;
  h.adapter.crossfadeEnabled = false; // Smooth audio switched off after the join seek
  assert.equal(h.adapter.prerollNative(performance.timeOrigin + performance.now() + 60, { joinMs: 15_000, parkMs: 65 }), true);
  t.mock.timers.tick(1);
  assert.equal(h.adapter.nativePreroll, null, 'no early start: restore seeks to the join itself');
  assert.equal(h.player.paused, true);
  assert.equal(h.host.style.visibility, 'visible');
  // The same switch without a park changes nothing: native starts as before.
  const plain = harness('precise');
  await exitAt(plain, { joinMs: 15_000, pausedAt: 15.0 });
  plain.adapter.crossfadeEnabled = false;
  t.mock.timers.tick(1);
  assert.equal(plain.adapter.nativePreroll?.started, true);
});

test('exit park: without frame callbacks the fallback waits once more while native is still before the join', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness('precise');
  await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = h.host;
  h.player.currentTime = 14.935;
  assert.equal(h.adapter.prerollNative(performance.timeOrigin + performance.now() + 60, { joinMs: 15_000, parkMs: 65 }), true);
  t.mock.timers.tick(1);
  h.player.currentTime = 14.95; // stalled 50 ms before the join
  t.mock.timers.tick(300 + 65);
  assert.equal(h.host.style.visibility, 'visible', 'still before the join: one more wait');
  t.mock.timers.tick(150);
  assert.equal(h.host.style.visibility, 'hidden', 'the cover is still bounded');
  assert.equal(h.adapter.exitClockDelays.length, 0, 'a fallback uncover teaches nothing');
});
