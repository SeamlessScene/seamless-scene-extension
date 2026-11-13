import { startPlaybackFrame } from '../playback-frame-app.mjs';
import { startCatalogControlPolling } from '../src/catalog-control-updates.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LOCAL_LIMITS, validLocalMessage, validLocalResult } from '../src/local-message-schema.mjs';
import { registerLocalPlaybackRelay } from '../src/local-playback-protocol.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';
import { sameExecutingBuild } from '../src/build-identity.mjs';
import { PrivateLocalOverlay } from '../src/private-local-overlay.mjs';
import { LocalOverlay } from '../src/local-overlay.mjs';
import { OperationContext, boundedOperation, assertActive } from '../src/operation-context.mjs';
import { receivedParentBinding, PRIVATE_PARENT_BINDING } from '../src/private-frame-binding.mjs';
import { disconnectNotice } from '../src/connection-diagnostics.mjs';

const command = (name, args = [], id = 1) => ({ type: 'command', command: name, args, id });
const result = (value, id = 1) => ({ type: 'result', id, ok: true, value });
const hash = 'a'.repeat(64), turn = () => new Promise(resolve => setImmediate(resolve));
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';

test('every private command has a finite argument contract', () => {
  for (const [name, args] of [['prepare', ['fixture']], ['prepare', ['asset:' + hash]], ['configureAudio', [{ muted: false, volume: .3 }, -12]],
    ['play', [{ profileClass: 'catalog-v2' }]], ['play', [{}]], ['abort', [1]], ['importReady', [1]],
    ...['mount', 'primeForPlayback', 'show', 'stop', 'teardown', 'clear', 'lease'].map(name => [name, []])]) assert.equal(validLocalMessage(command(name, args), 'controller'), true, name);
  for (const message of [command('prepare', ['https://example.com/video']), command('play', [{ profileClass: 'unlimited' }]), command('play', [{ token: 'private' }]),
    command('configureAudio', [{ muted: false, volume: 2 }, 0]), command('configureAudio', [{ muted: 'false', volume: .2 }, 0]),
    command('configureAudio', [{ muted: false, volume: .2 }, 7]), command('abort', [0]), command('mount', ['private-path']), { ...command('stop'), hidden: 'private' }, command('stop', [], 1.5)]) {
    assert.equal(validLocalMessage(message, 'controller'), false, JSON.stringify(message));
  }
});

test('channel refuses binary objects, getters, cycles, deep objects, nonfinite numbers and non-ASCII byte overflow', () => {
  const cycle = {}; cycle.self = cycle;
  let calls = 0; const getter = { get secret() { calls++; return 'private'; } };
  let nested = {}; for (let i = 0; i < 30; i++) nested = { next: nested };
  for (const value of [new Uint8Array(3), new Blob(['private']), new ArrayBuffer(3), cycle, getter, nested, NaN, Infinity, { arbitrary: '😀'.repeat(300000) }]) {
    assert.equal(validLocalMessage(result(value), 'renderer'), false);
  }
  assert.equal(calls, 0);
});

test('results must match the exact outstanding command and cannot carry paths or unmeasured receipts', () => {
  assert.equal(validLocalResult(result({ readyState: 3 }), 'prepare'), true);
  assert.equal(validLocalResult(result(null), 'clear'), true);
  assert.equal(validLocalResult(result({ muted: false, volume: .2, gainDb: 0 }), 'configureAudio'), true);
  const receipt = { durationMs: 120000, localTimeAtEndMs: 120000, unplayedTailMs: 0, frameHoldMode: 'natural-end', heldFrameMediaTimeMs: null, localEnded: true };
  assert.equal(validLocalResult(result(receipt), 'play'), true);
  assert.equal(validLocalResult(result({ ...receipt, stalledMs: 1500 }), 'play'), true);
  for (const stalledMs of [0, 8001, 1.5, '10']) assert.equal(validLocalResult(result({ ...receipt, stalledMs }), 'play'), false);
  assert.equal(validLocalMessage({ type: 'result', id: 1, ok: false, error: 'private-local-stall' }, 'renderer'), true);
  const command = (name, args) => validLocalMessage({ type: 'command', id: 1, command: name, ...(args ? { args } : {}) }, 'controller');
  for (const [name, args] of [['localPause'], ['localResume'], ['localSeek', [-5000]], ['localSeek', [5000]], ['localMute', [true]]]) assert.equal(command(name, args), true, name);
  for (const [name, args] of [['localPause', [1]], ['localSeek', [0]], ['localSeek', [30001]], ['localSeek', [1.5]], ['localSeek', []], ['localMute', ['yes']]]) assert.equal(command(name, args), false, `${name} ${JSON.stringify(args)}`);
  for (const [value, name] of [[{ readyState: 2 }, 'prepare'], [{ readyState: 3 }, 'stop'], [null, 'play'], [{ ...receipt, durationMs: null }, 'play'],
    [{ ...receipt, privatePath: 'C:/private.mp4' }, 'play'], [{ unknown: 'anything' }, 'clear']]) assert.equal(validLocalResult(result(value), name), false);
  assert.equal(validLocalMessage({ type: 'result', id: 1, ok: false, error: 'C:/private.mp4' }, 'renderer'), false);
});

test('private packet messages require the existing schema and hash-only aliases, retaining 1000-segment support', async () => {
  const packet = JSON.parse(await readFile(new URL('../media/edit-packet.json', import.meta.url)));
  packet.purpose = 'local-user-edit'; packet.manifest.status = 'local-only'; packet.manifest.signature = null; packet.manifest.rights.classification = 'user-supplied';
  const template = packet.manifest.segments.find(value => value.action === 'REPLACE');
  packet.manifest.segments = Array.from({ length: 1000 }, (_, index) => ({ ...structuredClone(template), segment_id: `segment-${index}`, trigger_time_ms: index * 10000, resume_time_ms: index * 10000 + 5000 }));
  packet.manifest.source.expected_runtime_ms = 10000000;
  packet.manifest.feature_flags.skip_enabled = false; packet.manifest.feature_flags.mute_enabled = false;
  packet.asset_bindings.forEach(binding => { binding.relative_path = `${binding.sha256}.mp4`; });
  assert.equal(validLocalMessage({ type: 'packet', packet }, 'renderer'), true);
  packet.asset_bindings[0].relative_path = 'private-name.mp4'; assert.equal(validLocalMessage({ type: 'packet', packet }, 'renderer'), false);
});

function relay() {
  let connect;
  registerLocalPlaybackRelay({ id: extensionId, onConnect: { addListener: fn => { connect = fn; } } });
  function port(role, tab = 1, session = crypto.randomUUID()) {
    const p = { name: `scene-local-v1:${role}:${session}`, sender: { id: extensionId, tab: { id: tab, url: 'https://www.amazon.com/video' }, frameId: role === 'renderer' ? 2 : 0,
      origin: role === 'renderer' ? `chrome-extension://${extensionId}` : 'https://www.amazon.com', documentId: crypto.randomUUID(), documentLifecycle: 'active',
      url: role === 'renderer' ? `chrome-extension://${extensionId}/local-playback-frame.html#${session}` : 'https://www.amazon.com/video' }, messages: [],
      onMessage: { addListener: fn => { p.receive = fn; } }, onDisconnect: { addListener: fn => { p.closed = fn; } },
      postMessage: message => p.messages.push(message), disconnect() { if (p.disconnected) return; p.disconnected = true; p.closed?.(); } };
    connect(p); return p;
  }
  function pair() { const session = crypto.randomUUID(), controller = port('controller', 1, session), renderer = port('renderer', 1, session);
    for (const p of [controller, renderer]) p.receive({ type: 'hello', build: EXECUTING_BUILD });
    renderer.receive({ type: 'frame-bound', challenge: controller.messages[0].challenge }); return { controller, renderer }; }
  return { port, pair };
}

test('relay forwards a renderer lease request once paired, and refuses it during the handshake', () => {
  const { controller, renderer } = relay().pair();
  renderer.receive({ type: 'lease-request' });
  assert.deepEqual(controller.messages.at(-1), { type: 'lease-request' }); assert.equal(controller.disconnected, undefined);
  controller.receive(command('lease', [], 1)); assert.equal(renderer.messages.at(-1).command, 'lease');
  const r = relay(), session = crypto.randomUUID(), early = r.port('renderer', 1, session); r.port('controller', 1, session);
  early.receive({ type: 'hello', build: EXECUTING_BUILD }); early.receive({ type: 'lease-request' });
  assert.equal(early.disconnected, true);
});

test('relay budgets sessions globally and per tab without removing an established pair', () => {
  const r = relay(), all = [];
  try {
    all.push(r.port('renderer', 1), r.port('renderer', 1)); const third = r.port('renderer', 1); assert.equal(third.disconnected, true);
    for (let index = 2; index <= 31; index++) all.push(r.port('renderer', index));
    assert.equal(all.length, LOCAL_LIMITS.sessions); assert.equal(r.port('renderer', 99).disconnected, true); assert.ok(all.every(port => !port.disconnected));
  } finally { all.forEach(port => port.disconnect()); }
});

test('relay bounds pending requests, reserves cleanup capacity and rejects a reply with the wrong shape', () => {
  const { controller, renderer } = relay().pair();
  for (let id = 1; id <= 8; id++) controller.receive(command('prepare', ['fixture'], id));
  controller.receive(command('teardown', [], 9)); assert.equal(renderer.messages.at(-1).command, 'teardown');
  renderer.receive(result(null, 9)); assert.equal(controller.disconnected, undefined);
  renderer.receive(result({ readyState: 3, path: 'private' }, 1)); assert.equal(controller.disconnected, true); assert.equal(renderer.disconnected, true);
  const next = relay().pair(); for (let id = 1; id <= 9; id++) next.controller.receive(command('prepare', ['fixture'], id));
  assert.equal(next.controller.disconnected, true);
});

test('relay drops cancelled late results, refuses replayed commands, and expires unanswered work', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controller, renderer } = relay().pair();
  controller.receive(command('prepare', ['fixture'], 1)); controller.receive(command('abort', [1], 2));
  renderer.receive(result({ readyState: 3 }, 1)); assert.equal(controller.messages.length, 2);
  controller.receive(command('prepare', ['fixture'], 3)); t.mock.timers.tick(15001); assert.equal(renderer.disconnected, true);
  const next = relay().pair(); next.controller.receive(command('lease', [], 1)); next.controller.receive(command('lease', [], 1)); assert.equal(next.controller.disconnected, true);
});

function controllerHarness(callbacks = {}, clocks = {}, { ready = true } = {}) {
  let receive, disconnect;
  const sent = [], port = { onMessage: { addListener: fn => { receive = fn; } }, onDisconnect: { addListener: fn => { disconnect = fn; } },
    postMessage(message) { sent.push(message); if (message.command === 'teardown') queueMicrotask(() => receive(result(null, message.id))); }, disconnect() { disconnect?.(); } };
  const home = { isConnected: true, append(node) { node.isConnected = true; node.parentNode = this; }, moveBefore(node) { node.parentNode = this; } };
  const view = {}; view.top = view;
  const document = { defaultView: view, createElement: () => ({ ownerDocument: document, contentWindow: { postMessage() {} }, style: {}, remove() {} }) };
  const overlay = new PrivateLocalOverlay({ runtime: { connect: ({name}={}) => name==='viewer-renderer-v1'?{onMessage:{addListener(){}},onDisconnect:{addListener(){}},postMessage(){}}:port, getURL: value => 'chrome-extension://' + extensionId + '/' + value }, document, ...clocks });
  overlay.attach(home, callbacks); receive({ type: 'bind-frame', challenge: crypto.randomUUID() }); if (ready) receive({ type: 'ready', build: EXECUTING_BUILD });
  return { overlay, receive, sent, home, port };
}

test('controller answers a renderer lease request at once, with the ordinary checked lease command', () => {
  const h=controllerHarness();
  try {
    const before=h.overlay.sequence;
    h.receive({type:'lease-request'});
    const leases=h.sent.filter(m=>m.command==='lease');
    assert.equal(leases.length,1);assert.equal(leases[0].id,before+1);assert.equal(validLocalMessage(leases[0],'controller'),true);
    assert.equal(h.sent.some(m=>m.command==='clockSample'),false,'a requested lease does not refresh the clock mapping');
    assert.equal(h.overlay.closed,false);
    h.receive({type:'lease-request',extra:true});assert.equal(h.overlay.closed,true,'malformed requests close the connection');
  }finally{h.overlay.dispose();}
});

test('a lease request cannot renew a controller that lost its frame or is not yet paired', () => {
  const lost=controllerHarness();
  try {
    lost.overlay.frame.isConnected=false;
    lost.receive({type:'lease-request'});
    assert.equal(lost.sent.some(m=>m.command==='lease'),false);assert.equal(lost.overlay.closed,true);
    assert.equal(lost.overlay.diagnostics().events.at(-1).reason,'frame-owner-lost');
  }finally{lost.overlay.dispose();}
  const early=controllerHarness({}, {}, {ready:false});
  try {
    early.receive({type:'lease-request'});
    assert.equal(early.sent.some(m=>m.command==='lease'),false);assert.equal(early.overlay.closed,true);
  }finally{early.overlay.dispose();}
});

test('controller retains reason across reset without treating a notice as a successful disconnect', async () => {
  let time=100;const h=controllerHarness({}, {now:()=>time});
  try {
    h.receive(disconnectNotice('renderer','lease-expired',{leaseAgeMs:8000,visibility:'hidden'}));
    assert.equal(h.overlay.closed,false);assert.equal(h.overlay.diagnostics().events.length,0);
    time=120;h.port.disconnect();
    const report=h.overlay.diagnostics();assert.equal(report.state,'disconnected');assert.equal(report.events.length,1);
    assert.equal(report.events[0].reason,'lease-expired');assert.equal(report.events[0].leaseAgeMs,8000);
    h.port.disconnect();assert.equal(h.overlay.diagnostics().events.length,1,'duplicate close cannot duplicate the event');
    h.overlay.resetConnection();assert.equal(h.overlay.diagnostics().events.length,1);assert.equal(h.overlay.disconnectReason,null);
  }finally{h.overlay.dispose();}
});

test('malformed notices close the controller and diagnostic recorder failure never prevents cancellation', async () => {
  const h=controllerHarness();
  try {
    const pending=h.overlay.request('prepare',['fixture']);const rejected=assert.rejects(pending,{name:'AbortError'});await turn();
    h.overlay.connectionDiagnostics.record=()=>{throw Error('diagnostic failure');};
    h.receive({...disconnectNotice('renderer','lease-expired'),path:'private'});
    await rejected;assert.equal(h.overlay.closed,true);assert.equal(h.overlay.pending.size,0);
  }finally{h.overlay.dispose();}
});

test('a notice from an obsolete port cannot change or close the successor connection', () => {
  const h=controllerHarness();
  try {
    h.overlay.port={};h.receive(disconnectNotice('renderer','lease-expired',{leaseAgeMs:8000}));
    assert.equal(h.overlay.disconnectReason,null);assert.equal(h.overlay.closed,false);
    h.receive({type:'disconnect-notice',reason:'malformed'});assert.equal(h.overlay.closed,false);
  }finally{h.overlay.port=h.port;h.overlay.dispose();}
});

test('relay closes even when the diagnostic notice cannot be delivered', () => {
  const pair=relay().pair();
  try {
    pair.controller.postMessage=()=>{throw Error('port gone');};
    pair.controller.receive(command('unknown',[],1));
    assert.equal(pair.controller.disconnected,true);assert.equal(pair.renderer.disconnected,true);
  }finally{pair.controller.disconnect();pair.renderer.disconnect();}
});

test('relay forwards renderer notices but independently identifies its own deadline and rejects source spoofing', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const first=relay().pair();
  try {
    const notice=disconnectNotice('renderer','lease-expired',{leaseAgeMs:8000});first.renderer.receive(notice);
    assert.deepEqual(first.controller.messages.at(-1),notice);assert(!first.controller.disconnected);
    first.controller.receive(command('prepare',['fixture'],1));t.mock.timers.tick(15001);
    assert.equal(first.controller.messages.at(-1).component,'relay');assert.equal(first.controller.messages.at(-1).reason,'request-timeout');
    assert.equal(first.controller.disconnected,true);
  }finally{first.controller.disconnect();first.renderer.disconnect();}
  const second=relay().pair();
  try {second.renderer.receive(disconnectNotice('relay','request-timeout'));
    assert.equal(second.controller.messages.at(-1).reason,'message-rejected');assert.equal(second.renderer.disconnected,true);
  }finally{second.controller.disconnect();second.renderer.disconnect();}
});

test('controller bounds its pending map, reserves cleanup, and rejects all work on explicit disposal', async () => {
  const h = controllerHarness(), pending = [];
  try {
    for (let index = 0; index < 8; index++) pending.push(h.overlay.request('prepare', ['fixture']).catch(error => error));
    await turn(); assert.equal(h.overlay.pending.size, 8);
    await assert.rejects(h.overlay.request('prepare', ['fixture']), /budget/);
    await h.overlay.request('teardown'); assert.equal(h.overlay.pending.size, 8);
    assert.throws(() => h.overlay.attach(h.home), /already-attached/);
    h.overlay.dispose(); const errors = await Promise.all(pending); assert.ok(errors.every(error => error.name === 'AbortError'));
    assert.equal(h.overlay.pending.size, 0); await assert.rejects(h.overlay.request('stop'), /disconnected/);
  } finally { h.overlay.dispose(); }
});

for (const alreadyClosed of [false, true]) test(`disposal releases local state when an invalidated port throws (closed=${alreadyClosed})`, async () => {
  const h = controllerHarness();
  let removed = 0, disconnectCalls = 0;
  h.overlay.frame.remove = () => { removed++; };
  const pending = h.overlay.request('prepare', ['fixture']).catch(error => error);
  await turn();
  if (alreadyClosed) h.overlay.disconnectCleanup();
  h.port.disconnect = () => { disconnectCalls++; throw Error('Extension context invalidated.'); };
  try {
    assert.doesNotThrow(() => h.overlay.dispose());
    assert.equal((await pending).name, 'AbortError');
    assert.equal(h.overlay.pending.size, 0);
    assert.equal(h.overlay.closed, true);
    assert.equal(h.overlay.disposed, true);
    assert.equal(h.overlay.connectedBuild, null);
    assert.equal(removed, 1);
    assert.equal(disconnectCalls, alreadyClosed ? 0 : 1);
    assert.doesNotThrow(() => h.overlay.dispose());
    assert.equal(disconnectCalls, alreadyClosed ? 0 : 1);
  } finally { h.port.disconnect = () => {}; h.overlay.dispose(); }
});

test('disposal removes the renderer even when a disconnect observer throws', () => {
  const h = controllerHarness({ onDisconnect() { throw Error('observer failed'); } });
  let removed = false;
  h.overlay.frame.remove = () => { removed = true; };
  try {
    assert.doesNotThrow(() => h.overlay.dispose());
    assert.equal(removed, true);
    assert.equal(h.overlay.closed, true);
  } finally { h.overlay.dispose(); }
});

test('private clock probe contract is exact and accepts only bounded timestamps', () => {
  assert.equal(validLocalMessage(command('clockSample'), 'controller'), true);
  assert.equal(validLocalMessage(command('clockSample', [1]), 'controller'), false);
  assert.equal(validLocalMessage(command('prerollAt', [null]), 'controller'), true);
  assert.equal(validLocalMessage(command('prerollAt', [1.8e12,1.8e12-100]), 'controller'), true);
  assert.equal(validLocalMessage(command('prerollAt', [1.8e12]), 'controller'), false);
  assert.equal(validLocalMessage({type:'local-ending',endAtMs:1.8e12+400,sentEpochMs:1.8e12,sentMonotonicMs:100},'renderer'),true);
  assert.equal(validLocalMessage({type:'local-ending',endAtMs:1.8e12+400},'renderer'),false);
  assert.equal(validLocalMessage({type:'local-ending',endAtMs:null},'renderer'),true);
  const stamp={epochMs:1.8e12,monotonicMs:100};
  assert.equal(validLocalResult(result(stamp), 'clockSample'), true);
  for(const value of [null, {...stamp,extra:1}, {...stamp,epochMs:NaN}, {...stamp,monotonicMs:-1}, {...stamp,epochMs:100}]) assert.equal(validLocalResult(result(value),'clockSample'),false);
});

test('controller calibrates both deadline directions and refuses stale predictions', async () => {
  const epoch=1.8e12, offset=-1356;let now=epoch;const endings=[];
  const h=controllerHarness({}, {clock:()=>now,now:()=>now-epoch});
  h.overlay.onLocalEnding=value=>endings.push(value);
  try {
    const refresh=h.overlay.refreshClock();assert.equal(h.overlay.refreshClock(),refresh,'only one refresh may run');
    for(let i=0;i<2;i++) {
      await turn();const message=h.sent.at(-1);assert.equal(message.command,'clockSample');
      const sent=now;now+=4;h.receive(result({epochMs:sent+2+offset,monotonicMs:sent-epoch+2},message.id));
    }
    assert.equal(await refresh,true);
    const preroll=h.overlay.prerollAt(now+400);await turn();const message=h.sent.at(-1);
    assert.deepEqual(message.args,[now+400+offset,epoch+offset]);h.receive(result(null,message.id));await preroll;
    h.receive({type:'local-ending',endAtMs:now+400+offset,sentEpochMs:now+offset,sentMonotonicMs:now-epoch});assert.equal(endings.at(-1),now+400);
    h.receive({type:'local-ending',endAtMs:now+500+offset,sentEpochMs:now+100+offset,sentMonotonicMs:now-epoch});assert.equal(endings.at(-1),null,'changed renderer origin cannot use previous calibration');
    now+=6000;h.receive({type:'local-ending',endAtMs:now+400+offset,sentEpochMs:now+offset,sentMonotonicMs:now-epoch});assert.equal(endings.at(-1),null);
    const stale=h.overlay.prerollAt(now+400);await turn();const cancel=h.sent.at(-1);
    assert.deepEqual(cancel.args,[null]);h.receive(result(null,cancel.id));await stale;
  } finally { h.overlay.dispose(); }
});

test('a slow or timed-out refresh keeps a fresh calibration and does not withdraw pre-roll', async () => {
  const epoch=1.8e12;let now=epoch;const endings=[];
  const h=controllerHarness({}, {clock:()=>now,now:()=>now-epoch});
  h.overlay.onLocalEnding=value=>endings.push(value);
  const probe=async(rtt)=>{await turn();const message=h.sent.at(-1);assert.equal(message.command,'clockSample');
    const sent=now;now+=rtt;h.receive(result({epochMs:sent+rtt/2,monotonicMs:sent-epoch+rtt/2},message.id));};
  try {
    let refresh=h.overlay.refreshClock();await probe(4);await probe(4);assert.equal(await refresh,true);
    const before=h.sent.length;now+=1000;
    refresh=h.overlay.refreshClock();await probe(40);await probe(40);assert.equal(await refresh,false);
    assert.ok(h.overlay.clockDomain.current(),'slow probes leave the fresh mapping in place');
    assert.equal(h.sent.slice(before).some(m=>m.command==='prerollAt'),false,'no pre-roll withdrawal while calibration is fresh');
    assert.equal(endings.includes(null),false);
    assert.equal(h.overlay.clockDomain.snapshot().slow,2);
    now+=5000;refresh=h.overlay.refreshClock();await probe(40);await probe(40);assert.equal(await refresh,false);
    await turn();assert.equal(h.overlay.clockDomain.current(),null,'without a good probe the mapping still expires');
    const cancel=h.sent.at(-1);assert.equal(cancel.command,'prerollAt');assert.deepEqual(cancel.args,[null]);
    h.receive(result(null,cancel.id));assert.equal(endings.at(-1),null);
  } finally { h.overlay.dispose(); }
});

test('late probe from a reset connection cannot calibrate its successor', async () => {
  let now=1.8e12;const h=controllerHarness({}, {clock:()=>now,now:()=>now-1.8e12});
  try {
    const refresh=h.overlay.refreshClock();await turn();const message=h.sent.at(-1);
    h.overlay.resetConnection();now+=4;h.receive(result({epochMs:now-2,monotonicMs:2},message.id));
    assert.equal(await refresh,false);assert.equal(h.overlay.clockDomain.current(),null);
    assert.equal(h.overlay.clockDomain.snapshot().samples.length,0);
  } finally {h.overlay.dispose();}
});

test('late import restoration cannot acknowledge or update a disposed controller', async () => {
  let resolve, errors = 0;
  const waiting = new Promise(done => { resolve = done; });
  const h = controllerHarness({ onImportStart: () => waiting, onError: () => { errors++; } });
  h.receive({ type: 'import-start', importId: 1 }); await turn(); h.overlay.dispose(); resolve(); await turn();
  assert.equal(h.sent.some(message => message.command === 'importReady'), false); assert.equal(errors, 0);
});

test('superseded import restoration failure cannot report an error against the current controller import', async () => {
  let rejectOld, starts = 0, errors = 0;
  const old = new Promise((_resolve, reject) => { rejectOld = reject; });
  const h = controllerHarness({ onImportStart: () => ++starts === 1 ? old : Promise.resolve(), onError: () => { errors++; } });
  try {
    h.receive({ type: 'import-start', importId: 1 }); await turn();
    h.receive({ type: 'import-start', importId: 2 }); await turn();
    const ready = h.sent.find(message => message.command === 'importReady');
    assert.deepEqual(ready.args, [2]); h.receive(result(null, ready.id)); await turn();
    rejectOld(Error('older restoration failed')); await turn();
    assert.equal(errors, 0); assert.equal(h.sent.filter(message => message.command === 'importReady').length, 1);
  } finally { h.overlay.dispose(); }
});

test('an import superseded before its queued controller callback runs cannot restore a newer session', async () => {
  let starts = 0;
  const h = controllerHarness({ onImportStart: () => { starts++; } });
  try {
    h.receive({ type: 'import-start', importId: 1 }); h.receive({ type: 'import-start', importId: 2 }); await turn();
    assert.equal(starts, 1);
    const ready = h.sent.find(message => message.command === 'importReady'); assert.deepEqual(ready.args, [2]);
    h.receive(result(null, ready.id)); await turn();
  } finally { h.overlay.dispose(); }
});

test('every private presentation/audio/cleanup wrapper forwards its caller cancellation signal', async () => {
  const h = controllerHarness(), signal = new AbortController().signal, calls = [];
  h.overlay.request = async (name, args, received) => { calls.push({ name, signal: received }); };
  const host = { moveBefore(frame) { frame.parentNode = this; } };
  try {
    await h.overlay.mount(host, signal); await h.overlay.configureAudio({ muted: false, volume: .5 }, 0, signal);
    await h.overlay.primeForPlayback(signal); await h.overlay.show(signal); await h.overlay.stop(signal);
    await h.overlay.teardown(signal); await h.overlay.forceTeardown(signal);
    assert.deepEqual(calls.map(call => call.name), ['mount','configureAudio','primeForPlayback','show','stop','teardown','teardown']);
    assert.ok(calls.every(call => call.signal === signal));
  } finally { h.overlay.dispose(); }
});

test('late private teardown settlement cannot move an iframe out of a newer presentation', async () => {
  const h = controllerHarness(); let resolve;
  const waiting = new Promise(done => { resolve = done; });
  h.overlay.request = name => name === 'teardown' ? waiting : Promise.resolve();
  const host = () => ({ moveBefore(frame) { frame.parentNode = this; } });
  try {
    await h.overlay.mount(host()); const old = h.overlay.teardown(); const current = host();
    await h.overlay.mount(current); resolve(); await old;
    assert.equal(h.overlay.frame.parentNode, current);
  } finally { resolve(); h.overlay.dispose(); }
});

test('already cancelled private mount does not move the current frame', async () => {
  const h = controllerHarness(), controller = new AbortController(); controller.abort();
  h.overlay.request = async () => {};
  let moves = 0;
  try {
    await assert.rejects(h.overlay.mount({ moveBefore() { moves++; } }, controller.signal), { name: 'AbortError' });
    assert.equal(moves, 0);
  } finally { h.overlay.dispose(); }
});

class Video extends EventTarget {
  constructor() { super(); this.dataset = {}; this.style = {}; this.readyState = 3; this.currentTime = 3; this.seeking = false; this.muted = false; this.pauses = 0; }
  pause() { this.pauses++; } load() {} removeAttribute() {} remove() { this.removed = true; }
}

test('force teardown cancels local playback listeners/frame callbacks and ignores late old play settlement', async () => {
  const overlay = new LocalOverlay({ document: {} }), video = new Video(), second = new Video();
  const frames = new Set(), listeners = new Set(); let resolvePlay;
  video.duration = 60;
  video.play = () => new Promise(resolve => { resolvePlay = resolve; });
  video.addEventListener = (...args) => { listeners.add(args[1]); EventTarget.prototype.addEventListener.call(video, ...args); };
  video.removeEventListener = (...args) => { listeners.delete(args[1]); EventTarget.prototype.removeEventListener.call(video, ...args); };
  video.requestVideoFrameCallback = callback => { frames.add(callback); return callback; };
  video.cancelVideoFrameCallback = callback => frames.delete(callback);
  overlay.video = video; const lifetime = overlay.lifetime;
  const playing = overlay.play(), rejected = assert.rejects(playing, { name: 'AbortError' });
  overlay.forceTeardown(); assert.equal(lifetime.signal.aborted, true); await rejected;
  assert.equal(frames.size, 0); assert.equal(listeners.size, 0); assert.equal(overlay.video, null);
  overlay.video = second; resolvePlay(); await turn(); assert.equal(second.pauses, 0); await overlay.teardown();
});

test('already cancelled local presentation/audio/cleanup calls do not mutate the decoder', async () => {
  const overlay = new LocalOverlay({ document: {} }), video = new Video(), abort = new AbortController();
  overlay.video = video; video.volume = .5; video.style.display = 'none'; abort.abort(); let mounts = 0;
  for (const call of [() => overlay.mount({ append() { mounts++; } }, abort.signal), () => overlay.configureAudio({ muted: true, volume: 1 }, 0, abort.signal),
    () => overlay.show(abort.signal), () => overlay.stop(abort.signal), () => overlay.teardown(abort.signal), () => overlay.forceTeardown(abort.signal)]) {
    await assert.rejects(Promise.resolve().then(call), { name: 'AbortError' });
  }
  assert.equal(mounts, 0); assert.equal(video.pauses, 0); assert.equal(video.volume, .5); assert.equal(video.muted, false);
  assert.equal(video.style.display, 'none'); assert.equal(overlay.video, video); await overlay.teardown();
});
test('local warmup cannot rewind or change a newly selected decoder after late play resolution', async () => {
  const overlay = new LocalOverlay({ document: {} }), first = new Video(), second = new Video(); let resolve;
  first.play = () => new Promise(done => { resolve = done; }); overlay.video = first;
  const pending = overlay.primeForPlayback(); const rejected = assert.rejects(pending, { name: 'AbortError' });
  await turn(); await overlay.teardown(); overlay.video = second; resolve(); await rejected; await turn();
  assert.equal(second.currentTime, 3); assert.equal(second.pauses, 0); assert.equal(second.muted, false); await overlay.teardown();
});

test('warmup timeout stops a late same-decoder play without leaving its temporary mute', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const overlay = new LocalOverlay({ document: {} }), video = new Video(); let resolve;
  video.play = () => new Promise(done => { resolve = done; }); overlay.video = video;
  const pending = overlay.primeForPlayback(); const rejected = assert.rejects(pending, /timed out|timeout/i);
  t.mock.timers.tick(3001); await rejected; const before = video.pauses; resolve(); await turn();
  assert.ok(video.pauses > before); assert.equal(video.currentTime, 3); assert.equal(video.muted, false); await overlay.teardown();
});

test('a replaced pending preparation rejects without reading readiness from the new decoder', async () => {
  const first = new Video(), second = new Video(); first.readyState = 0; first.currentTime = second.currentTime = 0;
  const videos = [first, second], overlay = new LocalOverlay({ document: { createElement: () => videos.shift() } });
  const old = overlay.prepare('blob:first'), rejected = assert.rejects(old, { name: 'AbortError' }); await turn();
  assert.equal((await overlay.prepare('blob:second')).readyState, 3); await rejected;
  assert.equal(overlay.video, second); assert.equal(first.removed, true); await overlay.teardown();
});

test('actual renderer clear does not cancel its own acknowledgement and disconnect drains pending preparation', async () => {
  let receive, disconnected, preparationSignal; const messages = [], intervals = new Set(), events = new Map();
  const port = { onMessage: { addListener: fn => { receive = fn; } }, onDisconnect: { addListener: fn => { disconnected = fn; } }, postMessage: value => messages.push(value), disconnect() { disconnected?.(); } };
  const element = () => ({ value: 'private', classList: { add() {}, remove() {} }, addEventListener() {}, querySelector() { return {}; } });
  const nodes = new Map(['#folder', '#status', '#packet-kind', '#video-host', '#protected-picker', '#protected-release', '#protected-offline', '#protected-combined', '#protected-load', '#choose-directory'].map(key => [key, element()]));
  // Get-or-create: a selector the page adds should fail the test that cares, not every test here.
  const lookup = key => { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key); };
  const overlay = { teardown: async () => {}, prepare: (_source, signal) => { preparationSignal = signal; return new Promise(() => {}); } };
  const parent = {}, window = { parent, top: parent, location: { ancestorOrigins: ['https://www.amazon.com'] } };
  const sandbox = ({ createViewerStore:()=>({folder:async()=>null}),
    // Actual polling implementation with a controlled, undriven timer for these
    // import/relay lifetime tests. Dedicated control tests exercise timer ticks.
    startCatalogControlPolling: options => startCatalogControlPolling({ ...options, setTimer: fn => fn, clearTimer() {} }),
    LocalOverlay: class { constructor() { return overlay; } }, loadFixturePacket() {}, OperationContext, boundedOperation, assertActive,
    // Marshal VM-created objects into the validator's realm, as runtime JSON
    // messages are materialized in their receiving extension context.
    validLocalMessage: (message, role) => validLocalMessage(structuredClone(message), role), validLocalResult: (message, command) => validLocalResult(structuredClone(message), command),
    LOCAL_LIMITS, LOCAL_CONTROL_COMMANDS: new Set(['stop','clear','teardown','importReady']), sameExecutingBuild, EXECUTING_BUILD, receivedParentBinding, window,
    CatalogPlaybackSession: class { clear() {} }, createCatalogRuntimeClient: () => ({ readPolicy() {} }), catalogTrustConfig: { fixtureOnly: false }, protectedTrustConfig: { enabled: false },
    document: { querySelector: lookup, body: element() }, location: { hash: '#' + crypto.randomUUID() },
    chrome: { runtime: { id: extensionId, connect: ({name}={}) => name==='viewer-renderer-v1'?{onMessage:{addListener(){}},onDisconnect:{addListener(){}},postMessage(){}}:port, getURL: path => 'chrome-extension://' + extensionId + '/' + path }, storage: { onChanged: { addListener() {}, removeListener() {} } } },
    AbortController, URL, performance, setInterval: fn => { intervals.add(fn); return fn; }, clearInterval: fn => intervals.delete(fn),
    addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) });
  startPlaybackFrame({ ...sandbox, deps: sandbox });
  events.get('message')({ isTrusted: true, source: parent, origin: 'https://www.amazon.com', data: { type: PRIVATE_PARENT_BINDING, challenge: crypto.randomUUID() } });
  receive({ type: 'ready', build: EXECUTING_BUILD }); receive(command('clear')); await turn();
  assert.equal(messages.find(value => value.type === 'result' && value.id === 1)?.ok, true);
  receive(command('prepare', ['fixture'], 2)); await turn(); disconnected(); await turn();
  assert.equal(preparationSignal.aborted, true); assert.equal(intervals.size, 0); assert.equal(nodes.get('#folder').disabled, true);
});
