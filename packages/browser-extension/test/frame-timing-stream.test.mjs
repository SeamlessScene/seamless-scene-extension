import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameTimingStream } from '../src/frame-timing-stream.mjs';

function harness(options = {}) {
  let now = 1000, player, generation = 0, mode = 'video', heldMediaTime = null;
  const animations = new Map(), timers = new Map(); let next = 0;
  const window = { requestAnimationFrame(fn) { animations.set(++next, fn); return next; }, cancelAnimationFrame(id) { animations.delete(id); } };
  const video = () => {
    const frames = [], listeners = new Map();
    return { frames, paused: false, seeking: false, ended: false, cancelled: [], requestVideoFrameCallback(fn) { frames.push(fn); return frames.length; },
      cancelVideoFrameCallback(id) { this.cancelled.push(id); },
      addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); },
      emit(type) { listeners.get(type)?.(); } };
  };
  player = video();
  const stream = createFrameTimingStream({ window, getPlayer: () => player, getGeneration: () => generation,
    getPresentation: () => ({ mode, heldMediaTime }), clock: () => now, timeOrigin: 0, ...options,
    ...(options.timerHeartbeat ? { heartbeatTimer: {
      setInterval(fn) { timers.set(++next, fn); return next; }, clearInterval(id) { timers.delete(id); }
    } } : {}) });
  return { stream, video, get player() { return player; }, set player(p) { player = p; },
    bump() { generation++; }, present(m, held = null) { mode = m; heldMediaTime = held; stream.sample(); },
    tick(at) { now = at; const callbacks = [...animations.values()]; animations.clear(); callbacks.forEach(fn => fn(at)); },
    timer(at) { now = at; [...timers.values()].forEach(fn => fn()); },
    get timers() { return [...timers.values()]; },
    frame(at, mediaTime, presentedFrames) { player.frames.shift()(at, { mediaTime, expectedDisplayTime: at, presentedFrames }); } };
}

test('renderer timer observes staged decoder while animation callbacks are absent, without inventing frames', () => {
  const h = harness({ timerHeartbeat: true }); h.stream.setEnabled(true);
  h.timer(1000); h.timer(1050); h.timer(1100);
  h.tick(1125); h.frame(1130, .04, 1); h.timer(1150);
  assert.deepEqual(h.stream.snapshot().spans, [[1000, 1150]]);
  assert.equal(h.stream.snapshot().frames.length, 1);
});

test('renderer timer suspension remains a gap and stale timer cannot join recorder lifetimes', () => {
  const h = harness({ timerHeartbeat: true }); h.stream.setEnabled(true);
  h.timer(1000); h.timer(1050); h.timer(1400);
  assert.deepEqual(h.stream.snapshot().spans, [[1000, 1050], [1400, 1400]]);
  const stale = h.timers[0]; h.stream.setEnabled(false);
  assert.equal(h.timers.length, 0); h.timer(1500);
  h.stream.setEnabled(true); stale();
  assert.deepEqual(h.stream.snapshot().spans, [[1000, 1050], [1400, 1400]]);
  h.timer(1600);
  assert.deepEqual(h.stream.snapshot().spans.at(-1), [1600, 1600]);
});

test('a late callback from an old player cannot contaminate its replacement', () => {
  const h = harness(); h.stream.setEnabled(true); h.tick(1000);
  const old = h.player, stale = old.frames.shift();
  h.player = h.video(); h.tick(1016);
  stale(1020, { mediaTime: 99 }); h.frame(1020, 1, 1);
  const log = h.stream.snapshot();
  assert.deepEqual(log.frames.map(f => f[1]), [1]);
  assert.equal(log.frames[0][2], log.states.at(-1)[1]); assert.ok(old.cancelled.length);
});

test('source reload and decoder generation each invalidate pending callbacks on the same element', () => {
  const h = harness(); h.stream.setEnabled(true); h.tick(1000);
  const first = h.player.frames.shift(); h.player.emit('loadstart');
  const second = h.player.frames.shift(); h.bump(); h.tick(1016);
  first(1010, { mediaTime: 90 }); second(1020, { mediaTime: 91 }); h.frame(1030, 2, 1);
  assert.deepEqual(h.stream.snapshot().frames.map(f => f[1]), [2]);
  assert.equal(new Set(h.stream.snapshot().states.map(s => s[1])).size, 3);
});

test('disable/re-enable cannot resurrect callbacks and records independent observation spans', () => {
  const h = harness(); h.stream.setEnabled(true); h.tick(1000); h.tick(1016);
  const stale = h.player.frames.shift(); h.stream.setEnabled(false); h.tick(2000);
  h.stream.setEnabled(true); h.tick(2016); stale(2020, { mediaTime: 99 }); h.frame(2020, 3, 1);
  assert.deepEqual(h.stream.snapshot().spans, [[1000, 1016], [2016, 2016]]);
  assert.deepEqual(h.stream.snapshot().frames.map(f => f[1]), [3]);
});

test('heartbeat suspension, dropped callbacks and bounded retention are explicit', () => {
  const h = harness({ maximumFrames: 2 }); h.stream.setEnabled(true); h.tick(1000);
  h.frame(1000, 0, 1); h.tick(1040); h.frame(1040, .04, 2);
  h.tick(1400); h.frame(1400, .4, 11);
  const log = h.stream.snapshot();
  assert.deepEqual(log.spans, [[1000, 1040], [1400, 1400]]);
  assert.deepEqual(log.losses, [[1040, 1400, 8]]); assert.equal(log.dropped.frames, 1);
});

test('presentation records held canvas media time and hidden decoders without inventing frame callbacks', () => {
  const h = harness(); h.stream.setEnabled(true); h.tick(1000);
  h.present('held', 4.9); h.tick(1016); h.present('hidden');
  const log = h.stream.snapshot();
  assert.deepEqual(log.states.map(s => s.slice(2)), [['video', null], ['held', 4.9], ['hidden', null]]);
  assert.equal(log.frames.length, 0);
});

test('pause and seek changes between heartbeats retain source ownership and stop on disable', () => {
  const h = harness(); h.stream.setEnabled(true); h.tick(1000);
  const old = h.player;
  old.paused = true; old.emit('pause'); old.seeking = true; old.emit('seeking');
  old.seeking = false; old.emit('seeked'); old.paused = false; old.emit('play');
  assert.deepEqual(h.stream.snapshot().playback.map(row => row.slice(2)), [
    [false, false, false], [true, false, false], [true, true, false], [true, false, false], [false, false, false]
  ]);
  h.player = h.video(); h.tick(1016); const count = h.stream.snapshot().playback.length;
  old.paused = true; old.emit('pause'); assert.equal(h.stream.snapshot().playback.length, count);
  h.stream.setEnabled(false); h.player.paused = true; h.player.emit('pause');
  assert.equal(h.stream.snapshot().playback.length, count);
});

test('missing transport properties and retention losses are explicit', () => {
  const h = harness({ maximumStates: 2 }); delete h.player.paused;
  h.stream.setEnabled(true); h.tick(1000);
  assert.equal(h.stream.snapshot().playback[0][2], null);
  h.player.paused = true; h.player.emit('pause');
  h.player.paused = false; h.player.emit('play');
  assert.equal(h.stream.snapshot().dropped.playback, 1);
  h.stream.clear(); assert.equal(h.stream.snapshot().dropped.playback, 0);
});
