import test from 'node:test';
import assert from 'node:assert/strict';
import { StandardTransitionAdapter } from '../src/standard-transition-adapter.mjs';
import { LocalOverlay } from '../src/local-overlay.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const epochNow = () => performance.timeOrigin + performance.now();

function nativeHarness() {
  const frames = new Map(); let id = 0; const plays = [];
  const player = new EventTarget();
  Object.assign(player, { muted: false, paused: false, seeking: false, playbackRate: 1, currentTime: 9.8, readyState: 4,
    requestVideoFrameCallback(callback) { frames.set(++id, callback); return id; }, cancelVideoFrameCallback(handle) { frames.delete(handle); },
    pause() { this.paused = true; }, play() { plays.push(this.currentTime); this.paused = false; return Promise.resolve(); } });
  const seeks = [];
  const adapter = new StandardTransitionAdapter({ document: { defaultView: {} }, passiveAdapter: { activePlayer: () => player },
    commandAdapter: { readState: () => ({ currentTimeMs: Math.round(player.currentTime * 1000), paused: player.paused, muted: player.muted, volume: 1, readyState: 4 }),
      pause: async () => { player.paused = true; }, play: async () => { player.paused = false; }, seekToWithPlaybackWarmup: async target => { seeks.push(target); } } });
  const host = () => ({ style: {}, dataset: {}, isConnected: true, remove() {} });
  const present = (mediaTime, presentedFrames) => { for (const [handle, callback] of [...frames]) { frames.delete(handle); callback(performance.now(), { mediaTime, presentedFrames, expectedDisplayTime: performance.now() }); } };
  return { player, adapter, frames, present, host, plays, seeks };
}

test('a planned cut pauses native and reveals the staged cover in the callback of the last frame before the trigger', async () => {
  const h = nativeHarness(), woken = [], predicted = [];
  h.adapter.stagedHost = h.host();
  h.adapter.stateSubscribers.add(state => woken.push(state));
  assert.equal(h.adapter.planCut(10_000, { onPredict: epoch => predicted.push(epoch) }), true);
  h.present(9.875, 1); h.present(9.917, 2);
  assert.equal(h.player.paused, false); assert.equal(predicted.length, 2);
  assert.ok(Math.abs(predicted[1] - (epochNow() + 83)) < 25, 'predicts the cut from the frame clock');
  h.present(9.958, 3);
  assert.equal(h.player.paused, true, 'paused before the 10.0 s frame can be presented');
  assert.equal(h.adapter.stagedHost.style.visibility, 'visible');
  assert.deepEqual(woken, [{ currentTimeMs: 10_000, paused: false, event: 'planned-cut' }]);
  // The transition adopts the hold: the viewer was playing, so restore resumes native.
  const snapshot = await h.adapter.snapshot();
  assert.equal(snapshot.paused, false);
  await h.adapter.pause();
  assert.equal(h.adapter.pauseLedger.entries[0].before, false);
  assert.equal(h.adapter.cutHold, null);
});

test('a skipped frame callback does not make the cut early', () => {
  const h = nativeHarness();
  h.adapter.stagedHost = h.host();
  h.adapter.planCut(10_000);
  h.present(9.833, 1); h.present(9.917, 3);
  assert.equal(h.player.paused, false, 'two frames presented in one callback: still one frame of 42 ms, not 84');
});

test('planned cut retains pre-pause native and callback clocks separately from its scheduler wake', () => {
  const h = nativeHarness(), woken = [];
  h.adapter.stagedHost = h.host();
  h.adapter.stateSubscribers.add(state => woken.push(state));
  h.adapter.planCut(10_000);
  h.present(9.917, 1);
  h.player.currentTime = 9.972;
  h.player.pause = () => { h.player.currentTime = 9.999; h.player.paused = true; };
  h.present(9.958, 2);
  try {
    assert.equal(woken[0].currentTimeMs, 10_000);
    assert.deepEqual(h.adapter.cutObservation(10_000), { currentTimeMs: 9972, frameTimeMs: 9958 });
    assert.equal(h.adapter.cutObservation(11_000), null, 'a later scene cannot reuse the receipt');
    h.adapter.adoptCutHold();
    assert.equal(h.adapter.cutObservation(10_000), null, 'adoption clears the hold receipt');
  } finally { h.adapter.releaseCutHold(); }
});

test('pausing native before the trigger abandons the plan; an unadopted cut resumes native', async t => {
  const h = nativeHarness(); let aborted = 0;
  h.adapter.stagedHost = h.host();
  h.adapter.planCut(10_000, { onAbort: () => { aborted++; } });
  h.player.dispatchEvent(new Event('pause'));
  assert.equal(aborted, 1); assert.equal(h.adapter.plannedCut, null); assert.equal(h.frames.size, 0);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.player.paused = false; h.adapter.planCut(10_000);
  h.present(9.917, 1); h.present(9.958, 2);
  assert.equal(h.player.paused, true);
  t.mock.timers.tick(2000);
  assert.equal(h.player.paused, false, 'released after 2 s without a transition');
  assert.equal(h.adapter.stagedHost.style.visibility, 'hidden');
});

test('native pre-roll starts under the cover before the clip ends and restore adopts it without re-seeking', async t => {
  const h = nativeHarness();
  const snapshot = await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = h.host(); h.adapter.overlayHost.style.visibility = 'visible';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.player.currentTime = 15; // native sits paused at the join (15 s)
  // The clip ends 5 ms from now (the fixed lead is tested in audio-crossfade.test.mjs).
  assert.equal(h.adapter.prerollNative(epochNow() + 5), true);
  t.mock.timers.tick(1); assert.equal(h.plays.length, 1, 'native started at once');
  assert.equal(h.adapter.overlayHost.style.visibility, 'visible', 'still covered until its first frame');
  h.present(15.0, 10);
  assert.equal(h.adapter.overlayHost.style.visibility, 'visible', '0.62.17: a re-presented paused frame does not uncover (clock not yet shown moving)');
  h.present(15.042, 11);
  assert.equal(h.adapter.overlayHost.style.visibility, 'hidden'); assert.equal(h.player.muted, false);
  t.mock.timers.reset();
  const receipt = await h.adapter.restore(snapshot, { targetTimeMs: 15_000, resumePlayback: true, awaitPresentedFrame: true });
  assert.equal(receipt.presentation, 'prerolled'); assert.deepEqual(h.seeks, [], 'no seek back to the join');
});

// E72 (0.64.3): Exit reveal 'new' (default) uncovers on native's first frame newer than its paused
// position; 'previous' keeps 0.62.17's wait for a frame newer than the first presented one.
for (const policy of ['new', 'previous']) test(`exit reveal '${policy}': which native frame uncovers, and the receipt says which policy ran`, async t => {
  const h = nativeHarness();
  const snapshot = await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = h.host(); h.adapter.overlayHost.style.visibility = 'visible';
  if (policy === 'previous') h.adapter.setExitRevealPolicy('previous');
  h.player.currentTime = 14.999; // paused at a mid-frame join (frame 14.983 on screen)
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.adapter.prerollNative(epochNow() + 5, { joinMs: 14_999 });
  t.mock.timers.tick(10);
  h.present(15.025, 10); // native's first new frame: the expected next picture
  assert.equal(h.adapter.overlayHost.style.visibility, policy === 'new' ? 'hidden' : 'visible');
  h.present(15.067, 11);
  assert.equal(h.adapter.overlayHost.style.visibility, 'hidden');
  t.mock.timers.reset();
  const receipt = await h.adapter.restore(snapshot, { targetTimeMs: 14_999, resumePlayback: true, awaitPresentedFrame: true });
  assert.equal(receipt.audioFade.revealPolicy, policy);
  assert.equal(receipt.audioFade.pausedVsJoinMs, 0);
  assert.equal(receipt.audioFade.uncoverFrameMediaTimeMs, policy === 'new' ? 15_025 : 15_067);
  assert.equal(receipt.audioFade.frames.length, policy === 'new' ? 1 : 2);
});

test('exit reveal policy accepts only new | previous (anything else is new)', () => {
  const h = nativeHarness();
  assert.equal(h.adapter.exitReveal, 'new');
  h.adapter.setExitRevealPolicy('previous'); assert.equal(h.adapter.exitReveal, 'previous');
  h.adapter.setExitRevealPolicy('bogus'); assert.equal(h.adapter.exitReveal, 'new');
});

test('a withdrawn clip end cancels a pending native pre-roll', async t => {
  const h = nativeHarness();
  await h.adapter.snapshot(); await h.adapter.pause();
  h.adapter.overlayHost = h.host();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.adapter.prerollNative(epochNow() + 500);
  h.adapter.prerollNative(null);
  t.mock.timers.tick(1000);
  assert.equal(h.plays.length, 0); assert.equal(h.adapter.nativePreroll, null);
});

for (const fallback of [false, true]) test(`pre-roll receipt retains native position at ${fallback ? 'fallback' : 'frame'} uncover instead of later restore`, async t => {
  const h = nativeHarness();
  const snapshot = await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = h.host(); h.adapter.overlayHost.style.visibility = 'visible';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.adapter.prerollNative(epochNow() + 5); t.mock.timers.tick(20);
  h.player.currentTime = 15.025;
  if (fallback) t.mock.timers.tick(300); else { h.present(15.0, 10); h.present(15.042, 11); }
  assert.equal(h.adapter.overlayHost.style.visibility, 'hidden');
  h.player.currentTime = 15.475; // Native keeps advancing before local completion reaches restore.
  t.mock.timers.reset();
  const receipt = await h.adapter.restore(snapshot, { targetTimeMs: 15_000, resumePlayback: true, awaitPresentedFrame: true });
  assert.equal(receipt.presentation, fallback ? 'prerolled-without-frame-callback' : 'prerolled');
  assert.equal(receipt.timeAtUncoverMs, 15025);
  assert.equal(receipt.errorMs, 25);
  assert.equal(h.player.currentTime, 15.475, 'measurement must not seek or change native playback');
  assert.deepEqual(h.seeks, []);
});

test('withdrawing after native pre-roll starts keeps the clip covered and ignores a late first frame', async t => {
  const h = nativeHarness(); await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = h.host(); h.adapter.overlayHost.style.visibility = 'visible';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.adapter.prerollNative(epochNow() + 100); t.mock.timers.tick(20);
  assert.equal(h.plays.length, 1); const late = [...h.frames.values()][0];
  h.adapter.prerollNative(null);
  assert.equal(h.player.paused, true, 'withdrawal stops owned native pre-roll');
  late(performance.now(), { expectedDisplayTime: performance.now() }); t.mock.timers.tick(400);
  assert.equal(h.adapter.overlayHost.style.visibility, 'visible'); assert.equal(h.player.muted, true);
  assert.equal(h.adapter.nativePreroll, null); assert.equal(h.frames.size, 0);
  assert.equal(h.adapter.nativeStartLatencyMs, null, 'a cancelled callback cannot tune the next start');
  assert.equal(h.adapter.prerollNative(epochNow() + 100), false, 'after native advanced, the normal restore must seek back to the join');
});

for (const superseded of [false, true]) test(`late native play after withdrawal ${superseded ? 'cannot pause a newer owner' : 'is stopped for the same owner'}`, async t => {
  const h = nativeHarness(); let resolve;
  h.player.play = () => new Promise(done => { resolve = () => { h.player.paused = false; done(); }; });
  await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = h.host(); h.adapter.overlayHost.style.visibility = 'visible';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.adapter.prerollNative(epochNow() + 100); t.mock.timers.tick(20); h.adapter.prerollNative(null);
  if (superseded) h.adapter.snapshotToken = {};
  resolve(); await turn();
  assert.equal(h.player.paused, !superseded);
  assert.equal(h.adapter.overlayHost.style.visibility, 'visible'); assert.equal(h.frames.size, 0);
});

test('late cancelled play cannot pause the normal restore already in progress', async t => {
  const h = nativeHarness(); let resolve;
  h.player.play = () => new Promise(done => { resolve = () => { h.player.paused = false; done(); }; });
  const snapshot = await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = h.host(); h.adapter.overlayHost.style.visibility = 'visible';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.adapter.prerollNative(epochNow() + 100); t.mock.timers.tick(20); h.adapter.prerollNative(null);
  const restoring = h.adapter.restore(snapshot, { targetTimeMs: 15000, resumePlayback: true, awaitPresentedFrame: false });
  resolve(); await turn(); await restoring;
  assert.equal(h.player.paused, false);
});

for (const afterStart of [false, true]) test(`source invalidation ${afterStart ? 'after' : 'before'} native pre-roll cannot uncover or unmute`, async t => {
  const h = nativeHarness(); await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = h.host(); h.adapter.overlayHost.style.visibility = 'visible';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.adapter.prerollNative(epochNow() + 100);
  if (afterStart) t.mock.timers.tick(20);
  h.adapter.invalidateContext(); h.present(99, 1); t.mock.timers.tick(500);
  assert.equal(h.adapter.overlayHost.style.visibility, 'visible'); assert.equal(h.player.muted, true);
  assert.equal(h.plays.length, afterStart ? 1 : 0);
});

class ClipVideo extends EventTarget {
  constructor() { super(); this.paused = true; this.muted = false; this.duration = 5; this.currentTime = 0; this.readyState = 4; this.playbackRate = 1; this.plays = 0; this.style = {}; }
  play() { this.plays++; this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  remove() {}
}

test('the clip starts early by its measured latency, muted, and play() adopts it; unmount cancels it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const overlay = new LocalOverlay({ document: {} }), video = new ClipVideo();
  overlay.video = video; overlay.startLatencyMs = 100;
  overlay.prerollAt(epochNow() + 190);
  t.mock.timers.tick(40); assert.equal(video.plays, 0, 'starts at the cut minus latency (100) minus margin (40)');
  t.mock.timers.tick(20); assert.equal(video.plays, 1); assert.equal(video.muted, true);
  const playing = overlay.play(new AbortController().signal); playing.catch(() => {});
  assert.equal(overlay.preroll, null, 'adopted'); assert.equal(video.paused, false);
  overlay.prerollAt(epochNow() + 150); await overlay.unmount();
  t.mock.timers.tick(500); assert.equal(video.plays, 2, 'the second play is play() itself; the cancelled preroll never starts');
  video.dispatchEvent(new Event('ended')); await playing;
});

test('a playing clip announces its end time shortly before it ends, and withdraws it on a viewer pause', async () => {
  const overlay = new LocalOverlay({ document: {} }), video = new ClipVideo(), ends = [];
  video.currentTime = 4.8; overlay.video = video; overlay.onLocalEnding = value => ends.push(value);
  const playing = overlay.play(new AbortController().signal); playing.catch(() => {});
  await turn();
  assert.equal(ends.length, 1); assert.ok(Math.abs(ends[0] - (epochNow() + 200)) < 100, "announced about 200 ms ahead");
  overlay.localPause();
  assert.equal(ends.at(-1), null);
  video.dispatchEvent(new Event('ended')); await playing;
});

// 0.66.2: a scene that is not staged (staging still running, or failed) still stops native on the
// last frame before its trigger; nothing is revealed, and the transition adopts the hold.
test('a hold-only cut pauses native on the last frame before the trigger without a staged cover', async () => {
  const h = nativeHarness(), woken = [];
  h.adapter.stateSubscribers.add(state => woken.push(state));
  assert.equal(h.adapter.planCut(10_000), false, 'an ordinary planned cut still needs the staged host');
  assert.equal(h.adapter.planHold(10_000), true);
  h.present(9.875, 1); h.present(9.917, 2);
  assert.equal(h.player.paused, false);
  h.present(9.958, 3);
  assert.equal(h.player.paused, true, 'same cut rule: paused before the 10.0 s frame can be presented');
  assert.deepEqual(woken, [{ currentTimeMs: 10_000, paused: false, event: 'planned-cut' }]);
  assert.equal(h.adapter.cutHoldOnly(10_000), true); assert.equal(h.adapter.cutHoldOnly(11_000), false);
  assert.equal(h.adapter.cutCoveredAt(10_000), null, 'nothing was revealed');
  assert.equal(h.adapter.cutRevealDeferred(10_000), false, 'not a short-gap deferred reveal');
  // Discarding an unfinished stage keeps the hold when the transition asks; it then adopts it.
  h.adapter.stagedHost = h.host();
  h.adapter.unstageOverlayHost({ keepCutHold: true });
  assert.equal(h.player.paused, true); assert.equal(h.adapter.cutHoldOnly(10_000), true);
  const snapshot = await h.adapter.snapshot();
  assert.equal(snapshot.paused, false, 'the viewer was playing: restore resumes native');
  await h.adapter.pause();
  assert.equal(h.adapter.cutHold, null);
});

test('a hold-only cut that no transition takes over resumes native; an ordinary unstage releases it at once', async t => {
  const h = nativeHarness();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.adapter.planHold(10_000); h.present(9.917, 1); h.present(9.958, 2);
  assert.equal(h.player.paused, true);
  t.mock.timers.tick(2000);
  assert.equal(h.player.paused, false, 'released after 2 s (the existing cut-hold policy)');
  h.adapter.planHold(10_000); h.present(9.917, 3); h.present(9.958, 4);
  assert.equal(h.player.paused, true);
  h.adapter.unstageOverlayHost();
  assert.equal(h.player.paused, false);
  // A viewer pause or seek before the trigger abandons the watch, as for a planned cut.
  let aborted = 0;
  h.adapter.planHold(10_000, { onAbort: () => { aborted++; } });
  h.player.dispatchEvent(new Event('seeking'));
  assert.equal(aborted, 1); assert.equal(h.adapter.plannedCut, null); assert.equal(h.frames.size, 0);
});
