import { installEvidenceExport } from '../src/playback-evidence-export.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MetricsRecorder } from '../src/metrics.mjs';
import { TrialEvidenceRecorder } from '../src/trial-evidence.mjs';
import { ManifestActionExecutor } from '../src/manifest-action-executor.mjs';
import { ManifestActionScheduler } from '../src/manifest-action-scheduler.mjs';
import { TransitionEngine } from '../src/transition-engine.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';
import { PacketPlaybackJournal } from '../src/packet-playback-journal.mjs';
import { automaticPacketEvidence, createPrimePlaybackEvidence } from '../src/packet-playback-evidence.mjs';

const action = overrides => ({ id: 'PRIVATE-SEGMENT-ID', type: 'REPLACE', triggerMs: 1234567,
  resumeMs: 1248267, clipUrl: 'blob:PRIVATE-URL', expectedDurationMs: 13700, profileClass: 'local-user', ...overrides });
const turn = () => new Promise(resolve => setImmediate(resolve));
function composed({ fail = false, play, evidenceRun = null, cutObservation = null, seekOffset = -3, commandOffset = 0, receipt = { errorMs: 19, nativeResumeMs: 2, frameWaitMs: 12, compositorWaitMs: 5 } } = {}) {
  const metrics = new MetricsRecorder(), trials = new TrialEvidenceRecorder();
  const adapter = {
    cutObservation() { return cutObservation; },
    async snapshot() { return { currentTimeMs: 1234567, paused: false, muted: false, volume: 0.5 }; },
    async mountOverlayHost() { return {}; }, async pause() {}, async setMuted() {}, async setNativeCovered() {},
    async seek(targetMs) { return { targetMs: targetMs + commandOffset, errorMs: seekOffset - commandOffset, after: { currentTimeMs: targetMs + seekOffset } }; },
    async restore(_snapshot, options) { return options.awaitPresentedFrame ? receipt : { errorMs: 13 }; },
    async forceSafeNativeState() {}
  };
  const overlay = {
    async cue() { return { positionMs: 5000 }; },
    async prepare() {}, async mount() {}, async configureAudio() {}, async show() {}, async stop() {}, async teardown() {}, async forceTeardown() {},
    async play(signal) { if (play) return play(signal); if (fail) throw Error('C:\\PRIVATE-FILE.mp4'); return { unplayedTailMs: 0 }; }
  };
  const engine = new TransitionEngine({ adapter, overlay, metrics, joinSeekDelayMs: 0 });
  const executor = new ManifestActionExecutor({ transitionEngine: engine, adapter, evidenceRun });
  const snapshot = (scheduler, journal) => createPrimePlaybackEvidence({ trials, metrics, scheduler, journal });
  return { engine, executor, metrics, trials, snapshot };
}

test('actual scheduler/executor/engine receipts join retained anonymous history across repeated packet runs', async () => {
  const journal = new PacketPlaybackJournal(), value = action(), first = journal.beginRun([value]);
  const h = composed({ evidenceRun: first });
  for (const run of [first, journal.beginRun([value])]) {
    const executor = new ManifestActionExecutor({ transitionEngine: h.engine, adapter: h.engine.adapter, evidenceRun: run });
    const scheduler = new ManifestActionScheduler({ actions: [value], executor, onEvent: run.onSchedulerEvent });
    await scheduler.observe({ currentTimeMs: value.triggerMs - 100, paused: false });
    await scheduler.observe({ currentTimeMs: value.triggerMs + 7, paused: false });
    await scheduler.cancelAll(); run.close('cleared', scheduler.observerFailures);
  }
  const output = h.snapshot(null, journal);
  assert.deepEqual(output.automaticPacketPlayback.records.map(record => [record.runSequence, record.actionOrdinal]), [[1, 1], [2, 1]]);
  for (const record of output.automaticPacketPlayback.records) {
    assert.equal(record.timelineErrorMs, 19);
    assert.ok(output.packetJournal.events.some(event => event.runSequence === record.runSequence && event.actionOrdinal === record.actionOrdinal && event.outcome === 'completed'));
  }
  assert.equal(output.currentPacketScheduler, null);
  assert.equal(output.packetJournal.events.filter(event => event.event === 'run-closed').length, 2);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE|1234567|1248267|blob:/);
});

for (const type of ['REPLACE', 'INSERT']) test(`actual ${type} executor/engine receipts reach redacted automatic evidence without manual trials`, async () => {
  const h = composed(), value = action(type === 'INSERT' ? { type, resumeMs: 1234567, expectedDurationMs: 90000 } : {});
  await h.executor.executeLocal(value, 1234574);
  const output = h.snapshot(), record = output.automaticPacketPlayback.records[0];
  assert.equal(output.manualTrials.records.length, 0); assert.deepEqual(output.executingBuild, EXECUTING_BUILD);
  assert.equal(record.action, type); assert.equal(record.clipDurationMs, value.expectedDurationMs);
  assert.equal(record.triggerErrorMs, 7); assert.equal(record.timelineErrorMs, 19);
  assert.equal(record.timelineErrorBasis, 'native-uncover-receipt'); assert.equal(record.metrics.nativeSeekErrorMs, -3);
  assert.equal(record.metrics.localUnplayedTailMs, 0); assert.equal(record.outcome, 'success');
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE|1234567|1248267|1234574|blob:|clipUrl|segmentId/);
});

test('actual failed execution exports recovery receipt and finite error code, not the private exception', async () => {
  const h = composed({ fail: true }); await assert.rejects(h.executor.executeLocal(action(), 1234567));
  const record = h.snapshot().automaticPacketPlayback.records[0];
  assert.equal(record.outcome, 'failed'); assert.equal(record.errorCode, 'local-media-failure');
  assert.equal(record.timelineErrorBasis, 'native-recovery-receipt'); assert.equal(record.timelineErrorMs, 13);
  assert.equal(record.metrics.nativeUncoverErrorMs, null); assert.doesNotMatch(JSON.stringify(record), /PRIVATE|1234567/);
});

test('actual cancellation keeps recovery evidence without recording success or discarding the attempted cycle', async () => {
  const h = composed({ play: signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  const running = h.executor.executeLocal(action(), 1234567), rejected = assert.rejects(running, { name: 'AbortError' });
  await turn(); await h.executor.cancel('PRIVATE-CANCEL-REASON'); await rejected;
  const record = h.snapshot().automaticPacketPlayback.records[0];
  assert.equal(record.outcome, 'cancelled'); assert.equal(record.timelineErrorMs, 13); assert.equal(record.errorCode, 'cancelled');
  assert.doesNotMatch(JSON.stringify(record), /PRIVATE/);
});

test('missing and non-finite receipt samples remain null even when execution finishes', async () => {
  const h = composed({ receipt: { errorMs: NaN, nativeResumeMs: Infinity } });
  await h.executor.executeLocal(action(), 1234567);
  const record = h.snapshot().automaticPacketPlayback.records[0];
  assert.equal(record.outcome, 'success'); assert.equal(record.timelineErrorMs, null);
  assert.equal(record.metrics.nativeUncoverErrorMs, null); assert.equal(record.metrics.nativeFrameWaitMs, null);
  assert.equal(record.metrics.nativeResumeMs, null); assert.equal(Object.hasOwn(record, 'passed'), false);
});

for (const presentation of ['hidden-document', 'frame-timeout', 'prerolled', 'prerolled-without-frame-callback', 'presented', 'unsupported']) {
  test(`completed execution retains ${presentation} without inventing a frame sample`, async () => {
    const h = composed({ receipt: { presentation, errorMs: 140 } });
    await h.executor.executeLocal(action(), 1234567);
    const record = h.snapshot().automaticPacketPlayback.records[0];
    assert.equal(record.outcome, 'success');
    assert.equal(record.nativePresentation, presentation);
    assert.equal(record.metrics.nativeFrameWaitMs, null);
    assert.equal(record.timelineErrorMs, 140);
  });
}

test('missing or arbitrary presentation details are not exported or inferred from numeric timings', async () => {
  for (const presentation of [undefined, 'PRIVATE-path-or-message', { source: 'PRIVATE' }]) {
    const h = composed({ receipt: { presentation, frameWaitMs: 20, compositorWaitMs: 0 } });
    await h.executor.executeLocal(action(), 1234567);
    const record = h.snapshot().automaticPacketPlayback.records[0];
    assert.equal(record.nativePresentation, null);
    assert.equal(record.metrics.nativeFrameWaitMs, 20);
    assert.doesNotMatch(JSON.stringify(record), /PRIVATE/);
  }
});

test('planned trigger uses the retained cut observation without changing scheduler coordinates', async () => {
  const h = composed({ cutObservation: { currentTimeMs: 1234520, frameTimeMs: 1234510 } });
  await h.executor.executeLocal(action(), 1234567);
  const cycle = h.metrics.snapshot().cycles[0];
  const record = h.snapshot().automaticPacketPlayback.records[0];
  assert.equal(cycle.observedTimeMs, 1234567, 'scheduler wake coordinate is preserved');
  assert.equal(record.triggerErrorBasis, 'native-cut-clock');
  assert.equal(record.triggerErrorMs, -47);
  assert.equal(record.nativeCutFrameErrorMs, -57);
  assert.doesNotMatch(JSON.stringify(record), /1234520|1234510|PRIVATE/);
});

test('a planned cut with missing clocks cannot fall back to the scheduled zero error', async () => {
  const h = composed({ cutObservation: { currentTimeMs: null, frameTimeMs: NaN } });
  await h.executor.executeLocal(action(), 1234567);
  const record = h.snapshot().automaticPacketPlayback.records[0];
  assert.equal(record.triggerErrorBasis, 'native-cut-clock');
  assert.equal(record.triggerErrorMs, null);
  assert.equal(record.nativeCutFrameErrorMs, null);
});

test('ordinary observations have an explicit timing basis and legacy records stay unclassified', async () => {
  const h = composed();
  await h.executor.executeLocal(action(), 1234574);
  let record = h.snapshot().automaticPacketPlayback.records[0];
  assert.equal(record.triggerErrorBasis, 'scheduler-observation');
  assert.equal(record.triggerErrorMs, 7);
  assert.equal(record.nativeCutFrameErrorMs, null);
  delete h.metrics.cycles[0].triggerErrorBasis;
  record = h.snapshot().automaticPacketPlayback.records[0];
  assert.equal(record.triggerErrorBasis, null);
});

test('manual cycles are not relabelled as automatic packet attempts', async () => {
  const h = composed(); h.engine.arm({ ...action(), action: 'REPLACE' }); await h.engine.execute(1234567);
  assert.equal(h.metrics.snapshot().cycles.length, 1); assert.equal(h.snapshot().automaticPacketPlayback.records.length, 0);
});

test('projection rejects arbitrary nested diagnostics, source coordinates and unknown enum values', () => {
  const snapshot = { retention: { droppedCycles: 0, path: 'PRIVATE' }, events: [{ source: 'PRIVATE' }], cycles: [{
    evidenceOrigin: 'automatic-packet', id: 'PRIVATE', segmentId: 'PRIVATE', sequence: 'PRIVATE', triggerMs: 1234567,
    observedTimeMs: 1234568, status: 'PRIVATE', action: 'PRIVATE', expectedDurationMs: NaN,
    detail: { errorCode: 'PRIVATE', source: 'PRIVATE' }, timings: { nativeUncoverErrorMs: 5, path: 'PRIVATE', nativeResumeMs: Infinity }
  }] };
  const output = automaticPacketEvidence(snapshot), record = output.records[0];
  assert.equal(record.sequence, null); assert.equal(record.action, 'unknown'); assert.equal(record.outcome, 'unknown');
  assert.equal(record.errorCode, null); assert.equal(record.clipDurationMs, null); assert.equal(record.metrics.nativeResumeMs, null);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE|1234567|1234568|segmentId|observedTimeMs/);
});

test('bounded shared retention discloses eviction and keeps monotonically assigned cycle sequences', () => {
  const h = composed();
  for (let i = 0; i < 1005; i++) {
    h.metrics.startCycle({ ...action(), action: 'REPLACE', evidenceOrigin: i === 0 ? 'unspecified' : 'automatic-packet' }, 1234567);
    h.metrics.finishCycle('success');
  }
  const output = h.snapshot().automaticPacketPlayback;
  assert.equal(output.records.length, 1000); assert.equal(output.records[0].sequence, 6);
  assert.equal(output.records.at(-1).sequence, 1005); assert.equal(output.retention.droppedSharedCycles, 5);
  assert.equal(output.retention.droppedCountIncludesOtherTransitionOrigins, true);
  const before = JSON.stringify(output); h.metrics.cycles[0].timings.nativeUncoverErrorMs = 999;
  assert.equal(JSON.stringify(output), before, 'export snapshot does not retain mutable raw metrics');
});

test('current scheduler skips appear without private action IDs or invented execution receipts', async () => {
  const h = composed(), scheduler = new ManifestActionScheduler({ actions: [action()], executor: h.executor });
  await scheduler.observe({ currentTimeMs: 1300000, paused: false });
  const output = h.snapshot(scheduler);
  assert.deepEqual(output.currentPacketScheduler.actions, [{ ordinal: 1, action: 'REPLACE', outcome: 'skipped' }]);
  assert.equal(output.automaticPacketPlayback.records.length, 0);
  assert.match(output.currentPacketScheduler.scope, /bounded historical outcomes/);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE|1300000/);
  assert.equal(h.snapshot().currentPacketScheduler, null);
});

test('both actual panel export handlers serialize automatic evidence and release their download URLs', async () => {
  const journal = new PacketPlaybackJournal(), run = journal.beginRun([action()]);
  const h = composed({ evidenceRun: run }); await h.executor.executeLocal(action(), 1234567); run.close();
  const nodes = new Map(), blobs = [], anchors = [], timers = [], revoked = [];
  function node(selector) { if (!nodes.has(selector)) nodes.set(selector, { disabled: true, events: {}, addEventListener(name, fn) { this.events[name] = fn; } }); return nodes.get(selector); }
  installEvidenceExport({ trials: h.trials, metrics: h.metrics, getScheduler: () => null, journal, spikeBuild: 'controlled-test',
    Blob, shadow: { querySelector: node }, panelHost: { dataset: {} }, updateTrialSummary() {}, commandOutput: {},
    document: { createElement() { const anchor = { click() { this.clicked = true; } }; anchors.push(anchor); return anchor; } },
    URL: { createObjectURL(blob) { blobs.push(blob); return `blob:test-${blobs.length}`; }, revokeObjectURL(url) { revoked.push(url); } },
    setTimeout(callback) { timers.push(callback); }
  });
  assert.equal(node('[data-action="export-packet-evidence"]').disabled, false);
  for (const selector of ['[data-action="export-packet-evidence"]', '[data-action="export-trials"]']) node(selector).events.click();
  assert.equal(blobs.length, 2);
  for (const blob of blobs) {
    const value = JSON.parse(await blob.text()); assert.equal(value.automaticPacketPlayback.records.length, 1);
    assert.equal(value.packetJournal.events.length, 2); assert.equal(value.automaticPacketPlayback.records[0].runSequence, 1);
    assert.equal(value.kind, 'prime-playback-evidence'); assert.doesNotMatch(JSON.stringify(value), /PRIVATE|1234567/);
  }
  assert.ok(anchors.every(anchor => anchor.clicked && anchor.download === 'prime-playback-evidence-vcontrolled-test.json'));
  timers.forEach(callback => callback()); assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2']);
  node('[data-action="clear-trials"]').events.click();
  assert.equal(h.snapshot().automaticPacketPlayback.records.length, 1, 'manual clear does not imply automatic history was cleared');
});

test('clamped seek error retains requested-target basis through anonymous packet evidence',async()=>{
  const h=composed({seekOffset:-247,commandOffset:-250});await h.executor.executeLocal(action(),1234574);
  const output=h.snapshot();assert.equal(output.automaticPacketPlayback.records[0].metrics.nativeSeekErrorMs,-247);
  assert.doesNotMatch(JSON.stringify(output),/PRIVATE|1234567|1248267|1248017|1248020|blob:|requestedTargetMs|commandTargetMs/);
});

test('seek-entry displacement stays separate from trigger error through executor, engine and export', async () => {
  const h = composed(), value = action();
  await h.executor.executeLocal(value, value.triggerMs + 7);
  await h.executor.executeLocal(value, value.triggerMs + 4757, { entryFraction: 0.35 });
  const cycles = h.metrics.snapshot().cycles;
  const records = h.snapshot().automaticPacketPlayback.records;
  assert.equal(h.metrics.snapshot().schemaVersion, 2);
  assert.equal(h.snapshot().automaticPacketPlayback.schemaVersion, 2);
  for (const [ordinary, entry] of [cycles, records]) {
    assert.equal(ordinary.entryMode, 'from-start');
    assert.equal(ordinary.triggerErrorMs, 7);
    assert.equal(ordinary.entryOffsetMs, null);
    assert.equal(entry.entryMode, 'seek-entry');
    assert.equal(entry.triggerErrorMs, null);
    assert.equal(entry.triggerErrorBasis, 'not-applicable');
    assert.equal(entry.nativeCutFrameErrorMs, null);
    assert.equal(entry.entryOffsetMs, 4757);
    assert.equal(entry.status ?? entry.outcome, 'success');
  }
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE|1234567|1248267|blob:|entryFraction/);
});

test('legacy and invalid entry classifications remain unknown rather than becoming from-start samples', () => {
  const cycle = { evidenceOrigin: 'automatic-packet', triggerErrorMs: 4757, entryOffsetMs: 4757 };
  const output = automaticPacketEvidence({ cycles: [cycle, { ...cycle, entryMode: 'PRIVATE' },
    { ...cycle, entryMode: 'seek-entry', entryOffsetMs: Infinity }] });
  assert.deepEqual(output.records.map(r => r.entryMode), ['unknown', 'unknown', 'seek-entry']);
  assert.deepEqual(output.records.map(r => r.entryOffsetMs), [null, null, null]);
  assert.deepEqual(output.records.map(r => r.triggerErrorMs), [4757, 4757, null]);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE/);
});
