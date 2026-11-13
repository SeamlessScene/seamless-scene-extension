import test from 'node:test';
import assert from 'node:assert/strict';
import { CROSSFADE_MS, VolumeRamp, equalPowerGain, crossfadeAllowed, fadeableVolume, combinedGain, exitPrerollLeadMs, EXIT_PARK_AUDIO_START_MS, EXIT_NATIVE_START_MS, EXIT_NATIVE_RAMP_MS, EXIT_CLIP_TAIL_MARGIN_MS, EXIT_SILENT_GAIN } from '../src/audio-crossfade.mjs';
import { StandardTransitionAdapter } from '../src/standard-transition-adapter.mjs';
import { LocalOverlay } from '../src/local-overlay.mjs';
import { validLocalMessage, validLocalResult } from '../src/local-message-schema.mjs';
import { preferences, preferenceChange } from '../src/viewer-model.mjs';
import { MetricsRecorder } from '../src/metrics.mjs';
import { TransitionEngine } from '../src/transition-engine.mjs';

// A manual clock and timer queue shared by the ramp and the test.
function fakeClock(start = 1_000) {
  let t = start, id = 0;
  const timers = new Map();
  return {
    tickMs: 1,
    now: () => t,
    setTimer: (callback, ms) => { timers.set(++id, { at: t + Math.max(0, ms), callback }); return id; },
    clearTimer: handle => { timers.delete(handle); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); t = Math.max(t, due[1].at); due[1].callback();
      }
      t = end;
    },
    get pending() { return timers.size; }
  };
}

// A media element whose volume writes are recorded.
function element({ volume = 0.8, muted = false } = {}) {
  const el = new EventTarget();
  let value = volume;
  el.muted = muted; el.writes = [];
  Object.defineProperty(el, 'volume', { get: () => value, set: next => { if (!(next >= 0 && next <= 1)) throw new RangeError('volume'); value = next; el.writes.push(next); } });
  return el;
}
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-4, `${message ?? ''} ${actual} ≈ ${expected}`);

test('equal-power curves keep constant power and meet at -3 dB', () => {
  assert.equal(CROSSFADE_MS, 50, 'the tunable default the desktop A/B measures');
  close(equalPowerGain(0, 'in'), 0); close(equalPowerGain(1, 'in'), 1);
  close(equalPowerGain(0, 'out'), 1); close(equalPowerGain(1, 'out'), 0);
  close(equalPowerGain(0.5, 'in'), Math.SQRT1_2); close(equalPowerGain(0.5, 'out'), Math.SQRT1_2);
  for (let p = 0; p <= 1; p += 0.05) close(equalPowerGain(p, 'in') ** 2 + equalPowerGain(p, 'out') ** 2, 1, `power at ${p}`);
  close(equalPowerGain(-1, 'in'), 0); close(equalPowerGain(2, 'in'), 1); close(equalPowerGain(NaN, 'out'), 1);
});

test('fades are off in a hidden tab, at zero length and for elements without a usable volume', () => {
  assert.equal(crossfadeAllowed({ visibilityState: 'visible' }), true);
  assert.equal(crossfadeAllowed({}), true);
  assert.equal(crossfadeAllowed({ visibilityState: 'hidden' }), false);
  assert.equal(crossfadeAllowed({ visibilityState: 'visible' }, 0), false);
  assert.equal(fadeableVolume(element()), true);
  assert.equal(fadeableVolume(element({ volume: 0 })), false);
  assert.equal(fadeableVolume(element({ muted: true })), false);
  assert.equal(fadeableVolume({}), false);
});

test('a fade-out follows the cosine curve on schedule, holds at zero and restores the exact level', () => {
  const clock = fakeClock(), el = element({ volume: 0.8 });
  const ramp = new VolumeRamp(el, { ...clock, direction: 'out', level: 0.8, startAt: 1_100, durationMs: 50 });
  clock.advance(90); close(el.volume, 0.8, 'untouched before the window');
  clock.advance(10 + 25); close(el.volume, 0.8 * Math.SQRT1_2, 'half way: -3 dB');
  clock.advance(30); assert.equal(el.volume, 0); assert.equal(ramp.state, 'holding');
  assert.equal(clock.pending, 0, 'a held fade has no timer left');
  assert.ok(el.writes.every(v => v <= 0.8), 'never above the viewer level');
  for (let i = 1; i < el.writes.length; i++) assert.ok(el.writes[i] <= el.writes[i - 1], 'monotonic');
  assert.equal(ramp.restore(), 'restored'); assert.equal(el.volume, 0.8);
  assert.equal(ramp.restore(), 'restored', 'idempotent'); assert.equal(ramp.active, false);
});

test('a fade-in starts from silence, follows the sine curve and finishes exactly at the level', () => {
  const clock = fakeClock(), el = element({ volume: 0.6 });
  const ramp = new VolumeRamp(el, { ...clock, direction: 'in', level: 0.6, startAt: 1_000, durationMs: 50 });
  assert.equal(el.volume, 0);
  clock.advance(25); close(el.volume, 0.6 * Math.SQRT1_2, 'half way');
  clock.advance(40); assert.equal(el.volume, 0.6); assert.equal(ramp.state, 'done'); assert.equal(clock.pending, 0);
  assert.ok(el.writes.every(v => v <= 0.6));
});

test('a fade-in can wait for the media clock to move, with a deadline', () => {
  const clock = fakeClock(), el = element({ volume: 1 });
  let moving = false;
  new VolumeRamp(el, { ...clock, direction: 'in', level: 1, durationMs: 50, startWhen: () => moving, startDeadlineMs: 250 });
  clock.advance(100); assert.equal(el.volume, 0, 'silent until the clock moves');
  moving = true; clock.advance(1); clock.advance(25); close(el.volume, Math.SQRT1_2, 'ramps from when it moved', );
  const late = element({ volume: 1 });
  const ramp = new VolumeRamp(late, { ...clock, direction: 'in', level: 1, durationMs: 50, startWhen: () => false, startDeadlineMs: 250 });
  clock.advance(400); assert.equal(late.volume, 1, 'never left at zero'); assert.equal(ramp.state, 'done');
});

test('cancelling mid-ramp restores the level and stops writing', () => {
  const clock = fakeClock(), el = element({ volume: 0.7 });
  const ramp = new VolumeRamp(el, { ...clock, direction: 'out', level: 0.7, startAt: 1_000, durationMs: 50 });
  clock.advance(20); assert.ok(el.volume < 0.7 && el.volume > 0);
  ramp.restore(); assert.equal(el.volume, 0.7);
  const writes = el.writes.length; clock.advance(200);
  assert.equal(el.writes.length, writes, 'no write after cancellation'); assert.equal(clock.pending, 0);
});

test("a viewer's own volume change mid-ramp wins and is never overwritten", () => {
  const clock = fakeClock(), el = element({ volume: 0.9 });
  const ramp = new VolumeRamp(el, { ...clock, direction: 'out', level: 0.9, startAt: 1_000, durationMs: 50 });
  clock.advance(20); el.volume = 0.3;
  clock.advance(10); assert.equal(ramp.state, 'released'); assert.equal(el.volume, 0.3);
  ramp.restore(); assert.equal(el.volume, 0.3, 'restore leaves the viewer change');
  const held = element({ volume: 0.5 });
  const other = new VolumeRamp(held, { ...clock, direction: 'out', level: 0.5, startAt: clock.now(), durationMs: 10 });
  clock.advance(20); assert.equal(other.state, 'holding'); held.volume = 0.2;
  assert.equal(other.restore(), 'released'); assert.equal(held.volume, 0.2);
});

test('a ramp can be re-aimed before it starts, not while it runs', () => {
  const clock = fakeClock(), el = element({ volume: 1 });
  const ramp = new VolumeRamp(el, { ...clock, direction: 'out', level: 1, startAt: 1_200, durationMs: 50 });
  assert.equal(ramp.retime(1_100), true);
  clock.advance(125); close(el.volume, Math.SQRT1_2);
  assert.equal(ramp.retime(1_300), false, 'a running ramp keeps its timing');
});

test('an unclaimed held fade-out gives the volume back by itself; a claimed one waits for its owner', () => {
  const clock = fakeClock(), el = element({ volume: 0.5 });
  new VolumeRamp(el, { ...clock, direction: 'out', level: 0.5, startAt: 1_000, durationMs: 50, autoRestoreMs: 400 });
  clock.advance(60); assert.equal(el.volume, 0);
  clock.advance(400); assert.equal(el.volume, 0.5);
  const kept = element({ volume: 0.5 });
  const ramp = new VolumeRamp(kept, { ...clock, direction: 'out', level: 0.5, startAt: clock.now(), durationMs: 50, autoRestoreMs: 400 });
  clock.advance(20); ramp.hold(); ramp.claim(); const value = kept.volume;
  clock.advance(1_000); assert.equal(kept.volume, value, 'held where the cut paused it');
  ramp.restore(); assert.equal(kept.volume, 0.5);
});

test('setLevel moves the ceiling of a running fade-in', () => {
  const clock = fakeClock(), el = element({ volume: 1 });
  const ramp = new VolumeRamp(el, { ...clock, direction: 'in', level: 1, startAt: 1_000, durationMs: 50 });
  clock.advance(25); ramp.setLevel(0.5); close(el.volume, 0.5 * Math.SQRT1_2);
  clock.advance(50); assert.equal(el.volume, 0.5);
});

// --- Native side --------------------------------------------------------------

function nativeHarness({ visibilityState = 'visible', volume = 0.8 } = {}) {
  const clock = fakeClock(performance.now()), frames = new Map(); let id = 0;
  const player = element({ volume });
  Object.assign(player, { paused: false, seeking: false, playbackRate: 1, currentTime: 9.75, readyState: 4,
    requestVideoFrameCallback(callback) { frames.set(++id, callback); return id; }, cancelVideoFrameCallback(handle) { frames.delete(handle); },
    pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } });
  const adapter = new StandardTransitionAdapter({ document: { visibilityState, defaultView: {} }, passiveAdapter: { activePlayer: () => player },
    commandAdapter: { readState: () => ({ currentTimeMs: Math.round(player.currentTime * 1000), paused: player.paused, muted: player.muted, volume: player.volume, readyState: 4 }),
      pause: async () => { player.paused = true; }, play: async () => { player.paused = false; }, seekToWithPlaybackWarmup: async () => {} },
    crossfadeMs: 50, fadeClock: clock });
  adapter.stagedHost = { style: {}, dataset: {}, isConnected: true, remove() {} };
  // A 24 fps frame clock: each frame is presented now and its callback runs.
  const present = mediaTime => { player.currentTime = mediaTime; for (const [handle, callback] of [...frames]) { frames.delete(handle); callback(clock.now(), { mediaTime, presentedFrames: Math.round(mediaTime * 24), expectedDisplayTime: clock.now() }); } };
  const frame = 1000 / 24;
  // Plays frames up to (not including) the trigger at 10 s.
  const playTo = (from, until) => { const out = []; for (let t = from; t < until; t += frame / 1000) { present(t); out.push({ at: clock.now(), volume: player.volume, paused: player.paused }); if (player.paused) break; clock.advance(frame); } return out; };
  return { clock, player, adapter, present, playTo, frame };
}

test('native fades out over the window that ends on the last frame before the cut, then the mute step restores the exact volume', async () => {
  const h = nativeHarness(), predictions = [];
  h.adapter.planCut(10_000, { onPredict: (cut, audioEnd) => predictions.push({ cut, audioEnd }) });
  const trace = h.playTo(9.75, 10.0);
  const cut = trace.at(-1);
  assert.equal(cut.paused, true, 'paused at the last frame before the trigger, as before');
  assert.equal(h.player.paused, true);
  assert.ok(trace.at(-3).volume === 0.8 || trace.at(-3).volume > 0.7, 'full level until the window');
  assert.ok(cut.volume < 0.05, `native has faded to (near) silence at the cut: ${cut.volume}`);
  assert.ok(h.player.writes.every(v => v <= 0.8), 'never above the viewer volume');
  const last = predictions.at(-1);
  assert.ok(last.audioEnd < last.cut && last.cut - last.audioEnd <= h.frame + 1, `${JSON.stringify(last)}` + 'audio ends on the last original frame, before the trigger frame');
  // The transition adopts the cut: its snapshot holds the viewer's volume.
  const snapshot = await h.adapter.snapshot();
  assert.equal(snapshot.volume, 0.8);
  await h.adapter.pause();
  await h.adapter.setMuted(true);
  assert.equal(h.player.muted, true); assert.equal(h.player.volume, 0.8, 'exact volume back once muted and paused');
  assert.equal(h.adapter.nativeFade, null);
  h.clock.advance(1_000); assert.equal(h.player.volume, 0.8);
  await h.adapter.forceSafeNativeState(snapshot);
  assert.equal(h.player.muted, false); assert.equal(h.player.volume, 0.8);
});

test('a viewer pause during the pre-cut fade cancels the cut and restores the volume', () => {
  const h = nativeHarness(); let aborted = 0;
  h.adapter.planCut(10_000, { onAbort: () => { aborted++; } });
  h.playTo(9.75, 9.92);
  h.clock.advance(10);
  assert.ok(h.player.volume < 0.8, 'fade under way');
  h.player.paused = true; h.player.dispatchEvent(new Event('pause'));
  assert.equal(aborted, 1); assert.equal(h.player.volume, 0.8); assert.equal(h.adapter.nativeFade, null);
});

test('a seek during the pre-cut fade, or unstaging, restores the volume', () => {
  for (const leave of ['seeking', 'unstage']) {
    const h = nativeHarness();
    h.adapter.planCut(10_000);
    h.playTo(9.75, 9.92); h.clock.advance(10);
    assert.ok(h.player.volume < 0.8);
    if (leave === 'seeking') h.player.dispatchEvent(new Event('seeking')); else h.adapter.unstageOverlayHost();
    assert.equal(h.player.volume, 0.8, leave);
  }
});

test('an unadopted cut releases native at its full volume', async t => {
  const h = nativeHarness();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.adapter.planCut(10_000);
  h.playTo(9.75, 10.0);
  assert.equal(h.player.paused, true); assert.ok(h.player.volume < 0.05);
  t.mock.timers.tick(2000);
  assert.equal(h.player.paused, false); assert.equal(h.player.volume, 0.8);
});

test('a changed volume during the pre-cut fade is the viewer\'s and is kept', async () => {
  const h = nativeHarness();
  h.adapter.planCut(10_000);
  h.playTo(9.75, 9.92); h.clock.advance(5);
  h.player.volume = 0.4;
  h.playTo(9.917, 10.0);
  assert.equal(h.player.paused, true);
  await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  assert.equal(h.player.volume, 0.4);
});

test('in a hidden tab the cut switches hard, as before', () => {
  const h = nativeHarness({ visibilityState: 'hidden' });
  h.adapter.planCut(10_000);
  h.playTo(9.75, 10.0);
  assert.equal(h.player.paused, true); assert.equal(h.player.volume, 0.8); assert.deepEqual(h.player.writes, []);
});

// 0.62.11 exit: native seeked to the join (no handle), started lead ms before the clip's
// end as in 0.62.5, uncovered on its first frame; its gain follows its own media clock.
async function exitHarness(t, { lead = 40, smooth = true, endIn = 300, warmAtJoin = true, startLatencies = [], parkMs = 0 } = {}) {
  const h = nativeHarness();
  if (lead !== null) h.adapter.nativeStartLatencyMs = lead;
  h.adapter.exitStartLatencies = startLatencies; // 0.65.6: earlier exits' start-up
  h.adapter.setCrossfadeEnabled(smooth);
  const snapshot = await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  const host = { style: { visibility: 'visible' }, dataset: {}, isConnected: true, remove() {} };
  h.adapter.overlayHost = host;
  h.player.currentTime = 15 - parkMs / 1000; // native paused exactly at the join, or parked before it
  // 0.62.14: what the engine does right after the join seek settles.
  const warmed = warmAtJoin ? h.adapter.warmNativeOutput('paused-at-join') : false;
  const afterWarm = { muted: h.player.muted, volume: h.player.volume, writes: [...h.player.writes] };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const end = h.clock.now() + endIn;
  assert.equal(h.adapter.prerollNative(performance.timeOrigin + end, { joinMs: 15_000, handleMs: h.adapter.exitHandleMs(), ...(parkMs > 0 ? { parkMs } : {}) }), true);
  // Native advancing at `rate` media ms per wall ms for `ms` wall ms.
  const run = (ms, rate = 1) => { for (let i = 0; i < ms; i += 1) { h.player.currentTime += rate / 1000; h.clock.advance(1); } };
  const restore = async () => { t.mock.timers.reset(); return h.adapter.restore(snapshot, { targetTimeMs: 15_000, resumePlayback: true, awaitPresentedFrame: true }); };
  // Real timers (the pre-roll start) and the ramp's clock move together.
  const go = ms => { h.clock.advance(ms); t.mock.timers.tick(ms); };
  const events = () => h.adapter.nativePreroll?.events ?? [];
  return { ...h, host, end, run, restore, go, events, warmed, afterWarm, snapshot };
}

test('0.62.14 warm-up: right after the join seek native is unmuted while paused, at volume 0 (Smooth on) or its level (off)', async t => {
  const on = await exitHarness(t);
  assert.equal(on.warmed, true);
  assert.equal(on.afterWarm.muted, false); assert.ok(Math.abs(on.afterWarm.volume - 0.0008) < 1e-9, 'on: unmuted at -60 dB (not 0: Chrome treats 0 as muted) while paused');
  assert.equal(on.player.paused, true);
  assert.equal((await on.adapter.readState()).volume, 0.8, 'the viewer\'s level is still reported');
  await on.restore();
  const off = await exitHarness(t, { smooth: false });
  assert.deepEqual([off.afterWarm.muted, off.afterWarm.volume, off.afterWarm.writes], [false, 0.8, []], 'off: unmuted at the viewer\'s level, no volume write');
  assert.equal(off.adapter.exitFadeArmed(), false); assert.equal(off.adapter.exitCutArmed(), true, 'off: the clip is cut, not faded');
  await off.restore();
});

test('0.62.14: Smooth on and off schedule the same pre-roll lead, and nothing on native changes from warm-up to play', async t => {
  const starts = {};
  for (const smooth of [true, false]) {
    const h = await exitHarness(t, { smooth });
    const writes = h.player.writes.length;
    h.go(150); assert.equal(h.player.paused, true, `${smooth}: not yet`); // margin for real-clock drift under load
    h.go(55); assert.equal(h.player.paused, false, `${smooth}: started the fixed 105 ms before the clip end`);
    assert.equal(h.player.muted, false);
    assert.ok(h.player.writes.slice(writes).every(v => v <= 0.0008 + 1e-9), `${smooth}: no audible volume change at the pre-roll start ${JSON.stringify(h.player.writes)}`);
    starts[smooth] = h.events().find(e => e[1] === 'preroll-start');
    await h.restore();
  }
  assert.equal(starts.true[4], 105); assert.equal(starts.false[4], 105, 'same fixed lead on the preroll-start event');
});

test('0.62.14 Smooth on: unmuted well before the clip end; gain 0 until native media is past the join, then 30 ms of media', async t => {
  const h = await exitHarness(t);
  h.player.currentTime = 14.989; // the seek landed 11 ms early
  h.go(265);
  h.run(10); h.clock.advance(30);
  assert.ok(h.player.volume <= 0.0008 + 1e-9, 'still before the join: -60 dB at most');
  h.run(16); assert.ok(h.player.volume > 0.5 && h.player.volume < 0.7, `ramping from the join (${h.player.volume})`);
  h.run(20); assert.equal(h.player.volume, 0.8);
  h.present(15.03); h.go(300); // the uncover waits for the clip end (mocked timers)
  const receipt = await h.restore();
  const exit = receipt.audioFade;
  assert.equal(exit.outputWarmMode, 'paused-at-join');
  assert.ok(exit.unmuteLeadMs >= 100, `unmuted ${exit.unmuteLeadMs} ms before the clip end`);
  assert.equal(exit.native.trigger, 'warm'); assert.equal(exit.native.fullBy, 'media');
  assert.ok(exit.native.trace.every(([, gain, media]) => gain <= 0.001 + 1e-9 || media >= 0), 'nothing before the join above the -60 dB floor');
  assert.ok(Number.isFinite(exit.frameWaitMs), 'first-frame wait recorded');
});

// 0.66.2: a parked exit must leave no stretch before the join in which neither the clip nor native
// is heard. The clip's own audio ends EXIT_CLIP_TAIL_MARGIN_MS before its end, which is where
// native's clock reaches the join; native's ramp (EXIT_NATIVE_RAMP_MS of its own media time) must
// be over by then. These tests read EXIT_PARK_AUDIO_START_MS: a value that reopens the gap fails.
const JOIN_MS = 15_000;
// Native's level (0-1 of the viewer's) at each ms of its media clock, from the parked position to the join.
function levelsToJoin(h, parkMs, level = 0.8) {
  const rows = [];
  for (let ms = JOIN_MS - parkMs; ms <= JOIN_MS; ms += 1) {
    h.player.currentTime = ms / 1000; h.clock.advance(1);
    rows.push([ms - JOIN_MS, h.player.volume / level]);
  }
  return rows;
}

test("exit park: native's ramp is over before the clip's audio ends, so nothing is silent before the join", async t => {
  assert.ok(EXIT_PARK_AUDIO_START_MS + EXIT_NATIVE_RAMP_MS <= -EXIT_CLIP_TAIL_MARGIN_MS,
    `a ramp from ${EXIT_PARK_AUDIO_START_MS} ms over ${EXIT_NATIVE_RAMP_MS} ms ends after the clip's audio (${-EXIT_CLIP_TAIL_MARGIN_MS} ms): a quiet stretch before the join`);
  const h = await exitHarness(t, { parkMs: 65 });
  h.go(300 - 105);
  assert.equal(h.player.paused, false, 'started at the usual lead');
  const rows = levelsToJoin(h, 65), at = offset => rows.find(([ms]) => ms === offset)[1];
  const floor = EXIT_SILENT_GAIN + 1e-9, tick = 2; // the ramp's timer reads the clock up to a tick late
  assert.ok(rows.filter(([ms]) => ms <= EXIT_PARK_AUDIO_START_MS).every(([, gain]) => gain <= floor), 'held at -60 dB up to the start of the ramp');
  // Rising across the clip's fade: never falling, and past half level by the middle of the ramp.
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i][1] >= rows[i - 1][1], `never falls (${rows[i][0]} ms)`);
  assert.ok(at(EXIT_PARK_AUDIO_START_MS + EXIT_NATIVE_RAMP_MS / 2 + tick) > 0.5);
  // The clip is silent over its last EXIT_CLIP_TAIL_MARGIN_MS: native is at the viewer's level throughout.
  const tail = rows.filter(([ms]) => ms >= -EXIT_CLIP_TAIL_MARGIN_MS + tick);
  assert.ok(tail.length >= EXIT_CLIP_TAIL_MARGIN_MS - tick);
  assert.ok(tail.every(([, gain]) => gain === 1), `at full level from ${-EXIT_CLIP_TAIL_MARGIN_MS} ms to the join: ${JSON.stringify(tail.filter(([, gain]) => gain !== 1))}`);
  assert.ok(h.player.writes.every(v => v <= 0.8), "never above the viewer's level");
  h.present(15.0); h.go(300);
  const exit = (await h.restore()).audioFade;
  assert.equal(exit.parkMs, 65);
  assert.equal(exit.fadeBaseMediaMs, EXIT_PARK_AUDIO_START_MS, 'the export carries where the ramp started');
  assert.equal(exit.native.fullBy, 'media');
});

test('exit park: the ramp cannot start before the park completes (paused or seeking native stays at -60 dB)', async t => {
  const h = await exitHarness(t, { parkMs: 65 });
  const floor = 0.8 * EXIT_SILENT_GAIN + 1e-9;
  // Paused at the parked position until the pre-roll start: no ramp exists, whatever the clocks do.
  h.go(300 - 105 - 10);
  assert.equal(h.player.paused, true); assert.equal(h.adapter.nativePreroll.fade ?? null, null);
  assert.ok(h.player.volume <= floor);
  h.go(10);
  assert.equal(h.player.paused, false);
  // A position past the ramp's start reported while native is seeking or paused moves nothing.
  h.player.seeking = true; h.player.currentTime = 14.98; h.clock.advance(20);
  assert.ok(h.player.volume <= floor, 'seeking: held');
  h.player.seeking = false; h.player.paused = true; h.clock.advance(20);
  assert.ok(h.player.volume <= floor, 'paused: held');
  h.player.paused = false; h.clock.advance(5);
  assert.ok(h.player.volume > floor, 'playing past the start of the ramp: rising');
  await h.restore();
  // A park shorter than the audio start: the ramp starts where native is parked, once it moves.
  const short = await exitHarness(t, { parkMs: 40 });
  short.go(300 - 105);
  short.clock.advance(30);
  assert.ok(short.player.volume <= floor, 'the clock has not moved yet');
  const rows = levelsToJoin(short, 40);
  assert.ok(rows.at(-1)[1] === 1 && rows.find(([ms]) => ms === -40 + EXIT_NATIVE_RAMP_MS + 2)[1] === 1);
  short.present(15.0); short.go(300);
  assert.equal((await short.restore()).audioFade.fadeBaseMediaMs, Math.max(EXIT_PARK_AUDIO_START_MS, -40));
});

test('exit park: an unparked exit still fades native in from the join, never before it', async t => {
  const h = await exitHarness(t);
  h.player.currentTime = 14.95; // a seek that landed short, with no park declared
  h.go(300 - 105);
  const rows = levelsToJoin(h, 50);
  assert.ok(rows.every(([ms, gain]) => ms > EXIT_NATIVE_START_MS || gain <= EXIT_SILENT_GAIN + 1e-9), 'nothing above -60 dB before the join');
  h.run(EXIT_NATIVE_RAMP_MS + 2); assert.equal(h.player.volume, 0.8);
  h.present(15.04); h.go(300);
  const exit = (await h.restore()).audioFade;
  assert.equal('parkMs' in exit, false);
  assert.equal(exit.fadeBaseMediaMs, EXIT_NATIVE_START_MS);
});

test('0.62.14: without a join warm-up native is unmuted at the ending notice if the end is at least 100 ms away', async t => {
  const h = await exitHarness(t, { warmAtJoin: false, endIn: 300 });
  assert.equal(h.player.muted, false); assert.ok(h.player.volume <= 0.0008 + 1e-9);
  h.go(265); h.run(40); h.present(15.04);
  const receipt = await h.restore();
  assert.equal(receipt.audioFade.outputWarmMode, 'early'); assert.ok(receipt.audioFade.unmuteLeadMs >= 100);
});

test('0.62.14 fallback: with less than 100 ms left native is unmuted on its playing event (0.62.13)', async t => {
  const h = await exitHarness(t, { warmAtJoin: false, endIn: 90 });
  assert.equal(h.player.muted, true);
  h.go(55); assert.equal(h.player.paused, false); assert.equal(h.player.muted, true, 'nothing before playing');
  h.player.currentTime = 15.005; h.player.dispatchEvent(new Event('playing'));
  assert.equal(h.player.muted, false); assert.equal(h.player.volume, 0);
  h.run(35); assert.equal(h.player.volume, 0.8);
  const receipt = await h.restore();
  assert.equal(receipt.audioFade.outputWarmMode, 'fallback'); assert.equal(receipt.audioFade.native.trigger, 'playing');
});

test('0.62.14 Smooth off: no fade at all; native sounds at its level from its first played sample', async t => {
  const h = await exitHarness(t, { smooth: false });
  h.go(265); h.run(20); h.present(15.02);
  assert.equal(h.player.muted, false); assert.deepEqual(h.player.writes, [], 'no volume writes');
  const receipt = await h.restore();
  assert.deepEqual(receipt.audioFade.native, { status: 'skipped', reason: 'disabled' });
  assert.equal(receipt.audioFade.outputWarmMode, 'paused-at-join'); assert.ok(receipt.audioFade.unmuteLeadMs >= 100);
});

test('0.62.14: a cancelled transition after the warm-up gives the viewer\'s level back', async t => {
  const h = await exitHarness(t);
  assert.ok(h.player.volume <= 0.0008 + 1e-9);
  t.mock.timers.reset();
  await h.adapter.forceSafeNativeState(h.snapshot);
  assert.equal(h.player.volume, 0.8); assert.equal(h.player.muted, false);
});

test('exit audio never stays quiet: a clock that never moves reaches full level by the deadline', async t => {
  const h = await exitHarness(t);
  h.go(265); h.present(15.0);
  h.clock.advance(1400); assert.ok(h.player.volume <= 0.0008 + 1e-9);
  h.clock.advance(120); assert.equal(h.player.volume, 0.8);
  const receipt = await h.restore();
  assert.equal(receipt.audioFade.native.fullBy, 'deadline');
});

test('0.62.13 trace overlap helper (from gain traces only, output latency excluded)', () => {
  const ramp = (from, ms, dir) => Array.from({ length: ms / 2 + 1 }, (_, i) => [from + i * 2, equalPowerGain(i * 2 / ms, dir)]);
  const aligned = combinedGain(ramp(-35, 30, 'in'), ramp(-35, 30, 'out'));
  assert.ok(aligned.minCombinedTraceGain > 0.95, JSON.stringify(aligned)); assert.equal(aligned.excludesOutputLatency, true);
  const gap = combinedGain(ramp(36, 30, 'in'), ramp(-40, 40, 'out'));
  assert.ok(gap.minCombinedTraceGain < 0.05, JSON.stringify(gap));
  assert.equal(combinedGain([], ramp(-30, 30, 'out')), null);
});

test('exit: native nearer the join than its handle starts later by the difference, so its join frame stays on time', async t => {
  const h = nativeHarness();
  await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = { style: { visibility: 'visible' }, dataset: {}, isConnected: true, remove() {} };
  h.player.currentTime = 15.0; // the seek landed on the join, not before it
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.adapter.prerollNative(performance.timeOrigin + h.clock.now() + 300, { joinMs: 15_000, handleMs: 50 });
  t.mock.timers.tick(215); assert.equal(h.player.paused, true, 'held back by the missing handle');
  t.mock.timers.tick(55); assert.equal(h.player.paused, false);
  t.mock.timers.reset();
});

test('entry with the setting off: a hard cut, no volume writes and no clip fade-in time', async () => {
  const h = nativeHarness(), predictions = [];
  h.adapter.setCrossfadeEnabled(false);
  h.adapter.planCut(10_000, { onPredict: (cut, audioEnd, options) => predictions.push([audioEnd, options]) });
  h.playTo(9.75, 10.0);
  assert.equal(h.player.paused, true); assert.deepEqual(h.player.writes, []);
  // 0.62.14: the clip still gets the cut time, to step to full there (no fade).
  assert.ok(predictions.length > 0 && predictions.every(([audioEnd, options]) => Number.isFinite(audioEnd) && options?.hard === true));
  assert.deepEqual(h.adapter.cutAudioFade(10_000), { native: { status: 'skipped', reason: 'disabled' }, clip: { status: 'skipped', reason: 'disabled' } });
  h.adapter.setCrossfadeEnabled(true);
  h.adapter.releaseCutHold();
});

test('entry diagnostics: both windows relative to the cut', () => {
  const h = nativeHarness();
  h.adapter.planCut(10_000);
  h.playTo(9.75, 10.0);
  const report = h.adapter.cutAudioFade(10_000);
  assert.equal(report.native.status, 'ran');
  assert.ok(Math.abs(report.native.endMs) <= 1 && Math.abs(report.native.startMs + 50) <= 1, JSON.stringify(report));
  assert.ok(report.native.gainAtCut < 0.05);
  assert.equal(report.clip.status, 'planned');
  assert.ok(Math.abs(report.clip.endMs) <= 1, JSON.stringify(report));
  assert.equal(h.adapter.cutAudioFade(11_000), null);
  h.adapter.releaseCutHold();
});

test('a withdrawn native pre-roll before its uncover leaves the volume and the owned mute untouched', async t => {
  const h = nativeHarness();
  const snapshot = await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = { style: { visibility: 'visible' }, dataset: {}, isConnected: true, remove() {} };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.player.currentTime = 15;
  h.adapter.prerollNative(performance.timeOrigin + performance.now() + 90);
  t.mock.timers.tick(5); h.player.currentTime = 15.01; h.clock.advance(60);
  assert.equal(h.player.paused, false); assert.equal(h.player.muted, true, '0.62.12: muted until the uncover, as with the setting off');
  h.adapter.prerollNative(null);
  assert.equal(h.player.paused, true); assert.equal(h.player.muted, true); assert.equal(h.player.volume, 0.8); assert.deepEqual(h.player.writes, []);
  t.mock.timers.reset();
  await h.adapter.forceSafeNativeState(snapshot);
  assert.equal(h.player.muted, false); assert.equal(h.player.volume, 0.8);
});

test('a viewer who had Prime muted stays muted and is never faded', async t => {
  const h = nativeHarness(); h.player.muted = true;
  await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = { style: { visibility: 'visible' }, dataset: {}, isConnected: true, remove() {} };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.adapter.prerollNative(performance.timeOrigin + performance.now() + 90);
  t.mock.timers.tick(5); h.clock.advance(200);
  assert.equal(h.player.muted, true); assert.deepEqual(h.player.writes, []);
  t.mock.timers.reset();
});

// --- Clip side ----------------------------------------------------------------

class ClipVideo extends EventTarget {
  constructor() { super(); this.duration = 4; this.currentTime = 0; this.paused = true; this.muted = false; this.playbackRate = 1; this.callbacks = []; this.writes = []; this._volume = 0.8; }
  get volume() { return this._volume; }
  set volume(value) { this._volume = value; this.writes.push(value); }
  async play() { this.paused = false; this.dispatchEvent(new Event('playing')); }
  pause() { this.paused = true; }
  requestVideoFrameCallback(callback) { this.callbacks.push(callback); return this.callbacks.length; }
  cancelVideoFrameCallback() {}
}

test('a pre-rolled clip fades in from silence to end when native stops, and configureAudio sets its ceiling', async t => {
  const clock = fakeClock(performance.now());
  const overlay = new LocalOverlay({ document: { visibilityState: 'visible' }, crossfadeMs: 50, fadeClock: clock });
  const video = new ClipVideo(); overlay.video = video; overlay.startLatencyMs = 60;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audioEnd = performance.timeOrigin + clock.now() + 200;
  overlay.prerollAt(audioEnd + 30, undefined, { audioEndAtMs: audioEnd });
  t.mock.timers.tick(200);
  assert.equal(video.paused, false); assert.equal(video.muted, false, 'audible, not muted'); assert.equal(video.volume, 0);
  clock.advance(175); close(video.volume, 0.8 * Math.SQRT1_2, 'half way through the window');
  await overlay.configureAudio({ muted: false, volume: 0.5 }, 0);
  close(video.volume, 0.5 * Math.SQRT1_2, 'the confirmed level becomes the ceiling');
  // play() adopts the pre-roll and keeps the fade running.
  const playing = overlay.play(new AbortController().signal);
  clock.advance(30); assert.equal(video.volume, 0.5);
  assert.ok(video.writes.every(v => v <= 0.8));
  await overlay.stop(); await playing.catch(() => {});
  t.mock.timers.reset();
});

test('stopping a pre-rolled clip mid-fade restores its level and mute', async t => {
  const clock = fakeClock(performance.now());
  const overlay = new LocalOverlay({ document: {}, crossfadeMs: 50, fadeClock: clock });
  const video = new ClipVideo(); overlay.video = video; overlay.startLatencyMs = 60;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const end = performance.timeOrigin + clock.now() + 200;
  overlay.prerollAt(end, undefined, { audioEndAtMs: end });
  t.mock.timers.tick(200); clock.advance(170);
  assert.ok(video.volume > 0 && video.volume < 0.8);
  overlay.cancelPreroll();
  assert.equal(video.paused, true); assert.equal(video.volume, 0.8); assert.equal(video.muted, false);
  t.mock.timers.reset();
});

test('a muted clip pre-rolls muted, without a fade', async t => {
  const overlay = new LocalOverlay({ document: {}, crossfadeMs: 50, fadeClock: fakeClock(performance.now()) });
  const video = new ClipVideo(); video.muted = true; overlay.video = video; overlay.startLatencyMs = 60;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  overlay.prerollAt(performance.timeOrigin + performance.now() + 200);
  t.mock.timers.tick(200);
  assert.equal(video.muted, true); assert.deepEqual(video.writes, []);
  overlay.cancelPreroll(); t.mock.timers.reset();
});

test('the clip fades out to zero at its end once the page asks (native fading in); a viewer pause cancels it', async t => {
  const clock = fakeClock(performance.now());
  const overlay = new LocalOverlay({ document: {}, crossfadeMs: 50, fadeClock: clock });
  const video = new ClipVideo(); overlay.video = video; overlay.onLocalEnding = () => {};
  video.currentTime = 3.8;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const playing = overlay.play(new AbortController().signal);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(video.volume, 0.8);
  // 200 ms remain: 0.62.14 fades over [end - 60, end - 30], silent before Chrome drops the tail.
  assert.deepEqual(overlay.localFadeOut(true), { status: 'scheduled', startMs: -60, endMs: -30 });
  clock.advance(155); close(video.volume, 0.8 * Math.SQRT1_2);
  overlay.localPause();
  assert.equal(video.volume, 0.8, 'pause withdraws the ending and restores the level');
  overlay.localResume(); await Promise.resolve(); await Promise.resolve();
  video.currentTime = 3.99; video.dispatchEvent(new Event('playing'));
  assert.equal(video.volume, 0.8, 'not again until the page asks again');
  overlay.localFadeOut(true); // 10 ms remain: past the window, so straight to its end state
  clock.advance(2); assert.equal(video.volume, 0, 'zero by end - 30 ms');
  video.ended = true; video.dispatchEvent(new Event('ended'));
  await playing;
  assert.equal(video.volume, 0.8, 'ended: level back for reuse');
  assert.deepEqual(overlay.localFadeOut(true), { status: 'skipped', reason: 'clip-not-playing' });
  t.mock.timers.reset();
});

test('the page can withdraw a clip end fade, and without a request the clip plays to its end at full level', async t => {
  const clock = fakeClock(performance.now());
  const overlay = new LocalOverlay({ document: {}, crossfadeMs: 50, fadeClock: clock });
  const video = new ClipVideo(); overlay.video = video; overlay.onLocalEnding = () => {};
  video.currentTime = 3.8;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const playing = overlay.play(new AbortController().signal);
  await Promise.resolve(); await Promise.resolve();
  overlay.localFadeOut(true); clock.advance(180);
  assert.ok(video.volume < 0.8);
  assert.deepEqual(overlay.localFadeOut(false), { status: 'cancelled' });
  assert.equal(video.volume, 0.8);
  clock.advance(300); assert.equal(video.volume, 0.8);
  video.dispatchEvent(new Event('ended')); await playing;
  t.mock.timers.reset();
});

test('with the setting off the page sends no audio end and the clip pre-rolls muted (0.62.5)', async t => {
  const overlay = new LocalOverlay({ document: {}, crossfadeMs: 50, fadeClock: fakeClock(performance.now()) });
  const video = new ClipVideo(); overlay.video = video; overlay.startLatencyMs = 60;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  overlay.prerollAt(performance.timeOrigin + performance.now() + 200);
  t.mock.timers.tick(200);
  assert.equal(video.paused, false); assert.equal(video.muted, true); assert.deepEqual(video.writes, []);
  overlay.cancelPreroll(); assert.equal(video.muted, false);
  t.mock.timers.reset();
});

test('the private channel carries the fade request, its report and the audio end time, nothing else', () => {
  const command = (name, args) => validLocalMessage({ type: 'command', id: 1, command: name, args }, 'controller');
  assert.equal(command('localFadeOut', [true]), true);
  assert.equal(command('localFadeOut', [false]), true);
  assert.equal(command('localFadeOut', []), false);
  assert.equal(command('localFadeOut', ['yes']), false);
  assert.equal(command('play', [{ profileClass: 'mvp' }]), true);
  assert.equal(command('play', [{}]), true);
  assert.equal(command('play', [{ handOver: true }]), false, '0.62.6 flag retired');
  const epoch = Date.now();
  assert.equal(command('prerollAt', [epoch, epoch - 5000]), true);
  assert.equal(command('prerollAt', [epoch, epoch - 5000, epoch - 30]), true);
  assert.equal(command('prerollAt', [epoch, epoch - 5000, 5]), false);
  assert.equal(command('prerollAt', [epoch, epoch - 5000, epoch, epoch]), false);
  const result = value => validLocalResult({ type: 'result', id: 1, ok: true, value }, 'localFadeOut');
  assert.equal(result({ status: 'scheduled', startMs: -50, endMs: 0 }), true);
  assert.equal(result({ status: 'scheduled', startMs: -50, endMs: 0, lateMs: 12 }), true);
  assert.equal(result({ status: 'skipped', reason: 'hidden-tab' }), true);
  assert.equal(result({ status: 'cancelled' }), true);
  assert.equal(result({ status: 'skipped', reason: 'anything' }), false);
  assert.equal(result({ status: 'scheduled', startMs: -50, endMs: 0, path: 'x' }), false);
  assert.equal(result(null), false);
});

test('"Smooth audio at scene changes" is on by default, a plain on/off preference, and persists', () => {
  assert.equal(preferences({}).smoothAudio, true);
  const off = preferenceChange(preferences({}), { smoothAudio: false });
  assert.equal(off.smoothAudio, false);
  const stored = JSON.parse(JSON.stringify(off));
  assert.equal(preferences(stored).smoothAudio, false, 'read back from storage');
  assert.equal(preferences({ ...stored, smoothAudio: 'no' }).smoothAudio, true, 'invalid stored value falls back to on');
  assert.throws(() => preferenceChange(preferences({}), { smoothAudio: 1 }));
});

function engineHarness({ handleMs, parkMs = null, times = null }) {
  const calls = [], fadeRequests = [], prerolls = [], shortRequests = [];
  let now = 0, finishPlay;
  const adapter = {
    async snapshot() { return { currentTimeMs: 3000, paused: false, muted: false, volume: 0.5 }; },
    async mountOverlayHost() { return {}; }, async pause() {}, async setMuted() {}, async setNativeCovered() {},
    async seek(value) { calls.push(`seek:${value}`); },
    exitHandleMs: () => handleMs,
    ...(parkMs !== null ? { exitParkMs: () => parkMs } : {}),
    ...(times ? { cutCoveredAt: () => times.cutCoveredAt } : {}),
    prerollNative(endAtMs, options) { prerolls.push({ endAtMs, ...options }); return endAtMs !== null; },
    exitFadeArmed: () => handleMs > 0,
    async restore(_snapshot, options) {
      calls.push(`restore:${options.targetTimeMs}`);
      return { presentation: 'prerolled', firstFrameMediaTimeMs: 7_952, ...(times ? { uncoveredAtMs: times.uncoveredAt } : {}), audioFade: { handleMs, native: handleMs > 0 ? { status: 'ran', startMs: -50, endMs: 0 } : { status: 'skipped', reason: 'disabled' } } };
    },
    async forceSafeNativeState() {}
  };
  const overlay = {
    onLocalEnding: null,
    async prepare() {}, async mount() {}, async configureAudio() {}, async show() {},
    play() { return new Promise(resolve => { finishPlay = resolve; }); },
    async localFadeOut(on, _signal, endInMs) { if (endInMs !== undefined) { shortRequests.push(endInMs); return { status: 'scheduled', startMs: -40, endMs: 0, shortenedMs: 10 }; } fadeRequests.push(on); return on ? { status: 'scheduled', startMs: -50, endMs: 0 } : { status: 'cancelled' }; },
    async stop() {}, async teardown() {}, forceTeardown() {}
  };
  const metrics = new MetricsRecorder({ now: () => ++now, wallClock: () => '2026-10-10T00:00:00.000Z' });
  const engine = new TransitionEngine({ adapter, overlay, metrics, now: () => ++now, joinSeekDelayMs: 0 });
  engine.arm({ id: 'scene', triggerMs: 3000, resumeMs: 8000, clipUrl: 'fixture.mp4', gainDb: 0 });
  return { engine, overlay, calls, fadeRequests, prerolls, shortRequests, metrics, finish: () => finishPlay({ durationMs: 5000, localTimeAtEndMs: 5000, unplayedTailMs: 0, frameHoldMode: 'natural-end', heldFrameMediaTimeMs: null, localEnded: true }) };
}
const turns = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };

test('engine: with fades on the join seek leaves the handle, the pre-roll gets the join, the clip is asked to fade and the report lands in the cycle', async () => {
  const h = engineHarness({ handleMs: 50 });
  const running = h.engine.execute(3000);
  await turns();
  assert.deepEqual(h.calls, ['seek:7950']);
  h.overlay.onLocalEnding(1e12);
  await turns();
  assert.deepEqual(h.prerolls.map(({ onAhead, ...x }) => x), [{ endAtMs: 1e12, joinMs: 8000, handleMs: 50 }]);
  assert.deepEqual(h.fadeRequests, [true]);
  h.overlay.onLocalEnding(null); await turns();
  assert.deepEqual(h.fadeRequests, [true, false], 'a withdrawn ending withdraws the clip fade');
  assert.equal('onAhead' in h.prerolls[0], false, '0.62.12: the clip fade is never shortened');
  assert.deepEqual(h.shortRequests, []);
  h.overlay.onLocalEnding(1e12); await turns();
  h.finish(); await running;
  assert.ok(h.calls.includes('restore:8000'), 'restore still targets the join');
  const cycle = h.metrics.snapshot().cycles.at(-1);
  assert.equal(cycle.audioFade.exit.native.status, 'ran');
  assert.deepEqual(cycle.audioFade.exit.clip, { status: 'scheduled', startMs: -50, endMs: 0 });
  assert.equal(cycle.timings.nativeFirstFrameMediaErrorMs, -48);
  assert.equal(cycle.timings.nativeSeekErrorMs ?? null, null);
});

// 0.66.2 (exit jump): the adapter's park moves the join seek back; restore still targets the join.
test('engine: the join seek leaves the exit park, the pre-roll is told, and restore still targets the join', async () => {
  const h = engineHarness({ handleMs: 0, parkMs: 65 });
  const running = h.engine.execute(3000);
  await turns();
  assert.deepEqual(h.calls, ['seek:7935']);
  h.overlay.onLocalEnding(1e12); await turns();
  assert.deepEqual(h.prerolls.map(({ onAhead, ...x }) => x), [{ endAtMs: 1e12, joinMs: 8000, handleMs: 0, parkMs: 65 }]);
  h.finish(); await running;
  assert.ok(h.calls.includes('restore:8000'), 'restore targets the join, not the park');
  const cycle = h.metrics.snapshot().cycles.at(-1);
  assert.equal(JSON.stringify(h.metrics.snapshot()).includes('"parkMs":65'), true, 'the native-seek mark names the park');
  // No park (the adapter says 0): the seek is the join and the pre-roll carries no park.
  const plain = engineHarness({ handleMs: 0, parkMs: 0 });
  const plainRun = plain.engine.execute(3000);
  await turns();
  assert.deepEqual(plain.calls, ['seek:8000']);
  plain.overlay.onLocalEnding(1e12); await turns();
  assert.deepEqual(plain.prerolls.map(({ onAhead, ...x }) => x), [{ endAtMs: 1e12, joinMs: 8000, handleMs: 0 }]);
  plain.finish(); await plainRun;
  // A handle and a park are never combined.
  const both = engineHarness({ handleMs: 50, parkMs: 65 });
  const bothRun = both.engine.execute(3000);
  await turns();
  assert.deepEqual(both.calls, ['seek:7950']);
  both.overlay.onLocalEnding(1e12); await turns(); both.finish(); await bothRun;
});

test('engine: with the setting off the join seek is exact and the clip is never asked to fade', async () => {
  const h = engineHarness({ handleMs: 0 });
  const running = h.engine.execute(3000);
  await turns();
  assert.deepEqual(h.calls, ['seek:8000']);
  h.overlay.onLocalEnding(1e12); await turns();
  assert.deepEqual(h.prerolls.map(({ onAhead, ...x }) => x), [{ endAtMs: 1e12, joinMs: 8000, handleMs: 0 }]);
  assert.deepEqual(h.fadeRequests, []);
  h.finish(); await running;
  const cycle = h.metrics.snapshot().cycles.at(-1);
  assert.deepEqual(cycle.audioFade.exit.clip, { status: 'skipped', reason: 'native-not-fading' });
});

test('0.62.10 diagnostics: a ramp traces each volume change, at most TRACE_LIMIT', async () => {
  const { TRACE_LIMIT } = await import('../src/audio-crossfade.mjs');
  const clock = fakeClock(), el = element({ volume: 0.5 });
  let n = 0;
  const ramp = new VolumeRamp(el, { ...clock, direction: 'out', level: 0.5, startAt: 1_010, durationMs: 20, trace: () => ++n });
  clock.advance(40);
  assert.equal(ramp.trace[0][0], 1_000); assert.equal(ramp.trace[0][1], 1); assert.equal(ramp.trace.at(-1)[1], 0);
  assert.ok(ramp.trace.length <= 22, 'unchanged writes are not repeated');
  const long = new VolumeRamp(element({ volume: 1 }), { ...clock, direction: 'in', level: 1, startAt: clock.now(), durationMs: 500, trace: true });
  clock.advance(600); assert.equal(long.trace.length, TRACE_LIMIT); assert.equal(long.trace.at(-1)[1], 1, 'the final volume is kept');
  assert.equal(new VolumeRamp(element(), { ...clock, direction: 'out', level: 0.8, startAt: clock.now() }).trace, null, 'off unless asked');
});

test('0.62.10 diagnostics: the play result says whether the clip ended before its end fade reached zero', async t => {
  const clock = fakeClock(performance.now());
  const overlay = new LocalOverlay({ document: {}, crossfadeMs: 50, fadeClock: clock });
  const video = new ClipVideo(); overlay.video = video; overlay.onLocalEnding = () => {};
  video.currentTime = 3.8;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const playing = overlay.play(new AbortController().signal);
  await Promise.resolve(); await Promise.resolve();
  overlay.localFadeOut(true);
  clock.advance(150); // 50 ms before the clip end, 10 ms into the [end-60, end-30] fade
  video.ended = true; video.dispatchEvent(new Event('ended'));
  const result = await playing;
  assert.equal(result.endFade.endedAtMs, -50);
  assert.ok(result.endFade.gainAtEnd > 0.5 && result.endFade.gainAtEnd < 1, String(result.endFade.gainAtEnd));
  assert.equal(result.endFade.ended, true);
  assert.equal(result.endFade.trace[0][1], 1); assert.ok(result.endFade.trace.length >= 3);
  assert.equal(validLocalResult({ type: 'result', id: 1, ok: true, value: result }, 'play'), true, 'the channel accepts it');
  assert.equal(validLocalResult({ type: 'result', id: 1, ok: true, value: { ...result, endFade: { ...result.endFade, extra: 1 } } }, 'play'), false);
  assert.equal(video.volume, 0.8, 'level restored after the end');
  t.mock.timers.reset();
});

test('0.62.12: coveredDurationMs and clipVisibleMs run from the cover with the clip to the native uncover', async () => {
  const h = engineHarness({ handleMs: 0, times: { cutCoveredAt: 1_000, uncoveredAt: 6_079 } });
  const running = h.engine.execute(3000);
  await turns(); h.finish(); await running;
  const timings = h.metrics.snapshot().cycles.at(-1).timings;
  assert.equal(timings.coveredDurationMs, 5_079); assert.equal(timings.clipVisibleMs, 5_079);
});

test('0.62.14 Smooth off exit: the clip is cut hard 30 ms before its end, with no fade', async t => {
  const clock = fakeClock(performance.now());
  const overlay = new LocalOverlay({ document: {}, crossfadeMs: 50, fadeClock: clock });
  const video = new ClipVideo(); overlay.video = video; overlay.onLocalEnding = () => {};
  video.currentTime = 3.8;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const playing = overlay.play(new AbortController().signal);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(overlay.localFadeOut(true, undefined, 'cut'), { status: 'scheduled', startMs: -31, endMs: -30 });
  clock.advance(168); assert.equal(video.volume, 0.8, 'full until the cut');
  clock.advance(3); assert.equal(video.volume, 0, 'cut at end - 30 ms');
  assert.ok(video.writes.filter(v => v > 0.001 && v < 0.8).length <= 1, 'a cut: at most one 1 ms tick between full and 0, no fade');
  video.ended = true; video.dispatchEvent(new Event('ended')); await playing;
  t.mock.timers.reset();
});

test('0.62.14 Smooth off entry: the pre-rolled clip runs unmuted at 0 and steps to full at the cut', async t => {
  const clock = fakeClock(performance.now());
  const overlay = new LocalOverlay({ document: {}, crossfadeMs: 50, fadeClock: clock });
  const video = new ClipVideo(); overlay.video = video; overlay.startLatencyMs = 60;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const end = performance.timeOrigin + clock.now() + 200;
  overlay.prerollAt(end + 30, undefined, { audioEndAtMs: end, fadeMs: 0 });
  t.mock.timers.tick(200);
  assert.equal(video.paused, false); assert.equal(video.muted, false, 'output running'); assert.equal(video.volume, 0);
  clock.advance(198); assert.equal(video.volume, 0, 'silent until the cut');
  clock.advance(3); assert.equal(video.volume, 0.8, 'full at the cut');
  assert.ok(video.writes.filter(v => v > 0.001 && v < 0.8).length <= 1, 'a step: at most one 1 ms tick between 0 and full, not a fade');
  overlay.cancelPreroll(); t.mock.timers.reset();
});

test('0.62.14: Smooth-on entry is unchanged: same prediction arguments and the same clip fade-in', async t => {
  // Page side: with fades on, onPredict gets (cut, audioEnd) only, as in 0.62.13.
  const h = nativeHarness(), predictions = [];
  h.adapter.planCut(10_000, { onPredict: (...args) => predictions.push(args) });
  h.playTo(9.75, 10.0);
  assert.ok(predictions.every(args => args.length <= 2), 'no extra options with Smooth on');
  h.adapter.releaseCutHold();
  // Frame side: a prerollAt without fadeMs fades in over crossfadeMs, ending at the audio end.
  const clock = fakeClock(performance.now());
  const overlay = new LocalOverlay({ document: {}, crossfadeMs: 50, fadeClock: clock });
  const video = new ClipVideo(); overlay.video = video; overlay.startLatencyMs = 60;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const end = performance.timeOrigin + clock.now() + 200;
  overlay.prerollAt(end + 30, undefined, { audioEndAtMs: end });
  t.mock.timers.tick(200);
  clock.advance(175); close(video.volume, 0.8 * Math.SQRT1_2, 'half way through the 50 ms fade-in, as before');
  overlay.cancelPreroll(); t.mock.timers.reset();
  // Engine: Smooth on sends the same prerollAt options as before.
  const sent = [];
  const engine = new TransitionEngine({ adapter: { planCut(_t, { onPredict }) { onPredict(performance.timeOrigin + performance.now() + 100, 123456789012); } },
    overlay: { prerollAt: (...args) => { sent.push(args); } }, metrics: new MetricsRecorder() });
  engine.staged = { clipUrl: 'x' };
  engine.planCut(engine.staged, { id: 's', triggerMs: 1000 });
  assert.deepEqual(sent.map(a => a[2]), [{ audioEndAtMs: 123456789012 }]);
});

test('0.62.16: the exit lead is fixed at 105 ms whatever the learned first-frame time; play/playing are logged', async t => {
  for (const learned of [30, 90, 250]) {
    const h = await exitHarness(t, { lead: learned });
    h.go(185); assert.equal(h.player.paused, true, `${learned}: not yet`);
    h.go(15); assert.equal(h.player.paused, false, `${learned}: started 105 ms before the end`);
    h.player.dispatchEvent(new Event('playing'));
    const receipt = await h.restore();
    assert.equal(receipt.audioFade.prerollLeadMs, 105);
    for (const key of ['playCallMs', 'playingMs', 'actualStartMs']) assert.ok(Number.isFinite(receipt.audioFade[key]) && receipt.audioFade[key] < 0, `${key}: ${receipt.audioFade[key]}`);
    assert.ok(receipt.audioFade.predicted.gapMs === 0 && receipt.audioFade.predicted.audibleAtMs <= -40, JSON.stringify(receipt.audioFade.predicted));
  }
});

test('0.62.17: an early first frame never uncovers on a timer; the uncover waits for a moving frame at or after T-10', async t => {
  const h = await exitHarness(t);
  h.go(220); // native started 105 ms before the end (at +195)
  h.run(5); h.present(15.005); // first frame, ~75 ms early
  assert.equal(h.host.style.visibility, 'visible', 'the clip\'s last frame stays shown');
  h.run(40); h.present(15.045); // moving, but still ~35 ms early
  assert.equal(h.host.style.visibility, 'visible');
  h.run(30); // now T-5: past T-10, but no new frame yet
  h.go(10); assert.equal(h.host.style.visibility, 'visible', 'no bare-timer uncover');
  h.present(15.085); // a fresh moving frame at or after T-10
  assert.equal(h.host.style.visibility, 'hidden');
  const receipt = await h.restore();
  const exit = receipt.audioFade;
  assert.equal(exit.uncoverVia, 'frame'); assert.equal(exit.uncoverFrameMediaTimeMs, 15085);
  assert.ok(exit.uncoverAtMs >= -10, String(exit.uncoverAtMs));
  assert.deepEqual(exit.frames.map(f => f[1]), [5, 45, 85], 'each callback: media vs the join');
  assert.ok(exit.frames.every(f => Number.isFinite(f[0]) && Number.isSafeInteger(f[2])));
  assert.equal(exit.firstFrameVsJoinMs, 5);
});

test('0.62.17: a frame before the join does not uncover even after T-10', async t => {
  const h = await exitHarness(t);
  h.player.currentTime = 14.98;
  h.go(220); h.clock.advance(100); // well past T-10
  h.present(14.98); h.present(14.99); // before the join
  assert.equal(h.host.style.visibility, 'visible');
  h.present(15.0); // at the join and newer than the first frame
  assert.equal(h.host.style.visibility, 'hidden');
  await h.restore();
});

test('0.62.17: the fallback still uncovers when no frame callback qualifies', async t => {
  const h = await exitHarness(t);
  h.go(220); h.present(15.0); // only the first frame
  assert.equal(h.host.style.visibility, 'visible');
  h.go(300); // 300 ms after the pre-roll start
  assert.equal(h.host.style.visibility, 'hidden');
  const receipt = await h.restore();
  assert.equal(receipt.audioFade.uncoverVia, 'fallback'); assert.equal(receipt.presentation, 'prerolled-without-frame-callback');
});

// The exit's volume writes for a fixed script (Smooth on, warmed at the join). 0.62.17 changes
// only when the cover goes, so these must equal 0.62.16's (86d18a6), captured below.
async function exitAudioScript(t) {
  const h = await exitHarness(t);
  h.go(220);
  for (let i = 0; i < 12; i += 1) { h.run(10); h.present(15 + (i + 1) * 0.01); }
  h.go(400);
  await h.restore();
  return h.player.writes.map(v => Math.round(v * 1e6) / 1e6);
}

test('0.62.17: exit audio scheduling is identical to 0.62.16 (same volume writes for the same script)', async t => {
  assert.deepEqual(await exitAudioScript(t), [0.0008,0.0008,0.0008,0.0008,0.041869,0.083623,0.125148,0.166329,0.207055,0.247214,0.286694,0.325389,0.363192,0.4,0.435711,0.470228,0.503456,0.535304,0.565685,0.594516,0.621717,0.647214,0.670936,0.69282,0.712805,0.730836,0.746864,0.760845,0.772741,0.782518,0.790151,0.795618,0.798904,0.8,0.8]);
});

test('0.62.18 exit layers: from native\'s start the cover is 0.999 opaque (native composited underneath); the uncover waits two animation frames', async t => {
  const rafs = [];
  const h = await exitHarness(t);
  h.adapter.document.defaultView = { requestAnimationFrame: callback => { rafs.push(callback); return rafs.length; }, getComputedStyle: () => ({ visibility: 'visible', opacity: '1', display: 'block' }) };
  h.go(220); // native started (pre-roll at +195)
  assert.equal(h.host.style.opacity, '0.999', 'native is drawn under a not-quite-opaque cover');
  h.run(80); h.present(15.08); h.run(5); h.present(15.085); // fresh moving frames after T-10
  assert.equal(h.host.style.visibility, 'visible', 'not before two animation frames since the pre-reveal');
  rafs.shift()(); rafs.shift()();
  h.run(5); h.present(15.09);
  assert.equal(h.host.style.visibility, 'hidden', 'then only our layer is removed');
  const receipt = await h.restore();
  const layers = receipt.audioFade.layers;
  assert.deepEqual(layers.prerollStart.native, { visibility: 'visible', opacity: '1', display: 'block', rect: null });
  assert.equal(layers.beforeUncover.host.opacity, '0.999'); assert.equal(layers.beforeUncover.host.visibility, 'visible');
  assert.equal(layers.beforeUncover.native.visibility, 'visible', 'native visible under the cover before it goes');
});

test('0.62.18 entry: the staged cover is invisible but rendering, and the cut reveals it at full opacity with its layout logged', async () => {
  const h = nativeHarness();
  h.adapter.stagedHost = { style: { opacity: '0', visibility: 'visible' }, dataset: {}, isConnected: true, remove() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }) };
  h.player.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 480 });
  h.adapter.planCut(10_000);
  h.playTo(9.75, 10.0);
  assert.equal(h.adapter.stagedHost.style.opacity, '1'); assert.equal(h.adapter.stagedHost.style.visibility, 'visible');
  const layout = h.adapter.cutLayout(10_000);
  assert.deepEqual(layout.host.rect, [0, 0, 640, 480]); assert.deepEqual(layout.native.rect, [0, 0, 640, 480]);
  h.adapter.releaseCutHold();
});

// 0.65.6: native's first frame after play() from a pause at the join came
// 163-183 ms later at 0.65.4's follow-up exits, so the fixed 105 ms lead held the clip's last frame.
test('0.65.6: the exit lead follows the measured paused-at-join start-up, within 105..200 ms', () => {
  assert.equal(exitPrerollLeadMs(), 105);
  assert.equal(exitPrerollLeadMs([180]), 105, 'one sample never sets it');
  assert.equal(exitPrerollLeadMs([171, 183]), 181, 'lower median of two plus 10');
  assert.equal(exitPrerollLeadMs([171, 183, 179]), 189, 'median of three plus 10');
  assert.equal(exitPrerollLeadMs([30, 40, 50]), 105, 'never below the fixed floor');
  assert.equal(exitPrerollLeadMs([400, 410]), 200, 'never above the cap');
  assert.equal(exitPrerollLeadMs([300, 300, 300, 120, 130, 125]), 135, 'only the last three count');
  assert.equal(exitPrerollLeadMs([NaN, -5, 160, 170]), 170, 'invalid samples are ignored');
});

test('0.65.6: a paused-at-join exit records play() to first frame, and two such exits lengthen the next lead', async t => {
  // Native's first frame is displayed 175 ms after play() (on the real clock the adapter reads).
  const shownAfterPlay = h => { const request = h.player.requestVideoFrameCallback.bind(h.player);
    h.player.requestVideoFrameCallback = callback => request((now, meta) => callback(now, { ...meta, expectedDisplayTime: h.adapter.nativePreroll.playCallAt + 175 })); };
  const exits = []; let latencies = [];
  for (let exit = 0; exit < 3; exit += 1) {
    const h = await exitHarness(t, { startLatencies: latencies }); shownAfterPlay(h);
    const lead = exit < 2 ? 105 : 185;
    h.go(300 - lead - 10); assert.equal(h.player.paused, true, `exit ${exit}: not yet`);
    h.go(15); assert.equal(h.player.paused, false, `exit ${exit}: started ${lead} ms before the end`);
    h.go(175); h.present(15.2);
    const receipt = await h.restore();
    latencies = h.adapter.exitStartLatencies;
    exits.push({ lead: receipt.audioFade.prerollLeadMs, startLatencyMs: receipt.audioFade.startLatencyMs });
  }
  assert.deepEqual(exits, [{ lead: 105, startLatencyMs: 175 }, { lead: 105, startLatencyMs: 175 }, { lead: 185, startLatencyMs: 175 }]);
  assert.deepEqual(latencies, [175, 175, 175]);
});

test('0.65.6: an exit not warmed at the join does not teach the lead', async t => {
  const h = await exitHarness(t, { warmAtJoin: false, endIn: 50 });
  h.go(60); h.present(15.1);
  const receipt = await h.restore();
  assert.notEqual(receipt.audioFade.outputWarmMode, 'paused-at-join');
  assert.deepEqual(h.adapter.exitStartLatencies, []);
});
