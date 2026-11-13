import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacketSessionController } from '../src/packet-session-controller.mjs';
import { PacketPlaybackJournal, clearCause } from '../src/packet-playback-journal.mjs';
import { OperationContext } from '../src/operation-context.mjs';
import { ManifestActionScheduler } from '../src/manifest-action-scheduler.mjs';
import { ManifestActionExecutor } from '../src/manifest-action-executor.mjs';
import { createGuardedExecutor } from '../src/playback-session.mjs';
import { TransitionEngine } from '../src/transition-engine.mjs';
import { MetricsRecorder } from '../src/metrics.mjs';
import { watchTransitions } from '../src/transition-timing.mjs';

// 0.65.7: clear(reason) used to close the evidence run with the literal "cleared" and lose its
// caller. The run, the developer events and the scene timing report now record the caller's
// reason (known codes only). Log only: nothing else changes.

const value = { id: 'PRIVATE-ID', type: 'REPLACE', triggerMs: 1000, resumeMs: 6000, clipUrl: 'blob:PRIVATE-VIDEO' };
const node = () => ({ disabled: false, textContent: '', hidden: false, addEventListener() {}, replaceChildren() {} });

function controllerWith(engine) {
  const journal = new PacketPlaybackJournal();
  const state = { session: { packet: { manifest: { segments: [{ segment_id: value.id, action: value.type }] } }, trust: 'local-user', assetUrls: new Map() }, scheduler: null, arming: null };
  const controller = createPacketSessionController({ state, operations: new OperationContext(), journal,
    ui: { armButton: node(), cancelButton: node(), navigation: node(), navigationList: node(), navigationOutput: node(), packetOutput: node(), panelHost: { dataset: {} } },
    engine, adapter: { async seek() {} }, overlay: { async clear() {} },
    commandAdapter: { readState: () => ({ currentTimeMs: 900, paused: true }) },
    assertSource: async () => ({}),
    deps: { ManifestActionExecutor, ManifestActionScheduler, createGuardedExecutor, compileLocalUserEditActions: () => [{ ...value }] } });
  return { controller, journal };
}

test('the evidence run records which caller cleared it', async () => {
  for (const reason of ['viewer-user-stopped', 'source-identity-changed', 'pagehide-bfcache', 'renderer-disconnected']) {
    const noted = [];
    const { controller, journal } = controllerWith({ async preload() {}, async cancelPreload() {}, arm() {}, async execute() { return { status: 'success' }; }, async cancel() {}, noteCleared: r => noted.push(r) });
    await controller.arm();
    await controller.clear(reason);
    const closed = journal.snapshot().events.at(-1);
    assert.equal(closed.event, 'run-closed');
    assert.equal(closed.reason, 'cleared', 'the existing reason field is unchanged');
    assert.equal(closed.cause, reason);
    assert.deepEqual(noted, [reason]);
  }
});

test('an unknown clear reason is recorded as other, never as free text', async () => {
  assert.equal(clearCause('PRIVATE-REASON'), 'other');
  assert.equal(clearCause(undefined), 'other');
  const { controller, journal } = controllerWith({ async preload() {}, async cancelPreload() {}, arm() {}, async execute() { return { status: 'success' }; }, async cancel() {} });
  await controller.arm();
  await controller.clear('PRIVATE-REASON');
  assert.equal(journal.snapshot().events.at(-1).cause, 'other');
  assert.doesNotMatch(JSON.stringify(journal.snapshot().events), /PRIVATE/);
  // Closing without a cause (other callers) keeps the 0.65.6 event exactly.
  const solo = new PacketPlaybackJournal(); const r = solo.beginRun([{ id: 'a', type: 'REPLACE' }]); r.close('cleared', 0);
  assert.deepEqual(Object.keys(solo.snapshot().events.at(-1)).sort(), ['event', 'observerFailures', 'reason', 'runSequence', 'sequence']);
});

test('the engine records the clear reason in its developer events and the scene timing report', () => {
  const metrics = new MetricsRecorder();
  const engine = new TransitionEngine({ adapter: {}, overlay: {}, metrics });
  const marks = [];
  const timing = { mark: (name, detail) => marks.push([name, detail]) };
  const controller = new AbortController();
  watchTransitions(timing, { engine, document: { addEventListener() {} }, signal: controller.signal });
  engine.noteCleared('ad-break-detected');
  engine.noteCleared('PRIVATE-REASON');
  assert.deepEqual(metrics.snapshot().events.filter(event => event.name === 'session-cleared').map(event => event.detail), [{ reason: 'ad-break-detected' }, { reason: 'other' }]);
  assert.deepEqual(marks, [['session-cleared', { reason: 'ad-break-detected' }], ['session-cleared', { reason: 'other' }]]);
  controller.abort();
});
