import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class Target {
  listeners = new Map();
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name) { return Promise.all([...(this.listeners.get(name) ?? [])].map(fn => fn())); }
  count(name) { return this.listeners.get(name)?.size ?? 0; }
}
async function harness(onRestore = () => {}) {
  const nodes = new Map(['#status', '#results', '#run', '#reverse', '#stop'].map(id => [id, new Target()]));
  class Player extends Target {
    currentTime = 0; muted = true; paused = true;
    requestVideoFrameCallback() { return 1; }
    pause() { this.paused = true; }
  }
  const player = new Player(); nodes.set('#native', player);
  const document = Object.assign(new Target(), { visibilityState: 'visible', focused: true,
    hasFocus() { return this.focused; }, querySelector(id) { return nodes.get(id); } });
  const window = new Target(), timers = new Map(), intervals = new Map(), animations = new Map();
  let nextId = 0, now = 0, restoreCalls = 0, rawRecord;
  class Commands { async play() { player.paused = false; } }
  class Adapter {
    overlayHost = null;
    async snapshot() { return { paused: false, muted: true }; }
    async pause() { player.paused = true; }
    async setMuted(value) { player.muted = value; }
    async mountOverlayHost() { this.overlayHost = { isConnected: true }; }
    async seek(ms) { player.currentTime = ms / 1000; }
    async restore() {
      await onRestore({ document, window, call: ++restoreCalls });
      this.overlayHost = null; player.paused = false;
      return { presentation: 'presented', errorMs: 20 };
    }
    async forceSafeNativeState() { this.overlayHost = null; }
    teardownOverlayHost() { this.overlayHost = null; }
  }
  const code = (await readFile(new URL('../../fixtures/native-frame-cadence-test.mjs', import.meta.url), 'utf8')).replace(/^import .+;\r?\n/gm, '');
  vm.runInNewContext(code, {
    document, window, StandardMediaCommandAdapter: Commands, StandardTransitionAdapter: Adapter,
    EXECUTING_BUILD: { version: 'test', id: null }, performance: { now: () => now++ }, AbortController, DOMException,
    JSON: { stringify(value, ...args) { rawRecord = value; return JSON.stringify(value, ...args); } },
    setTimeout(fn, ms) {
      const id = ++nextId; timers.set(id, fn);
      if (ms === 5000) queueMicrotask(() => { if (timers.delete(id)) fn(); });
      return id;
    }, clearTimeout: id => timers.delete(id),
    setInterval(fn) { const id = ++nextId; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id),
    requestAnimationFrame(fn) { const id = ++nextId; animations.set(id, fn); return id; }, cancelAnimationFrame: id => animations.delete(id),
    addEventListener: window.addEventListener.bind(window)
  });
  return { nodes, document, window, player, timers, intervals, animations,
    get rawRecord() { return rawRecord; },
    async run() { await nodes.get('#run').emit('click'); return JSON.parse(nodes.get('#results').textContent); } };
}
test('actual cadence fixture retains failed coverage, pre-restore state and failure state', async () => {
  const h = await harness(({ document, window }) => {
    document.focused = false; void window.emit('blur'); document.visibilityState = 'hidden'; void document.emit('visibilitychange');
    throw Error('Timed out waiting for a presented native frame');
  });
  const result = await h.run();
  assert.equal(result.completed, false); assert.equal(result.timingWithin250Ms, false);
  assert.equal(result.cases.length, 0); assert.equal(result.pendingCase.status, 'failed');
  assert.equal(result.pendingCase.covered, false);
  assert.equal(result.pendingCase.beforeResume.visibility, 'visible');
  assert.equal(result.pendingCase.beforeResume.focused, true);
  assert.equal(result.failureStateBeforeFixtureCleanup.visibility, 'hidden');
  assert.equal(result.failureStateBeforeFixtureCleanup.focused, false);
  assert.ok(result.pendingCase.visibilityEvents.some(item => item.cause === 'blur'));
  assert.ok(result.pendingCase.visibilityEvents.some(item => item.cause === 'visibilitychange' && item.visibility === 'hidden'));
  assert.equal(result.pendingCase.phases.at(-1).visibilityAtFinish.visibility, 'hidden');
  assert.equal(result.nativePaused, true); assert.equal(result.overlayRemoved, true);
  assert.equal(h.document.count('visibilitychange'), 0); assert.equal(h.window.count('focus'), 0); assert.equal(h.window.count('blur'), 0);
  assert.equal(h.intervals.size + h.animations.size + h.timers.size, 0);
});
test('actual cadence fixture bounds visibility evidence and ignores disposed event callbacks', async () => {
  let late;
  const h = await harness(({ window }) => {
    late = [...window.listeners.get('focus')][0];
    for (let i = 0; i < 300; i++) void window.emit('focus');
    throw Error('Timed out waiting for a presented native frame');
  });
  const result = await h.run();
  assert.equal(result.pendingCase.visibilityEvents.length, 128);
  assert.ok(result.pendingCase.droppedVisibilityEvents >= 175);
  const output = h.nodes.get('#results').textContent;
  const events = JSON.stringify(h.rawRecord.pendingCase.visibilityEvents); late();
  assert.equal(h.nodes.get('#results').textContent, output);
  assert.equal(JSON.stringify(h.rawRecord.pendingCase.visibilityEvents), events);
  assert.equal(h.window.count('focus'), 0);
});
test('actual cadence fixture publishes complete cases without leaving a pending case or observers', async () => {
  const h = await harness(); const result = await h.run();
  assert.equal(result.completed, true); assert.equal(result.timingWithin250Ms, true);
  assert.equal(result.pendingCase, undefined); assert.equal(result.cases.length, 4);
  assert.ok(result.cases.every(item => item.status === 'complete' && item.visibilityEvents.length >= 4));
  assert.equal(h.document.count('visibilitychange') + h.window.count('focus') + h.window.count('blur'), 0);
  assert.equal(h.intervals.size + h.animations.size + h.timers.size, 0);
});
