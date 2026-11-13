import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalOverlay } from '../src/local-overlay.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class Video extends EventTarget {
  constructor() {
    super(); this.dataset = {}; this.style = {}; this.readyState = 3; this.seeking = false;
    this.currentTime = 0; this.duration = 5; this.muted = false; this.volume = .5; this.paused = true;
    this.requests = []; this.listeners = new Set(); this.frames = new Map(); this.nextFrame = 0; this.pauses = 0;
  }
  addEventListener(name, listener, options) { this.listeners.add(listener); super.addEventListener(name, listener, options); }
  removeEventListener(name, listener, options) { this.listeners.delete(listener); super.removeEventListener(name, listener, options); }
  play() { const request = deferred(); this.requests.push(request); return request.promise.then(() => { this.paused = false; }); }
  pause() { this.paused = true; this.pauses++; }
  load() {} removeAttribute() {} remove() { this.removed = true; }
  requestVideoFrameCallback(callback) { const id = ++this.nextFrame; this.frames.set(id, callback); return id; }
  cancelVideoFrameCallback(id) { this.frames.delete(id); }
  frame(time, presentedFrames) { const callbacks = [...this.frames.values()]; this.frames.clear(); this.currentTime = time; for (const callback of callbacks) callback(0, { mediaTime: time, presentedFrames }); }
  end() { this.currentTime = this.duration; this.ended = true; this.paused = true; this.dispatchEvent(new Event('ended')); }
}
function harness() {
  const video = new Video(), overlay = new LocalOverlay({ document: {} }); overlay.video = video; overlay.source = 'blob:cleared';
  return { video, overlay };
}

for (const failure of ['timeout', 'decode-error']) test(`local ${failure} prevents a late play promise from restarting the failed clip`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const { overlay, video } = harness();
  const playing = overlay.play(), rejected = assert.rejects(playing);
  try {
    if (failure === 'timeout') t.mock.timers.tick(7001); else video.dispatchEvent(new Event('error'));
    await rejected; assert.equal(video.listeners.size, 0); assert.equal(video.frames.size, 0);
    video.requests[0].resolve(); await turn(); assert.equal(video.paused, true);
  } finally { await overlay.teardown(); }
});

test('stop immediately cancels the owned playback wait without discarding the selected decoder', async () => {
  const { overlay, video } = harness(), playing = overlay.play(), rejected = assert.rejects(playing, { name: 'AbortError' });
  try {
    await overlay.stop(); assert.equal(video.listeners.size, 0); assert.equal(video.frames.size, 0); await rejected;
    assert.equal(overlay.video, video); assert.equal(overlay.source, 'blob:cleared');
    video.requests[0].resolve(); await turn(); assert.equal(video.paused, true);
  } finally { await overlay.teardown(); await rejected; }
});

test('a newer play supersedes the old wait and an old abort cannot pause the new attempt', async () => {
  const { overlay, video } = harness(), oldAbort = new AbortController();
  const old = overlay.play(oldAbort.signal), rejected = assert.rejects(old, { name: 'AbortError' });
  const current = overlay.play(); current.catch(() => {});
  try {
    // Only the current attempt listens: ended, error, stall, progress and playing (end notice).
    assert.equal(video.listeners.size, 5); await rejected;
    video.requests[1].resolve(); await turn(); const pauses = video.pauses;
    oldAbort.abort(); video.requests[0].resolve(); await turn();
    assert.equal(video.pauses, pauses); assert.equal(video.paused, false);
    video.end(); assert.equal((await current).localEnded, true);
  } finally { await overlay.teardown(); await rejected; }
});

test('superseding warmup restores its temporary mute before the new play begins', async () => {
  const { overlay, video } = harness(), warmup = overlay.primeForPlayback(), rejected = assert.rejects(warmup, { name: 'AbortError' });
  await turn(); assert.equal(video.muted, true);
  const playing = overlay.play(); playing.catch(() => {});
  try {
    assert.equal(video.muted, false); await rejected;
    video.requests[1].resolve(); await turn(); const pauses = video.pauses;
    video.requests[0].resolve(); await turn(); assert.equal(video.pauses, pauses); assert.equal(video.muted, false);
    video.end(); await playing;
  } finally { await overlay.teardown(); await rejected; }
});

test('same-asset prepare cancels playback, rewinds and does not allow late play to revive its paused decoder', async () => {
  const { overlay, video } = harness(), playing = overlay.play(), rejected = assert.rejects(playing, { name: 'AbortError' });
  try {
    video.currentTime = 2; await overlay.prepare('blob:cleared');
    assert.equal(video.listeners.size, 0); await rejected;
    assert.equal(overlay.video, video); assert.equal(video.currentTime, 0);
    video.requests[0].resolve(); await turn(); assert.equal(video.paused, true);
  } finally { await overlay.teardown(); await rejected; }
});

for (const failure of ['play', 'frame-registration']) test(`synchronous ${failure} failure releases playback listeners and timers`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const { overlay, video } = harness();
  if (failure === 'play') video.play = () => { throw Error('fixture play failure'); };
  else video.requestVideoFrameCallback = () => { throw Error('fixture registration failure'); };
  try {
    await assert.rejects(overlay.play(), /fixture/); assert.equal(video.listeners.size, 0); assert.equal(video.frames.size, 0);
    const pauses = video.pauses; t.mock.timers.tick(7001); assert.equal(video.pauses, pauses);
  } finally { await overlay.teardown(); }
});

test('the paused-frame fallback remains paused if its original play promise resolves late', async () => {
  const { overlay, video } = harness(), playing = overlay.play();
  try {
    video.frame(4.99); const receipt = await playing;
    assert.equal(receipt.frameHoldMode, 'paused-frame-fallback'); assert.equal(receipt.unplayedTailMs > 0, true);
    video.requests[0].resolve(); await turn(); assert.equal(video.paused, true);
  } finally { await overlay.teardown(); }
});

test('stop during warmup restores only its temporary mute and retains the selected decoder', async () => {
  const { overlay, video } = harness(), warmup = overlay.primeForPlayback(), rejected = assert.rejects(warmup, { name: 'AbortError' });
  try {
    await turn(); assert.equal(video.muted, true); await overlay.stop(); await rejected;
    assert.equal(video.muted, false); assert.equal(video.volume, .5); assert.equal(overlay.video, video);
    video.requests[0].resolve(); await turn(); assert.equal(video.paused, true); assert.equal(video.muted, false);
  } finally { await overlay.teardown(); await rejected; }
});

test('an already-cancelled play or warmup does not supersede active playback', async () => {
  const { overlay, video } = harness(), playing = overlay.play(), abort = new AbortController(); abort.abort();
  try {
    assert.throws(() => overlay.play(abort.signal), { name: 'AbortError' });
    await assert.rejects(overlay.primeForPlayback(abort.signal), { name: 'AbortError' });
    video.requests[0].resolve(); await turn(); assert.equal(video.paused, false); assert.equal(video.requests.length, 1);
    video.end(); assert.equal((await playing).localEnded, true);
  } finally { await overlay.teardown(); }
});

test('reusing the prepared asset releases the preceding retained image before another playback', async () => {
  const { overlay, video } = harness(); let removed = 0;
  overlay.heldFrame = { remove() { removed++; } }; video.currentTime = 5;
  await overlay.prepare('blob:cleared');
  assert.equal(removed, 1); assert.equal(overlay.heldFrame, null); assert.equal(video.currentTime, 0); assert.equal(video.paused, true);
  await overlay.teardown();
});

for (const fps of [24, 30, 60]) test(`sparse ${fps} fps callbacks do not turn their delivery gap into a multi-frame end guard`, async () => {
  const { overlay, video } = harness(), total = fps * video.duration;
  let captured = 0; overlay.holdDecodedFrame = () => { captured++; return true; };
  const playing = overlay.play(); playing.catch(() => {});
  try {
    video.requests[0].resolve(); await turn();
    video.frame((total - fps - 2) / fps, total - fps - 1);
    video.frame((total - 2) / fps, total - 1);
    assert.equal(captured, 0, 'two frame durations remain; do not freeze early');
    assert.equal(video.paused, false);
    video.frame((total - 1) / fps, total);
    assert.equal(captured, 1);
    video.end(); const receipt = await playing;
    assert.equal(receipt.frameHoldMode, 'local-canvas-audio-to-ended');
    assert.equal(receipt.heldFrameMediaTimeMs, (total - 1) / fps * 1000);
    assert.equal(receipt.unplayedTailMs, 0);
  } finally { video.end(); await playing; await overlay.teardown(); }
});

for (const counter of [undefined, NaN, 0, 118, 118.5]) test(`invalid or nonadvancing presented count ${String(counter)} cannot widen the local frame guard`, async () => {
  const { overlay, video } = harness(); let captured = 0;
  overlay.holdDecodedFrame = () => { captured++; return true; };
  const playing = overlay.play(); playing.catch(() => {});
  try {
    video.frame(3.9, 118); video.frame(4.9, counter);
    assert.equal(captured, 0); video.end(); const receipt = await playing;
    assert.equal(receipt.frameHoldMode, 'natural-end');
    assert.equal(receipt.heldFrameMediaTimeMs, null);
  } finally { video.end(); await playing; await overlay.teardown(); }
});

test('natural ended without a final-frame callback remains explicitly unguarded', async () => {
  const { overlay, video } = harness(); let captured = 0;
  overlay.holdDecodedFrame = () => { captured++; return true; };
  const playing = overlay.play(); playing.catch(() => {});
  try {
    video.frame(3.9, 118); video.frame(4.9, 148); video.end();
    const receipt = await playing;
    assert.equal(captured, 0); assert.equal(receipt.frameHoldMode, 'natural-end');
    assert.equal(receipt.heldFrameMediaTimeMs, null); assert.equal(receipt.localEnded, true);
    assert.equal(video.frames.size, 0); assert.equal(video.listeners.size, 0);
  } finally { video.end(); await playing; await overlay.teardown(); }
});

for (const phase of ['play-pending', 'frame-pending', 'stationary-frame']) test(`warmup cancellation releases its frame observer during ${phase}`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { overlay, video } = harness();
  let settled = false;
  const warmup = overlay.primeForPlayback();
  const rejected = assert.rejects(warmup, { name: 'AbortError' }).then(() => { settled = true; });
  try {
    await turn();
    if (phase !== 'play-pending') { video.requests[0].resolve(); await turn(); }
    if (phase === 'stationary-frame') video.frame(0, 1);
    assert.equal(video.frames.size, 1);
    await overlay.stop(); await turn();
    assert.equal(video.frames.size, 0, 'stop owns and cancels the latest frame callback');
    assert.equal(settled, true, 'abort settles without waiting for the 400 ms measurement timeout');
    assert.equal(video.muted, false);
  } finally { t.mock.timers.tick(4001); video.requests[0]?.resolve(); await rejected; await overlay.teardown(); }
});

test('warmup frame timeout releases an unobserved callback and cannot rearm it later', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { overlay, video } = harness();
  const warmup = overlay.primeForPlayback();
  try {
    await turn(); video.requests[0].resolve(); await turn();
    const late = [...video.frames.values()][0];
    t.mock.timers.tick(401); await warmup;
    assert.equal(video.frames.size, 0);
    late(0, { mediaTime: 0, presentedFrames: 1 });
    assert.equal(video.frames.size, 0, 'a late stationary callback does not resubscribe');
    assert.equal(overlay.startLatencyMs, null);
    assert.equal(video.paused, true); assert.equal(video.muted, false);
  } finally { await overlay.teardown(); }
});

test('failed warmup play releases its frame observer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { overlay, video } = harness();
  const warmup = overlay.primeForPlayback();
  const rejected = assert.rejects(warmup, /fixture decode failure/);
  try {
    await turn(); video.requests[0].reject(Error('fixture decode failure')); await rejected;
    assert.equal(video.frames.size, 0);
    assert.equal(video.muted, false);
  } finally { t.mock.timers.tick(4001); await overlay.teardown(); }
});

for (const phase of ['initial', 'stationary']) test(`warmup ${phase} frame registration failure is owned and leaves no observer`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { overlay, video } = harness();
  const register = video.requestVideoFrameCallback.bind(video);
  let calls = 0;
  video.requestVideoFrameCallback = callback => {
    if (++calls === (phase === 'initial' ? 1 : 2)) throw Error('fixture frame registration failure');
    return register(callback);
  };
  const warmup = overlay.primeForPlayback();
  const rejected = assert.rejects(warmup, /fixture frame registration failure/);
  try {
    await turn(); video.requests[0].resolve(); await turn();
    if (phase === 'stationary') video.frame(0, 1);
    await rejected;
    assert.equal(video.frames.size, 0); assert.equal(video.muted, false);
    assert.equal(overlay.startLatencyMs, null);
  } finally { t.mock.timers.tick(4001); await overlay.teardown(); }
});

test('successful warmup ignores the paused frame, measures motion and releases its observer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { overlay, video } = harness();
  const warmup = overlay.primeForPlayback();
  try {
    await turn(); video.requests[0].resolve(); await turn();
    video.frame(0, 1); assert.equal(video.frames.size, 1);
    video.frame(.04, 2); await warmup;
    assert.equal(video.frames.size, 0);
    assert.equal(Number.isFinite(overlay.startLatencyMs), true);
    assert.equal(video.currentTime, 0); assert.equal(video.paused, true); assert.equal(video.muted, false);
  } finally { await overlay.teardown(); }
});
