// 0.66.2 (exit dropout): on a parked exit native's ramp has a wall-time floor.
//
// Measured on 0.66.2 candidates: native's ramp ran on native's own clock, which was 9-31 ms behind
// at the clip's end, while the clip faded on wall time over a fixed [-60, -30] ms. The clip was
// gone before native had risen (about 47 ms of silence at 22-24 ms behind). The scenario below is
// the real adapter (native side) and the real clip overlay on one clock, with native's clock a
// chosen number of ms behind at the clip's end. Two levels are read every ms: the sum of the two
// gains (the law of the report's overlap.minCombinedTraceGain), and the same with the clip at zero
// from 25 ms before its end (Chrome drops that tail whatever its gain: EXIT_CLIP_DROPPED_TAIL_MS).
// Neither includes output latency: this is a model of the envelopes, not of what is heard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { StandardTransitionAdapter } from '../src/standard-transition-adapter.mjs';
import { LocalOverlay } from '../src/local-overlay.mjs';
import { combinedGain, EXIT_SILENT_GAIN, EXIT_CLIP_DROPPED_TAIL_MS, EXIT_PARK_AUDIO_START_MS, EXIT_CLIP_TAIL_MARGIN_MS, EXIT_CLIP_FADE_MS, EXIT_NATIVE_RAMP_MS } from '../src/audio-crossfade.mjs';

const LEVEL = 0.8, JOIN_MS = 15_000, LEAD_MS = 105, CLIP_S = 4;
const micro = async (n = 6) => { for (let i = 0; i < n; i += 1) await Promise.resolve(); };

// One wall clock for the page and the renderer frame. Each side has its own timers, and a side's
// timers can be stalled for a window (a blocked main thread: they all run when it ends).
function world(t) {
  const state = { now: 500_000 };
  t.mock.method(performance, 'now', () => state.now);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let id = 0;
  const timers = new Map(), stalls = [];
  const side = name => ({ tickMs: 4, now: () => state.now,
    setTimer(callback, ms) { timers.set(++id, { at: state.now + Math.max(0, ms), callback, side: name }); return id; },
    clearTimer(handle) { timers.delete(handle); } });
  const due = timer => stalls.reduce((at, stall) => stall.side === timer.side && at >= stall.from && at < stall.to ? stall.to : at, timer.at);
  const fire = () => {
    for (;;) {
      const next = [...timers].filter(([, timer]) => due(timer) <= state.now).sort((a, b) => due(a[1]) - due(b[1]) || a[0] - b[0])[0];
      if (!next) return;
      timers.delete(next[0]); next[1].callback();
    }
  };
  return { state, side, fire, stall: (name, from, to) => stalls.push({ side: name, from, to }) };
}

function nativePlayer() {
  const player = new EventTarget();
  let value = LEVEL, id = 0;
  const frames = new Map();
  Object.assign(player, { muted: false, writes: [], paused: false, seeking: false, playbackRate: 1, currentTime: 9.75, readyState: 4, playedAt: null,
    requestVideoFrameCallback(callback) { frames.set(++id, callback); return id; }, cancelVideoFrameCallback(handle) { frames.delete(handle); },
    pause() { this.paused = true; }, play() { this.paused = false; this.playedAt = performance.now(); return Promise.resolve(); } });
  Object.defineProperty(player, 'volume', { get: () => value, set: next => { if (!(next >= 0 && next <= 1)) throw new RangeError('volume'); value = next; player.writes.push(next); } });
  return player;
}

class ClipVideo extends EventTarget {
  constructor() { super(); this.duration = CLIP_S; this.currentTime = 0; this.paused = true; this.muted = false; this.playbackRate = 1; this.writes = []; this._volume = LEVEL; }
  get volume() { return this._volume; }
  set volume(value) { this._volume = value; this.writes.push(value); }
  async play() { this.paused = false; this.dispatchEvent(new Event('playing')); }
  pause() { this.paused = true; }
  requestVideoFrameCallback() { return 1; }
  cancelVideoFrameCallback() {}
}

// A parked (or unparked) exit up to the clip's end and a little beyond.
// lagMs: how far native's clock is behind the join at the clip's end. Native is parked parkMs
// before the join and play() is called LEAD_MS before the clip's end, so its clock starts
// lagMs - parkMs from the clip's end and then runs at 1. freeze: a window (ms from the clip's end)
// in which native's clock stands still although it is not paused (a stall).
async function exit(t, { lagMs = 0, parkMs = 65, smooth = true, endIn = 300, stall = null, freeze = null, at = {}, afterMs = 80 } = {}) {
  const w = world(t), page = w.side('page'), frame = w.side('frame');
  const player = nativePlayer();
  const adapter = new StandardTransitionAdapter({ document: { visibilityState: 'visible', defaultView: {} }, passiveAdapter: { activePlayer: () => player },
    commandAdapter: { readState: () => ({ currentTimeMs: Math.round(player.currentTime * 1000), paused: player.paused, muted: player.muted, volume: player.volume, readyState: 4 }),
      pause: async () => { player.paused = true; }, play: async () => { player.paused = false; }, seekToWithPlaybackWarmup: async () => {} },
    crossfadeMs: 50, fadeClock: page });
  adapter.stagedHost = { style: {}, dataset: {}, isConnected: true, remove() {} };
  adapter.nativeStartLatencyMs = 40; adapter.exitStartLatencies = [];
  adapter.setCrossfadeEnabled(smooth);
  await adapter.snapshot(); await adapter.pause(); await adapter.setMuted(true);
  adapter.overlayHost = { style: { visibility: 'visible' }, dataset: {}, isConnected: true, remove() {} };
  const parkedMs = JOIN_MS - parkMs;
  player.currentTime = parkedMs / 1000;
  adapter.warmNativeOutput('paused-at-join');

  const overlay = new LocalOverlay({ document: { visibilityState: 'visible' }, crossfadeMs: 50, fadeClock: frame });
  const video = new ClipVideo(); overlay.video = video;
  let clipFade = null, end = null, preroll = null;
  // The engine's glue between the clip's ending notice and the two sides.
  overlay.onLocalEnding = endAtMs => {
    if (endAtMs === null) { adapter.prerollNative(null); overlay.localFadeOut(false); return; }
    end ??= endAtMs - performance.timeOrigin;
    adapter.prerollNative(endAtMs, { joinMs: JOIN_MS, handleMs: adapter.exitHandleMs(), ...(parkMs > 0 ? { parkMs } : {}) });
    preroll = adapter.nativePreroll ?? preroll;
    if (adapter.exitFadeArmed()) clipFade = overlay.localFadeOut(true) ?? clipFade;
    else if (adapter.exitCutArmed()) clipFade = { ...overlay.localFadeOut(true, undefined, 'cut'), mode: 'cut' };
  };
  video.currentTime = CLIP_S - endIn / 1000;
  const playing = overlay.play(new AbortController().signal);
  playing.catch(() => {}); // a stopped clip rejects; the tests that stop one do not read it
  await micro();
  assert.ok(Number.isFinite(end), 'the clip announced its end');
  if (stall) w.stall(stall.side, end + stall.from, end + stall.to);
  const delay = lagMs + LEAD_MS - parkMs;
  const rows = []; let result = null, ended = false, ran = 0;
  for (let ms = Math.round(w.state.now - end) + 1; ms <= afterMs; ms += 1) {
    w.state.now = end + ms;
    if (!ended) video.currentTime = Math.min(CLIP_S, CLIP_S + ms / 1000);
    if (!player.paused && player.playedAt !== null && w.state.now - player.playedAt > delay && !(freeze && ms > freeze.from && ms <= freeze.to)) {
      ran += 1; player.currentTime = (parkedMs + ran) / 1000;
    }
    t.mock.timers.tick(1); w.fire(); await micro();
    at[ms]?.({ player, video, overlay, adapter });
    await micro();
    if (ms >= 0 && !ended && !video.paused) { ended = true; video.ended = true; video.dispatchEvent(new Event('ended')); result = await playing; }
    const native = player.muted ? 0 : player.volume / LEVEL, clip = ended || video.paused ? 0 : video.volume / LEVEL;
    rows.push({ ms, native, clip, media: Math.round(player.currentTime * 1000 - JOIN_MS), trace: Math.hypot(native, clip), heard: Math.hypot(native, ms >= -EXIT_CLIP_DROPPED_TAIL_MS ? 0 : clip) });
  }
  t.mock.timers.reset();
  const until = rows.find(row => row.native >= 0.999 && row.ms >= 0)?.ms ?? afterMs;
  const window = rows.filter(row => row.ms >= -120 && row.ms <= until);
  const low = key => window.reduce((best, row) => row[key] < best[key] ? row : best);
  const round = value => Math.round(value * 1000) / 1000;
  return { rows, window, result, clipFade, player, video, overlay, adapter, preroll, end, w,
    row: ms => rows.find(r => r.ms === ms),
    report: () => adapter.exitAudioReport(preroll),
    // When native's gain first left its floor and when it reached full level (ms from the clip's end).
    nativeFrom: rows.find(row => row.native > 0.01)?.ms ?? null, nativeFull: rows.find(row => row.native >= 0.999)?.ms ?? null,
    // The lowest summed level up to native at full level: of the two gains, and with Chrome's dropped tail.
    minTrace: round(low('trace').trace), minTraceAt: low('trace').ms,
    minHeard: round(low('heard').heard), minHeardAt: low('heard').ms,
    msBelow: (floor, key = 'heard') => window.filter(row => row[key] < floor).length };
}
const line = (name, h) => `${name}: min of the two gains ${h.minTrace} at ${h.minTraceAt} ms; with the 25 ms dropped tail ${h.minHeard} at ${h.minHeardAt} ms (below 0.7 for ${h.msBelow(0.7)} ms, below 0.1 for ${h.msBelow(0.1)} ms); native rises ${h.nativeFrom}..${h.nativeFull} ms`;

const FLOOR = 0.7, CLIP_FADE_FROM = -(EXIT_CLIP_TAIL_MARGIN_MS + EXIT_CLIP_FADE_MS);
const reportOverlap = h => combinedGain(h.preroll.fade.trace.map(([at, gain]) => [at - h.end, gain]), h.result.endFade.trace);

// Native's clock is running as the clip's fade begins (a park about 55 ms + the lag deep, or
// more): the floor closes the hole whatever the lag.
for (const [lagMs, parkMs] of [[0, 65], [10, 65], [25, 90], [40, 105]]) {
  test(`parked exit, native ${lagMs} ms behind, its clock starting ${lagMs - parkMs} ms from the clip's end (park ${parkMs}): no dip, with and without the clip's dropped tail`, async t => {
    const h = await exit(t, { lagMs, parkMs });
    t.diagnostic(line(`lag ${lagMs} ms, park ${parkMs}`, h));
    assert.ok(h.minTrace >= 0.95, `the two gains: ${h.minTrace} at ${h.minTraceAt} ms`); // 4 ms volume steps on both sides
    assert.ok(h.minHeard >= 0.95, `with the dropped tail: ${h.minHeard} at ${h.minHeardAt} ms`);
    assert.ok(h.nativeFull <= -EXIT_CLIP_DROPPED_TAIL_MS, `native is at full level before the clip's audio is dropped: ${h.nativeFull}`);
    assert.ok(h.nativeFrom >= CLIP_FADE_FROM, `and never rises before the clip's fade window: ${h.nativeFrom}`);
    assert.ok(h.rows.filter(row => row.ms < CLIP_FADE_FROM).every(row => row.native <= EXIT_SILENT_GAIN + 1e-9), 'held at -60 dB before it');
    const peak = Math.max(...h.window.map(row => row.trace));
    assert.ok(peak <= 1.15, `no bulge beyond the 4 ms volume steps: ${peak}`);
    assert.ok(reportOverlap(h).minCombinedTraceGain >= 0.95, `the report's own overlap: ${JSON.stringify(reportOverlap(h))}`);
    // The clip is untouched: wall time over [-60, -30], zero before the dropped tail.
    assert.deepEqual(h.clipFade, { status: 'scheduled', startMs: -60, endMs: -30 });
    assert.equal(h.row(-EXIT_CLIP_DROPPED_TAIL_MS).clip, 0, 'the clip is at zero before Chrome drops its tail');
    assert.equal(h.result.endFade.gainAtEnd, 0);
    assert.equal(h.video.volume, LEVEL, 'the ended clip has its level back');
    const native = h.report().native;
    assert.equal(native.wallFloor ?? false, lagMs > 0, 'the report says whether the floor raised the gain');
    assert.ok(native.clockMovingMs > lagMs - parkMs && native.clockMovingMs <= lagMs - parkMs + 5, `and when the clock was first seen advancing: ${native.clockMovingMs}`);
    assert.equal(native.mode, 'media-time'); assert.equal(native.rampMs, EXIT_NATIVE_RAMP_MS);
  });
}

// Native has no audio before its clock starts, and the clip is silent 30 ms before its end. A clock
// that starts inside the clip's fade window therefore still leaves a dip: the floor takes native to
// the wall-time level on the first reading that shows it advancing, which bounds the dip to the
// time before that. These are the sizes the model gives; they are pinned so a change shows.
for (const [lagMs, parkMs, minHeard, below] of [[25, 65, 0.45, 8], [25, 58, 0.09, 16], [40, 65, 0, 24]]) {
  test(`parked exit, native ${lagMs} ms behind and its clock starting ${lagMs - parkMs} ms from the clip's end (park ${parkMs}): the dip ends when the clock starts`, async t => {
    const h = await exit(t, { lagMs, parkMs });
    t.diagnostic(line(`lag ${lagMs} ms, park ${parkMs}`, h));
    const started = lagMs - parkMs;
    assert.ok(h.rows.filter(row => row.ms <= started).every(row => row.native <= EXIT_SILENT_GAIN + 1e-9), 'silent until its clock starts');
    assert.ok(h.nativeFrom <= started + 5, `raised on the first reading that shows the clock advancing: ${h.nativeFrom}`);
    const wall = Math.min(1, Math.sin(Math.max(0, (h.nativeFrom - CLIP_FADE_FROM) / EXIT_CLIP_FADE_MS) * Math.PI / 2));
    assert.ok(h.row(h.nativeFrom).native >= wall - 0.11, `straight to the wall-time level: ${h.row(h.nativeFrom).native} for ${wall}`);
    assert.ok(h.nativeFull <= Math.max(-EXIT_CLIP_TAIL_MARGIN_MS, started + 4) + 4, `full level by the end of the clip's fade, or as the clock starts: ${h.nativeFull}`);
    assert.ok(h.window.filter(row => row.ms >= h.nativeFrom).every(row => row.heard >= 0.9), 'no dip once native is up');
    assert.ok(h.minHeard >= minHeard, `the dip before that: ${h.minHeard}`);
    assert.ok(h.msBelow(FLOOR) <= below, `below ${FLOOR} for ${h.msBelow(FLOOR)} ms`);
    assert.equal(h.report().native.wallFloor, true);
    assert.ok(Math.abs(h.report().native.clockMovingMs - h.nativeFrom) <= 1, 'the report names when the clock was first seen advancing');
    assert.deepEqual(h.clipFade, { status: 'scheduled', startMs: -60, endMs: -30 });
    assert.equal(h.row(-EXIT_CLIP_DROPPED_TAIL_MS).clip, 0);
  });
}

test('native ahead of the clip: the floor never lowers or delays a ramp that its own clock already drives', async t => {
  const h = await exit(t, { lagMs: -10 });
  assert.equal(h.report().native.wallFloor ?? false, false);
  for (const row of h.rows.filter(r => r.native > EXIT_SILENT_GAIN + 1e-9 && r.native < 0.999)) {
    const media = Math.sin(Math.min(1, Math.max(0, (row.media - EXIT_PARK_AUDIO_START_MS) / EXIT_NATIVE_RAMP_MS)) * Math.PI / 2);
    assert.ok(row.native <= media + 1e-6 && row.native >= media - 0.3, `at ${row.ms} ms native follows its own clock: ${row.native} for ${media}`);
  }
  assert.ok(h.minTrace >= 0.99);
});

test('a stalled native clock holds the gain: the floor only applies while the clock advances', async t => {
  // Native 10 ms behind; its clock stands still over [-50, -20] although it is not paused.
  const h = await exit(t, { lagMs: 10, parkMs: 75, freeze: { from: -50, to: -20 } });
  const held = h.row(-46).native;
  assert.ok(held > 0.05 && held < 0.9, `caught part way: ${held}`);
  for (const ms of [-40, -30, -21]) assert.equal(h.row(ms).native, held, `held at ${ms} ms`);
  assert.ok(h.row(-14).native >= 0.999, 'and at the wall-time level as soon as the clock moves again');
  // A clock that never starts before the clip's end: native stays at its floor (the deadline is unchanged).
  const never = await exit(t, { lagMs: 200 });
  assert.ok(never.rows.filter(row => row.ms <= 80).every(row => row.native <= EXIT_SILENT_GAIN + 1e-9));
  assert.equal(never.report().native.wallFloor ?? false, false);
  assert.equal(never.report().native.clockMovingMs ?? null, null);
  // Seeking (or paused) while the wall clock runs: no progress at all, as before.
  const seeking = await exit(t, { lagMs: 10, parkMs: 75, at: { [-52]: ({ player }) => { player.seeking = true; }, [-22]: ({ player }) => { player.seeking = false; } } });
  const level = seeking.row(-50).native;
  assert.ok(level < 0.9);
  assert.equal(seeking.row(-24).native, level, 'held while seeking');
  assert.ok(seeking.row(-14).native >= 0.999);
});

test("a 60 ms page stall during native's ramp: the gain waits for the page, then goes straight to full level", async t => {
  const h = await exit(t, { lagMs: 10, stall: { side: 'page', from: -45, to: 15 } });
  const frozen = h.row(-30).native;
  t.diagnostic(line('page timers stalled -45..15 ms', h) + `; native frozen at ${frozen.toFixed(3)}`);
  assert.ok(frozen > 0.1 && frozen < 0.9, `caught part way: ${frozen}`);
  assert.equal(h.row(14).native, frozen, 'no timer, no volume write: nothing on the page can change that');
  assert.ok(h.row(16).native >= 0.999, 'full level on the first tick after the stall');
  assert.ok(h.window.every(row => row.heard >= frozen - 1e-9 || row.ms < -45), 'never below what native had reached');
  assert.equal(h.row(-EXIT_CLIP_DROPPED_TAIL_MS).clip, 0, "the clip's own fade is on the other thread and ends on time");
});

// --- What must not change ---------------------------------------------------------------------

test('pin: an unparked exit has no floor: native rises on its own clock from the join, however late', async t => {
  const h = await exit(t, { lagMs: 25, parkMs: 0 });
  assert.equal(h.preroll.fadeBaseMediaMs, 0, 'from the join');
  assert.ok(h.rows.filter(row => row.media <= 0).every(row => row.native <= EXIT_SILENT_GAIN + 1e-9), 'silent until its clock passes the join');
  assert.ok(h.nativeFrom >= 25 && h.nativeFull >= 25 + EXIT_NATIVE_RAMP_MS - 4, `rises ${h.nativeFrom}..${h.nativeFull} ms`);
  const native = h.report().native;
  assert.equal(native.wallFloor ?? false, false); assert.equal(native.clockMovingMs ?? null, null);
  assert.deepEqual(h.clipFade, { status: 'scheduled', startMs: -60, endMs: -30 });
});

test('pin: Smooth audio off keeps the hard cut and no native ramp', async t => {
  const h = await exit(t, { lagMs: 25, smooth: false });
  assert.deepEqual(h.clipFade, { status: 'scheduled', startMs: -31, endMs: -30, mode: 'cut' });
  assert.equal(h.row(-32).clip, 1); assert.equal(h.row(-EXIT_CLIP_DROPPED_TAIL_MS).clip, 0);
  assert.equal(h.preroll?.fade ?? null, null, 'no native ramp');
});

test('pin: a cancelled parked exit (viewer pause) restores the clip and withdraws the pre-roll', async t => {
  let writes = null;
  const h = await exit(t, { lagMs: 10, at: {
    [-40]: ({ video, overlay }) => { assert.ok(video.volume < LEVEL && video.volume > 0, 'mid fade'); overlay.localPause(); assert.equal(video.volume, LEVEL, 'restored at once'); writes = video.writes.length; }
  } });
  assert.equal(h.video.paused, true);
  assert.equal(h.video.volume, LEVEL);
  assert.equal(h.video.writes.length, writes, 'nothing wrote to the clip afterwards');
  assert.equal(h.preroll.cancelled, true);
  const after = h.row(-38).native;
  assert.ok(h.rows.filter(row => row.ms > -38).every(row => row.native <= after + 1e-9), 'the floor does not raise a withdrawn ramp');
  await h.overlay.stop().catch(() => {});
});

test("pin: the viewer's own volume change during the ramp wins; the floor never writes over it", async t => {
  const h = await exit(t, { lagMs: 25, parkMs: 90, at: { [-45]: ({ player }) => { player.volume = 0.4; } } });
  assert.equal(h.player.volume, 0.4);
  assert.ok(h.rows.filter(row => row.ms >= -45).every(row => row.native === 0.4 / LEVEL));
});

test('pin: the constants this fix leaves alone', async () => {
  const fade = await import('../src/audio-crossfade.mjs');
  assert.deepEqual([fade.EXIT_PARK_AUDIO_START_MS, fade.EXIT_PREROLL_LEAD_MS, fade.EXIT_SILENT_GAIN, fade.EXIT_NATIVE_RAMP_MS, fade.EXIT_NATIVE_DEADLINE_MS, fade.EXIT_UNCOVER_NOT_BEFORE_MS,
    fade.EXIT_COVER_PRE_REVEAL_OPACITY, fade.EXIT_HANDLE_MS, fade.EXIT_CLIP_TAIL_MARGIN_MS, fade.EXIT_CLIP_FADE_MS, fade.EXIT_CLIP_DROPPED_TAIL_MS],
    [-60, 105, 0.001, 30, 1500, 10, 0.999, 0, 30, 30, 25]);
});
