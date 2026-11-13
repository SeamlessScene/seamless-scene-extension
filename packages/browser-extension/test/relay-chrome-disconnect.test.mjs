import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerLocalPlaybackRelay } from '../src/local-playback-protocol.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';

// Field testing 2026-09-24 (uat3-diag): relay:ready-timeout, then relay:session-limit
// on retries. In Chrome, Port.disconnect() does NOT fire onDisconnect on the port
// that called it, so a pair the relay closes itself must be cleaned up there too.
// These ports follow Chrome's semantics (the older mocks fire their own onDisconnect).
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
function relay() {
  let connect;
  registerLocalPlaybackRelay({ id: extensionId, onConnect: { addListener: fn => { connect = fn; } } });
  return (role, tab, session) => {
    const p = { name: `scene-local-v1:${role}:${session}`, sender: { id: extensionId, tab: { id: tab, url: 'https://www.amazon.com/video' }, frameId: role === 'renderer' ? 2 : 0,
      origin: role === 'renderer' ? `chrome-extension://${extensionId}` : 'https://www.amazon.com', documentId: crypto.randomUUID(), documentLifecycle: 'active',
      url: role === 'renderer' ? `chrome-extension://${extensionId}/local-playback-frame.html#${session}` : 'https://www.amazon.com/video' },
      onMessage: { addListener: fn => { p.receive = fn; } }, onDisconnect: { addListener() {} },
      postMessage() {}, disconnect() { p.disconnected = true; } };
    connect(p); return p;
  };
}

test('a controller whose renderer never arrives is timed out and its session freed for a retry', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const port = relay();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = port('controller', 7, crypto.randomUUID());
      assert.notEqual(controller.disconnected, true, `attempt ${attempt} admitted`);
      controller.receive({ type: 'hello', build: EXECUTING_BUILD });
      mock.timers.tick(5001);
      assert.equal(controller.disconnected, true, `attempt ${attempt} timed out`);
    }
  } finally { mock.timers.reset(); }
});

test('a pair the relay drops for an invalid first message frees its session', () => {
  const port = relay();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = port('controller', 8, crypto.randomUUID());
    assert.notEqual(controller.disconnected, true, `attempt ${attempt} admitted`);
    controller.receive({ type: 'not-hello' });
    assert.equal(controller.disconnected, true);
  }
});
