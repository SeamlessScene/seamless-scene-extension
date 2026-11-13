import test from 'node:test';
import assert from 'node:assert/strict';
import { guardFrameSource, FRAME_SOURCE_RESTORES } from '../src/frame-source-guard.mjs';
import { disconnectNotice, disconnectSummary } from '../src/connection-diagnostics.mjs';

// 0.65.5: testing 0.65.4 showed "Reason: relay handshake-timeout" with an empty srcdoc on the renderer's
// iframe, which this extension never sets. A fake iframe and MutationObserver stand in for the page.
const SRC = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/local-playback-frame.html#s';
function fakes() {
  const observers = [];
  class Observer { constructor(cb) { this.cb = cb; this.on = false; observers.push(this); } observe(target, options) { this.target = target; this.options = options; this.on = true; } disconnect() { this.on = false; } }
  const attrs = new Map(), loads = [];
  const frame = {
    hasAttribute: name => attrs.has(name), getAttribute: name => attrs.get(name) ?? null,
    removeAttribute(name) { if (attrs.delete(name) && name === 'srcdoc') loads.push(attrs.get('src')); },
    set src(value) { attrs.set('src', value); loads.push(value); }, get src() { return attrs.get('src'); },
    inject(name, value) { attrs.set(name, value); for (const o of observers) if (o.on) o.cb([{ type: 'attributes', attributeName: name }]); }
  };
  frame.src = SRC; loads.length = 0;
  return { frame, observers, loads, Observer };
}

test('an injected empty srcdoc is removed and the renderer page loads again', () => {
  const { frame, observers, loads, Observer } = fakes();
  const guard = guardFrameSource(frame, SRC, { MutationObserver: Observer });
  assert.deepEqual(observers[0].options, { attributes: true, attributeFilter: ['srcdoc', 'src'] });
  frame.inject('srcdoc', '');
  assert.equal(frame.hasAttribute('srcdoc'), false);
  assert.equal(frame.getAttribute('src'), SRC);
  assert.deepEqual(loads, [SRC], 'removing srcdoc loads src again, once');
  assert.equal(guard.restores, 1);
});

test('a changed src is put back', () => {
  const { frame, Observer } = fakes();
  const guard = guardFrameSource(frame, SRC, { MutationObserver: Observer });
  frame.inject('src', 'about:blank');
  assert.equal(frame.getAttribute('src'), SRC); assert.equal(guard.restores, 1);
});

test('after the limit the guard stops and reports, instead of fighting the page forever', () => {
  const { frame, observers, Observer } = fakes();
  let exhausted = 0;
  const guard = guardFrameSource(frame, SRC, { MutationObserver: Observer, onExhausted: () => exhausted++ });
  for (let i = 0; i < FRAME_SOURCE_RESTORES; i++) frame.inject('srcdoc', '');
  assert.equal(guard.restores, FRAME_SOURCE_RESTORES); assert.equal(exhausted, 0);
  frame.inject('srcdoc', '');
  assert.equal(exhausted, 1); assert.equal(observers[0].on, false);
  assert.equal(frame.getAttribute('srcdoc'), '', 'left as the page set it; the controller closes with a reason');
  frame.inject('srcdoc', 'x'); assert.equal(exhausted, 1, 'reported once');
  // The reason the panel and Copy diagnostics show.
  assert.equal(disconnectSummary(disconnectNotice('controller', 'frame-source-replaced')), 'controller frame-source-replaced');
});

test('an untouched frame is left alone; without MutationObserver only the first check runs; disconnect stops it', () => {
  const { frame, loads, Observer } = fakes();
  const guard = guardFrameSource(frame, SRC, { MutationObserver: Observer });
  assert.equal(guard.restores, 0); assert.deepEqual(loads, []);
  guard.disconnect(); frame.inject('srcdoc', ''); guard.check();
  assert.equal(frame.hasAttribute('srcdoc'), true); assert.equal(guard.restores, 0);
  const other = fakes(); other.frame.inject('srcdoc', '');
  assert.equal(guardFrameSource(other.frame, SRC, { MutationObserver: undefined }).restores, 1);
  assert.equal(other.frame.hasAttribute('srcdoc'), false);
  assert.equal(guardFrameSource({}, SRC, { MutationObserver: Observer }).restores, 0, 'a stand-in without attributes is left alone');
});

test('the overlay guards its own frame before it joins the page', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/private-local-overlay.mjs', import.meta.url), 'utf8');
  const guardAt = source.indexOf('this.frameGuard = guardFrameSource(frame, src'), appendAt = source.indexOf('home.append(frame);');
  assert.ok(guardAt > 0 && guardAt < appendAt, 'observed before append, so an injection right after insertion is seen');
  assert.match(source, /onExhausted: \(\) => \{ if \(this\.frame === frame\) this\.closeWithDiagnostic\('frame-source-replaced'\); \}/);
});
