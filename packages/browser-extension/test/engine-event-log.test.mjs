import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EngineEventLog, engineEventExport, sanitizeDetail, safeCode, ENGINE_EVENT_SCHEMA, ENGINE_EVENT_LIMIT } from '../src/engine-event-log.mjs';
import { MetricsRecorder } from '../src/metrics.mjs';
import { withCatalogActivity } from '../src/catalog-activity-executor.mjs';
import { createPacketSessionController } from '../src/packet-session-controller.mjs';
import { PacketPlaybackJournal } from '../src/packet-playback-journal.mjs';
import { OperationContext } from '../src/operation-context.mjs';
import { ManifestActionScheduler } from '../src/manifest-action-scheduler.mjs';
import { ManifestActionExecutor } from '../src/manifest-action-executor.mjs';
import { createGuardedExecutor } from '../src/playback-session.mjs';
import { StandardTransitionAdapter } from '../src/standard-transition-adapter.mjs';
import { validLocalResult } from '../src/local-message-schema.mjs';

// 0.65.9: the developer-mode engine event export. Logging only.

const PRIVATE = /blob:|https?:|asset:|PRIVATE-VIDEO|0123456789abcdef0123456789abcdef|Some Title|tok-secret|6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f/;

test('the ring buffer keeps the last N events in order, counts what it dropped, and records nothing when off', () => {
  let clock = 0;
  const log = new EngineEventLog({ now: () => ++clock, limit: 5 });
  log.record('sync', 'ignored-while-off', {});
  assert.equal(log.count, 0, 'off: nothing recorded');
  log.setEnabled(true);
  for (let i = 0; i < 8; i++) log.record('scheduler', `e${i}`, { i });
  const entries = log.entries();
  assert.equal(entries.length, 5);
  assert.deepEqual(entries.map(entry => entry[2]), ['e3', 'e4', 'e5', 'e6', 'e7']);
  assert.ok(entries.every((entry, index) => index === 0 || entry[0] > entries[index - 1][0]), 'time-ordered');
  assert.equal(log.dropped, 3);
  for (let i = 0; i < 3 * 5; i++) log.record('sync', 'x', null);
  assert.equal(log.entries().length, 5, 'never more than the limit');
  log.setEnabled(false);
  assert.equal(log.count, 0, 'turning developer mode off clears the log');
  assert.deepEqual(log.entries(), []);
  assert.equal(new EngineEventLog().limit, ENGINE_EVENT_LIMIT);
  assert.equal(ENGINE_EVENT_LIMIT, 2000);
});

test('details keep numbers, booleans and short codes only; URLs, hashes, UUIDs, free text and sensitive field names are left out', () => {
  const clean = sanitizeDetail({
    segmentId: 'scene-001', reason: 'short-gap', via: 'planned-cut', triggerMs: 12_345.678, ok: true, none: null, nan: NaN,
    clipUrl: 'blob:https://example.invalid/PRIVATE-VIDEO', src: 'x', assetSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    packetId: '6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f', note: '6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f', hex: '0123456789abcdef0123456789abcdef',
    title: 'Some Title', label: 'Some Title', link: 'https://example.invalid/?token=tok-secret', licenseToken: 'tok', leaseId: 'lease-1',
    accountId: 'a1', deviceId: 'd1', userName: 'u', sourceKey: 'k', fileName: 'f', authHeader: 'h',
    nested: { atMs: 1.04, url: 'https://example.invalid', deeper: { code: 'ok', deepest: { tooDeep: { x: 1 } } } },
    list: Array.from({ length: 40 }, (_, i) => i), fn: () => 1
  });
  assert.deepEqual(clean, {
    segmentId: 'scene-001', reason: 'short-gap', via: 'planned-cut', triggerMs: 12_345.7, ok: true, none: null, nan: null,
    note: null, hex: null, label: null, link: null,
    nested: { atMs: 1, deeper: { code: 'ok', deepest: {} } },
    list: Array.from({ length: 32 }, (_, i) => i)
  });
  assert.doesNotMatch(JSON.stringify(clean), PRIVATE);
});

function exportFixture() {
  let clock = 100;
  const metrics = new MetricsRecorder({ now: () => clock, wallClock: () => '2026-11-01T00:00:00.000Z' });
  const log = new EngineEventLog({ now: () => clock });
  log.setEnabled(true);
  metrics.startCycle({ id: 'scene-001', action: 'REPLACE', triggerMs: 10_000, resumeMs: 12_000, evidenceOrigin: 'automatic-packet' }, 10_000, null);
  clock = 101; metrics.mark('staged', { segmentId: 'scene-001', via: 'short-gap-handover', clipUrl: 'blob:PRIVATE-VIDEO' });
  metrics.stageTrace({ via: 'short-gap-handover', planCutRegisteredMs: -120, cut: { via: 'planned', revealDeferred: false } });
  metrics.finishCycle('success', { nativePresentation: 'prerolled' });
  clock = 102; log.record('scheduler', 'source-check-start', {});
  clock = 103; log.record('sync', 'native-pause-issued', { via: 'planned-cut', triggerMs: 10_000, mediaMs: 9_958.3 });
  clock = 104; log.record('engine', 'planned-cut-registered', { segmentId: 'scene-001', triggerMs: 10_000, handover: true });
  clock = 105; log.record('scheduler', 'scheduler-busy', { busy: true, mediaMs: 9_990, link: 'https://example.invalid/?token=tok-secret' });
  clock = 106; log.record('sync', 'clip-first-frame', { segmentId: 'scene-001', callbackAt: 106.2, displayAt: 120.4, playingAt: 90.1, mediaMs: 40 });
  log.record('bogus-kind', 'x', {}); log.record('sync', 'not a code', {});
  return { metrics, log };
}

test('the export: schema, clock, retention, and time-ordered engine, scheduler and sync lists plus stage traces, all redacted', () => {
  const { metrics, log } = exportFixture();
  const report = engineEventExport({ log, metrics, timeOriginMs: 1_762_000_000_000.25, wallClock: () => '2026-11-01T00:00:01.000Z' });
  assert.equal(report.schema, ENGINE_EVENT_SCHEMA);
  assert.equal(report.recordedAt, '2026-11-01T00:00:01.000Z');
  assert.deepEqual(report.clock, { domain: 'performance.now', timeOriginMs: 1_762_000_000_000.3 });
  assert.deepEqual(Object.keys(report), ['schema', 'recordedAt', 'executingBuild', 'clock', 'retention', 'engineEvents', 'schedulerEvents', 'syncMarks', 'cycles', 'limitations']);
  assert.equal(report.retention.maximumEvents, ENGINE_EVENT_LIMIT);
  assert.equal(report.retention.droppedEvents, 0);
  assert.deepEqual(report.engineEvents.map(event => event.name), ['cycle-started', 'staged', 'cycle-finished', 'planned-cut-registered']);
  assert.deepEqual(report.engineEvents[1], { atMs: 101, name: 'staged', detail: { segmentId: 'scene-001', via: 'short-gap-handover' } });
  assert.deepEqual(report.schedulerEvents, [
    { atMs: 102, name: 'source-check-start', detail: {} },
    { atMs: 105, name: 'scheduler-busy', detail: { busy: true, mediaMs: 9_990, link: null } }]);
  assert.deepEqual(report.syncMarks.map(mark => mark.name), ['native-pause-issued', 'clip-first-frame']);
  assert.deepEqual(report.syncMarks[1].detail, { segmentId: 'scene-001', callbackAt: 106.2, displayAt: 120.4, playingAt: 90.1, mediaMs: 40 });
  assert.equal(report.cycles.length, 1);
  assert.deepEqual(report.cycles[0].stage, { via: 'short-gap-handover', planCutRegisteredMs: -120, cut: { via: 'planned', revealDeferred: false } });
  assert.equal(report.cycles[0].segmentId, 'scene-001');
  assert.doesNotMatch(JSON.stringify(report), PRIVATE);
  JSON.parse(JSON.stringify(report));
});

test('the export exists in developer mode only', () => {
  const { metrics, log } = exportFixture();
  log.setEnabled(false);
  assert.throws(() => engineEventExport({ log, metrics }), /engine-events-developer-mode-only/);
  assert.throws(() => engineEventExport({ log: null, metrics }), /engine-events-developer-mode-only/);
});

test('the export is bounded: the last 2000 log entries and the last 200 cycles', () => {
  let clock = 0;
  const log = new EngineEventLog({ now: () => ++clock });
  log.setEnabled(true);
  for (let i = 0; i < 2500; i++) log.record('sync', 'cover-commit', { via: 'transition' });
  const metrics = new MetricsRecorder({ now: () => ++clock, wallClock: () => '2026-11-01T00:00:00.000Z' });
  for (let i = 0; i < 250; i++) { metrics.startCycle({ id: `s${i}`, triggerMs: i * 1000, resumeMs: i * 1000 + 500 }, i * 1000); metrics.finishCycle('success'); }
  const report = engineEventExport({ log, metrics });
  assert.equal(report.syncMarks.length, 2000);
  assert.equal(report.retention.droppedEvents, 500);
  assert.equal(report.cycles.length, 200);
  assert.equal(report.retention.droppedCycles, 50);
  assert.ok(report.engineEvents.length <= 2000);
});

test('catalog activity round trips are timed around the same promise; without the hook nothing changes', async () => {
  const calls = [], events = [];
  let release;
  const overlay = { catalogActivity: (id, active) => { calls.push([id, active]); return active ? new Promise(resolve => { release = resolve; }) : Promise.resolve(); } };
  const base = { executeLocal: async () => ({ status: 'success' }) };
  const timed = withCatalogActivity(base, overlay, { onEvent: (name, detail) => events.push([name, detail]) });
  const running = timed.executeLocal({ id: 'scene-001' }, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [['catalog-activity-start', { actionId: 'scene-001', active: true }]]);
  release();
  assert.deepEqual(await running, { status: 'success' });
  assert.deepEqual(events.map(([name, detail]) => `${name}:${detail.active}:${detail.result ?? ''}`),
    ['catalog-activity-start:true:', 'catalog-activity-end:true:ok', 'catalog-activity-start:false:', 'catalog-activity-end:false:ok']);
  // Developer mode off: the same round trips, nothing timed.
  const quiet = [];
  const off = withCatalogActivity(base, { catalogActivity: () => Promise.resolve() }, { onEvent: (name) => quiet.push(name), enabled: () => false });
  assert.deepEqual(await off.executeLocal({ id: 'scene-001' }, 0), { status: 'success' });
  assert.deepEqual(quiet, []);
  const plainCalls = [];
  const plain = withCatalogActivity(base, { catalogActivity: (id, active) => { plainCalls.push([id, active]); return Promise.resolve(); } });
  assert.deepEqual(await plain.executeLocal({ id: 'scene-001' }, 0), { status: 'success' });
  assert.deepEqual(plainCalls, calls);
});

test("the packet session times source checks and the scheduler's own events into the log", async () => {
  const log = new EngineEventLog();
  log.setEnabled(true);
  const node = () => ({ disabled: false, textContent: '', hidden: false, addEventListener() {}, replaceChildren() {} });
  const state = { session: { packet: { manifest: { segments: [{ segment_id: 'scene-001', action: 'REPLACE' }] } }, trust: 'local-user', assetUrls: new Map() }, scheduler: null, arming: null };
  const controller = createPacketSessionController({ state, operations: new OperationContext(), journal: new PacketPlaybackJournal(),
    ui: { armButton: node(), cancelButton: node(), navigation: node(), navigationList: node(), navigationOutput: node(), packetOutput: node(), panelHost: { dataset: {} } },
    engine: { async preload() {}, async cancelPreload() {}, arm() {}, async execute() { return { status: 'success' }; }, async cancel() {} },
    adapter: { async seek() {} }, overlay: { async clear() {} }, commandAdapter: { readState: () => ({ currentTimeMs: 900, paused: true }) },
    assertSource: async () => ({}), eventLog: log,
    deps: { ManifestActionExecutor, ManifestActionScheduler, createGuardedExecutor,
      compileLocalUserEditActions: () => [{ id: 'scene-001', type: 'REPLACE', triggerMs: 1000, resumeMs: 6000, clipUrl: 'blob:PRIVATE-VIDEO' }] } });
  await controller.arm();
  assert.ok(state.scheduler, 'armed');
  // The seek observation at arm starts the preload, which passes the guarded source check.
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  const names = log.entries().map(entry => `${entry[1]}:${entry[2]}`);
  assert.ok(names.includes('scheduler:scheduler-reset-pending'), names.join(' '));
  assert.ok(names.includes('scheduler:source-check-start') && names.includes('scheduler:source-check-end'), names.join(' '));
  const report = engineEventExport({ log, metrics: null });
  assert.equal(report.schedulerEvents.find(event => event.name === 'source-check-end').detail.result, 'passed');
  assert.doesNotMatch(JSON.stringify(report), PRIVATE);
  await controller.clear('viewer-user-stopped');
});

test('adapter sync marks: a planned cut records the pause, the cover and the wake-up; without the log the cut is the same', () => {
  const run = withLog => {
    const frames = new Map(); let id = 0;
    const player = new EventTarget();
    Object.assign(player, { muted: false, paused: false, seeking: false, playbackRate: 1, currentTime: 9.9, readyState: 4, volume: 1,
      requestVideoFrameCallback(callback) { frames.set(++id, callback); return id; }, cancelVideoFrameCallback(handle) { frames.delete(handle); },
      pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } });
    const adapter = new StandardTransitionAdapter({ document: { defaultView: {} }, passiveAdapter: { activePlayer: () => player },
      commandAdapter: { readState: () => ({ currentTimeMs: 9900, paused: player.paused }), pause: async () => {}, play: async () => {} } });
    const log = new EngineEventLog();
    if (withLog) { log.setEnabled(true); adapter.eventLog = log; }
    adapter.stagedHost = { style: {}, dataset: {}, isConnected: true, remove() {} };
    const woken = [];
    adapter.stateSubscribers.add(state => woken.push(state));
    adapter.planCut(10_000, { redeliverWake: true });
    const present = (mediaTime, presentedFrames) => { for (const [handle, callback] of [...frames]) { frames.delete(handle); callback(performance.now(), { mediaTime, presentedFrames, expectedDisplayTime: performance.now() }); } };
    present(9.933, 1); present(9.967, 2);
    const result = { paused: player.paused, visibility: adapter.stagedHost.style.visibility, woken, names: log.entries().map(entry => entry[2]) };
    adapter.releaseCutHold();
    return result;
  };
  const on = run(true), off = run(false);
  // 0.65.10: the cut rule's frame callbacks are logged too, after the rule has acted.
  assert.deepEqual(on.names, ['cut-frame', 'native-pause-issued', 'cover-commit', 'planned-cut-wake-sent', 'cut-frame', 'cut-plan-end']);
  assert.deepEqual(off.names, []);
  assert.deepEqual({ ...on, names: null }, { ...off, names: null });
});

test("the renderer may report the clip's 'playing' time with its first frame; nothing looser", () => {
  const value = firstFrame => ({ type: 'result', id: 1, ok: true, value: { durationMs: 2000, localTimeAtEndMs: 2000, unplayedTailMs: 0, frameHoldMode: 'natural-end', heldFrameMediaTimeMs: null, localEnded: true, firstFrame } });
  const epoch = 1_762_000_000_000;
  assert.equal(validLocalResult(value({ callbackMs: epoch, displayMs: epoch + 16, mediaMs: 40 }), 'play'), true, 'the 0.65.7 shape');
  assert.equal(validLocalResult(value({ callbackMs: epoch, displayMs: epoch + 16, mediaMs: 40, playingMs: epoch - 30 }), 'play'), true);
  assert.equal(validLocalResult(value({ callbackMs: epoch, displayMs: epoch + 16, mediaMs: 40, playingMs: 'soon' }), 'play'), false);
  assert.equal(validLocalResult(value({ callbackMs: epoch, displayMs: epoch + 16, mediaMs: 40, extra: 1 }), 'play'), false);
});

test('main.mjs: the log follows developer (Advanced) mode, its button is in the developer panel, and scene timing keeps 60 cycles', async () => {
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/developer-panel.mjs', import.meta.url), 'utf8');
  assert.match(main, /const setAdvancedMode = advanced => \{\n    setEngineEventLog\(advanced === true\);/);
  assert.match(main, /eventLog: engineEventLog \}\);/);
  assert.match(main, /readEngineEvents: \(\) => engineEventExport\(\{ log: engineEventLog, metrics: primeTransitionMetrics \}\)/);
  assert.match(main, /cycles:primeTransitionMetrics\.snapshot\(\)\.cycles\.slice\(-60\)/);
  assert.match(panel, /data-action="export-engine-events"/);
});

// 0.65.10: cycle IDs are `<segment UUID>-<n>`. The anchored UUID check let
// them through, so the export carried the segment UUID that segmentId itself drops.
const FIXTURE_UUID = '6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HEX_RUN_16 = /[0-9a-f]{16,}/i;

test('safeCode leaves out any code containing a UUID (plain, prefixed, suffixed, embedded) or 16+ hex digits', () => {
  for (const value of [
    FIXTURE_UUID, FIXTURE_UUID.toUpperCase(),
    `scene-${FIXTURE_UUID}`, `${FIXTURE_UUID}-14`, `${FIXTURE_UUID}-1`, `x${FIXTURE_UUID}`, `${FIXTURE_UUID}x`,
    `cut.${FIXTURE_UUID}.end`, `a-${FIXTURE_UUID}-b-7`,
    '0123456789abcdef', '0123456789ABCDEF', 'run-0123456789abcdef', '0123456789abcdef-9', 'x.fedcba98765432100.y',
    '6f1c2b9e1d2a4c3b9e8f0a1b2c3d4e5f', `sha-${'a'.repeat(40)}`, '1234567890123456'
  ]) assert.equal(safeCode(value), null, value);
  // Short codes, hex shorter than 16 and numbers stay.
  for (const value of ['scene-001', 'short-gap-handover', 'during-previous', 'unstaged-fallback', 'planned-cut', 'faded', 'abcdef0123', '0123456789abcde', 'r1', '806121'])
    assert.equal(safeCode(value), value, value);
});

test('id-like fields become per-export local numbers; the raw value never leaves, and segmentId stays a code', () => {
  const clean = sanitizeDetail({
    cycleId: `${FIXTURE_UUID}-14`, actionId: FIXTURE_UUID, id: 'abc', stepID: 'x', other_id: 'y', segmentId: 'scene-008',
    nextSegmentId: `${FIXTURE_UUID}`, reason: `${FIXTURE_UUID}-9`, nested: { cycleId: `${FIXTURE_UUID}-14`, actionId: null },
    list: [{ cycleId: `${FIXTURE_UUID}-15` }], packetId: FIXTURE_UUID, deviceId: 'd1'
  });
  assert.deepEqual(clean, {
    cycleId: 1, actionId: 1, id: 1, stepID: 1, other_id: 1, segmentId: 'scene-008', nextSegmentId: null, reason: null,
    nested: { cycleId: 1, actionId: null }, list: [{ cycleId: 2 }]
  });
  assert.doesNotMatch(JSON.stringify(clean), UUID_ANYWHERE);
});

test('the export: catalog-style UUID segments leave no UUID or hex run anywhere; cycleId joins cycles[].cycleRef', () => {
  let clock = 100;
  const metrics = new MetricsRecorder({ now: () => clock, wallClock: () => '2026-11-01T00:00:00.000Z' });
  const log = new EngineEventLog({ now: () => clock });
  log.setEnabled(true);
  const segments = ['0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'f0e1d2c3-b4a5-4968-8776-655443322110']; // made up
  for (const [index, id] of segments.entries()) {
    clock += 10; metrics.startCycle({ id, action: 'REPLACE', triggerMs: 10_000 * (index + 1), resumeMs: 10_000 * (index + 1) + 500 }, 10_000 * (index + 1), null);
    metrics.mark('state', { state: 'COMPLETE', cycleId: `${id}-${index + 1}` });
    log.record('scheduler', 'catalog-activity-start', { actionId: id, active: true });
    log.record('scheduler', 'catalog-activity-end', { actionId: id, active: true, result: 'ok' });
    log.record('engine', 'planned-cut-registered', { segmentId: id, triggerMs: 10_000 * (index + 1), handover: index === 1 });
    metrics.finishCycle('success', { nativePresentation: 'prerolled' });
  }
  const report = engineEventExport({ log, metrics, timeOriginMs: 1_762_000_000_000, wallClock: () => '2026-11-01T00:00:01.000Z' });
  const text = JSON.stringify({ ...report, executingBuild: null });
  assert.doesNotMatch(text, UUID_ANYWHERE);
  assert.doesNotMatch(text, HEX_RUN_16);
  for (const id of segments) for (const part of id.split('-')) if (part.length >= 8) assert.ok(!text.includes(part), part);
  assert.deepEqual(report.cycles.map(cycle => [cycle.sequence, cycle.cycleRef, cycle.segmentId]), [[1, 1, null], [2, 2, null]]);
  const started = report.engineEvents.filter(event => event.name === 'cycle-started').map(event => event.detail.cycleId);
  const finished = report.engineEvents.filter(event => event.name === 'cycle-finished').map(event => event.detail.cycleId);
  const complete = report.engineEvents.filter(event => event.name === 'state' && event.detail.state === 'COMPLETE').map(event => event.detail.cycleId);
  assert.deepEqual(started, [1, 2]); assert.deepEqual(finished, [1, 2]); assert.deepEqual(complete, [1, 2]);
  assert.deepEqual(report.schedulerEvents.map(event => event.detail.actionId), [1, 1, 2, 2], 'start and end of one action share a number');
  assert.deepEqual(report.engineEvents.filter(event => event.name === 'planned-cut-registered').map(event => event.detail.segmentId), [null, null]);
  // A second export numbers from 1 again (local to each export).
  assert.deepEqual(engineEventExport({ log, metrics }).cycles.map(cycle => cycle.cycleRef), [1, 2]);
});

test('the actual 0.65.9 cycle-ID shape from real playback is left out of every place it appeared', () => {
  // Shape only (UUID, dash, sequence); the fixture UUIDs are made up.
  const detail = { cycleId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-14', entryMode: 'from-start', triggerErrorMs: 68.9 };
  assert.deepEqual(sanitizeDetail(detail), { cycleId: 1, entryMode: 'from-start', triggerErrorMs: 68.9 });
  assert.deepEqual(sanitizeDetail({ state: 'COMPLETE', note: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-14' }), { state: 'COMPLETE', note: null });
});

// 0.65.10 (measurement for a late cut after a short gap): every frame callback the cut rule considers
// near the trigger, its decision and tolerance, and presentedFrames gaps. Logging only.
function cutRun({ withLog, deferLateReveal = false, triggerMs = 806_121, frames: sequence, abortAfter = null }) {
  const frames = new Map(); let id = 0;
  const player = new EventTarget();
  Object.assign(player, { muted: false, paused: false, seeking: false, playbackRate: 1, currentTime: sequence[0][0], readyState: 4, volume: 1,
    requestVideoFrameCallback(callback) { frames.set(++id, callback); return id; }, cancelVideoFrameCallback(handle) { frames.delete(handle); },
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }, play() { this.paused = false; return Promise.resolve(); } });
  const adapter = new StandardTransitionAdapter({ document: { defaultView: {} }, passiveAdapter: { activePlayer: () => player },
    commandAdapter: { readState: () => ({ currentTimeMs: player.currentTime * 1000, paused: player.paused }), pause: async () => {}, play: async () => {} } });
  const log = new EngineEventLog();
  if (withLog) { log.setEnabled(true); adapter.eventLog = log; }
  adapter.stagedHost = { style: {}, dataset: {}, isConnected: true, remove() {} };
  const predictions = [], woken = [];
  adapter.stateSubscribers.add(state => woken.push(state));
  adapter.planCut(triggerMs, { deferLateReveal, onPredict: (...args) => predictions.push(args.length) });
  let step = 0;
  for (const [mediaTime, presentedFrames] of sequence) {
    if (abortAfter !== null && step++ === abortAfter) { player.seeking = true; player.dispatchEvent(new Event('seeking')); break; }
    player.currentTime = mediaTime;
    for (const [handle, callback] of [...frames]) { frames.delete(handle); callback(1000 + mediaTime, { mediaTime, presentedFrames, expectedDisplayTime: 1005 + mediaTime }); }
  }
  const result = { paused: player.paused, visibility: adapter.stagedHost.style.visibility ?? null, deferred: adapter.cutRevealDeferred(triggerMs),
    observation: adapter.cutObservation(triggerMs), predictions, woken, pending: frames.size };
  adapter.releaseCutHold();
  const entries = log.entries().filter(entry => entry[2].startsWith('cut-'));
  return { result, entries: entries.map(([, , name, detail]) => ({ name, ...detail })) };
}

test('cut-frame log (0.65.10): a late short-gap cut. A callback on 806080 waits (1/30 s estimate), 806120 has no callback, 806160 is missed; the cut is identical without the log', () => {
  // 25 fps native, plan registered at ~806088: the first callback (806080) has no frame history, so
  // the rule uses 1/30 s and waits (806080 + 33.3 < 806119); 806120 is presented with no callback
  // (presentedFrames +2); the cut lands on 806160, 39 ms past the trigger.
  const sequence = [[806.08, 11], [806.16, 13]];
  const on = cutRun({ withLog: true, deferLateReveal: true, frames: sequence });
  const off = cutRun({ withLog: false, deferLateReveal: true, frames: sequence });
  assert.deepEqual(on.result, off.result, 'cut timing, reveal, observation, predictions and wake-ups are the same');
  assert.equal(on.result.deferred, true);
  assert.equal(off.entries.length, 0, 'nothing is logged outside developer mode');
  const frames = on.entries.filter(entry => entry.name === 'cut-frame');
  assert.deepEqual(frames.map(entry => [Math.round(entry.mediaMs), entry.decision]), [[806_080, 'wait'], [806_160, 'missed']]);
  assert.ok(Math.abs(frames[0].frameMs - 1000 / 30) < 0.01 && Math.abs(frames[1].frameMs - 40) < 0.01, 'the frame estimate the rule used');
  assert.equal(frames[0].toleranceMs, 2);
  assert.ok(Math.abs(frames[0].untilTriggerMs - 41) < 0.01, '806080 is the last frame before the trigger, yet the rule waited');
  assert.ok(Math.abs(frames[1].untilTriggerMs + 39) < 0.01 && Math.abs(frames[1].lateLimitMs - 20) < 0.01);
  assert.ok(frames.every(entry => entry.triggerMs === 806_121 && Number.isFinite(entry.callbackAt) && Number.isFinite(entry.displayAt) && Number.isSafeInteger(entry.presentedFrames)));
  const gap = on.entries.find(entry => entry.name === 'cut-frame-gap');
  assert.deepEqual({ ...gap, mediaMs: Math.round(gap.mediaMs), previousMediaMs: Math.round(gap.previousMediaMs) },
    { name: 'cut-frame-gap', triggerMs: 806_121, mediaMs: 806_160, previousMediaMs: 806_080, presentedFrames: 13, missedCallbacks: 1 });
  assert.deepEqual(on.entries.at(-1), { name: 'cut-plan-end', triggerMs: 806_121, outcome: 'cut', callbacks: 2, logged: 2, earlier: 0, missedFrames: 1, prerollAtCut: false });
  // The export keeps these as sync marks, with numbers and codes only.
  const log = new EngineEventLog(); log.setEnabled(true);
  for (const entry of on.entries) log.record('sync', entry.name, entry);
  const report = engineEventExport({ log });
  assert.deepEqual(report.syncMarks.filter(mark => mark.name === 'cut-frame').map(mark => mark.detail.decision), ['wait', 'missed']);
});

test('cut-frame log (0.65.10): on-time cuts log "cut"; far callbacks are only counted; a dropped plan logs its end; timing is unchanged', () => {
  // 30 fps from 2 s before the trigger: only the last 500 ms are logged one by one.
  const sequence = Array.from({ length: 61 }, (_, i) => [8 + i / 30, i + 1]).filter(([media]) => media < 10);
  const on = cutRun({ withLog: true, triggerMs: 10_000, frames: sequence }), off = cutRun({ withLog: false, triggerMs: 10_000, frames: sequence });
  assert.deepEqual(on.result, off.result);
  const frames = on.entries.filter(entry => entry.name === 'cut-frame');
  assert.equal(frames.at(-1).decision, 'cut');
  assert.ok(frames.every(entry => entry.untilTriggerMs <= 500));
  const end = on.entries.at(-1);
  assert.equal(end.outcome, 'cut'); assert.equal(end.logged, frames.length); assert.equal(end.callbacks, end.logged + end.earlier);
  assert.ok(end.earlier > 0 && end.missedFrames === 0);
  // A seek drops the plan before its cut: 'aborted', and again the same behaviour without the log.
  const aborted = cutRun({ withLog: true, triggerMs: 10_000, frames: sequence, abortAfter: 55 }), plain = cutRun({ withLog: false, triggerMs: 10_000, frames: sequence, abortAfter: 55 });
  assert.deepEqual(aborted.result, plain.result);
  assert.equal(aborted.result.paused, false);
  assert.deepEqual(aborted.entries.at(-1).outcome, 'aborted');
});

// 0.65.11 Fix 2 (logging only): a cut on a frame at or within 2 ms of the trigger is the trigger's own
// frame, already the first replaced picture (one original sample, seen in testing); the log says so.
test("cut-frame log (0.65.11): a trigger-frame cut is labelled 'cut-trigger-frame'; P01's cut on the frame before stays 'cut'", () => {
  const p03 = cutRun({ withLog: true, deferLateReveal: true, frames: [[806.12, 20]] });
  const p03off = cutRun({ withLog: false, deferLateReveal: true, frames: [[806.12, 20]] });
  assert.deepEqual(p03.result, p03off.result, 'logging changes nothing');
  assert.deepEqual(p03.entries.filter(entry => entry.name === 'cut-frame').map(entry => entry.decision), ['cut-trigger-frame']);
  assert.ok(Number.isFinite(p03.entries[0].displayAt) && Number.isFinite(p03.entries[0].callbackAt));
  assert.equal(p03.entries.at(-1).prerollAtCut, true, 'Fix 1 started the clip at this cut');
  assert.equal(p03.result.predictions.length, 1);
  const p01 = cutRun({ withLog: true, deferLateReveal: true, frames: [[806.04, 10], [806.08, 11]] });
  assert.deepEqual(p01.entries.filter(entry => entry.name === 'cut-frame').map(entry => entry.decision), ['wait', 'cut']);
  assert.equal(p01.entries.at(-1).prerollAtCut, false);
  // Exactly 2 ms before the trigger is still the trigger frame; 2.5 ms before is not.
  assert.equal(cutRun({ withLog: true, triggerMs: 10_002, frames: [[10.0, 5]] }).entries.find(entry => entry.name === 'cut-frame').decision, 'cut-trigger-frame');
  assert.equal(cutRun({ withLog: true, triggerMs: 10_002.5, frames: [[10.0, 5]] }).entries.find(entry => entry.name === 'cut-frame').decision, 'cut');
});
