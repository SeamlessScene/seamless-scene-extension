import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacketSessionController } from '../src/packet-session-controller.mjs';
import { PacketPlaybackJournal } from '../src/packet-playback-journal.mjs';
import { OperationContext } from '../src/operation-context.mjs';
import { ManifestActionScheduler } from '../src/manifest-action-scheduler.mjs';
import { ManifestActionExecutor } from '../src/manifest-action-executor.mjs';
import { createGuardedExecutor } from '../src/playback-session.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const value = { id: 'PRIVATE-ID', type: 'REPLACE', triggerMs: 1000, resumeMs: 6000, clipUrl: 'blob:PRIVATE-VIDEO' };
function session() { return { packet: { manifest: { segments: [{ segment_id: value.id, action: value.type }] } }, trust: 'local-user', assetUrls: new Map() }; }

// The actual Prime arm/clear controller; browser transport, source probe and
// action compilation are controlled. This does not establish installed behavior.
function harness({ sourceCheck = async () => ({}), Scheduler = ManifestActionScheduler } = {}) {
  let check = sourceCheck, sourceCalls = 0, cleared = 0;
  const node = () => ({ disabled: false, textContent: '', hidden: false, events: {}, addEventListener(type, fn) { this.events[type] = fn; }, replaceChildren() {} });
  const journal = new PacketPlaybackJournal(), operations = new OperationContext(), arm = node();
  const packetOutput = node();
  const state = { session: session(), scheduler: null, arming: null };
  const controller = createPacketSessionController({ state, operations, journal,
    ui: { armButton: arm, cancelButton: node(), navigation: node(), navigationList: node(), navigationOutput: node(), packetOutput, panelHost: { dataset: {} } },
    engine: { async preload() {}, async cancelPreload() {}, arm() {}, async execute() { return { status: 'success' }; }, async cancel() {} },
    adapter: { async seek() {} }, overlay: { async clear() { cleared++; } },
    commandAdapter: { readState: () => ({ currentTimeMs: 900, paused: true }) },
    assertSource: (...args) => { sourceCalls++; return check(...args); },
    deps: { ManifestActionExecutor, ManifestActionScheduler: Scheduler, createGuardedExecutor, compileLocalUserEditActions: () => [{ ...value }] } });
  // The names these tests grew up with, mapped onto the controller's state.
  const context = {
    get localPacketSession() { return state.session; }, set localPacketSession(v) { state.session = v; },
    get localPacketScheduler() { return state.scheduler; }, set localPacketScheduler(v) { state.scheduler = v; },
    get localPacketArming() { return state.arming; }, set localPacketArming(v) { state.arming = v; },
    armLocalPacketButton: arm };
  return { context, journal, operations, packetOutput,
    // The click listener is `()=>void armViewerEdit().catch(()=>{})`, so a refused second arm is
    // swallowed there; mirror that rather than surfacing a rejection the product never surfaces.
    arm: () => controller.arm().catch(() => {}), clear: reason => controller.clear(reason),
    invalidateCatalog: context => controller.invalidateCatalog(context),
    setCheck(fn) { check = fn; }, get sourceCalls() { return sourceCalls; }, get cleared() { return cleared; } };
}

test('stopping clears armed text immediately, before a pending scheduler drain', async () => {
  const draining = deferred();
  class SlowScheduler {
    async observe() {}
    async cancelAll() { await draining.promise; }
  }
  const h = harness({ Scheduler: SlowScheduler });
  await h.arm(); assert.match(h.packetOutput.textContent, /Armed/);
  const clearing = h.clear('viewer-user-stopped');
  assert.equal(h.context.localPacketScheduler, null);
  assert.match(h.packetOutput.textContent, /^Edit stopped\./);
  draining.resolve(); await clearing;
  assert.doesNotMatch(h.packetOutput.textContent, /Armed|Local edit armed/);
});

test('current catalog invalidation clears the edit and reports why after cleanup', async () => {
  const h = harness(); await h.arm(); await h.invalidateCatalog({ isCurrent: () => true });
  assert.equal(h.context.localPacketSession, null); assert.equal(h.context.localPacketScheduler, null);
  assert.match(h.packetOutput.textContent, /^Catalog permissions or version changed/); assert.equal(h.cleared, 1);
});

test('obsolete catalog invalidation cannot clear a currently armed edit', async () => {
  const h = harness(); await h.arm(); const scheduler = h.context.localPacketScheduler, text = h.packetOutput.textContent;
  await h.invalidateCatalog({ isCurrent: () => false });
  assert.equal(h.context.localPacketScheduler, scheduler); assert.equal(h.packetOutput.textContent, text);
  await h.clear();
});

test('late catalog cleanup cannot replace the status of a newer armed packet', async () => {
  const drain = deferred();
  class SlowScheduler { async observe() {} async cancelAll() { await drain.promise; } }
  const h = harness({ Scheduler: SlowScheduler }); await h.arm();
  const invalidating = h.invalidateCatalog({ isCurrent: () => true });
  await h.clear('new-folder-selected'); h.context.localPacketSession = session(); await h.arm();
  const scheduler = h.context.localPacketScheduler, text = h.packetOutput.textContent;
  drain.resolve(); await invalidating;
  assert.equal(h.context.localPacketScheduler, scheduler); assert.equal(h.packetOutput.textContent, text);
  await h.clear();
});

test('catalog cleanup completion preserves connection recovery status after its context expires', async () => {
  const drain = deferred(); let current = true;
  class SlowScheduler { async observe() {} async cancelAll() { await drain.promise; } }
  const h = harness({ Scheduler: SlowScheduler }); await h.arm();
  const invalidating = h.invalidateCatalog({ isCurrent: () => current });
  current = false; h.packetOutput.textContent = 'Private renderer disconnected; edits stopped. Reconnecting…';
  const text = h.packetOutput.textContent;
  drain.resolve(); await invalidating; assert.equal(h.packetOutput.textContent, text);
});

test('late catalog cleanup failure is suppressed only after its packet is superseded', async () => {
  for (const superseded of [true, false]) {
    const drain = deferred();
    class SlowScheduler { async observe() {} async cancelAll() { await drain.promise; } }
    const h = harness({ Scheduler: SlowScheduler }); await h.arm();
    const invalidating = h.invalidateCatalog({ isCurrent: () => true });
    const outcome = invalidating.then(() => 'resolved', () => 'rejected');
    if (superseded) { await h.clear('new-folder-selected'); h.context.localPacketSession = session(); await h.arm(); }
    drain.reject(Error('cleanup failed'));
    assert.equal(await outcome, superseded ? 'resolved' : 'rejected');
    if (superseded) assert.match(h.packetOutput.textContent, /^Armed/);
  }
});

test('actual arm handler is single-flight while source checking, then records its run as armed', async () => {
  const pending = deferred(), h = harness({ sourceCheck: () => pending.promise });
  const first = h.arm(); await turn(); await h.arm();
  assert.equal(h.sourceCalls, 1); assert.equal(h.journal.snapshot().events.filter(event => event.event === 'arm-requested').length, 1);
  pending.resolve({}); await first;
  assert.equal(h.context.localPacketArming, null); assert.ok(h.context.localPacketScheduler);
  assert.ok(h.journal.snapshot().events.some(event => event.event === 'armed'));
  await h.clear(); assert.equal(h.context.localPacketScheduler, null);
  assert.equal(h.journal.snapshot().events.at(-1).event, 'run-closed'); assert.equal(h.cleared, 1);
});

test('actual source refusal is retained without private errors and a retry receives another anonymous run', async () => {
  const h = harness({ sourceCheck: async () => { throw Error('PRIVATE-CONTENT-ID'); } });
  await h.arm();
  assert.ok(h.journal.snapshot().events.some(event => event.event === 'arm-refused' && event.phase === 'source-check'));
  assert.equal(h.context.armLocalPacketButton.disabled, false); assert.equal(h.context.localPacketArming, null);
  h.setCheck(async () => ({})); await h.arm(); await h.clear();
  assert.deepEqual(h.journal.snapshot().events.filter(event => event.event === 'arm-requested').map(event => event.runSequence), [1, 2]);
  assert.doesNotMatch(JSON.stringify(h.journal.snapshot()), /PRIVATE|blob:/);
});

test('clearing during a late source result closes only its old run and preserves a new selected packet', async () => {
  const pending = deferred(), h = harness({ sourceCheck: () => pending.promise });
  const first = h.arm(); await turn(); const oldRun = h.context.localPacketSession.evidenceRun;
  await h.clear(); const replacement = session(); h.context.localPacketSession = replacement;
  pending.resolve({}); await first;
  assert.equal(h.context.localPacketSession, replacement); assert.equal(h.context.localPacketScheduler, null);
  assert.equal(h.context.localPacketArming, null); assert.equal(oldRun.context(value), null);
  assert.equal(h.journal.snapshot().events.some(event => event.event === 'armed'), false);
  assert.equal(h.journal.snapshot().events.filter(event => event.event === 'run-closed').length, 1);
});

test('failed partial scheduler arming drains its owner before closing evidence or accepting a retry', async () => {
  const draining = deferred(); let cancelled = 0;
  class PartialScheduler {
    constructor() { this.observerFailures = 2; }
    async observe() { throw Error('PRIVATE-ARM-FAILURE'); }
    async cancelAll() { cancelled++; await draining.promise; }
  }
  const h = harness({ Scheduler: PartialScheduler }), first = h.arm(); await turn();
  assert.equal(cancelled, 1); assert.equal(h.context.localPacketScheduler, null);
  assert.ok(h.context.localPacketArming); await h.arm(); assert.equal(h.sourceCalls, 1);
  assert.equal(h.journal.snapshot().events.some(event => event.event === 'run-closed'), false);
  draining.resolve(); await first;
  assert.equal(h.context.localPacketArming, null);
  assert.ok(h.journal.snapshot().events.some(event => event.event === 'arm-refused' && event.phase === 'scheduler-arm'));
  assert.equal(h.journal.snapshot().retention.closedRunObserverFailures, 2);
  assert.doesNotMatch(JSON.stringify(h.journal.snapshot()), /PRIVATE/);
});
