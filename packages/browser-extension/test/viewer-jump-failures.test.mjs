import test from 'node:test';
import assert from 'node:assert/strict';
import { connectViewerController, controllerFailureCode, failureCause } from '../src/viewer-client.mjs';
import { viewerFailureMessage } from '../src/viewer-model.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';

// Field testing of 0.61.0: scene jumps failed with "The edit could not be turned on…", the text
// for viewer-action-failed, because every controller failure that was not on a short list,
// including "the player is busy", collapsed to that code.
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(v) { for (const fn of this.listeners) fn(v); } });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function controller(execute) {
  const sent = [], port = { onMessage: event(), onDisconnect: event(), postMessage: m => sent.push(m), disconnect() {} };
  const handle = connectViewerController({ runtime: { connect: () => port }, read: async () => ({ state: 'armed' }), execute });
  const send = (method, args = {}) => { const id = crypto.randomUUID(); port.onMessage.emit({ id, method, args, build: EXECUTING_BUILD }); return id; };
  const reply = id => sent.find(m => m.id === id);
  return { send, reply, close: () => handle.close() };
}

test('a jump that arrives while another command runs waits for it instead of failing', async () => {
  let finishRecheck;
  const ran = [];
  const c = controller(method => { ran.push(method); return method === 'recheck' ? new Promise(r => { finishRecheck = r; }) : { jumped: true }; });
  try {
    const recheck = c.send('recheck'); await flush();
    const jump = c.send('jump-scene', { which: 'next' }); await flush();
    assert.equal(c.reply(jump), undefined, 'the jump waits');
    finishRecheck({}); await flush();
    assert.equal(c.reply(recheck).ok, true);
    assert.deepEqual(c.reply(jump).value, { jumped: true });
    assert.deepEqual(ran, ['recheck', 'jump-scene']);
  } finally { c.close(); }
});

test('a command still running after the wait reports the busy player, not a turn-on failure', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const c = controller(method => method === 'arm' ? new Promise(() => {}) : {});
  try {
    c.send('arm'); await flush();
    const jump = c.send('jump-scene', { which: 'next' }); await flush();
    t.mock.timers.tick(4000); await flush();
    assert.equal(c.reply(jump).code, 'viewer-controller-busy');
    assert.equal(viewerFailureMessage('viewer-controller-busy'), 'The player is busy. Try again in a moment.');
  } finally { c.close(); }
});

test('a failed jump has its own message, and the cause is kept as a safe token', async () => {
  const c = controller(method => { throw method === 'jump-scene' ? Error('seek-warmup-timeout') : new DOMException('Edit changed during navigation', 'AbortError'); });
  try {
    const jump = c.send('jump-scene', { which: 2 }), arm = c.send('arm'); await flush();
    assert.deepEqual([c.reply(jump).code, c.reply(jump).cause], ['viewer-jump-failed', 'seek-warmup-timeout']);
    assert.deepEqual([c.reply(arm).code, c.reply(arm).cause], ['viewer-arm-failed', 'Edit-changed-during-navigation'], 'a failed arm says so; its words survive as a token');
    assert.match(viewerFailureMessage('viewer-jump-failed'), /did not reach that scene/);
    assert.doesNotMatch(viewerFailureMessage('viewer-jump-failed'), /turned on|account/);
  } finally { c.close(); }
  for (const code of ['viewer-controller-busy', 'viewer-source-changed', 'viewer-scene-unavailable', 'viewer-not-ready'])
    assert.equal(controllerFailureCode('jump-scene', Error(code)), code);
  assert.equal(failureCause(Error('https://example.com/a?b')), 'Error');
  assert.equal(failureCause({}), 'unknown');
});
