import test from 'node:test';
import assert from 'node:assert/strict';
import { PacketPlaybackJournal } from '../src/packet-playback-journal.mjs';
import { ManifestActionScheduler } from '../src/manifest-action-scheduler.mjs';
import { TransitionEngine } from '../src/transition-engine.mjs';
import { MetricsRecorder } from '../src/metrics.mjs';

const action = (id = 'PRIVATE-SCENE', type = 'REPLACE') => ({ id, type, triggerMs: 1000, resumeMs: 6000, clipUrl: 'blob:PRIVATE-MEDIA' });
const turn = () => new Promise(resolve => setImmediate(resolve));
function schedulerFor(journal, selected = [action()], overrides = {}) {
  const run = journal.beginRun(selected);
  const executor = { async preloadLocal() {}, async cancelPreload() {}, async executeLocal() {}, async cancel() {},
    async honorNativeSeek() {}, async startMute() {}, async finishMute() {}, ...overrides };
  return { run, scheduler: new ManifestActionScheduler({ actions: selected, executor, onEvent: run.onSchedulerEvent }) };
}

for (const fails of [false, true]) test(`actual staging ${fails ? 'failure and fallback' : 'success'} survives journal filtering`, async () => {
  const journal = new PacketPlaybackJournal();
  const { scheduler, run } = schedulerFor(journal, [action()], {
    async stageLocal() { if (fails) throw Error('PRIVATE-STAGE-ERROR'); return true; }
  });
  await scheduler.observe({ currentTimeMs: 800, paused: false });
  await scheduler.observe({ currentTimeMs: 900, paused: false });
  await turn();
  await scheduler.observe({ currentTimeMs: 1001, paused: false });
  await scheduler.cancelAll(); run.close();
  const output = journal.snapshot();
  assert.equal(output.retention.rejectedEvents, 0);
  assert.ok(output.events.some(event => event.outcome === 'stage-started'));
  assert.ok(output.events.some(event => event.outcome === (fails ? 'stage-failed' : 'staged')));
  assert.ok(output.events.some(event => event.outcome === 'completed'));
  if (fails) {
    assert.ok(output.events.some(event => event.reason === 'unstaged-fallback'));
    assert.deepEqual(output.events.find(event => event.outcome === 'stage-failed').failure, { phase: 'unknown', kind: 'unknown' });
  }
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE|blob:/);
});

for (const phase of ['prepare', 'overlay-host', 'overlay-mount', 'overlay-show']) {
  for (const mode of ['error', 'timeout', 'cancelled']) test(`real staging ${phase} ${mode} is bounded and retains fallback`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fail = current => {
      if (current !== phase) return Promise.resolve({});
      if (mode === 'timeout') return new Promise(() => {});
      const error = Error('PRIVATE-STAGE-DETAIL blob:PRIVATE-MEDIA');
      if (mode === 'cancelled') error.name = 'AbortError';
      return Promise.reject(error);
    };
    const engine = new TransitionEngine({
      adapter: { stageOverlayHost: () => fail('overlay-host'), unstageOverlayHost() {} },
      overlay: { prepare: () => fail('prepare'), mount: () => fail('overlay-mount'),
        async configureAudio() {}, show: () => fail('overlay-show'), async unmount() {} },
      metrics: new MetricsRecorder(), operationTimeouts: { [phase]: 10 }
    });
    let executions = 0;
    const journal = new PacketPlaybackJournal(), { scheduler, run } = schedulerFor(journal, [action()], {
      stageLocal: value => engine.stage(value), async executeLocal() { executions++; }
    });
    await scheduler.observe({ currentTimeMs: 800, paused: false });
    await scheduler.observe({ currentTimeMs: 900, paused: false }); await turn();
    if (mode === 'timeout') { t.mock.timers.tick(11); await turn(); }
    await scheduler.observe({ currentTimeMs: 1001, paused: false });
    await scheduler.cancelAll(); run.close();
    const output = journal.snapshot(), failed = output.events.find(event => event.outcome === 'stage-failed');
    assert.deepEqual(failed.failure, { phase: mode === 'cancelled' ? 'unknown' : phase, kind: mode });
    assert.equal(failed.reason, 'unstaged-fallback'); assert.equal(executions, 1);
    assert.ok(output.events.some(event => event.outcome === 'completed'));
    assert.equal(output.retention.rejectedEvents, 0); assert.equal(engine.staged, null);
    assert.doesNotMatch(JSON.stringify(output), /PRIVATE|blob:/);
  });
}

test('unreadable thrown error properties cannot break staging failure reporting or fallback', async () => {
  const journal = new PacketPlaybackJournal(), error = { get name() { throw Error('PRIVATE-GETTER'); } };
  const { scheduler } = schedulerFor(journal, [action()], { async stageLocal() { throw error; } });
  await scheduler.observe({ currentTimeMs: 800, paused: false });
  await scheduler.observe({ currentTimeMs: 900, paused: false }); await turn();
  await scheduler.observe({ currentTimeMs: 1001, paused: false });
  const events = journal.snapshot().events;
  assert.deepEqual(events.find(event => event.outcome === 'stage-failed').failure, { phase: 'unknown', kind: 'unknown' });
  assert.ok(events.some(event => event.outcome === 'completed'));
});

test('staging diagnostics redact arbitrary fields and snapshots cannot mutate retained failure', () => {
  const journal = new PacketPlaybackJournal(), value = action(), run = journal.beginRun([value]);
  const failure = { phase: 'PRIVATE-PATH', kind: 'PRIVATE-ERROR', message: 'PRIVATE-TEXT', stack: 'PRIVATE-STACK' };
  run.onSchedulerEvent({ actionId: value.id, type: value.type, outcome: 'stage-failed', failure });
  run.onSchedulerEvent({ actionId: value.id, type: value.type, outcome: 'staged', failure });
  failure.phase = 'prepare';
  const snapshot = journal.snapshot();
  assert.deepEqual(snapshot.events[1].failure, { phase: 'unknown', kind: 'unknown' });
  assert.equal('failure' in snapshot.events[2], false);
  snapshot.events[1].failure.phase = 'overlay-show';
  assert.equal(journal.snapshot().events[1].failure.phase, 'unknown');
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE/);
});

test('closed runs release ordinal context and cannot append old events to a newer run', () => {
  const journal = new PacketPlaybackJournal(), value = action(), first = journal.beginRun([value]);
  assert.deepEqual(first.context(value), { runSequence: 1, actionOrdinal: 1 });
  first.refuse('source-check'); const previous = journal.snapshot();
  const second = journal.beginRun([value], 'catalog-v2');
  assert.deepEqual(second.context(value), { runSequence: 2, actionOrdinal: 1 });
  assert.equal(first.context(value), null); assert.equal(first.context(null), null);
  first.onSchedulerEvent({ actionId: value.id, type: value.type, outcome: 'completed' }); first.armed();
  second.armed(); second.close();
  const output = journal.snapshot(); assert.equal(output.retention.ignoredLateEvents, 2);
  assert.equal(output.events.filter(event => event.runSequence === 1).length, previous.events.length);
  assert.equal(output.events.find(event => event.runSequence === 2).profileContext, 'catalog-v2');
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE|1000|6000|blob:/);
});

test('journal rejects unknown action/outcome events and redacts arbitrary reasons', () => {
  const journal = new PacketPlaybackJournal(), value = action(), run = journal.beginRun([value]);
  run.onSchedulerEvent({ actionId: 'OTHER-PRIVATE-ID', type: 'REPLACE', outcome: 'completed' });
  run.onSchedulerEvent({ actionId: value.id, type: 'INSERT', outcome: 'completed' });
  run.onSchedulerEvent({ actionId: value.id, type: 'REPLACE', outcome: 'PRIVATE-OUTCOME' });
  run.onSchedulerEvent({ actionId: value.id, type: 'REPLACE', outcome: 'skipped', reason: 'C:\\PRIVATE-FILE.mp4' });
  const output = journal.snapshot(); assert.equal(output.retention.rejectedEvents, 3);
  assert.equal(output.events.at(-1).reason, 'unknown'); assert.doesNotMatch(JSON.stringify(output), /PRIVATE/);
});

test('journal action admission is bounded and refuses duplicate IDs before starting a run', () => {
  const journal = new PacketPlaybackJournal();
  for (const values of [[], Array(1001).fill(action()), [action(), action()], [action('x', 'UNREVIEWED')]]) assert.throws(() => journal.beginRun(values));
  assert.equal(journal.snapshot().events.length, 0);
  const values = Array.from({ length: 1000 }, (_, i) => action(`private-${i}`)), run = journal.beginRun(values);
  assert.equal(run.context(values.at(-1)).actionOrdinal, 1000); run.close(); assert.equal(run.context(values[0]), null);
});

test('journal retains a bounded immutable tail with exact sequence and eviction accounting', () => {
  const journal = new PacketPlaybackJournal(), run = journal.beginRun([action()]);
  for (let i = 0; i < 2005; i++) run.onSchedulerEvent({ actionId: action().id, type: 'REPLACE', outcome: 'skipped', reason: 'preflight-not-ready' });
  run.close('cleared', 3);
  const output = journal.snapshot();
  assert.equal(output.events.length, 2000); assert.equal(output.retention.droppedEvents, 7);
  assert.equal(output.events[0].sequence, 8); assert.equal(output.events.at(-1).sequence, 2007);
  assert.equal(output.retention.closedRunObserverFailures, 3);
  output.events[0].outcome = 'PRIVATE-MUTATION'; assert.notEqual(journal.snapshot().events[0].outcome, 'PRIVATE-MUTATION');
});

test('actual failed preflight and skipped trigger remain in history after scheduler cancellation and run close', async () => {
  const journal = new PacketPlaybackJournal(), { scheduler, run } = schedulerFor(journal, [action()], { async preloadLocal() { throw Error('PRIVATE-CODEC'); } });
  await scheduler.observe({ currentTimeMs: 900, paused: false }); await scheduler.observe({ currentTimeMs: 1001, paused: false });
  await scheduler.cancelAll('PRIVATE-REASON'); run.close('cleared', scheduler.observerFailures);
  const events = journal.snapshot().events;
  assert.ok(events.some(event => event.outcome === 'preflight-failed' && event.reason === 'not-ready'));
  assert.ok(events.some(event => event.outcome === 'skipped' && event.reason === 'preflight-not-ready'));
  assert.equal(events.some(event => event.outcome === 'running' || event.outcome === 'completed'), false);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|1001/);
});

test('actual seek resets and repeated execution stay ordered in one anonymous run', async () => {
  const journal = new PacketPlaybackJournal(), { scheduler, run } = schedulerFor(journal);
  await scheduler.observe({ currentTimeMs: 900, paused: false }); await scheduler.observe({ currentTimeMs: 1001, paused: false });
  await scheduler.observe({ currentTimeMs: 7000, paused: true, event: 'seek' });
  assert.equal(Object.values(scheduler.snapshot().statuses)[0], 'completed');
  await scheduler.observe({ currentTimeMs: 900, paused: true, event: 'seek' });
  await scheduler.observe({ currentTimeMs: 1001, paused: false }); await scheduler.cancelAll(); run.close();
  const events = journal.snapshot().events;
  assert.equal(events.filter(event => event.outcome === 'running').length, 2);
  assert.equal(events.filter(event => event.outcome === 'completed').length, 2);
  assert.equal(events.some(event => event.outcome === 'skipped' && event.reason === 'seek-after-trigger'), false);
  assert.ok(events.some(event => event.outcome === 'reset-pending' && event.reason === 'seek-at-or-before-trigger'));
  assert.ok(events.every(event => event.runSequence === 1));
  assert.ok(events.every((event, i) => event.sequence === i + 1));
});

test('cancelling pending actions records one terminal outcome per action before run close', async () => {
  const journal = new PacketPlaybackJournal(), values = [action('private-a'), action('private-b')];
  const { scheduler, run } = schedulerFor(journal, values);
  await scheduler.cancelAll('PRIVATE-CANCEL'); await scheduler.cancelAll(); run.close();
  const cancelled = journal.snapshot().events.filter(event => event.outcome === 'cancelled');
  assert.deepEqual(cancelled.map(event => event.actionOrdinal), [1, 2]);
  assert.ok(cancelled.every(event => event.reason === 'plan-cancelled'));
});

test('active mute cancellation distinguishes terminal cancellation from mute cleanup', async () => {
  const journal = new PacketPlaybackJournal(), { scheduler, run } = schedulerFor(journal, [action('private-mute', 'MUTE')]);
  await scheduler.observe({ currentTimeMs: 900, paused: false }); await scheduler.observe({ currentTimeMs: 1001, paused: false });
  await scheduler.cancelAll(); run.close();
  const events = journal.snapshot().events;
  assert.equal(events.filter(event => event.outcome === 'cancelled').length, 1);
  assert.equal(events.filter(event => event.outcome === 'mute-stopped').length, 1);
});

test('a broken synchronous observer cannot change playback outcome and is explicitly counted', async () => {
  const value = action(), scheduler = new ManifestActionScheduler({ actions: [value], executor: { async preloadLocal() {}, async executeLocal() {} },
    onEvent(event) { event.outcome = 'PRIVATE-MUTATION'; } });
  await scheduler.observe({ currentTimeMs: 900, paused: false }); await scheduler.observe({ currentTimeMs: 1001, paused: false });
  const output = scheduler.snapshot(); assert.equal(output.statuses[value.id], 'completed');
  assert.equal(output.retention.observerFailures, output.events.length);
  assert.equal(output.events.at(-1).outcome, 'completed');
});

test('scheduler event tail reports drops without preventing delivery to the bounded journal', () => {
  const journal = new PacketPlaybackJournal(), { scheduler, run } = schedulerFor(journal), value = action();
  for (let i = 0; i < 2005; i++) scheduler.record(value, 'skipped', 'missed-interval');
  assert.equal(scheduler.snapshot().retention.droppedEvents, 5);
  assert.equal(journal.snapshot().retention.droppedEvents, 6); run.close();
});

test('an accidentally async observer is counted and its rejection is consumed without blocking scheduling', async () => {
  const value = action(), scheduler = new ManifestActionScheduler({ actions: [value], executor: { async preloadLocal() {}, async executeLocal() {} },
    async onEvent() { throw Error('PRIVATE-OBSERVER-FAILURE'); } });
  await scheduler.observe({ currentTimeMs: 900, paused: false }); await scheduler.observe({ currentTimeMs: 1001, paused: false }); await turn();
  assert.equal(scheduler.snapshot().statuses[value.id], 'completed');
  assert.equal(scheduler.observerFailures, scheduler.events.length);
});

test('late preflight settlement after cancellation cannot append success to a closed run', async () => {
  let finish; const wait = new Promise(resolve => { finish = resolve; });
  const journal = new PacketPlaybackJournal(), { scheduler, run } = schedulerFor(journal, [action()], { preloadLocal: () => wait, cancelPreload: async () => finish() });
  const pending = scheduler.observe({ currentTimeMs: 900, paused: false }); await turn();
  await scheduler.cancelAll(); run.close(); await pending;
  assert.equal(journal.snapshot().events.some(event => event.outcome === 'preflight-ready'), false);
  assert.equal(journal.snapshot().events.at(-1).event, 'run-closed');
});
