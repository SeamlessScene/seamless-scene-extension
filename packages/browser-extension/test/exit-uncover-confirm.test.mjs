import test from 'node:test';
import assert from 'node:assert/strict';
import { StandardTransitionAdapter, EXIT_UNCOVER_CONFIRM_DISPLAY_MS, EXIT_UNCOVER_CONFIRM_TIMEOUT_MS } from '../src/standard-transition-adapter.mjs';

// 0.66.2: a parked exit does not lift the cover inside the qualifying frame's callback (the frame
// is only handed to the compositor then; the frame before it, a picture of the removed scene,
// could show for one display refresh). It lifts once that frame is confirmed on screen: native's
// next frame callback, an animation frame one display refresh after its expected display time, or
// a 60 ms timeout. Unparked exits lift in the qualifying callback, as before.

const FRAME = 1000 / 24;

// The real adapter on a native player whose frame callbacks, animation frames and clock are
// driven by hand. `raf: false` leaves the page without requestAnimationFrame.
function harness(t, { raf = true } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const frames = new Map(), rafs = new Map(); let id = 0; const cancelled = { frames: 0, rafs: 0 };
  const player = new EventTarget();
  Object.assign(player, { muted: false, paused: false, seeking: false, playbackRate: 1, currentTime: 9.8, readyState: 4, volume: 1,
    requestVideoFrameCallback(callback) { frames.set(++id, callback); return id; },
    cancelVideoFrameCallback(handle) { if (frames.delete(handle)) cancelled.frames += 1; },
    pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } });
  const view = raf ? { requestAnimationFrame(callback) { rafs.set(++id, callback); return id; },
    cancelAnimationFrame(handle) { if (rafs.delete(handle)) cancelled.rafs += 1; } } : {};
  const adapter = new StandardTransitionAdapter({ document: { defaultView: view }, passiveAdapter: { activePlayer: () => player },
    commandAdapter: { readState: () => ({ currentTimeMs: Math.round(player.currentTime * 1000), paused: player.paused, muted: player.muted, volume: 1, readyState: 4 }),
      pause: async () => { player.paused = true; }, play: async () => { player.paused = false; }, seekToWithPlaybackWarmup: async () => {} } });
  adapter.setExitRevealPolicy('precise');
  adapter.nativeFrameMs = FRAME;
  const host = { style: { visibility: 'visible' }, dataset: {}, isConnected: true, remove() {} };
  const h = { t, player, adapter, host, frames, rafs, cancelled, clock: performance.now(), endAtPerf: 0, snapshot: null };
  t.mock.method(performance, 'now', () => h.clock);
  // One native frame callback at the current clock; `shownIn` is its expectedDisplayTime from now.
  h.present = (mediaTime, presentedFrames, shownIn = 4) => {
    for (const [handle, callback] of [...frames]) { frames.delete(handle); callback(h.clock, { mediaTime, presentedFrames, expectedDisplayTime: h.clock + shownIn }); }
  };
  // One animation frame at the current clock.
  h.animate = () => { for (const [handle, callback] of [...rafs]) { rafs.delete(handle); callback(h.clock); } };
  // Move the clock and the timers together.
  h.go = ms => { h.clock += ms; t.mock.timers.tick(ms); };
  h.covered = () => host.style.visibility !== 'hidden';
  return h;
}

// Native paused `parkMs` before the 15.0 s join, pre-rolled 105 ms before the clip's end, played
// to the join frame's callback 3 ms after the clip's end (to be shown 4 ms later).
async function toQualifyingFrame(h, { parkMs = 65 } = {}) {
  h.snapshot = await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = h.host;
  h.player.currentTime = 15 - parkMs / 1000;
  h.endAtPerf = h.clock + 105;
  assert.equal(h.adapter.prerollNative(performance.timeOrigin + h.endAtPerf, { joinMs: 15_000, ...(parkMs > 0 ? { parkMs } : {}) }), true);
  h.t.mock.timers.tick(1); // the 105 ms lead: native starts at once
  h.animate(); h.animate(); // the two animation frames the cover waits for (0.62.18)
  const preroll = h.adapter.nativePreroll;
  assert.equal(preroll.started, true);
  if (parkMs > 0) { h.go(60); h.present(14.958, 10); assert.equal(h.covered(), true, 'a frame before the join stays covered'); h.go(48); }
  else h.go(108);
  h.player.currentTime = 15.004;
  h.present(15.0, 11);
  return preroll;
}

async function exitReport(h) {
  h.t.mock.timers.reset();
  return (await h.adapter.restore(h.snapshot, { targetTimeMs: 15_000, resumePlayback: true, awaitPresentedFrame: true })).audioFade;
}

test("uncover confirm: a parked exit keeps the cover through the qualifying frame's callback and lifts it on native's next frame callback", async t => {
  const h = harness(t, { raf: false });
  const preroll = await toQualifyingFrame(h);
  assert.equal(h.covered(), true, 'still covered when the qualifying callback returns');
  assert.equal(preroll.uncovered, false);
  assert.equal(preroll.uncoverFrameMediaTimeMs, 15_000, 'the qualifying frame is recorded at once');
  assert.equal(h.frames.size, 1, 'waiting for the next frame callback');
  h.go(41.7); h.player.currentTime = 15.046;
  h.present(15.042, 12);
  assert.equal(h.covered(), false, 'lifted on the confirming callback');
  assert.equal(h.host.dataset.nativeCovered, 'false');
  assert.equal(h.frames.size, 0);
  t.mock.timers.tick(1000); // the confirmation timeout and the fallback were cleared: nothing else runs
  const exit = await exitReport(h);
  assert.equal(exit.uncoverVia, 'frame');
  assert.equal(exit.uncoverFrameMediaTimeMs, 15_000, 'the report keeps the qualifying frame');
  assert.equal(exit.uncover.frameVsJoinMs, 0);
  assert.equal(exit.uncover.confirmVia, 'frame');
  assert.equal(exit.uncover.confirmMs, 41.7);
  assert.equal(exit.uncoverAtMs, 3, "the qualifying frame's callback time");
  assert.equal(exit.uncover.clipRemainingMs, -44.7, 'the cover went 44.7 ms after the clip ended (3 + 41.7)');
  assert.equal(exit.uncover.clockVsJoinMs, 46, "native's clock at the actual lift");
  // The clock start delay is taken back to the clip's end from the actual lift, so the hold does not move it.
  assert.equal(exit.uncover.clockDelayMs, 38.7);
});

test('uncover confirm: an animation frame one display refresh after the expected display time lifts the cover first', async t => {
  const h = harness(t);
  const preroll = await toQualifyingFrame(h); // expected on screen 4 ms after its callback
  assert.equal(h.covered(), true);
  assert.equal(h.rafs.size >= 1, true);
  h.animate(); // the same rendering turn as the callback: too early
  assert.equal(h.covered(), true);
  h.go(16.7); h.animate(); // 16.7 ms later: the frame is due 4 ms in, one refresh after that is 20.7
  assert.equal(h.covered(), true, 'not yet one display refresh after the expected display time');
  assert.equal(h.clock < h.endAtPerf + 3 + 4 + EXIT_UNCOVER_CONFIRM_DISPLAY_MS - 1, true);
  h.go(16.7); h.player.currentTime = 15.037; h.animate();
  assert.equal(h.covered(), false, 'lifted on the animation frame');
  assert.equal(preroll.frame, null, 'the pending frame callback was cancelled');
  assert.equal(h.frames.size, 0);
  h.present(15.042, 12); t.mock.timers.tick(1000); // nothing left to run
  const exit = await exitReport(h);
  assert.equal(exit.uncoverVia, 'frame');
  assert.equal(exit.uncover.confirmVia, 'raf');
  assert.equal(exit.uncover.confirmMs, 33.4);
  assert.equal(exit.uncoverFrameMediaTimeMs, 15_000);
});

test('uncover confirm: with no frame callback and no animation frame the timeout lifts the cover, and the fallback is untouched', async t => {
  const h = harness(t);
  const preroll = await toQualifyingFrame(h);
  h.go(EXIT_UNCOVER_CONFIRM_TIMEOUT_MS - 1);
  assert.equal(h.covered(), true);
  h.go(1);
  assert.equal(h.covered(), false, 'never held past the timeout');
  assert.equal(preroll.frame, null); assert.equal(h.frames.size, 0);
  assert.equal(h.cancelled.frames >= 1, true, 'the frame callback request was cancelled');
  const exit = await exitReport(h);
  assert.equal(exit.uncoverVia, 'frame', 'a qualifying frame was seen: not the 300 ms fallback');
  assert.equal(exit.uncover.confirmVia, 'timeout');
  assert.equal(exit.uncover.confirmMs, EXIT_UNCOVER_CONFIRM_TIMEOUT_MS);
});

test('uncover confirm: a cancel between the qualifying frame and its confirmation lifts nothing and leaves no handle', async t => {
  const h = harness(t);
  const preroll = await toQualifyingFrame(h);
  assert.equal(h.covered(), true);
  const pendingRafs = h.rafs.size;
  preroll.cancel();
  assert.equal(preroll.frame, null); assert.equal(preroll.clearConfirm, null);
  assert.equal(h.frames.size, 0, 'no frame callback left');
  assert.equal(h.cancelled.rafs, 1, 'the confirming animation frame was cancelled');
  assert.equal(h.rafs.size, pendingRafs - 1);
  h.go(20); h.animate(); h.present(15.042, 12); h.go(40); h.animate(); h.go(1000);
  assert.equal(h.covered(), true, 'no lift after the cancel');
  assert.equal(preroll.uncovered, false);
  assert.equal(preroll.confirmVia, undefined);
  assert.equal(h.frames.size, 0);
});

test('uncover confirm: a pre-roll that no longer owns the player is not lifted by the confirmation', async t => {
  const h = harness(t, { raf: false });
  const preroll = await toQualifyingFrame(h);
  h.adapter.nativePreroll = null; // replaced or released elsewhere
  h.go(41.7); h.present(15.042, 12); h.go(100);
  assert.equal(h.covered(), true);
  assert.equal(preroll.uncovered, false);
});

test('uncover confirm: an unparked exit lifts the cover inside the qualifying callback, as before', async t => {
  const h = harness(t);
  const preroll = await toQualifyingFrame(h, { parkMs: 0 });
  assert.equal(h.covered(), false, 'lifted in the qualifying callback');
  assert.equal(preroll.uncovered, true);
  assert.equal(preroll.clearConfirm, undefined, 'no confirmation was ever set up');
  assert.equal(h.frames.size, 0);
  const exit = await exitReport(h);
  assert.equal(exit.uncoverVia, 'frame');
  assert.equal(exit.uncoverFrameMediaTimeMs, 15_000);
  assert.equal('confirmVia' in exit.uncover, false);
  assert.equal('confirmMs' in exit.uncover, false);
  assert.equal(exit.uncover.clipRemainingMs, -3);
});
