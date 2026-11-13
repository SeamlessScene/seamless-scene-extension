import test from 'node:test';
import assert from 'node:assert/strict';
import { TransitionEngine, SHORT_GAP_MS } from '../src/transition-engine.mjs';
import { ManifestActionScheduler } from '../src/manifest-action-scheduler.mjs';
import { ManifestActionExecutor } from '../src/manifest-action-executor.mjs';
import { MetricsRecorder } from '../src/metrics.mjs';
import { createGuardedExecutor } from '../src/playback-session.mjs';
import { withCatalogActivity } from '../src/catalog-activity-executor.mjs';
import { EngineEventLog } from '../src/engine-event-log.mjs';
import { StandardTransitionAdapter } from '../src/standard-transition-adapter.mjs';

// 0.65.7 short-gap priming, on a virtual clock: the real scheduler, executor and transition engine
// drive a modelled native player (24 fps frames, frame callbacks, planned cut, exit pre-roll) and a
// modelled renderer whose operations take time (round trips 2-5 ms, a cold warm-up 150 ms, a cold
// clip start 150 ms, a warmed one 60 ms, an exact seek 30 ms). It checks the engine's ordering and
// timing logic against those latencies; it does not reproduce Chrome. Optical proof is the A/B.
//
// 0.65.8 (A/B analysis 2026-11-01): Chrome registered the hand-over's planned cut about 200 ms
// after the trigger, because registration waited for the scheduler's next stage request, which sat
// behind the guarded source check and the catalog-activity round trips. The `realistic` option
// models those: the packet session's guarded executor (source check) around catalog activity
// (begin/end round trips), a 40 ms observation cadence, the exit uncover 52 ms after the clip's end,
// a 42 ms restore tail, a 48 ms hand-over and a 300 ms load of the next clip into the standby.

const FRAME = 1000 / 24;
const flush = () => new Promise(resolve => setImmediate(resolve));

function simulation(t, { gapMs, shortGap, withShortGapSurface = true, restoreTailMs = 25, realistic = null, eventLog = null, realCut = false, failCheck = null }) {
  if (realistic) restoreTailMs = realistic.restoreTailMs;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 0;
  // 0.65.11: performance.now follows the virtual clock, so epoch times (onPredict, prerollAt) no
  // longer drift with real time spent between steps; under CPU load that drift made the on/off
  // comparisons below flaky (seen on 0.65.10 too).
  t.mock.method(performance, 'now', () => clock);
  const log = [];
  const realEpoch = () => performance.timeOrigin + performance.now();
  const toVirtual = epochMs => clock + (epochMs - realEpoch());
  const later = (ms, fn) => setTimeout(fn, ms);
  const wait = ms => new Promise(resolve => later(ms, resolve));

  // --- native player and adapter -------------------------------------------------------------
  const native = { playing: true, base: 9000, since: 0, lastFrame: null, joinStartClock: null };
  const media = () => native.playing ? native.base + (clock - native.since) : native.base;
  const pauseNative = () => { native.base = media(); native.playing = false; };
  const playNative = () => { if (!native.playing) { native.since = clock; native.playing = true; } };
  const covers = [];
  const adapter = {
    stagedHost: null, overlayHost: null, plan: null, cutHold: null, preroll: null, wake: null,
    cover(host) {
      if (host.visible) return;
      host.visible = true;
      covers.push({ clock, nativeMs: media(), clipMs: overlay.position(), clipUrl: overlay.current?.url });
    },
    async snapshot() { log.push(`snapshot@${clock}`); return { currentTimeMs: media(), paused: false, muted: false, volume: 1 }; },
    async pause() { pauseNative(); this.cutHold = null; },
    async setMuted() {},
    async readState() { return { currentTimeMs: media(), paused: !native.playing, muted: false, volume: 1 }; },
    async mountOverlayHost() { this.overlayHost = this.stagedHost ?? { visible: false, style: {}, dataset: {} }; this.stagedHost = null; return this.overlayHost; },
    async stageOverlayHost() { this.stagedHost = { visible: false, style: {}, dataset: {} }; return this.stagedHost; },
    unstageOverlayHost() {
      this.cancelPlannedCut();
      if (this.cutHold && !this.overlayHost) { this.cutHold = null; playNative(); }
      this.stagedHost = null;
    },
    async setNativeCovered(covered) { if (covered) this.cover(this.overlayHost); },
    async seek(target) { pauseNative(); native.base = target; return { after: { currentTimeMs: target } }; },
    exitHandleMs: () => 0,
    planCut(triggerMs, options) {
      if (!this.stagedHost) return false;
      log.push(`planCut@${clock}${options.deferLateReveal ? ':defer' : ''}${options.redeliverWake ? ':wake' : ''}`);
      this.plan = { triggerMs, ...options };
      return true;
    },
    cancelPlannedCut() { this.plan = null; },
    onFrame(frameMs) {
      const plan = this.plan;
      if (!plan) return;
      if (frameMs + FRAME >= plan.triggerMs - 2) {
        this.plan = null;
        const late = plan.deferLateReveal === true && frameMs - plan.triggerMs >= FRAME / 2;
        pauseNative();
        this.cutHold = { triggerMs: plan.triggerMs, observation: { currentTimeMs: media(), frameTimeMs: frameMs }, coveredAt: late ? null : clock, deferred: late, invokedAt: clock,
          redeliverWake: plan.redeliverWake === true };
        if (!late) this.cover(this.stagedHost);
        this.wake(plan.triggerMs);
        return;
      }
      plan.onPredict(realEpoch() + (plan.triggerMs - frameMs));
    },
    // The adapter's sample loop (subscribe): native's state, or, while a cut hold that asked for it
    // has not been taken over, the cut's wake-up again (StandardTransitionAdapter.sampledState).
    sample() {
      return this.cutHold?.redeliverWake === true ? { currentTimeMs: this.cutHold.triggerMs, paused: false } : { currentTimeMs: media(), paused: !native.playing };
    },
    cutObservation(triggerMs) { return this.cutHold?.triggerMs === triggerMs ? { ...this.cutHold.observation } : null; },
    cutCoveredAt(triggerMs) { return this.cutHold?.triggerMs === triggerMs ? this.cutHold.coveredAt : null; },
    cutRevealDeferred(triggerMs) { return this.cutHold?.triggerMs === triggerMs && this.cutHold.deferred; },
    cutFrameCallback(triggerMs) { return this.cutHold?.triggerMs === triggerMs ? { invokedAt: this.cutHold.invokedAt, shownAt: this.cutHold.invokedAt } : null; },
    prerollNative(endAt, { joinMs } = {}) {
      if (endAt === null) { this.preroll = null; return false; }
      const preroll = { joinMs }; this.preroll = preroll;
      const uncoverDelayMs = realistic?.uncoverDelayMs ?? 0;
      preroll.uncovered = new Promise(resolve => later(Math.max(0, endAt - clock), () => {
        if (this.preroll !== preroll) return resolve(false);
        native.base = joinMs; native.since = clock; native.playing = true; native.joinStartClock ??= clock;
        const uncover = () => { this.overlayHost.visible = false; log.push(`uncover@${clock}`); resolve(true); };
        if (uncoverDelayMs > 0) later(uncoverDelayMs, uncover); else uncover();
      }));
      return true;
    },
    async restore(snapshot, { targetTimeMs, keepHost = false } = {}) {
      log.push(`restore${keepHost ? ':keep' : ''}@${clock}`);
      if (!(this.preroll && await this.preroll.uncovered)) { native.base = targetTimeMs; native.since = clock; native.playing = true; this.overlayHost.visible = false; }
      this.preroll = null;
      await wait(restoreTailMs);
      if (keepHost) this.stagedHost = this.overlayHost;
      this.overlayHost = null;
      return { presentation: 'prerolled', timeAtUncoverMs: targetTimeMs, errorMs: 0 };
    }
  };

  // 0.65.11 (realCut): the planned cut itself is StandardTransitionAdapter's real planCut/cutNow/
  // releaseCutHold on a modelled player (24 fps frame callbacks, performance.now on the virtual
  // clock), not the model rule above. Smooth audio off (no volume ramps); the tab is visible.
  if (realCut) {
    let frameCallback = null, presented = 0;
    const player = {
      get currentTime() { return media() / 1000; }, get paused() { return !native.playing; }, seeking: false, playbackRate: 1, volume: 1, muted: false,
      requestVideoFrameCallback(callback) { frameCallback = callback; return 1; }, cancelVideoFrameCallback() { frameCallback = null; },
      pause() { log.push(`native-pause@${clock}`); pauseNative(); }, play() { playNative(); return Promise.resolve(); },
      addEventListener() {}, removeEventListener() {}
    };
    const real = new StandardTransitionAdapter({ document: { visibilityState: 'visible', defaultView: {} }, passiveAdapter: { activePlayer: () => player }, commandAdapter: {} });
    real.setCrossfadeEnabled(false);
    real.stateSubscribers.add(state => { if (state.event === 'planned-cut') adapter.wake(state.currentTimeMs); });
    Object.assign(adapter, {
      real,
      planCut(triggerMs, options) {
        if (!this.stagedHost) return false;
        log.push(`planCut@${clock}${options.deferLateReveal ? ':defer' : ''}${options.redeliverWake ? ':wake' : ''}`);
        real.stagedHost = this.stagedHost;
        return real.planCut(triggerMs, options);
      },
      cancelPlannedCut() { real.cancelPlannedCut(); },
      onFrame(frameMs) {
        const callback = frameCallback; frameCallback = null; presented += 1;
        if (!callback) return;
        callback(clock, { mediaTime: frameMs / 1000, presentedFrames: presented, expectedDisplayTime: clock });
        const hold = real.cutHold;
        if (hold && Number.isFinite(hold.coveredAt) && this.stagedHost && !this.stagedHost.visible) this.cover(this.stagedHost);
      },
      async pause() { real.adoptCutHold(); pauseNative(); },
      unstageOverlayHost() {
        real.cancelPlannedCut();
        if (real.cutHold && !this.overlayHost) real.releaseCutHold();
        this.stagedHost = null; real.stagedHost = null;
      },
      sample() { const state = real.sampledState({ currentTimeMs: media(), paused: !native.playing }); return { currentTimeMs: state.currentTimeMs, paused: state.paused }; },
      cutObservation: triggerMs => real.cutObservation(triggerMs),
      cutCoveredAt: triggerMs => real.cutCoveredAt(triggerMs),
      cutRevealDeferred: triggerMs => real.cutRevealDeferred(triggerMs),
      cutFrameCallback: triggerMs => real.cutFrameCallback(triggerMs)
    });
  }

  // --- renderer ------------------------------------------------------------------------------
  const durations = { 'blob:a': 2000, 'blob:b': 2000 };
  const clip = url => ({ url, durationMs: durations[url], pos: 0, movingSince: null, from: 0, primed: false, latency: 150 });
  const overlay = {
    calls: [], current: null, standby: null, onLocalEnding: null, startLatencyMs: null,
    position() {
      const c = this.current;
      if (!c) return null;
      return c.movingSince === null ? c.pos : Math.min(c.durationMs, c.from + Math.max(0, clock - c.movingSince - c.latency));
    },
    start(c, at = clock) { c.from = c.pos; c.movingSince = at; c.latency = c.primed ? 60 : 150; c.primed = false; },
    async op(name, ms, fn) { this.calls.push(name); await wait(ms); return fn?.(); },
    prepare(url) { return this.op('prepare', 5, () => { if (this.standby?.url === url) { this.current = this.standby; this.standby = null; } else if (this.current?.url !== url) this.current = clip(url); this.current.pos = 0; this.current.movingSince = null; return { readyState: 4 }; }); },
    prepareNext(url) { return this.op('prepareNext', realistic?.prepareNextMs ?? 5, () => { this.standby = clip(url); return { readyState: 4 }; }); },
    primeStandby() { return this.op('primeStandby', 150, () => { this.standby.primed = true; this.startLatencyMs = 60; return { status: 'primed', reason: null, startLatencyMs: 60 }; }); },
    promoteStandby() { return this.op('promoteStandby', realistic?.promoteMs ?? 3, () => { this.current = this.standby; this.standby = null; }); },
    cueAt(positionMs) { return this.op('cueAt', 30, () => { this.current.pos = Math.round(positionMs); this.current.movingSince = null; return { positionMs: this.current.pos }; }); },
    mount() { return this.op('mount', 3); },
    unmount() { return this.op('unmount', 3, () => { if (this.current) this.current.movingSince = null; }); },
    configureAudio() { return this.op('configureAudio', 2); },
    show() { return this.op('show', 2); },
    primeForPlayback() {
      const primed = this.current?.primed === true;
      return this.op('primeForPlayback', primed ? 0 : 150, () => { if (!primed) { this.current.primed = true; this.startLatencyMs = 60; } });
    },
    prerollAt(epochMs, signal, options = {}) {
      this.calls.push('prerollAt'); this.prerolls = [...(this.prerolls ?? []), { clock, cutAt: toVirtual(epochMs), ...options }];
      const c = this.current, cutAt = toVirtual(epochMs), startAt = cutAt - (this.startLatencyMs ?? 110) - 40;
      later(Math.max(0, startAt - clock), () => { if (this.current === c && c.movingSince === null) this.start(c); });
    },
    play() {
      this.calls.push('play');
      const c = this.current;
      if (c.movingSince === null) this.start(c);
      const endAt = c.movingSince + c.latency + (c.durationMs - c.from);
      later(Math.max(0, endAt - 400 - clock), () => { try { this.onLocalEnding?.(endAt); } catch {} });
      return new Promise(resolve => later(Math.max(0, endAt - clock), () => resolve({ durationMs: c.durationMs, localTimeAtEndMs: c.durationMs, unplayedTailMs: 0, frameHoldMode: 'local-canvas-audio-to-ended', heldFrameMediaTimeMs: c.durationMs, localEnded: true })));
    },
    stop() { return this.op('stop', 2); },
    teardown() { return this.op('teardown', 3, () => { this.current = null; }); },
    forceTeardown() { this.calls.push('forceTeardown'); }
  };
  if (!withShortGapSurface) { delete overlay.primeStandby; delete overlay.promoteStandby; delete overlay.cueAt; }

  // --- engine and scheduler --------------------------------------------------------------------
  const metrics = new MetricsRecorder({ now: () => clock, wallClock: () => '2026-11-01T00:00:00.000Z' });
  const engine = new TransitionEngine({ adapter, overlay, metrics, now: () => clock });
  engine.setShortGapPriming(shortGap);
  if (eventLog) engine.eventLog = eventLog; // 0.65.9: the developer-mode engine event log
  const triggerB = 12_000 + gapMs;
  const actions = [
    { id: 'a', type: 'REPLACE', triggerMs: 10_000, resumeMs: 12_000, clipUrl: 'blob:a', gainDb: 0 },
    { id: 'b', type: 'REPLACE', triggerMs: triggerB, resumeMs: triggerB + 2000, clipUrl: 'blob:b', gainDb: 0 }
  ];
  let executor = new ManifestActionExecutor({ transitionEngine: engine, adapter });
  const roundTrips = [];
  if (realistic) {
    // As packet-session-controller.mjs composes it for a catalog edit.
    let call = 0;
    const catalog = { catalogActivity: (id, active) => { const ms = realistic.catalogMs[call++ % realistic.catalogMs.length]; roundTrips.push(`catalog:${id}:${active ? 'begin' : 'end'}@${clock}+${ms}`); return wait(ms); } };
    const check = () => {
      roundTrips.push(`source-check@${clock}+${realistic.sourceCheckMs}`);
      const fails = failCheck?.(clock) === true;
      return wait(realistic.sourceCheckMs).then(() => { if (fails) throw Object.assign(new Error('source changed'), { code: 'source-check-failed' }); });
    };
    // 0.65.9: with the engine event log, timed as packet-session-controller.mjs times them.
    const record = eventLog ? (name, detail) => eventLog.record('scheduler', name, detail) : null;
    const timedCheck = !record ? check : () => { record('source-check-start', {}); const checking = Promise.resolve(check()); checking.then(() => record('source-check-end', { result: 'passed' }), () => record('source-check-end', { result: 'failed' })); return checking; };
    executor = createGuardedExecutor(record ? withCatalogActivity(executor, catalog, { onEvent: record }) : withCatalogActivity(executor, catalog), timedCheck);
  }
  const scheduler = new ManifestActionScheduler({ actions, executor, chainGapMs: 50 });
  const observe = state => { const work = scheduler.observe(state); work?.catch?.(() => {}); };
  adapter.wake = triggerMs => observe({ currentTimeMs: triggerMs, paused: false });

  const run = async ms => {
    for (let i = 0; i < ms; i++) {
      clock += 1;
      t.mock.timers.tick(1);
      if (native.playing) {
        const index = Math.floor(media() / FRAME + 1e-9);
        if (index !== native.lastFrame) { native.lastFrame = index; adapter.onFrame(index * FRAME); }
      }
      if (clock % (realistic?.cadenceMs ?? 16) === 0) observe(adapter.sample());
      await flush();
    }
  };
  // Native resumes at a's join (12 000 ms) when a is uncovered; b's trigger comes gapMs later.
  // (With `realistic`, native resumes at the clip's end and is uncovered uncoverDelayMs later.)
  const uncoverClock = () => Number(log.find(line => line.startsWith('uncover@'))?.split('@')[1]);
  const joinClock = () => realistic ? native.joinStartClock : uncoverClock();
  return { run, covers, log, overlay, adapter, metrics, scheduler, triggerB, roundTrips, native, media, get triggerBClock() { return joinClock() + (triggerB - 12_000); }, get clock() { return clock; } };
}

async function sceneB(t, options) {
  const sim = simulation(t, options);
  await sim.run(9000);
  const b = sim.covers.find(cover => cover.clipUrl === 'blob:b');
  return { sim, b };
}

for (const gapMs of [80, 160, 200, 320]) {
  test(`short-gap priming: a ${gapMs} ms native gap re-covers within one frame of the trigger, never stepping back`, async t => {
    const { sim, b } = await sceneB(t, { gapMs, shortGap: true });
    assert.ok(b, 'scene b was covered');
    assert.equal(sim.scheduler.snapshot().statuses.b, 'completed');
    const coverVsTrigger = b.clock - sim.triggerBClock;
    assert.ok(Math.abs(coverVsTrigger) <= FRAME + 0.5, `cover ${coverVsTrigger.toFixed(1)} ms from the trigger`);
    const nativeOffsetMs = b.nativeMs - sim.triggerB;
    assert.ok(Math.floor(b.clipMs / FRAME) >= Math.floor(Math.max(0, nativeOffsetMs) / FRAME), `clip frame ${b.clipMs} ms against native offset ${nativeOffsetMs} ms`);
    // The standby was warmed during scene a and handed over in its kept host.
    assert.ok(sim.overlay.calls.includes('primeStandby'));
    assert.ok(sim.overlay.calls.includes('promoteStandby'));
    assert.ok(sim.log.some(line => line.startsWith('restore:keep@')));
    // The gap was played by native, not bridged: native resumed at a's join and ran until the cut,
    // which came on its last frame before b's trigger (or on the trigger's own frame).
    assert.ok(b.nativeMs > 12_000 && b.nativeMs >= sim.triggerB - FRAME - 2 && b.nativeMs < sim.triggerB + FRAME, `native at ${b.nativeMs} ms when covered`);
    const trace = sim.metrics.snapshot().cycles.find(cycle => cycle.segmentId === 'b').stage;
    assert.equal(trace.via, 'short-gap-handover');
    assert.equal(trace.shortGapMs, gapMs);
    assert.ok(trace.planCutRegisteredMs < 0, 'the planned cut was registered before the cut');
  });
}

test('short-gap priming off: the same gaps run exactly the 0.65.6 path (no warm-up, hand-over, deferral or exact cue)', async t => {
  for (const gapMs of [80, 160, 200, 320]) {
    const off = await sceneB(t, { gapMs, shortGap: false });
    t.mock.timers.reset();
    const legacy = await sceneB(t, { gapMs, shortGap: false, withShortGapSurface: false });
    t.mock.timers.reset();
    for (const name of ['primeStandby', 'promoteStandby', 'cueAt']) assert.equal(off.sim.overlay.calls.includes(name), false, `${gapMs}: no ${name}`);
    assert.equal(off.sim.log.some(line => /:keep@|:defer/.test(line)), false);
    assert.deepEqual(off.sim.overlay.calls, legacy.sim.overlay.calls, `${gapMs}: renderer calls as without the new surface`);
    assert.deepEqual(off.sim.log, legacy.sim.log, `${gapMs}: native calls and times as without the new surface`);
    assert.deepEqual(off.sim.covers, legacy.sim.covers);
    // In this model 0.65.6's path covers late at the shortest gaps (real playback saw it up to 320 ms).
    if (gapMs <= 160) assert.ok(off.b.clock - off.sim.triggerBClock > FRAME, `${gapMs}: 0.65.6 covers late in this model`);
  }
});

test('a 0 ms (chained) join behaves exactly as in 0.65.6 with short-gap priming on', async t => {
  const on = await sceneB(t, { gapMs: 0, shortGap: true });
  t.mock.timers.reset();
  const off = await sceneB(t, { gapMs: 0, shortGap: false });
  t.mock.timers.reset();
  assert.deepEqual(on.sim.overlay.calls, off.sim.overlay.calls);
  assert.deepEqual(on.sim.log, off.sim.log);
  for (const name of ['primeStandby', 'promoteStandby', 'cueAt']) assert.equal(on.sim.overlay.calls.includes(name), false);
});

test('gaps of 500 ms or more are not short gaps', async t => {
  assert.equal(SHORT_GAP_MS, 500);
  const { sim } = await sceneB(t, { gapMs: 500, shortGap: true });
  assert.equal(sim.overlay.calls.includes('primeStandby'), false);
  assert.equal(sim.log.some(line => /:keep@|:defer/.test(line)), false);
});

test('a late cover after a short gap starts the clip at the native offset, not its first frame', async t => {
  // The standby warm-up is skipped (too little of a left), so there is no hand-over: b stages the
  // 0.65.6 way after a, with its 150 ms warm-up, and its cover comes after the trigger.
  const sim = simulation(t, { gapMs: 80, shortGap: true });
  sim.overlay.primeStandby = async () => { sim.overlay.calls.push('primeStandby'); return { status: 'skipped', reason: 'too-late', startLatencyMs: null }; };
  await sim.run(9000);
  const b = sim.covers.find(cover => cover.clipUrl === 'blob:b');
  assert.ok(b);
  const nativeOffsetMs = b.nativeMs - sim.triggerB;
  assert.ok(nativeOffsetMs >= 15, `native ran ${nativeOffsetMs} ms past the trigger`);
  assert.ok(sim.overlay.calls.includes('cueAt'));
  assert.ok(b.clipMs >= Math.round(nativeOffsetMs) - 1, `clip starts at ${b.clipMs} ms for a native offset of ${nativeOffsetMs} ms`);
  const trace = sim.metrics.snapshot().cycles.find(cycle => cycle.segmentId === 'b').stage;
  assert.equal(trace.startOffsetMs, b.clipMs);
});

// 0.65.8: the same gaps with Chrome's round trips (A/B analysis 2026-11-01): a 200 ms source
// check, catalog-activity begin/end of 100-250 ms (a's end keeps the scheduler busy into the gap),
// a 40 ms observation cadence, the uncover 52 ms after the clip's end, then a 42 ms restore tail
// and a 48 ms hand-over (measured times), and a 300 ms load of the next clip. The planned cut
// must be registered at the hand-over, not at the scheduler's next stage request, and its wake-up
// must reach the scheduler once it is free.
const REALISTIC = [
  { sourceCheckMs: 200, catalogMs: [100], cadenceMs: 40, uncoverDelayMs: 52, restoreTailMs: 42, promoteMs: 48, prepareNextMs: 300 },
  { sourceCheckMs: 200, catalogMs: [250], cadenceMs: 40, uncoverDelayMs: 52, restoreTailMs: 42, promoteMs: 48, prepareNextMs: 300 },
  { sourceCheckMs: 200, catalogMs: [180, 250, 100], cadenceMs: 40, uncoverDelayMs: 52, restoreTailMs: 42, promoteMs: 48, prepareNextMs: 300 }
];
async function realisticSceneB(t, gapMs, realistic) {
  const label = `${gapMs} ms, catalog ${realistic.catalogMs.join('/')} ms`;
  const { sim, b } = await sceneB(t, { gapMs, shortGap: true, realistic });
  t.mock.timers.reset();
  assert.ok(b, `${label}: scene b was covered`);
  assert.equal(sim.scheduler.snapshot().statuses.b, 'completed', label);
  // The round trips really ran: catalog end for a (the scheduler busy into the gap), and b's own
  // source check and catalog begin.
  assert.ok(sim.roundTrips.some(line => line.startsWith('catalog:a:end@')) && sim.roundTrips.some(line => line.startsWith('catalog:b:begin@')), label);
  const trace = sim.metrics.snapshot().cycles.find(cycle => cycle.segmentId === 'b').stage;
  // The standby was warmed during a, handed over, and its cut registered at the hand-over with the
  // re-delivered wake-up (':wake'), before the trigger or the cut.
  assert.equal(trace.via, 'short-gap-handover', label);
  assert.ok(sim.log.some(line => /^planCut@\d+:defer:wake$/.test(line)), label);
  assert.equal(trace.cut.via, 'planned', `${label}: the planned cut made the cut, and the scheduler then took it over`);
  assert.ok(trace.planCutRegisteredMs < 0, `${label}: registered ${trace.planCutRegisteredMs} ms before the cut`);
  // Never a backward step: the clip's first frame is at or after native's position.
  const nativeOffsetMs = b.nativeMs - sim.triggerB;
  assert.ok(Math.floor(b.clipMs / FRAME) >= Math.floor(Math.max(0, nativeOffsetMs) / FRAME), `${label}: clip ${b.clipMs} ms against native offset ${nativeOffsetMs} ms`);
  return { sim, b, trace, label };
}

for (const gapMs of [160, 200, 320]) {
  test(`short-gap priming with Chrome's round trips: a ${gapMs} ms gap re-covers within one frame of the trigger`, async t => {
    for (const realistic of REALISTIC) {
      const { sim, b, trace, label } = await realisticSceneB(t, gapMs, realistic);
      const coverVsTrigger = b.clock - sim.triggerBClock;
      assert.ok(Math.abs(coverVsTrigger) <= FRAME + 0.5, `${label}: cover ${coverVsTrigger.toFixed(1)} ms from the trigger`);
      assert.ok(b.clock + trace.planCutRegisteredMs < sim.triggerBClock, `${label}: registered before the trigger`);
      // Native played the gap and stopped on its last frame before b's trigger (or the trigger's own).
      assert.ok(b.nativeMs >= sim.triggerB - FRAME - 2 && b.nativeMs < sim.triggerB + FRAME, `${label}: native at ${b.nativeMs} ms when covered`);
      assert.equal(trace.cut.revealDeferred, false, label);
    }
  });
}

// An 80 ms gap is shorter than the hand-over itself here (uncover 52 ms + restore 42 ms + hand-over
// 48 ms after native resumes), so no registration at the hand-over can make the trigger. The cut
// comes on the first frame after it, late: native is paused there without revealing the clip, and
// once the scheduler takes the wake-up the clip is cued to native's position and covered (the 0.65.7
// late fallback), never stepping back.
test("short-gap priming with Chrome's round trips: an 80 ms gap (shorter than the hand-over) takes the late fallback", async t => {
  for (const realistic of REALISTIC) {
    const { b, trace, label } = await realisticSceneB(t, 80, realistic);
    assert.equal(trace.cut.revealDeferred, true, label);
    assert.ok(trace.nativeOffsetMs > 0 && trace.nativeOffsetMs < FRAME * 3, `${label}: native stopped ${trace.nativeOffsetMs} ms past the trigger`);
    assert.equal(trace.startOffsetMs, b.clipMs, `${label}: the clip starts at native's position`);
  }
});

test("short-gap priming off with Chrome's round trips: the same as without the new interfaces", async t => {
  for (const gapMs of [80, 160, 200, 320]) {
    const realistic = REALISTIC[2];
    const off = await sceneB(t, { gapMs, shortGap: false, realistic });
    t.mock.timers.reset();
    const legacy = await sceneB(t, { gapMs, shortGap: false, withShortGapSurface: false, realistic });
    t.mock.timers.reset();
    for (const name of ['primeStandby', 'promoteStandby', 'cueAt']) assert.equal(off.sim.overlay.calls.includes(name), false, `${gapMs}: no ${name}`);
    assert.equal(off.sim.log.some(line => /:keep@|:defer|:wake/.test(line)), false);
    assert.deepEqual(off.sim.overlay.calls, legacy.sim.overlay.calls, `${gapMs}: renderer calls`);
    assert.deepEqual(off.sim.log, legacy.sim.log, `${gapMs}: native calls and times`);
    assert.deepEqual(off.sim.covers, legacy.sim.covers);
    assert.deepEqual(off.sim.roundTrips, legacy.sim.roundTrips);
    assert.equal(off.sim.scheduler.snapshot().statuses.b, 'completed');
  }
  // A 0 ms (chained) join with Chrome's round trips: the same with priming on and off.
  const on = await sceneB(t, { gapMs: 0, shortGap: true, realistic: REALISTIC[2] });
  t.mock.timers.reset();
  const off = await sceneB(t, { gapMs: 0, shortGap: false, realistic: REALISTIC[2] });
  t.mock.timers.reset();
  assert.deepEqual(on.sim.overlay.calls, off.sim.overlay.calls);
  assert.deepEqual(on.sim.log, off.sim.log);
  assert.deepEqual(on.sim.roundTrips, off.sim.roundTrips);
});

// 0.65.9: the developer-mode engine event log is logging only. With it recording (engine marks,
// source-check and catalog-activity times), every scene covers at the same moment, on the same
// frames, with the same renderer and native calls and round trips as without it.
test('the engine event log changes nothing on the playback path', async t => {
  for (const [gapMs, realistic] of [[80, null], [160, null], [320, null], [80, REALISTIC[2]], [160, REALISTIC[0]], [320, REALISTIC[1]]]) {
    const log = new EngineEventLog({ now: () => 0 });
    log.setEnabled(true);
    const on = await sceneB(t, { gapMs, shortGap: true, ...(realistic ? { realistic } : {}), eventLog: log });
    t.mock.timers.reset();
    const off = await sceneB(t, { gapMs, shortGap: true, ...(realistic ? { realistic } : {}) });
    t.mock.timers.reset();
    const label = `${gapMs} ms${realistic ? ', round trips' : ''}`;
    assert.deepEqual(on.sim.covers, off.sim.covers, label);
    assert.deepEqual(on.sim.log, off.sim.log, label);
    assert.deepEqual(on.sim.overlay.calls, off.sim.overlay.calls, label);
    assert.deepEqual(on.sim.roundTrips, off.sim.roundTrips, label);
    const names = log.entries().map(entry => entry[2]);
    assert.ok(names.includes('planned-cut-registered'), label);
    if (realistic) assert.ok(names.includes('source-check-start') && names.includes('catalog-activity-end'), label);
  }
});

// 0.65.11: a hand-over registered within a frame of the
// trigger gets no 'wait' callback, so the cut fired with no prediction and no pre-roll: the clip sat
// paused and silent on its first frame until this scene's source check (215-295 ms) let the
// transition play it. With the real cut rule and a 290 ms source check: the clip must be pre-rolled
// at the cut and audible within its own start-up, long before the transition (ARMED).
const FS08_UNPREPARED = { sourceCheckMs: 290, catalogMs: [100], cadenceMs: 40, uncoverDelayMs: 52, restoreTailMs: 42, promoteMs: 48, prepareNextMs: 300 };

test('Fix 1: a planned cut with no prior prediction starts the clip at once; silence is bounded by its start-up, not the source check', async t => {
  const sim = simulation(t, { gapMs: 160, shortGap: true, realistic: FS08_UNPREPARED, realCut: true });
  let cutClock = null, prerollAt = null, playingAt = null, armedAt = null;
  const states = [];
  sim.metrics.mark = new Proxy(sim.metrics.mark, { apply: (fn, self, args) => { if (args[0] === 'preroll-requested' && args[1]?.segmentId === 'b') prerollAt = sim.clock; return Reflect.apply(fn, self, args); } });
  const realSetState = sim.metrics.state?.bind(sim.metrics);
  for (let i = 0; i < 9000; i++) {
    await sim.run(1);
    if (cutClock === null && sim.log.some(line => line.startsWith('native-pause@')) && sim.covers.some(cover => cover.clipUrl === 'blob:b')) cutClock = sim.covers.find(cover => cover.clipUrl === 'blob:b').clock;
    const b = sim.overlay.current?.url === 'blob:b' ? sim.overlay.current : null;
    if (cutClock !== null && playingAt === null && b?.movingSince !== null && b?.movingSince !== undefined) playingAt = b.movingSince + b.latency;
    if (cutClock !== null && armedAt === null && sim.metrics.snapshot().cycles.some(cycle => cycle.segmentId === 'b')) armedAt = sim.clock;
  }
  t.mock.timers.reset();
  const b = sim.covers.find(cover => cover.clipUrl === 'blob:b');
  assert.ok(b, 'scene b was covered by the planned cut');
  assert.equal(sim.scheduler.snapshot().statuses.b, 'completed');
  // The measured shape: the cut was the plan's first callback (registered too late for a wait).
  const cutTrace = sim.metrics.snapshot().cycles.find(cycle => cycle.segmentId === 'b').stage;
  assert.equal(cutTrace.via, 'short-gap-handover');
  assert.equal(cutTrace.cut.revealDeferred, false);
  assert.ok(prerollAt !== null, 'a pre-roll was requested for b');
  assert.ok(Math.abs(prerollAt - b.clock) <= 1, `pre-roll requested ${prerollAt - b.clock} ms from the cut`);
  const hard = sim.overlay.prerolls.at(-1);
  assert.equal(hard.fadeMs, 0, 'a hard audio step (the clip plays unmuted at its level)');
  assert.ok(Number.isFinite(hard.audioEndAtMs));
  assert.ok(playingAt !== null && playingAt < armedAt, `the clip was playing (${playingAt}) before the transition armed (${armedAt})`);
  const silenceMs = playingAt - b.clock;
  assert.ok(silenceMs <= 60 + 10, `modelled silence (native pause to clip audible) ${silenceMs} ms, against a 60 ms start-up`);
  assert.ok(armedAt - b.clock >= 280, `the transition still waited for the 290 ms source check (${armedAt - b.clock} ms)`);
});

test('Fix 1: when the source check fails after such a cut, the clip stops and native resumes when the hold expires, as before', async t => {
  let cutClock = null;
  const sim = simulation(t, { gapMs: 160, shortGap: true, realistic: FS08_UNPREPARED, realCut: true, failCheck: clock => cutClock !== null && clock >= cutClock - 1 });
  for (let i = 0; i < 9000 && cutClock === null; i++) {
    await sim.run(1);
    const cover = sim.covers.find(item => item.clipUrl === 'blob:b');
    if (cover) cutClock = cover.clock;
  }
  assert.ok(cutClock !== null, 'scene b was cut');
  await sim.run(1990);
  assert.equal(sim.native.playing, false, 'native held by the cut until the hold expires');
  await sim.run(40);
  t.mock.timers.reset();
  assert.equal(sim.scheduler.snapshot().statuses.b, 'failed');
  assert.equal(sim.native.playing, true, 'native resumed when the 2 s hold expired');
  const b = sim.overlay.current?.url === 'blob:b' ? sim.overlay.current : null;
  assert.ok(!b || b.movingSince === null, 'the clip is not playing any more');
  assert.ok(sim.overlay.calls.includes('unmount'), 'the staged clip was taken down');
  assert.equal(sim.adapter.real.cutHold, null);
});
