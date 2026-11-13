import test from 'node:test';
import assert from 'node:assert/strict';
import { installViewerKeys } from '../src/viewer-keys.mjs';

function setup({ controllable = true } = {}) {
  const window = new EventTarget(), document = new EventTarget(), calls = [];
  const engine = { localControllable: controllable, toggleLocalPause: async () => calls.push('toggle'), seekLocal: async ms => calls.push(`seek:${ms}`), toggleLocalMute: async () => calls.push('mute') };
  const native = new EventTarget(); native.paused = false; native.pause = () => { native.paused = true; };
  const controller = new AbortController(), owned = { seeking: false };
  installViewerKeys({ window, document, engine, isNativePlayer: node => node === native, ownsNativePlay: () => owned.seeking, signal: controller.signal });
  const key = (type, init) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { key: init.key, code: init.code ?? init.key, repeat: init.repeat ?? false, ctrlKey: false, metaKey: false, altKey: false, composedPath: () => [init.target ?? null] });
    let stopped = false; const stop = event.stopImmediatePropagation.bind(event); event.stopImmediatePropagation = () => { stopped = true; stop(); };
    window.dispatchEvent(event); return { prevented: event.defaultPrevented, stopped };
  };
  return { engine, calls, key, native, document, controller, owned };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('keys control the playing replacement and are kept from the page', async () => {
  const h = setup();
  for (const [key, code] of [[' ', 'Space'], ['ArrowLeft'], ['ArrowRight'], ['m', 'KeyM']]) {
    const down = h.key('keydown', { key, code }); assert.deepEqual(down, { prevented: true, stopped: true }, key);
    assert.equal(h.key('keyup', { key, code }).stopped, true, 'its keyup is taken too');
  }
  await settle();
  assert.deepEqual(h.calls, ['toggle', 'seek:-5000', 'seek:5000', 'mute']);
  assert.equal(h.key('keydown', { key: 'f' }).prevented, false, 'other keys pass through');
  assert.equal(h.key('keyup', { key: 'f' }).stopped, false);
});

test('keys pass through outside a replacement and in text fields; native play is re-paused only during one', async () => {
  const h = setup({ controllable: false });
  assert.equal(h.key('keydown', { key: ' ', code: 'Space' }).prevented, false);
  const dispatchPlay = () => { h.native.paused = false; const event = new Event('play'); Object.defineProperty(event, 'target', { value: h.native }); h.document.dispatchEvent(event); };
  dispatchPlay(); assert.equal(h.native.paused, false);
  h.engine.localControllable = true;
  dispatchPlay(); assert.equal(h.native.paused, true);
  h.owned.seeking = true; dispatchPlay(); assert.equal(h.native.paused, false, "the engine's own warm-up play during its seek is left alone"); h.owned.seeking = false;
  assert.equal(h.key('keydown', { key: ' ', code: 'Space', target: { tagName: 'INPUT' } }).prevented, false);
  h.controller.abort(); assert.equal(h.key('keydown', { key: ' ', code: 'Space' }).prevented, false, 'removed with the controller');
  await settle(); assert.deepEqual(h.calls, []);
});
