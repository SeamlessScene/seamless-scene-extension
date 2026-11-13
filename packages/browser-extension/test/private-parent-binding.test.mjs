import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { registerLocalPlaybackRelay } from '../src/local-playback-protocol.mjs';
import { registerCatalogRuntimeService } from '../src/catalog-runtime-service.mjs';
import { PrivateLocalOverlay } from '../src/private-local-overlay.mjs';
import { bindingMessage, PRIVATE_PARENT_BINDING, sendParentBinding, receivedParentBinding } from '../src/private-frame-binding.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop', extensionOrigin = `chrome-extension://${extensionId}`;
const parentOrigin = 'https://www.amazon.com', session = crypto.randomUUID();
const turn = () => new Promise(resolve => setImmediate(resolve));
function relay() {
  let connect, onMessage;
  const runtime = { id: extensionId, getManifest: () => ({ version: EXECUTING_BUILD.version }),
    onConnect: { addListener: fn => { connect = fn; } }, onMessage: { addListener: fn => { onMessage = fn; } } };
  const authority = registerLocalPlaybackRelay(runtime);
  const port = (role, changes = {}) => {
    const p = { name: `scene-local-v1:${role}:${session}`, sender: { id: extensionId, tab: { id: 4, url: `${parentOrigin}/video` },
      frameId: role === 'controller' ? 0 : 2, documentId: crypto.randomUUID(), documentLifecycle: 'active',
      origin: role === 'controller' ? parentOrigin : extensionOrigin,
      url: role === 'controller' ? `${parentOrigin}/video` : `${extensionOrigin}/local-playback-frame.html#${session}`, ...changes }, messages: [],
      onMessage: { addListener: fn => { p.receive = fn; } }, onDisconnect: { addListener: fn => { p.closed = fn; } },
      postMessage: value => p.messages.push(value), disconnect() { if (p.disconnected) return; p.disconnected = true; p.closed?.(); } };
    connect(p); return p;
  };
  const controller = port('controller'), renderer = port('renderer');
  const hello = () => { for (const p of [controller, renderer]) p.receive({ type: 'hello', build: EXECUTING_BUILD }); };
  const bind = () => renderer.receive({ type: 'frame-bound', challenge: controller.messages[0].challenge });
  const catalog = (options = { authorizeRenderer: authority.authorizeRenderer }) => {
    registerCatalogRuntimeService(runtime, { trustedKeys: {}, revokedVersionsByEdit: {} }, options);
    return (sender = renderer.sender) => new Promise(resolve => onMessage({ kind: 'catalog-v2', method: 'policy', requestId: crypto.randomUUID(), build: EXECUTING_BUILD }, sender, resolve));
  };
  return { authority, controller, renderer, port, hello, bind, catalog };
}

test('two build hellos disclose proof only to the controller and do not authorize renderer RPC', () => {
  const h = relay();
  try {
    h.hello(); assert.equal(h.controller.messages[0].type, 'bind-frame');
    assert.equal(h.renderer.messages.length, 0); assert.equal(h.authority.authorizeRenderer(h.renderer.sender), false);
    h.bind(); assert.equal(h.renderer.messages[0].type, 'ready'); assert.equal(h.authority.authorizeRenderer(h.renderer.sender), true);
    assert.equal(h.renderer.messages.some(message => Object.hasOwn(message, 'challenge')), false);
  } finally { h.controller.disconnect(); }
});

test('wrong role, wrong proof, extra fields and commands cannot complete child binding', () => {
  for (const variant of ['controller', 'wrong-proof', 'extra', 'command']) {
    const h = relay(); h.hello();
    const message = variant === 'command' ? { type: 'command', id: 1, command: 'stop' } :
      { type: 'frame-bound', challenge: variant === 'wrong-proof' ? crypto.randomUUID() : h.controller.messages[0].challenge, ...(variant === 'extra' ? { extra: true } : {}) };
    (variant === 'controller' || variant === 'command' ? h.controller : h.renderer).receive(message);
    assert.equal(h.controller.disconnected, true); assert.equal(h.renderer.disconnected, true);
    assert.equal(h.authority.authorizeRenderer(h.renderer.sender), false);
  }
});

test('unbound pairs expire even after both build hellos', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const h = relay(); h.hello();
  t.mock.timers.tick(5001); assert.equal(h.controller.disconnected, true); assert.equal(h.renderer.disconnected, true);
});

test('duplicate renderer cannot obtain the proof or displace an established peer', () => {
  const h = relay();
  try {
    h.hello(); const clone = h.port('renderer'); assert.equal(clone.disconnected, true); assert.equal(clone.messages.length, 0);
    h.bind(); assert.equal(h.authority.authorizeRenderer(h.renderer.sender), true); assert.equal(h.authority.authorizeRenderer(clone.sender), false);
  } finally { h.controller.disconnect(); }
});

test('old proof cannot authorize a replacement pair and a used proof is not a runtime command', () => {
  const old = relay(); old.hello(); const proof = old.controller.messages[0].challenge; old.controller.disconnect();
  const h = relay(); h.hello(); assert.notEqual(h.controller.messages[0].challenge, proof);
  h.renderer.receive({ type: 'frame-bound', challenge: proof }); assert.equal(h.renderer.disconnected, true);
  const ready = relay(); ready.hello(); ready.bind(); ready.bind(); assert.equal(ready.controller.disconnected, true);
});

test('renderer authorization is exact-document/frame/session and is revoked with either peer', () => {
  const h = relay(); h.hello(); h.bind();
  for (const change of [{ documentId: crypto.randomUUID() }, { frameId: 3 }, { documentLifecycle: 'cached' },
    { url: `${extensionOrigin}/local-playback-frame.html#${crypto.randomUUID()}` }, { tab: { id: 9, url: `${parentOrigin}/video` } }]) {
    assert.equal(h.authority.authorizeRenderer({ ...h.renderer.sender, ...change }), false);
  }
  h.renderer.disconnect(); assert.equal(h.authority.authorizeRenderer(h.renderer.sender), false);
});

test('actual catalog service requires bound relay authority and refuses a late success after disconnect', async () => {
  const h = relay(), policy = h.catalog();
  assert.deepEqual(await policy(), { ok: false, code: 'catalog-sender-denied' });
  h.hello(); assert.deepEqual(await policy(), { ok: false, code: 'catalog-sender-denied' });
  h.bind(); assert.equal((await policy()).ok, true);
  const pending = policy(); h.controller.disconnect();
  assert.deepEqual(await pending, { ok: false, code: 'catalog-sender-denied' });
});

test('catalog service without an explicitly supplied live renderer authority fails closed', async () => {
  const h = relay(); h.hello(); h.bind();
  try { assert.deepEqual(await h.catalog({})(), { ok: false, code: 'catalog-sender-denied' }); }
  finally { h.controller.disconnect(); }
});

test('binding envelope is exact and accessors never supply a proof', () => {
  const challenge = crypto.randomUUID(), message = { type: PRIVATE_PARENT_BINDING, challenge }; let reads = 0;
  assert.equal(bindingMessage(message, PRIVATE_PARENT_BINDING), true);
  for (const value of [null, [], { ...message, extra: true }, { ...message, challenge: 'short' },
    { type: PRIVATE_PARENT_BINDING, get challenge() { reads++; return challenge; } }]) assert.equal(bindingMessage(value, PRIVATE_PARENT_BINDING), false);
  assert.equal(reads, 0);
});

function dom() {
  const view = {}; view.top = view;
  const document = { defaultView: view }, sent = [];
  const frame = { isConnected: true, ownerDocument: document, contentWindow: { postMessage: (...args) => sent.push(args) }, style: {}, remove() { this.isConnected = false; } };
  document.createElement = () => frame;
  const home = { isConnected: true, append(node) { node.parentNode = this; node.isConnected = true; } };
  return { document, frame, sent, home };
}
test('controller sends proof only to its connected same-document child at the exact origin', () => {
  const d = dom(), challenge = crypto.randomUUID(); sendParentBinding({ ...d, challenge, targetOrigin: extensionOrigin });
  assert.deepEqual(d.sent, [[{ type: PRIVATE_PARENT_BINDING, challenge }, extensionOrigin]]);
  for (const targetOrigin of ['*', 'null', 'https://attacker.example', 'http://localhost:4173', `${extensionOrigin}/path`]) {
    assert.throws(() => sendParentBinding({ ...d, challenge, targetOrigin }));
  }
  for (const changed of [{ isConnected: false }, { ownerDocument: {} }, { contentWindow: null }]) {
    assert.throws(() => sendParentBinding({ ...d, frame: { ...d.frame, ...changed }, challenge, targetOrigin: extensionOrigin }));
  }
  assert.equal(d.sent.length, 1);
});

test('renderer accepts only a trusted direct-parent delivery with exact approved ancestor origin', () => {
  const parent = {}, window = { parent, top: parent, location: { ancestorOrigins: [parentOrigin] } };
  const event = { isTrusted: true, source: parent, origin: parentOrigin, data: { type: PRIVATE_PARENT_BINDING, challenge: crypto.randomUUID() } };
  assert.equal(receivedParentBinding(event, window, [parentOrigin]), event.data.challenge);
  assert.equal(receivedParentBinding({ ...event, source: null }, window, [parentOrigin]), event.data.challenge);
  for (const change of [{ isTrusted: false }, { origin: 'https://attacker.example' }, { source: {} }, { data: { ...event.data, extra: true } }]) {
    assert.equal(receivedParentBinding({ ...event, ...change }, window, [parentOrigin]), null);
  }
  for (const change of [{ top: {} }, { location: { ancestorOrigins: [parentOrigin, parentOrigin] } }, { location: {} }]) {
    assert.equal(receivedParentBinding(event, { ...window, ...change }, [parentOrigin]), null);
  }
  assert.equal(receivedParentBinding(event, window, ['https://www.primevideo.com']), null);
  window.parent = window; window.top = window; assert.equal(receivedParentBinding(event, window, [parentOrigin]), null);
});

function overlayHarness() {
  const d = dom(), sent = []; let receive, disconnect, disconnects = 0;
  const port = { postMessage: message => sent.push(message), onMessage: { addListener: fn => { receive = fn; } },
    onDisconnect: { addListener: fn => { disconnect = fn; } }, disconnect() { disconnect?.(); } };
  const overlay = new PrivateLocalOverlay({ document: d.document, runtime: { connect: () => port, getURL: path => `${extensionOrigin}/${path}` } });
  overlay.attach(d.home, { onDisconnect: () => { disconnects++; } });
  return { ...d, overlay, sent, receive: message => receive(message), disconnects: () => disconnects };
}
test('actual controller refuses readiness before the owned-child proof was sent', () => {
  const h = overlayHarness(); h.receive({ type: 'ready', build: EXECUTING_BUILD });
  assert.equal(h.overlay.closed, true); assert.equal(h.disconnects(), 1); h.overlay.dispose();
});

test('actual controller binds its child and frame removal cancels pending work before new commands', async () => {
  const h = overlayHarness();
  try {
    h.receive({ type: 'bind-frame', challenge: crypto.randomUUID() }); h.receive({ type: 'ready', build: EXECUTING_BUILD });
    assert.equal(h.overlay.closed, false); assert.equal(h.sent.some(message => message.type === 'frame-bound'), false);
    const pending = h.overlay.request('prepare', ['fixture']), rejected = assert.rejects(pending, { name: 'AbortError' }); await turn();
    h.frame.isConnected = false;
    await assert.rejects(h.overlay.request('stop'), /frame-owner-lost/); await rejected;
    assert.equal(h.sent.some(message => message.command === 'stop'), false); assert.equal(h.disconnects(), 1);
    assert.equal(h.frame.isConnected, false, 'cleanup must not recreate a removed iframe document');
  } finally { h.overlay.dispose(); }
});

test('a repeated binding challenge cannot reuse or redirect a connected controller', () => {
  const h = overlayHarness(), challenge = crypto.randomUUID();
  h.receive({ type: 'bind-frame', challenge }); h.receive({ type: 'ready', build: EXECUTING_BUILD });
  h.receive({ type: 'bind-frame', challenge }); assert.equal(h.overlay.closed, true); assert.equal(h.disconnects(), 1); h.overlay.dispose();
});

test('periodic ownership check disconnects a removed frame without a new request or reinsertion', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = overlayHarness(); h.receive({ type: 'bind-frame', challenge: crypto.randomUUID() }); h.receive({ type: 'ready', build: EXECUTING_BUILD });
  h.frame.isConnected = false; t.mock.timers.tick(2001);
  assert.equal(h.overlay.closed, true); assert.equal(h.disconnects(), 1); assert.equal(h.frame.isConnected, false);
  assert.equal(h.sent.some(message => message.command === 'lease'), false); h.overlay.dispose();
});

function reconnectHarness({ runtimeId = 'ext', callbacks = {} } = {}) {
  const view = {}; view.top = view;
  const document = { defaultView: view }, frames = [], ports = [];
  document.createElement = () => { const frame = { isConnected: false, ownerDocument: document, contentWindow: { postMessage() {} }, style: {}, remove() { this.isConnected = false; this.removed = true; } }; frames.push(frame); return frame; };
  const home = { isConnected: true, append(node) { node.parentNode = this; node.isConnected = true; } };
  const runtime = { id: runtimeId, getURL: path => `${extensionOrigin}/${path}`, connect: ({ name }) => {
    const port = { name, sent: [], postMessage(message) { this.sent.push(message); }, onMessage: { addListener: fn => { port.receive = fn; } },
      onDisconnect: { addListener: fn => { port.drop = fn; } }, disconnect() { this.drop?.(); } };
    ports.push(port); return port;
  } };
  let disconnects = 0;
  const overlay = new PrivateLocalOverlay({ document, runtime });
  overlay.attach(home, { ...callbacks, onDisconnect: () => { disconnects++; } });
  const bind = port => { port.receive({ type: 'bind-frame', challenge: crypto.randomUUID() }); port.receive({ type: 'ready', build: EXECUTING_BUILD }); };
  return { overlay, frames, ports, runtime, home, bind, disconnects: () => disconnects };
}

test('after the relay drops, reconnect pairs a new frame on a new session and requests flow again', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = reconnectHarness(); h.bind(h.ports[0]);
  const firstSession = h.overlay.session;
  const inflight = h.overlay.request('stop'); const rejected = assert.rejects(inflight, { name: 'AbortError' }); await turn();
  h.ports[0].drop(); await rejected;
  assert.equal(h.disconnects(), 1); assert.equal(h.overlay.closed, true);
  const reconnected = h.overlay.reconnect({ firstDelayMs: 100 });
  t.mock.timers.tick(100); await turn();
  assert.equal(h.ports.length, 2); assert.equal(h.frames[0].removed, true, 'the dead frame is removed');
  assert.notEqual(h.overlay.session, firstSession); assert.match(h.ports[1].name, new RegExp(h.overlay.session));
  h.bind(h.ports[1]); await reconnected;
  assert.equal(h.overlay.closed, false); assert.equal(h.disconnects(), 1, 'reconnecting reports no second disconnect');
  const request = h.overlay.request('stop'); await turn();
  const command = h.ports[1].sent.find(message => message.command === 'stop');
  h.ports[1].receive({ type: 'result', id: command.id, ok: true, value: null });
  assert.equal(await request, null);
  h.overlay.dispose();
});

test('reconnect gives up after its attempts, and refuses after an extension update or dispose', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = reconnectHarness(); h.bind(h.ports[0]); h.ports[0].drop();
  const failing = h.overlay.reconnect({ firstDelayMs: 10, attempts: 2 }), failed = assert.rejects(failing, /reconnect-failed/);
  for (let step = 0; step < 4; step += 1) { t.mock.timers.tick(5_000); await turn(); }
  await failed; assert.equal(h.overlay.closed, true); assert.equal(h.disconnects(), 1);
  delete h.runtime.id;
  const updated = assert.rejects(h.overlay.reconnect({ firstDelayMs: 10 }), /extension-updated/); t.mock.timers.tick(10); await updated;
  h.runtime.id = 'ext'; h.overlay.dispose();
  const disposed = assert.rejects(h.overlay.reconnect({ firstDelayMs: 10 }), /disposed/); t.mock.timers.tick(10); await disposed;
});

test('repeated reconnects release delay listeners from the shared controller lifetime', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = reconnectHarness(), lifetime = new AbortController(); t.after(() => h.overlay.dispose());
  h.bind(h.ports[0]);
  for (let cycle = 0; cycle < 8; cycle++) {
    h.ports.at(-1).drop();
    const connected = h.overlay.reconnect({ signal: lifetime.signal, firstDelayMs: 10 });
    assert.equal(getEventListeners(lifetime.signal, 'abort').length, 1);
    t.mock.timers.tick(10); await turn(); h.bind(h.ports.at(-1)); await connected;
    assert.equal(getEventListeners(lifetime.signal, 'abort').length, 0, `completed reconnect ${cycle + 1} retained a delay listener`);
  }
  assert.equal(h.ports.length, 9); assert.equal(h.frames.filter(frame => !frame.removed).length, 1);
});

test('exhausted reconnect attempts release all shared-lifetime delay listeners', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = reconnectHarness(), lifetime = new AbortController(); t.after(() => h.overlay.dispose());
  h.bind(h.ports[0]); h.ports[0].drop();
  const failed = assert.rejects(h.overlay.reconnect({ signal: lifetime.signal, firstDelayMs: 10, attempts: 2 }), /reconnect-failed/);
  for (let step = 0; step < 4; step++) { t.mock.timers.tick(5_000); await turn(); }
  await failed;
  assert.equal(getEventListeners(lifetime.signal, 'abort').length, 0);
});

test('already-aborted reconnect settles before its backoff delay without opening a new frame', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = reconnectHarness(), lifetime = new AbortController(); t.after(() => h.overlay.dispose());
  h.bind(h.ports[0]); h.ports[0].drop(); lifetime.abort();
  let settled = false;
  const failed = assert.rejects(h.overlay.reconnect({ signal: lifetime.signal, firstDelayMs: 1000 }), { name: 'AbortError' }).then(() => { settled = true; });
  await turn(); const settledBeforeDelay = settled;
  // Drain the old behavior too so a failing regression leaves no hanging work.
  t.mock.timers.tick(1000); await failed;
  assert.equal(settledBeforeDelay, true); assert.equal(h.ports.length, 1);
  assert.equal(getEventListeners(lifetime.signal, 'abort').length, 0);
});

test('abort during reconnect backoff cancels the wait without a later new frame', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = reconnectHarness(), lifetime = new AbortController(); t.after(() => h.overlay.dispose());
  h.bind(h.ports[0]); h.ports[0].drop();
  const failed = assert.rejects(h.overlay.reconnect({ signal: lifetime.signal, firstDelayMs: 1000 }), { name: 'AbortError' });
  lifetime.abort(); await failed; t.mock.timers.tick(1000); await turn();
  assert.equal(h.ports.length, 1); assert.equal(h.overlay.reconnecting, false);
  assert.equal(getEventListeners(lifetime.signal, 'abort').length, 0);
});

function deferredImport() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('queued catalog invalidation does not call cleanup after its renderer disconnects', async t => {
  let invalidations = 0;
  const h = reconnectHarness({ callbacks: { onCatalogInvalidated: () => { invalidations++; } } });
  t.after(() => h.overlay.dispose()); h.bind(h.ports[0]);
  h.ports[0].receive({ type: 'catalog-invalidated' }); h.ports[0].drop(); await turn();
  assert.equal(invalidations, 0);
});

test('old catalog invalidation failure cannot reach the replacement renderer status', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const old = deferredImport(), current = deferredImport(); let invalidations = 0, errors = 0;
  const h = reconnectHarness({ callbacks: { onCatalogInvalidated: () => ++invalidations === 1 ? old.promise : current.promise, onError: () => { errors++; } } });
  t.after(() => { current.resolve(); h.overlay.dispose(); }); h.bind(h.ports[0]);
  h.ports[0].receive({ type: 'catalog-invalidated' }); await turn();
  h.ports[0].drop(); const reconnected = h.overlay.reconnect({ firstDelayMs: 10 });
  t.mock.timers.tick(10); await turn(); h.bind(h.ports[1]); await reconnected;
  h.ports[1].receive({ type: 'catalog-invalidated' }); await turn();
  old.reject(Error('old invalidation failed')); await turn(); assert.equal(errors, 0);
  current.reject(Error('current invalidation failed')); await turn(); assert.equal(errors, 1);
});

test('queued catalog invalidation is obsolete when a newer import begins on the same connection', async t => {
  let invalidations = 0;
  const h = reconnectHarness({ callbacks: { onCatalogInvalidated: () => { invalidations++; } } });
  t.after(() => h.overlay.dispose()); h.bind(h.ports[0]);
  h.ports[0].receive({ type: 'catalog-invalidated' }); h.ports[0].receive({ type: 'import-start', importId: 1 }); await turn();
  assert.equal(invalidations, 0);
});

test('catalog invalidation context expires on both import replacement and connection loss', async t => {
  const contexts = [];
  const h = reconnectHarness({ callbacks: { onCatalogInvalidated: context => { contexts.push(context); } } });
  t.after(() => h.overlay.dispose()); h.bind(h.ports[0]);
  h.ports[0].receive({ type: 'catalog-invalidated' }); await turn(); assert.equal(contexts[0].isCurrent(), true);
  h.ports[0].receive({ type: 'import-start', importId: 1 }); await turn(); assert.equal(contexts[0].isCurrent(), false);
  h.ports[0].receive({ type: 'catalog-invalidated' }); await turn(); assert.equal(contexts[1].isCurrent(), true);
  h.ports[0].drop(); assert.equal(contexts[1].isCurrent(), false);
});

test('old renderer import completion cannot acknowledge a reused import ID on the replacement renderer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const old = deferredImport(), current = deferredImport(); let starts = 0;
  const h = reconnectHarness({ callbacks: { onImportStart: () => ++starts === 1 ? old.promise : current.promise } });
  t.after(() => { current.resolve(); h.overlay.dispose(); }); h.bind(h.ports[0]);
  h.ports[0].receive({ type: 'import-start', importId: 1 }); await turn(); assert.equal(starts, 1);
  h.ports[0].drop(); const reconnected = h.overlay.reconnect({ firstDelayMs: 10 });
  t.mock.timers.tick(10); await turn(); h.bind(h.ports[1]); await reconnected;
  h.ports[1].receive({ type: 'import-start', importId: 1 }); await turn(); assert.equal(starts, 2);
  old.resolve(); await turn();
  assert.equal(h.ports[1].sent.filter(m => m.command === 'importReady').length, 0, 'old cleanup acknowledged the new import before its own cleanup finished');
  current.resolve(); await turn();
  const acknowledgements = h.ports[1].sent.filter(m => m.command === 'importReady');
  assert.equal(acknowledgements.length, 1); assert.deepEqual(acknowledgements[0].args, [1]);
  h.ports[1].receive({ type: 'result', id: acknowledgements[0].id, ok: true, value: null }); await turn();
});

test('old renderer import failure cannot replace the new renderer status after its import ID restarts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const old = deferredImport(), current = deferredImport(); let starts = 0, errors = 0;
  const h = reconnectHarness({ callbacks: { onImportStart: () => ++starts === 1 ? old.promise : current.promise, onError: () => { errors++; } } });
  t.after(() => { current.resolve(); h.overlay.dispose(); }); h.bind(h.ports[0]);
  h.ports[0].receive({ type: 'import-start', importId: 1 }); await turn();
  h.ports[0].drop(); const reconnected = h.overlay.reconnect({ firstDelayMs: 10 });
  t.mock.timers.tick(10); await turn(); h.bind(h.ports[1]); await reconnected;
  h.ports[1].receive({ type: 'import-start', importId: 1 }); await turn();
  old.reject(Error('old import cleanup failed')); await turn();
  assert.equal(errors, 0, 'old renderer failure reached the current status callback');
  current.reject(Error('current import cleanup failed')); await turn();
  assert.equal(errors, 1, 'current renderer failures must still be reported');
  assert.equal(h.ports[1].sent.some(m => m.command === 'importReady'), false);
});
