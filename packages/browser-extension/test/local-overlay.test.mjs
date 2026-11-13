import assert from "node:assert/strict";
import test from "node:test";

import { LocalOverlay, localPlaybackVolume } from "../src/local-overlay.mjs";

test("derives local volume from native volume plus bounded decibel gain", () => {
  assert.equal(localPlaybackVolume(0.5, 0), 0.5);
  assert.ok(Math.abs(localPlaybackVolume(1, -8) - 0.3981071705534972) < 1e-12);
  assert.equal(localPlaybackVolume(1, 6), 1);
  assert.throws(() => localPlaybackVolume(1, -25), /between -24 and 6/);
  assert.throws(() => localPlaybackVolume(1, 0.5), /between -24 and 6/);
});

test("configures replacement mute and volume without mutating native state", async () => {
  const overlay = new LocalOverlay({ document: {} });
  overlay.video = { muted: false, volume: 1 };
  const snapshot = { muted: true, volume: 0.5 };

  const configured = await overlay.configureAudio(snapshot, -6);

  assert.equal(overlay.video.muted, true);
  assert.ok(Math.abs(overlay.video.volume - 0.2505936168136361) < 1e-12);
  assert.deepEqual(snapshot, { muted: true, volume: 0.5 });
  assert.deepEqual(configured, { muted: true, volume: overlay.video.volume, gainDb: -6 });
});

test("pauses on the final decoded local frame instead of entering ended", async () => {
  class FakeVideo extends EventTarget {
    constructor() {
      super();
      this.duration = 1;
      this.paused = true;
      this.callbacks = [];
    }

    async play() { this.paused = false; }
    pause() { this.paused = true; }
    requestVideoFrameCallback(callback) {
      this.callbacks.push(callback);
      return this.callbacks.length;
    }
    cancelVideoFrameCallback() {}
    present(mediaTime, presentedFrames) {
      const callback = this.callbacks.shift();
      callback(0, { mediaTime, presentedFrames });
    }
  }

  const overlay = new LocalOverlay({ document: {} });
  const video = new FakeVideo();
  overlay.video = video;
  const playback = overlay.play(new AbortController().signal);

  // Consecutive final frames in a one-second 25 fps fixture, including the
  // browser's required count rather than assuming every callback is a frame.
  video.present(0.92, 24);
  assert.equal(video.paused, false);
  video.present(0.96, 25);

  await playback;
  assert.equal(video.paused, true);
});

class StandbyVideo extends EventTarget {
  constructor() { super(); this.style = {}; this.dataset = {}; this.readyState = 0; this.currentTime = 0; this.seeking = false; this.paused = true; this.muted = false; this.volume = 1; this.parentNode = null; this.src = ""; }
  load() { if (!this.src) return; queueMicrotask(() => { this.readyState = 3; this.dispatchEvent(new Event("canplay")); }); }
  pause() { this.paused = true; }
  removeAttribute(name) { if (name === "src") this.src = ""; }
  remove() { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
}
function standbyHost() { return { children: [], append(node) { node.parentNode?.children.splice(node.parentNode.children.indexOf(node), 1); node.parentNode = this; this.children.push(node); } }; }

test("the next clip loads in a separate decoder and is promoted without reloading", async () => {
  const created = [];
  const overlay = new LocalOverlay({ document: { createElement: () => { const video = new StandbyVideo(); created.push(video); return video; } } });
  await overlay.prepare("blob:a");
  const current = overlay.video;
  await overlay.prepareNext("blob:b");
  assert.equal(overlay.video, current, "the playing decoder is untouched");
  assert.equal(created.length, 2);
  await overlay.prepare("blob:b");
  assert.equal(overlay.video, created[1], "promoted, not a third decoder");
  assert.equal(created.length, 2);
  assert.equal(current.src, "", "the previous decoder is released");
});

test("advance swaps the next clip into the mounted position and keeps the held frame until it presents", async () => {
  const created = [];
  const overlay = new LocalOverlay({ document: { createElement: () => { const video = new StandbyVideo(); created.push(video); return video; } } });
  await overlay.prepare("blob:a");
  const host = standbyHost();
  await overlay.mount(host);
  overlay.video.volume = 0.4; overlay.video.muted = false;
  let heldRemoved = false; overlay.heldFrame = { remove: () => { heldRemoved = true; } };
  let presented; created.length = 0;
  await overlay.prepareNext("blob:b");
  created[0].requestVideoFrameCallback = callback => { presented = callback; return 1; };
  await overlay.advance();
  assert.deepEqual(host.children, [created[0]]);
  assert.equal(overlay.video, created[0]); assert.equal(overlay.video.volume, 0.4); assert.equal(overlay.video.style.display, "block");
  assert.equal(heldRemoved, false, "held last frame still covers until the next frame is presented");
  presented(); assert.equal(heldRemoved, true);
  await assert.rejects(overlay.advance(), /not prepared/);
});

// W7 (0.65.2): a chained join must not hold the last picture or drop to silence.
// The next clip is started under the current one before it ends, no canvas hold is taken, and
// the next clip keeps its own fade-in level when it becomes current. Fails on 0.65.1, where the
// next clip only started from paused after the current one ended.
function chainHost() {
  const host = standbyHost();
  host.insertBefore = (node, before) => {
    node.parentNode?.children.splice(node.parentNode.children.indexOf(node), 1);
    node.parentNode = host; host.children.splice(host.children.indexOf(before), 0, node);
  };
  return host;
}
async function chainedOverlay() {
  const canvases = [];
  const overlay = new LocalOverlay({ document: { visibilityState: "visible", createElement: tag => {
    if (tag === "canvas") { canvases.push(tag); return { style: {}, getContext: () => ({ drawImage() {} }) }; }
    return new StandbyVideo();
  } } });
  await overlay.prepare("blob:a");
  const host = chainHost();
  await overlay.mount(host);
  const current = overlay.video; current.style.display = "block";
  Object.assign(current, { duration: 1, currentTime: 0.7, volume: 0.4, muted: false, videoWidth: 4, videoHeight: 4 });
  current.play = async () => { current.paused = false; };
  let frame = null; current.requestVideoFrameCallback = callback => { frame = callback; return 1; };
  current.cancelVideoFrameCallback = () => {};
  await overlay.prepareNext("blob:b");
  const next = overlay.standby.video;
  let nextStartedAt = null;
  next.play = async () => { next.paused = false; nextStartedAt ??= performance.now(); };
  return { overlay, host, current, next, canvases, presentFinal: () => frame(0, { mediaTime: 0.99, presentedFrames: 30 }), nextStartedAt: () => nextStartedAt };
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("a chained clip starts the next one underneath before it ends, with no held frame and no silence (W7)", async () => {
  const { overlay, host, current, next, canvases, presentFinal, nextStartedAt } = await chainedOverlay();
  const startedAt = performance.now();
  const playback = overlay.play(new AbortController().signal, { profileClass: "mvp", chainNext: true });
  await wait(240);
  assert.notEqual(nextStartedAt(), null, "the next clip is already playing before the current one ends");
  assert.ok(nextStartedAt() - startedAt < 300, "started ahead of the clip's end by its start-up latency");
  assert.deepEqual(host.children, [next, current], "mounted under the current clip, which stays on top");
  assert.equal(next.style.display, "block");
  assert.ok(next.volume < 0.4, "its audio fades in across the join");
  await wait(120);
  assert.ok(Math.abs(next.volume - 0.4) < 1e-9, "at the viewer's level by the join, so there is no silent gap");
  presentFinal();
  assert.equal(canvases.length, 0, "no canvas hold of the last frame");
  assert.equal(current.paused, false);
  current.dispatchEvent(new Event("ended"));
  const result = await playback;
  assert.equal(result.frameHoldMode, "chain-handover");
  assert.equal(current.style.display, "none", "the ended clip is hidden; the next one shows at once");
  await overlay.advance();
  assert.equal(overlay.video, next);
  assert.equal(next.paused, false, "the next clip was never stopped");
  assert.ok(Math.abs(next.volume - 0.4) < 1e-9);
  assert.deepEqual(host.children, [next]);
  overlay.forceTeardown();
});

test("stopping a chained clip also stops the next clip it started (W7)", async () => {
  const { overlay, next } = await chainedOverlay();
  const playback = overlay.play(new AbortController().signal, { profileClass: "mvp", chainNext: true });
  playback.catch(() => {});
  await wait(240);
  assert.equal(next.paused, false);
  await overlay.stop();
  assert.equal(next.paused, true);
  assert.equal(next.src, "", "released, so its audio cannot keep playing");
  assert.equal(overlay.standby, null);
  overlay.forceTeardown();
});

test("a viewer pause near the end of a chained clip puts the next clip back on its first frame (W7)", async () => {
  const { overlay, next, current } = await chainedOverlay();
  const playback = overlay.play(new AbortController().signal, { profileClass: "mvp", chainNext: true });
  playback.catch(() => {});
  await wait(240);
  assert.equal(next.paused, false);
  next.currentTime = 0.05;
  overlay.playControl.pause();
  assert.equal(next.paused, true);
  assert.equal(next.currentTime, 0);
  assert.equal(overlay.standby.prerolled, null);
  assert.equal(current.paused, true);
  overlay.forceTeardown();
});

// 0.65.6: a K pause with ~333 ms left, then resume: the next clip started
// 200.8 ms ahead (not ~150) because the end time was read on 'playing', before the resumed
// clip's clock moved, and the join skipped 4 frames with one black capture sample.
function frameQueue(video) {
  const callbacks = [];
  video.requestVideoFrameCallback = callback => { callbacks.push(callback); return callbacks.length; };
  return (mediaTime, presentedFrames) => { video.currentTime = mediaTime; for (const callback of callbacks.splice(0)) callback(0, { mediaTime, presentedFrames }); };
}
test("after a resume near the end, the next clip is timed from the resumed clip's first new frame, not 'playing' (0.65.6)", async () => {
  const { overlay, current, nextStartedAt } = await chainedOverlay();
  const present = frameQueue(current);
  current.currentTime = 0.5;
  const playback = overlay.play(new AbortController().signal, { profileClass: "mvp", chainNext: true });
  playback.catch(() => {});
  await wait(10);
  overlay.playControl.pause();
  current.currentTime = 0.7; // paused with 300 ms left
  overlay.playControl.resume();
  await wait(0);
  current.dispatchEvent(new Event("playing"));
  await wait(60);
  assert.ok(!overlay.standby.prerolled, "no ending notice while the clock has not moved");
  present(0.7, 21);
  assert.ok(!overlay.standby.prerolled, "the paused frame presented again is not a new one");
  present(0.75, 22);
  assert.notEqual(overlay.standby.prerolled, null, "the first new frame gives the ending notice");
  await wait(60);
  assert.equal(nextStartedAt(), null, "started its lead before the end, measured from the moving clock");
  await wait(80);
  assert.notEqual(nextStartedAt(), null);
  overlay.forceTeardown();
});

test("a resume whose clip presents no new frame still gives the ending notice after a bounded wait (0.65.6)", async () => {
  const { overlay, current } = await chainedOverlay();
  frameQueue(current);
  current.currentTime = 0.5;
  const playback = overlay.play(new AbortController().signal, { profileClass: "mvp", chainNext: true });
  playback.catch(() => {});
  await wait(10);
  overlay.playControl.pause(); current.currentTime = 0.7; overlay.playControl.resume();
  await wait(0);
  current.dispatchEvent(new Event("playing"));
  await wait(300);
  assert.notEqual(overlay.standby.prerolled, null);
  overlay.forceTeardown();
});

test("a pre-roll withdrawn before the next clip started is neither seeked nor re-inserted (0.65.6)", async () => {
  const { overlay, host, current, next } = await chainedOverlay();
  const present = frameQueue(current);
  Object.defineProperty(next, "nextSibling", { get() { const c = host.children; const i = c.indexOf(next); return i < 0 ? null : c[i + 1] ?? null; } });
  let seeks = 0, time = 0; Object.defineProperty(next, "currentTime", { get: () => time, set: value => { seeks += 1; time = value; } });
  const insert = host.insertBefore; let inserts = 0; host.insertBefore = (...args) => { inserts += 1; return insert(...args); };
  const playback = overlay.play(new AbortController().signal, { profileClass: "mvp", chainNext: true });
  playback.catch(() => {});
  await wait(20);
  assert.equal(inserts, 1); assert.notEqual(overlay.standby.prerolled, null);
  overlay.playControl.pause();
  assert.equal(overlay.standby.prerolled, null);
  assert.equal(seeks, 0, "its play timer never fired: still on its first frame, no seek");
  assert.equal(next.paused, true);
  overlay.playControl.resume();
  await wait(0);
  current.dispatchEvent(new Event("playing"));
  present(0.75, 22);
  assert.notEqual(overlay.standby.prerolled, null, "pre-rolled afresh");
  assert.equal(inserts, 1, "left in place under the current clip");
  assert.deepEqual(host.children, [next, current]);
  overlay.forceTeardown();
});

// 0.65.3: 0.65.2 showed 1-3 black capture samples at every natural chained join:
// the current clip was hidden on 'ended' and advance() re-appended the playing next element
// before it had presented a frame. And one 10 ms audio bin fell below -50 dBFS.
test("a chained clip stays on screen until the next clip presents a frame, and advance keeps the next element in place (0.65.3)", async () => {
  const { overlay, host, current, next } = await chainedOverlay();
  let nextFrame = null; next.requestVideoFrameCallback = callback => { nextFrame = callback; return 1; };
  const appends = []; const append = host.append; host.append = node => { appends.push(node); append.call(host, node); };
  const playback = overlay.play(new AbortController().signal, { profileClass: "mvp", chainNext: true });
  let result = null; playback.then(value => { result = value; });
  await wait(240);
  assert.equal(typeof nextFrame, "function", "the next clip's first presented frame is watched");
  current.dispatchEvent(new Event("ended"));
  await wait(20);
  assert.equal(current.style.display, "block", "not hidden while the next clip has no picture");
  assert.equal(result, null, "the clip's play waits for the handover");
  nextFrame(0, { mediaTime: 0.0417, presentedFrames: 3 });
  await wait(0);
  assert.equal(current.style.display, "none");
  assert.equal(result.chain.revealPresentedFrames, 3, "the next clip's presentedFrames at the reveal (0.65.6)");
  assert.equal(result.frameHoldMode, "chain-handover");
  assert.equal(result.chain.revealVia, "first-frame");
  assert.equal(result.chain.firstFrameMediaMs, 42);
  assert.ok(result.chain.playLeadMs >= 150 && result.chain.playMs < 0, "started at least 150 ms before the end");
  await overlay.advance();
  assert.deepEqual(appends.filter(node => node === next), [], "the playing next element is never re-appended");
  assert.deepEqual(host.children, [next]);
  assert.equal(overlay.video, next);
  overlay.forceTeardown();
});

test("a next clip that never presents is revealed after a bounded wait, not left behind a hidden clip (0.65.3)", async () => {
  const { overlay, current } = await chainedOverlay();
  const playback = overlay.play(new AbortController().signal, { profileClass: "mvp", chainNext: true });
  await wait(240);
  current.dispatchEvent(new Event("ended"));
  const started = performance.now(), result = await playback;
  assert.ok(performance.now() - started < 400);
  assert.equal(result.chain.revealVia, "cap");
  assert.equal(current.style.display, "none");
  overlay.forceTeardown();
});

test("the next clip's fade-in is complete before the current clip's fade-out starts, so the join never goes quiet (0.65.3)", async () => {
  const { overlay, current, next } = await chainedOverlay();
  const startedAt = performance.now();
  const playback = overlay.play(new AbortController().signal, { profileClass: "mvp", chainNext: true });
  playback.catch(() => {});
  await wait(10);
  const fade = overlay.standby.fade, endAt = startedAt + 300;
  assert.ok(fade, "a fade-in is planned");
  const fadeEnd = fade.startAt + fade.durationMs;
  assert.ok(Math.abs(fadeEnd - (endAt - 50)) < 15, `fade-in ends 50 ms before the end (${Math.round(fadeEnd - endAt)})`);
  // The current clip fades out over [end - 60, end - 30] ms (EXIT_CLIP_FADE_MS, EXIT_CLIP_TAIL_MARGIN_MS).
  assert.ok(fadeEnd <= endAt - 50 + 15 && fadeEnd < endAt - 30, "the next clip is at its level before the current one falls silent");
  await wait(300);
  assert.ok(Math.abs(next.volume - 0.4) < 1e-9);
  void current;
  overlay.forceTeardown();
});

class StallingVideo extends EventTarget {
  constructor() { super(); this.duration = 10; this.currentTime = 0; this.readyState = 4; this.paused = true; this.ended = false; }
  async play() { this.paused = false; }
  pause() { this.paused = true; }
  starve() { this.readyState = 2; this.dispatchEvent(new Event("waiting")); }
  feed() { this.readyState = 4; this.dispatchEvent(new Event("playing")); }
}

test("buffering suspends the local deadline and a clip that stops progressing fails as local-stall", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const overlay = new LocalOverlay({ document: {}, now: () => Date.now() });
  const video = new StallingVideo(); overlay.video = video;
  const playback = overlay.play(new AbortController().signal);
  let outcome = null; playback.then(value => { outcome = value; }, error => { outcome = error; });
  t.mock.timers.tick(9_000);
  video.starve(); t.mock.timers.tick(6_000);
  video.feed();
  // 12 s deadline: 9 s used before the stall; the 6 s stall was not counted.
  t.mock.timers.tick(2_900); await Promise.resolve();
  assert.equal(outcome, null, "a buffered clip keeps playing past its wall-clock deadline");
  video.starve(); t.mock.timers.tick(1_999); await Promise.resolve();
  assert.equal(outcome, null, "stall budget has 2 s left");
  t.mock.timers.tick(1); await Promise.resolve(); await Promise.resolve();
  assert.equal(outcome?.code, "local-stall");
  assert.equal(outcome?.message, "private-local-stall");
  assert.equal(video.paused, true);
});

test("a completed clip reports the time it spent buffering", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const overlay = new LocalOverlay({ document: {}, now: () => Date.now() });
  const video = new StallingVideo(); overlay.video = video;
  const playback = overlay.play(new AbortController().signal);
  video.starve(); t.mock.timers.tick(1_500);
  video.dispatchEvent(new Event("timeupdate"));
  assert.equal(video.readyState, 2, "timeupdate while starved is not progress");
  video.feed(); video.currentTime = 10; video.ended = true; video.dispatchEvent(new Event("ended"));
  const result = await playback;
  assert.equal(result.stalledMs, 1_500);
});

test("a viewer's pause holds the clip without failing it; seek and mute act on the playing clip only", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const overlay = new LocalOverlay({ document: {}, now: () => Date.now() });
  const video = new StallingVideo(); video.muted = false; overlay.video = video;
  assert.throws(() => overlay.localPause(), /not playing/);
  const playback = overlay.play(new AbortController().signal);
  let outcome = null; playback.then(value => { outcome = value; }, error => { outcome = error; });
  await Promise.resolve(); assert.equal(video.paused, false);
  t.mock.timers.tick(5_000); overlay.localPause(); assert.equal(video.paused, true);
  video.starve(); t.mock.timers.tick(120_000); await Promise.resolve();
  assert.equal(outcome, null, "two paused minutes neither time out nor count as a stall");
  overlay.localResume(); await Promise.resolve(); await Promise.resolve(); assert.equal(video.paused, false); video.feed();
  video.currentTime = 6; overlay.localSeek(-5_000); assert.equal(video.currentTime, 1);
  overlay.localSeek(30_000); assert.equal(video.currentTime, 9.75, "never past the final-frame guard");
  overlay.localMute(true); assert.equal(video.muted, true);
  // 12 s deadline: 5 s ran before the pause, the seek back granted 5 s more.
  t.mock.timers.tick(11_999); await Promise.resolve(); assert.equal(outcome, null);
  t.mock.timers.tick(1); await Promise.resolve(); await Promise.resolve();
  assert.match(outcome?.message ?? "", /timed out/);
  assert.throws(() => overlay.localResume(), /not playing/);
});
