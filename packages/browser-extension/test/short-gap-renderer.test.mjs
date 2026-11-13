import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalOverlay } from '../src/local-overlay.mjs';
import { StandardTransitionAdapter } from '../src/standard-transition-adapter.mjs';
import { validLocalMessage, validLocalResult } from '../src/local-message-schema.mjs';

// 0.65.7 short-gap priming: the renderer's standby warm-up, hand-over and exact cue, the adapter's
// deferred late reveal and kept host, and the private channel's new commands.

class FakeVideo extends EventTarget {
  constructor() {
    super();
    Object.assign(this, { style: {}, dataset: {}, readyState: 0, currentTime: 0, seeking: false, paused: true, muted: false, volume: 1, parentNode: null, src: '', duration: 2, playbackRate: 1 });
    this.frame = null; this.plays = 0;
  }
  load() { if (!this.src) return; queueMicrotask(() => { this.readyState = 3; this.dispatchEvent(new Event('canplay')); }); }
  pause() { this.paused = true; }
  play() { this.plays += 1; this.paused = false; this.mutedAtPlay = this.muted; setTimeout(() => { this.currentTime = 0.04; this.frame?.(performance.now(), { mediaTime: 0.04, presentedFrames: 1, expectedDisplayTime: performance.now() + 60 }); }, 1); return Promise.resolve(); }
  requestVideoFrameCallback(callback) { this.frame = callback; return 1; }
  cancelVideoFrameCallback() { this.frame = null; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  remove() { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
}
function host() {
  const node = { children: [] };
  node.append = child => { child.parentNode?.children.splice(child.parentNode.children.indexOf(child), 1); child.parentNode = node; node.children.push(child); };
  node.insertBefore = (child, before) => { child.parentNode?.children.splice(child.parentNode.children.indexOf(child), 1); child.parentNode = node; node.children.splice(node.children.indexOf(before), 0, child); };
  return node;
}
async function playingWithStandby({ currentTime = 0.5 } = {}) {
  const overlay = new LocalOverlay({ document: { visibilityState: 'visible', createElement: () => new FakeVideo() } });
  await overlay.prepare('blob:a');
  const mounted = host();
  await overlay.mount(mounted);
  const current = overlay.video;
  Object.assign(current, { duration: 3, currentTime, paused: false });
  await overlay.prepareNext('blob:b');
  return { overlay, mounted, current, next: overlay.standby.video };
}

test('primeStandby warms the standby under the playing clip, muted, then leaves it paused on its first frame', async () => {
  const { overlay, mounted, current, next } = await playingWithStandby();
  const result = await overlay.primeStandby();
  assert.equal(result.status, 'primed');
  assert.ok(result.startLatencyMs >= 30 && result.startLatencyMs <= 250);
  assert.equal(next.plays, 1); assert.equal(next.mutedAtPlay, true, 'silent while it decodes');
  assert.deepEqual(mounted.children, [next, current], 'under the playing clip, which stays on top');
  assert.equal(next.paused, true); assert.equal(next.currentTime, 0); assert.equal(next.muted, false, 'mute state put back');
  assert.equal(overlay.video, current, 'the playing clip is untouched');
  assert.equal(current.paused, false);
  assert.ok(overlay.standby.primed);
});

test('primeStandby does nothing without a playing clip or with too little of it left', async () => {
  const late = await playingWithStandby({ currentTime: 2.5 });
  assert.deepEqual(await late.overlay.primeStandby(), { status: 'skipped', reason: 'too-late', startLatencyMs: null });
  assert.equal(late.next.plays, 0); assert.equal(late.next.parentNode, null);
  late.current.paused = true;
  assert.equal((await late.overlay.primeStandby()).reason, 'no-playing-clip');
});

test("a primed standby skips the stage's warm-up once promoted; an unprimed clip still warms up (0.65.6)", async () => {
  const { overlay, next } = await playingWithStandby();
  await overlay.primeStandby();
  await overlay.teardown(); // the previous scene ends
  await overlay.prepare('blob:b');
  assert.equal(overlay.video, next);
  await overlay.primeForPlayback();
  assert.equal(next.plays, 1, 'no second warm-up play');
  const fresh = new LocalOverlay({ document: { createElement: () => new FakeVideo() } });
  await fresh.prepare('blob:c');
  await fresh.primeForPlayback();
  assert.equal(fresh.video.plays, 1, 'the 0.65.6 warm-up');
});

test('promoteStandby makes the primed standby current in place and releases the ended clip', async () => {
  const { overlay, mounted, current, next } = await playingWithStandby();
  await overlay.primeStandby();
  await overlay.promoteStandby();
  assert.equal(overlay.video, next); assert.equal(overlay.standby, null);
  assert.deepEqual(mounted.children, [next]);
  assert.equal(current.src, '', 'the ended decoder is released');
  assert.equal(next.style.display, 'block'); assert.equal(next.paused, true); assert.equal(next.currentTime, 0);
  await assert.rejects(overlay.promoteStandby(), /not prepared/);
});

test('cueAt seeks the clip to an exact position (no keyframe snap), kept 0.5 s from its end', async () => {
  const overlay = new LocalOverlay({ document: { createElement: () => new FakeVideo() } });
  await overlay.prepare('blob:a');
  const video = overlay.video;
  Object.defineProperty(video, 'currentTime', { get() { return this._t ?? 0; }, set(value) { this._t = value; this.seeking = true; setTimeout(() => { this.seeking = false; this.dispatchEvent(new Event('seeked')); }, 1); } });
  video.readyState = 4;
  assert.deepEqual(await overlay.cueAt(83), { positionMs: 83 });
  assert.deepEqual(await overlay.cueAt(1900), { positionMs: 1500 });
  await assert.rejects(overlay.cueAt(-1), RangeError);
});

function adapterHarness() {
  const frames = new Map(); let id = 0;
  const player = new EventTarget();
  Object.assign(player, { muted: false, paused: false, seeking: false, playbackRate: 1, currentTime: 9.8, readyState: 4, volume: 1,
    requestVideoFrameCallback(callback) { frames.set(++id, callback); return id; }, cancelVideoFrameCallback(handle) { frames.delete(handle); },
    pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } });
  const adapter = new StandardTransitionAdapter({ document: { defaultView: {} }, passiveAdapter: { activePlayer: () => player },
    commandAdapter: { readState: () => ({ currentTimeMs: Math.round(player.currentTime * 1000), paused: player.paused, muted: player.muted, volume: 1, readyState: 4 }),
      pause: async () => { player.paused = true; }, play: async () => { player.paused = false; }, seekToWithPlaybackWarmup: async () => {} } });
  const present = (mediaTime, presentedFrames) => { for (const [handle, callback] of [...frames]) { frames.delete(handle); callback(performance.now(), { mediaTime, presentedFrames, expectedDisplayTime: performance.now() + 8 }); } };
  let removed = 0;
  const makeHost = () => ({ style: {}, dataset: {}, isConnected: true, remove() { removed += 1; } });
  return { player, adapter, present, makeHost, get removed() { return removed; } };
}

test('deferLateReveal: a cut half a frame or more after the trigger pauses native but leaves the clip hidden', () => {
  // 30 fps native; the second callback is either the last frame before the trigger or, two frames
  // on (a skipped callback), one that already shows 34 ms of the replaced interval.
  for (const [defer, mediaTime, count, revealed] of [[true, 10.034, 3, false], [true, 9.967, 2, true], [false, 10.034, 3, true]]) {
    const h = adapterHarness();
    h.adapter.stagedHost = h.makeHost();
    h.adapter.planCut(10_000, defer ? { deferLateReveal: true } : {});
    h.present(9.933, 1); h.present(mediaTime, count);
    try {
      assert.equal(h.player.paused, true, 'native stops either way');
      assert.equal(h.adapter.stagedHost.style.visibility === 'visible', revealed, `defer ${defer}, frame ${mediaTime}`);
      assert.equal(h.adapter.cutRevealDeferred(10_000), !revealed);
      assert.equal(h.adapter.cutCoveredAt(10_000) === null, !revealed);
      assert.ok(Number.isFinite(h.adapter.cutFrameCallback(10_000).invokedAt), 'the cut callback time is kept for the stage trace');
    } finally { h.adapter.releaseCutHold(); }
  }
});

test("redeliverWake (0.65.8): a hand-over's cut re-delivers its wake-up on every sample until the transition takes the hold; other cuts never do", async () => {
  const frames = [];
  globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  const wake = { currentTimeMs: 10_000, paused: false, event: 'planned-cut' };
  const sample = async () => { frames.shift()?.(); await new Promise(resolve => setImmediate(resolve)); };
  try {
    for (const redeliverWake of [true, false]) {
      const h = adapterHarness(), seen = [];
      h.adapter.stagedHost = h.makeHost();
      const stop = h.adapter.subscribe(state => seen.push(state));
      await sample();
      assert.deepEqual(seen.at(-1), { currentTimeMs: 9_800, paused: false, muted: false, volume: 1, readyState: 4 }, 'before the cut: native');
      h.adapter.planCut(10_000, { deferLateReveal: true, ...(redeliverWake ? { redeliverWake } : {}) });
      h.present(9.933, 1); h.present(9.967, 2);
      assert.equal(h.player.paused, true, 'cut on the last frame before the trigger');
      assert.equal(h.adapter.stagedHost.style.visibility, 'visible');
      assert.deepEqual(seen.at(-1), wake, 'the cut sends its wake-up at once either way');
      // A busy scheduler drops that wake-up; the next samples carry it again only with the option.
      await sample(); await sample();
      assert.deepEqual(seen.slice(-2), redeliverWake ? [wake, wake] : [{ currentTimeMs: 9_800, paused: true, muted: false, volume: 1, readyState: 4 }, { currentTimeMs: 9_800, paused: true, muted: false, volume: 1, readyState: 4 }]);
      const state = { currentTimeMs: 1, paused: true };
      assert.equal(h.adapter.sampledState(state) === state, !redeliverWake);
      // The transition takes the hold over (snapshot, pause): samples are native's own again.
      await h.adapter.snapshot(); await h.adapter.pause();
      assert.equal(h.adapter.cutHold, null);
      await sample();
      assert.equal(seen.at(-1).paused, true);
      assert.equal(seen.at(-1).event, undefined);
      assert.equal(h.adapter.sampledState(state), state);
      stop(); frames.length = 0;
    }
    // A hold that expires or is released (never taken over) stops the wake-ups too.
    const h = adapterHarness();
    h.adapter.stagedHost = h.makeHost();
    h.adapter.planCut(10_000, { redeliverWake: true });
    h.present(9.933, 1); h.present(9.967, 2);
    assert.deepEqual(h.adapter.sampledState({ currentTimeMs: 9_967, paused: true }), wake);
    h.adapter.releaseCutHold();
    assert.deepEqual(h.adapter.sampledState({ currentTimeMs: 9_967, paused: false }), { currentTimeMs: 9_967, paused: false });
  } finally { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; }
});

test('keepHost: a successful restore keeps the hidden host as the next staged host; without it the host is removed', async t => {
  for (const keepHost of [true, false]) {
    const h = adapterHarness();
    const snapshot = await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
    const coverHost = h.makeHost(); coverHost.style.visibility = 'visible';
    h.adapter.overlayHost = coverHost;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    h.player.currentTime = 15;
    h.adapter.prerollNative(performance.timeOrigin + performance.now() + 5, { joinMs: 15_000 });
    t.mock.timers.tick(1);
    h.present(15.042, 11);
    t.mock.timers.reset();
    const receipt = await h.adapter.restore(snapshot, { targetTimeMs: 15_000, resumePlayback: true, awaitPresentedFrame: true, ...(keepHost ? { keepHost } : {}) });
    assert.equal(receipt.presentation, 'prerolled');
    assert.equal(h.adapter.overlayHost, null);
    assert.equal(h.adapter.stagedHost, keepHost ? coverHost : null);
    assert.equal(h.removed, keepHost ? 0 : 1);
    // 0.65.10: a kept host is uncovered at opacity 0 (still rendering), not visibility:hidden.
    if (keepHost) assert.deepEqual([coverHost.style.visibility, coverHost.style.opacity, coverHost.dataset.nativeCovered], ['visible', '0', 'false']);
    else assert.equal(coverHost.style.visibility, 'hidden');
  }
});

test("0.65.10: the next cover on a kept host shows the next clip, never the ended clip's last picture", async t => {
  // Model of the renderer's out-of-process frame (0.62.18): a frame tick copies the
  // renderer's picture into the host's surface only while the host is not visibility:hidden; the
  // screen shows that surface while the host is visible at opacity 1, else native. On 0.65.9 the kept
  // host stayed visibility:hidden through the hand-over, so the cover showed clip 7's last picture.
  const h = adapterHarness();
  const renderer = { picture: 'clip-7-last' };
  const coverHost = h.makeHost(); Object.assign(coverHost.style, { visibility: 'visible', opacity: '1' }); coverHost.surface = renderer.picture;
  const tick = () => { if (coverHost.style.visibility !== 'hidden') coverHost.surface = renderer.picture; };
  const screen = () => coverHost.style.visibility !== 'hidden' && coverHost.style.opacity === '1' ? coverHost.surface : 'native';
  const snapshot = await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = coverHost;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.player.currentTime = 15;
  h.adapter.prerollNative(performance.timeOrigin + performance.now() + 5, { joinMs: 15_000 });
  t.mock.timers.tick(1);
  h.present(15.042, 11);
  assert.equal(screen(), 'native', 'exit uncovered on its first native frame');
  t.mock.timers.reset();
  await h.adapter.restore(snapshot, { targetTimeMs: 15_000, resumePlayback: true, awaitPresentedFrame: true, keepHost: true });
  assert.equal(h.adapter.stagedHost, coverHost);
  assert.equal(screen(), 'native', 'nothing of the kept host is on screen during the gap');
  // The hand-over: the renderer promotes the primed standby (and may cue it); frames go by.
  renderer.picture = 'clip-8-first'; tick(); tick();
  assert.equal(screen(), 'native');
  // The next scene's planned cut, 160 ms after the join, reveals the kept host.
  h.player.paused = false;
  assert.equal(h.adapter.planCut(15_160), true);
  h.present(15.082, 12); h.present(15.122, 13);
  try {
    assert.equal(h.player.paused, true, 'native stops on the last frame before the trigger');
    assert.equal(screen(), 'clip-8-first', "the cover shows the next clip, not the ended clip's last picture");
  } finally { h.adapter.releaseCutHold(); }
});

test('the private channel accepts the short-gap commands and results, and nothing looser', () => {
  const command = (name, args) => validLocalMessage({ type: 'command', id: 1, command: name, args }, 'controller');
  assert.equal(command('primeStandby', []), true);
  assert.equal(command('promoteStandby', []), true);
  assert.equal(command('primeStandby', [1]), false);
  assert.equal(command('cueAt', [83]), true);
  for (const bad of [[-1], [83.5], [125001], [], ['83']]) assert.equal(command('cueAt', bad), false, JSON.stringify(bad));
  const result = (name, value) => validLocalResult({ type: 'result', id: 1, ok: true, value }, name);
  assert.equal(result('primeStandby', { status: 'primed', reason: null, startLatencyMs: 61.2 }), true);
  assert.equal(result('primeStandby', { status: 'skipped', reason: 'too-late', startLatencyMs: null }), true);
  assert.equal(result('primeStandby', { status: 'skipped', reason: 'PRIVATE', startLatencyMs: null }), false);
  assert.equal(result('primeStandby', null), false);
  assert.equal(result('promoteStandby', null), true);
  assert.equal(result('cueAt', { positionMs: 83 }), true);
  const play = { durationMs: 2000, localTimeAtEndMs: 2000, unplayedTailMs: 0, frameHoldMode: 'local-canvas-audio-to-ended', heldFrameMediaTimeMs: 1958, localEnded: true };
  const epoch = Date.now();
  assert.equal(result('play', { ...play, firstFrame: { callbackMs: epoch, displayMs: epoch + 9, mediaMs: 0 } }), true);
  assert.equal(result('play', { ...play, firstFrame: { callbackMs: epoch, displayMs: null, mediaMs: null } }), true);
  assert.equal(result('play', { ...play, firstFrame: { callbackMs: 5, displayMs: null, mediaMs: null } }), false);
  assert.equal(result('play', { ...play, firstFrame: { callbackMs: epoch } }), false);
});

// 0.65.11: registered at native 806105, the plan's first
// frame callback is 806120, which cuts at once: no 'wait' callback, so no prediction and no pre-roll.
// The adapter now asks for the clip's start right after the cut (pause, reveal, then onPredict with a
// hard step at the cut time). A plan that predicted on a wait callback (P01) is unchanged.
test('Fix 1: a cut with no prior prediction asks for the clip at once, after the pause and the reveal; a predicted cut does not', () => {
  const runShape = (frames, options = {}) => {
    const h = adapterHarness(), order = [], predictions = [];
    h.adapter.stagedHost = h.makeHost();
    const pause = h.player.pause.bind(h.player);
    h.player.pause = () => { order.push('pause'); pause(); };
    h.player.currentTime = frames[0][0] - 0.015;
    h.adapter.planCut(806_121, { ...options, onPredict: (...args) => {
      order.push(`predict:${h.player.paused ? 'paused' : 'playing'}:${h.adapter.stagedHost.style.visibility ?? 'hidden'}`);
      predictions.push({ args, at: performance.timeOrigin + performance.now() });
    } });
    for (const [media, count] of frames) { h.player.currentTime = media; h.present(media, count); }
    const result = { order, predictions, deferred: h.adapter.cutRevealDeferred(806_121) };
    h.adapter.releaseCutHold();
    return result;
  };
  // P02/P03: the first callback is the cut.
  const unprepared = runShape([[806.12, 20]], { deferLateReveal: true, redeliverWake: true });
  assert.deepEqual(unprepared.order, ['pause', 'predict:paused:visible']);
  assert.equal(unprepared.predictions.length, 1);
  const [cutAt, audioEndAt, mode] = unprepared.predictions[0].args;
  assert.equal(cutAt, audioEndAt, 'the audio ends (and the clip steps in) at the cut');
  assert.deepEqual(mode, { hard: true });
  assert.ok(Math.abs(cutAt - unprepared.predictions[0].at) < 5, 'cut time is now');
  // P01: a wait callback on 806040 predicted (and pre-rolled); its cut on 806080 adds nothing.
  const prepared = runShape([[806.04, 1], [806.08, 2]], { deferLateReveal: true, redeliverWake: true });
  assert.deepEqual(prepared.order, ['predict:playing:hidden', 'pause']);
  assert.equal(prepared.predictions[0].args[2], undefined, 'the predicted path is as before (fades on: no hard step)');
  // A late cut (deferred reveal) never starts the clip: the transition cues it to native's position.
  const late = runShape([[806.16, 20]], { deferLateReveal: true });
  assert.equal(late.deferred, true);
  assert.deepEqual(late.order, ['pause']);
});

test('Fix 1: a released cut hold tells the engine (onHoldReleased); a hold the transition adopts does not', async () => {
  for (const adopt of [false, true]) {
    const h = adapterHarness();
    let released = 0;
    h.adapter.stagedHost = h.makeHost();
    h.adapter.planCut(10_000, { onHoldReleased: () => { released += 1; } });
    h.present(9.967, 1);
    assert.equal(h.player.paused, true);
    if (adopt) { await h.adapter.snapshot(); await h.adapter.pause(); assert.equal(h.adapter.cutHold, null); }
    else { h.adapter.releaseCutHold(); assert.equal(h.player.paused, false, 'native resumes'); }
    assert.equal(released, adopt ? 0 : 1);
  }
});
