import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectLocalMedia } from '../src/local-asset-validator.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
function harness(t, { readyState = 2, audioBytes = 100, play = null } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const intervals = new Map(), timeouts = new Map(), intervalCallbacks = [], revoked = [];
  const nativeInterval = globalThis.setInterval, nativeClearInterval = globalThis.clearInterval;
  const nativeTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setInterval', (callback, delay) => {
    const id = nativeInterval(callback, delay); intervals.set(id, callback); intervalCallbacks.push(callback); return id;
  });
  t.mock.method(globalThis, 'clearInterval', id => { intervals.delete(id); nativeClearInterval(id); });
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const id = nativeTimeout(callback, delay); timeouts.set(id, callback); return id;
  });
  t.mock.method(globalThis, 'clearTimeout', id => { timeouts.delete(id); nativeClearTimeout(id); });
  class Video extends EventTarget {
    constructor() { super(); this.readyState = readyState; this.currentTime = 0; this.ended = false; this.paused = true;
      this.webkitAudioDecodedByteCount = audioBytes; this.duration = 5; this.videoWidth = 1280; this.videoHeight = 720; this.listeners = new Map(); this.loads = 0; }
    addEventListener(type, callback, options) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); super.addEventListener(type, callback, options); }
    removeEventListener(type, callback, options) { this.listeners.get(type)?.delete(callback); super.removeEventListener(type, callback, options); }
    async play() { this.paused = false; if (play) await play(); }
    pause() { this.paused = true; }
    load() { this.loads++; }
    removeAttribute(name) { delete this[name]; }
  }
  const video = new Video(), abort = new AbortController();
  const inspect = () => inspectLocalMedia(new Blob(['controlled local media']), { signal: abort.signal,
    document: { createElement: () => video }, urlApi: { createObjectURL: () => 'blob:controlled', revokeObjectURL: url => revoked.push(url) } });
  const assertReleased = () => {
    assert.equal(intervals.size, 0); assert.equal(timeouts.size, 0);
    assert.equal([...video.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
    assert.equal(video.paused, true); assert.equal(video.src, undefined); assert.deepEqual(revoked, ['blob:controlled']);
  };
  return { video, abort, inspect, intervals, timeouts, intervalCallbacks, assertReleased };
}

test('local readiness can finish before timeupdate only after native time advances with available video/audio evidence', async t => {
  const h = harness(t); let finished = false;
  const pending = h.inspect().then(value => { finished = true; return value; }); await turn();
  assert.equal(h.intervals.size, 1); h.video.currentTime = 0.019; t.mock.timers.tick(20); await turn(); assert.equal(finished, false);
  h.video.currentTime = 0.02; t.mock.timers.tick(10); const result = await pending;
  assert.equal(result.initialSampleDecoded, true); assert.equal(result.audioPresent, true); assert.equal(result.durationMs, 5000);
  assert.equal(result.width, 1280); assert.equal(result.height, 720); h.assertReleased();
});

test('the fast path does not finish early when audio evidence is unavailable', async t => {
  const h = harness(t, { audioBytes: 0 }); let finished = false;
  const pending = h.inspect().then(value => { finished = true; return value; }); await turn();
  h.video.currentTime = 0.04; t.mock.timers.tick(200); await turn(); assert.equal(finished, false);
  h.video.webkitAudioDecodedByteCount = 100; t.mock.timers.tick(10); assert.equal((await pending).audioPresent, true); h.assertReleased();
});

test('existing timeupdate fallback reports missing audio instead of silently accepting it', async t => {
  const h = harness(t, { audioBytes: 0 }), pending = h.inspect(); await turn();
  h.video.currentTime = 0.03; h.video.dispatchEvent(new Event('timeupdate'));
  assert.equal((await pending).audioPresent, false); h.assertReleased();
});

test('unknown audio evidence retains the existing event fallback and null result', async t => {
  const h = harness(t); delete h.video.webkitAudioDecodedByteCount;
  const pending = h.inspect(); await turn(); h.video.currentTime = 0.03; t.mock.timers.tick(50); await turn();
  assert.equal(h.intervals.size, 1); h.video.dispatchEvent(new Event('timeupdate'));
  assert.equal((await pending).audioPresent, null); h.assertReleased();
});

test('the fast path waits through a readyState regression', async t => {
  const h = harness(t); let finished = false;
  const pending = h.inspect().then(value => { finished = true; return value; }); await turn();
  h.video.currentTime = 0.03; h.video.readyState = 1; t.mock.timers.tick(50); await turn(); assert.equal(finished, false);
  h.video.readyState = 2; t.mock.timers.tick(10); await pending; h.assertReleased();
});

test('abort stops the readiness poll, releases media and makes queued poll callbacks inert', async t => {
  const h = harness(t), pending = h.inspect(), rejected = assert.rejects(pending, { name: 'AbortError' }); await turn();
  const late = h.intervalCallbacks[0]; h.abort.abort(); await rejected; h.assertReleased();
  Object.defineProperty(h.video, 'currentTime', { get() { throw Error('Disposed decoder must not be sampled'); } });
  late(); t.mock.timers.tick(6000); h.assertReleased();
});

test('readiness timeout stays at five seconds and releases its timer, interval and media', async t => {
  const h = harness(t), pending = h.inspect(), rejected = assert.rejects(pending, { code: 'decode-timeout' }); await turn();
  t.mock.timers.tick(5000); await rejected; h.assertReleased();
});

test('native media error settles readiness and prevents any later poll success', async t => {
  const h = harness(t), pending = h.inspect(), rejected = assert.rejects(pending, { code: 'decode-failed' }); await turn();
  h.video.dispatchEvent(new Event('error')); await rejected;
  h.video.currentTime = 1; h.intervalCallbacks[0](); h.assertReleased();
});

test('metadata/data waits do not allocate a readiness poll before initial data is available', async t => {
  const h = harness(t, { readyState: 0 }), pending = h.inspect(); await turn(); assert.equal(h.intervals.size, 0);
  h.video.readyState = 1; h.video.dispatchEvent(new Event('loadedmetadata')); await turn(); assert.equal(h.intervals.size, 0);
  h.video.readyState = 2; h.video.dispatchEvent(new Event('loadeddata')); await turn(); assert.equal(h.intervals.size, 1);
  h.video.currentTime = 0.03; t.mock.timers.tick(10); await pending; h.assertReleased();
});

test('failed play never allocates a readiness poll and still releases the selected media', async t => {
  const h = harness(t, { play: async () => { throw Error('controlled play rejection'); } });
  await assert.rejects(h.inspect(), { code: 'initial-decode-failed' });
  assert.equal(h.intervalCallbacks.length, 0); h.assertReleased();
});
