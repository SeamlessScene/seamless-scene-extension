import assert from "node:assert/strict";
import test from "node:test";
import { MetricsRecorder } from "../src/metrics.mjs";
import { TransitionEngine, TransitionState } from "../src/transition-engine.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness({
  prepareResult = Promise.resolve(),
  playResult = Promise.resolve(),
  failAt = null,
  hangAt = null,
  operationTimeouts = {}
} = {}) {
  const calls = [];
  let now = 0;
  const run = (phase, value) => {
    calls.push(phase);
    if (phase === hangAt) return new Promise(() => {});
    if (phase === failAt) return Promise.reject(new Error(`sensitive failure detail at C:\\private\\${phase}`));
    return typeof value === "function" ? value() : value;
  };
  const adapter = {
    async snapshot() { return run("snapshot", { currentTimeMs: 3000, paused: false, muted: false, volume: 0.5 }); },
    async mountOverlayHost() { return run("overlay-host", {}); },
    async pause() { return run("pause"); },
    async setMuted(value) { calls.push(`muted:${value}`); return run("mute"); },
    async setNativeCovered(value) { calls.push(`covered:${value}`); return run("cover"); },
    async seek(value) { calls.push(`seek:${value}`); return run("seek"); },
    async restore(_snapshot, options) {
      calls.push(`restore:${options.targetTimeMs}:${options.resumePlayback}:${options.awaitPresentedFrame === true}`);
      return run("restore");
    },
    async forceSafeNativeState() { return run("force-native-safe"); }
  };
  const overlay = {
    async prepare() { return run("prepare", prepareResult); },
    async mount() { return run("overlay-mount"); },
    async configureAudio(snapshot, gainDb) { calls.push(`audio:${snapshot.volume}:${gainDb}`); },
    async show() { return run("overlay-show"); },
    play() { return run("local-playback", playResult); },
    async stop() { return run("overlay-stop"); },
    async teardown() { return run("overlay-teardown"); },
    forceTeardown() { calls.push("force-overlay-teardown"); }
  };
  const metrics = new MetricsRecorder({ now: () => ++now, wallClock: () => "2026-08-23T00:00:00.000Z" });
  const engine = new TransitionEngine({ adapter, overlay, metrics, now: () => ++now, operationTimeouts, joinSeekDelayMs: 0 });
  engine.arm({ id: "segment-1", triggerMs: 3000, resumeMs: 8000, clipUrl: "fixture.mp4", gainDb: -6 });
  return { adapter, overlay, calls, engine, metrics };
}

for (const action of ['REPLACE', 'INSERT']) {
  for (const interruption of ['cancel', 'timeout']) {
    test(`${action} paused-position read cannot hold transition ${interruption} indefinitely`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const readStarted = deferred(), read = deferred();
      const h = harness({ operationTimeouts: { 'read-state': 20 } });
      let readSignal, settled = false, result;
      h.adapter.readState = async (options = {}) => {
        readSignal = options.signal;
        readStarted.resolve();
        return read.promise;
      };
      h.overlay.cue = async fraction => { h.calls.push(`cue:${fraction}`); };
      h.engine.arm({ id: 'position-read', action, triggerMs: 3000,
        resumeMs: action === 'INSERT' ? 3000 : 8000, clipUrl: 'fixture.mp4',
        ...(action === 'REPLACE' ? { entryFraction: 0.3 } : {}) });
      const running = h.engine.execute(4500).then(value => { settled = true; result = value; });
      try {
        await readStarted.promise;
        if (interruption === 'cancel') h.engine.cancel('viewer-user-stopped');
        else t.mock.timers.tick(21);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(settled, true, 'position read must release the transition');
        assert.equal(readSignal?.aborted, true, 'the obsolete read is cancelled');
        assert.equal(h.engine.running, null);
        if (interruption === 'cancel') {
          assert.equal(result.status, 'cancelled');
          assert.ok(!h.calls.includes('overlay-show'));
          assert.ok(h.calls.includes('restore:3000:true:false'));
        } else {
          assert.equal(result.status, 'success');
          assert.ok(h.calls.includes(action === 'INSERT' ? 'seek:3000' : 'cue:0.3'),
            'unavailable position retains the existing manifest/scheduler fallback');
        }
        const completedCalls = [...h.calls];
        read.resolve({ currentTimeMs: 5500 });
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(h.calls, completedCalls, 'late position cannot start another transition');
      } finally {
        read.resolve({ currentTimeMs: 5500 });
        await running;
      }
    });
  }
}

for (const [method, phase, signalIndex, recovering] of [
  ['mount', 'overlay-mount', 1, false], ['configureAudio', 'overlay-mount', 2, false],
  ['show', 'overlay-show', 0, false], ['teardown', 'overlay-teardown', 0, false],
  ['stop', 'overlay-stop', 0, true], ['forceTeardown', 'force-overlay-teardown', 0, true]
]) test(`engine deadline reaches ${method} and drains its owned step`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness({ failAt: recovering ? 'prepare' : null, operationTimeouts: { [phase]: 10 } });
  let stepSignal, calls = 0;
  h.overlay[method] = (...args) => {
    if (++calls > 1) return Promise.resolve();
    stepSignal = args[signalIndex]; return new Promise(() => {});
  };
  const running = h.engine.execute(3000), rejected = assert.rejects(running);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(stepSignal instanceof AbortSignal, `${method} receives its step signal`);
  assert.equal(stepSignal.aborted, false); t.mock.timers.tick(11); await rejected;
  assert.equal(stepSignal.aborted, true);
  assert.equal(h.engine.running, null);
});

test("runs an overlay-first replacement and restores at the resume point", async () => {
  const { calls, engine, metrics } = harness();
  const result = await engine.execute(3015);
  assert.equal(result.status, "success");
  assert.equal(engine.state, TransitionState.COMPLETE);
  assert.deepEqual(calls, [
    "prepare", "snapshot", "overlay-host", "overlay-mount", "audio:0.5:-6", "pause", "muted:true", "mute",
    "overlay-show", "covered:true", "cover", "local-playback", "seek:8000", "seek",
    "restore:8000:true:true", "restore", "overlay-teardown"
  ]);
  assert.equal(metrics.snapshot().cycles[0].triggerErrorMs, 15);
  assert.equal(metrics.snapshot().cycles[0].status, "success");
});

test('engine cannot rearm while asynchronous last-resort overlay cleanup is pending', async () => {
  const cleanup = deferred(), h = harness({ failAt: 'prepare' });
  h.overlay.forceTeardown = () => cleanup.promise;
  const running = h.engine.execute(3000), rejected = assert.rejects(running);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(h.engine.running);
  assert.throws(() => h.engine.arm({ id: 'next', triggerMs: 3000, resumeMs: 4000, clipUrl: 'fixture.mp4' }), /running/);
  cleanup.resolve(); await rejected; assert.equal(h.engine.running, null);
});

test("does not trigger until forward playback crosses the boundary", async () => {
  const { calls, engine } = harness();
  assert.equal(engine.observe({ currentTimeMs: 2900, paused: false }), null);
  assert.equal(engine.observe({ currentTimeMs: 2999, paused: false }), null);
  await engine.observe({ currentTimeMs: 3002, paused: false });
  assert.ok(calls.includes("local-playback"));
  assert.equal(engine.state, TransitionState.COMPLETE);
});

test("resumes at the join after a local playback failure instead of replaying the replaced interval", async () => {
  const { calls, engine, metrics } = harness({ playResult: Promise.reject(new Error("decode failed")) });
  await assert.rejects(engine.execute(3000), { name: "TransitionStepError", code: "local-media-failure", phase: "local-playback" });
  assert.equal(engine.state, TransitionState.FAILED);
  assert.ok(calls.includes("overlay-stop"));
  assert.ok(calls.includes("restore:8000:true:false"));
  assert.ok(!calls.includes("restore:3000:true:false"));
  assert.ok(calls.includes("force-overlay-teardown"));
  assert.ok(calls.includes("force-native-safe"));
  assert.equal(metrics.snapshot().cycles[0].status, "failed");
  assert.deepEqual(metrics.snapshot().cycles[0].detail, { errorCode: "local-media-failure", phase: "local-playback" });
});

test("a local clip that exhausts its buffering budget fails as local-stall and resumes native at the join", async () => {
  const stall = Object.assign(new Error("private-local-stall"), { code: "local-stall" });
  const { calls, engine, metrics } = harness({ playResult: Promise.reject(stall) });
  await assert.rejects(engine.execute(3000), { code: "local-stall", phase: "local-playback" });
  assert.ok(calls.includes("restore:8000:true:false"));
  assert.deepEqual(metrics.snapshot().cycles[0].detail, { errorCode: "local-stall", phase: "local-playback" });
});

test("fails closed before covering native playback when local preflight fails", async () => {
  const { calls, engine, metrics } = harness({
    prepareResult: Promise.reject(new Error("local decode preflight failed"))
  });
  await assert.rejects(engine.execute(3000), { name: "TransitionStepError", code: "local-media-failure", phase: "prepare" });
  assert.equal(engine.state, TransitionState.FAILED);
  assert.deepEqual(calls, ["prepare", "overlay-stop", "overlay-teardown", "force-overlay-teardown"]);
  assert.equal(metrics.snapshot().cycles[0].status, "failed");
});

test("cancels an active transition and restores native playback", async () => {
  const localPlayback = deferred();
  const { calls, engine } = harness({ playResult: localPlayback.promise });
  const running = engine.execute(3000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engine.cancel("test-cancel"), true);
  localPlayback.reject(Object.assign(new Error("test-cancel"), { name: "AbortError" }));
  assert.deepEqual(await running, { status: "cancelled", cycleId: "segment-1-1" });
  assert.equal(engine.state, TransitionState.CANCELLED);
  assert.ok(calls.includes("restore:8000:true:false"));
});

test("a viewer's own stop after the cover returns to where playback paused", async () => {
  for (const reason of ["user-cancelled-from-panel", "viewer-user-stopped"]) {
    const localPlayback = deferred();
    const { calls, engine } = harness({ playResult: localPlayback.promise });
    const running = engine.execute(3000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(engine.cancel(reason), true);
    localPlayback.reject(Object.assign(new Error(reason), { name: "AbortError" }));
    assert.equal((await running).status, "cancelled");
    assert.ok(calls.includes("restore:3000:true:false"), reason);
  }
});

test("seeking before the trigger rearms a completed segment", async () => {
  const { engine } = harness();
  await engine.execute(3000);
  engine.observe({ currentTimeMs: 2000, paused: false });
  assert.equal(engine.state, TransitionState.ARMED);
});

test("disarms an idle transition before it can cross the boundary", () => {
  const { calls, engine } = harness();
  engine.disarm("source-identity-became-incompatible");
  assert.equal(engine.state, TransitionState.IDLE);
  assert.equal(engine.observe({ currentTimeMs: 4000, paused: false }), null);
  assert.deepEqual(calls, []);
});

test("runs INSERT while leaving native source time at the trigger", async () => {
  const { calls, engine } = harness();
  engine.arm({ id: "insert-1", action: "INSERT", triggerMs: 3_000, resumeMs: 3_000, clipUrl: "fixture.mp4" });
  const result = await engine.execute(3_000);
  assert.equal(result.status, "success");
  assert.equal(calls.includes("seek:3000"), true);
  assert.equal(calls.includes("restore:3000:true:true"), true);
});

test("recovery records the adapter receipt and does not use a later native sample", async () => {
  const {adapter, engine, metrics} = harness({playResult: Promise.reject(new Error("decode failure"))});
  adapter.restore = async (_snapshot, options) => {
    assert.equal(options.targetTimeMs, 8000);
    return {targetTimeMs: 8000, timeAtUncoverMs: 8042, errorMs: 42};
  };
  await assert.rejects(engine.execute(3000));
  assert.equal(metrics.snapshot().cycles[0].timings.nativeRecoveryErrorMs, 42);
});

test("shared engine cancels local playback on presentation failure without per-UI wiring", async () => {
  const localPlayback = deferred();
  const {adapter, calls, engine, metrics} = harness({playResult: localPlayback.promise});
  let onPresentationError, removed = false;
  adapter.subscribePresentationErrors = listener => {
    onPresentationError = listener;
    return () => { removed = true; };
  };
  const running = engine.execute(3000);
  const rejected = assert.rejects(running, {code: "overlay-failure", phase: "presentation"});
  await new Promise(resolve => setImmediate(resolve));
  onPresentationError(new Error("native-video fullscreen"));
  await rejected;
  assert.ok(calls.includes("overlay-stop"));
  assert.ok(calls.includes("restore:8000:true:false"));
  assert.ok(calls.includes("force-native-safe"));
  assert.equal(metrics.snapshot().cycles[0].status, "failed");
  assert.equal(removed, true);
  localPlayback.resolve();
});

test("preloads local media without mutating native state and tears it down on cancellation", async () => {
  const pendingPrepare = deferred();
  const { calls, engine, metrics } = harness({ prepareResult: pendingPrepare.promise });
  const preloading = engine.preload({ id: "segment-1", triggerMs: 3000, resumeMs: 8000, clipUrl: "fixture.mp4" });
  await Promise.resolve();
  await engine.cancelPreload("native-seek");
  await assert.rejects(preloading, (error) => error.name === "AbortError");
  assert.deepEqual(calls, ["prepare", "overlay-teardown"]);
  assert.equal(metrics.snapshot().events.some((event) => event.name === "preflight-started"), true);
});

test("fault injection fails safe with bounded diagnostics at every transition mutation", async (t) => {
  const cases = [
    ["prepare", "local-media-failure", false],
    ["snapshot", "snapshot-failure", false],
    ["overlay-host", "overlay-failure", true],
    ["overlay-mount", "overlay-failure", true],
    ["pause", "native-control-failure", true],
    ["mute", "native-control-failure", true],
    ["overlay-show", "overlay-failure", true],
    ["cover", "native-control-failure", true],
    ["local-playback", "local-media-failure", true],
    ["seek", "seek-failure", true],
    ["restore", "restore-failure", true],
    ["overlay-teardown", "overlay-failure", true]
  ];
  for (const [phase, errorCode, hasSnapshot] of cases) {
    await t.test(phase, async () => {
      const { calls, engine, metrics } = harness({ failAt: phase });
      await assert.rejects(engine.execute(3000), { code: errorCode, phase });
      assert.equal(engine.state, TransitionState.FAILED);
      assert.equal(calls.includes("force-overlay-teardown"), true);
      assert.equal(calls.includes("force-native-safe"), hasSnapshot);
      const snapshot = metrics.snapshot();
      assert.deepEqual(snapshot.cycles[0].detail, { errorCode, phase });
      assert.equal(JSON.stringify(snapshot).includes("C:\\private"), false);
    });
  }
});

test("operation watchdog exits a hung native mutation and invokes last-resort restoration", async () => {
  const { calls, engine, metrics } = harness({
    hangAt: "pause",
    operationTimeouts: { pause: 5 }
  });
  await assert.rejects(engine.execute(3000), { name: "TransitionTimeoutError", code: "timeout", phase: "pause" });
  assert.equal(engine.state, TransitionState.FAILED);
  assert.equal(calls.includes("restore:3000:true:false"), true);
  assert.equal(calls.includes("force-overlay-teardown"), true);
  assert.equal(calls.includes("force-native-safe"), true);
  assert.deepEqual(metrics.snapshot().cycles[0].detail, { errorCode: "timeout", phase: "pause" });
});

test("recovery watchdog still reaches force-safe cleanup when normal restore hangs", async () => {
  const { calls, engine, metrics } = harness({
    hangAt: "restore",
    operationTimeouts: { restore: 5 }
  });
  await assert.rejects(engine.execute(3000), { name: "TransitionTimeoutError", code: "timeout", phase: "restore" });
  assert.equal(engine.state, TransitionState.FAILED);
  assert.equal(calls.filter((call) => call.startsWith("restore:")).length, 2);
  assert.equal(calls.includes("force-overlay-teardown"), true);
  assert.equal(calls.includes("force-native-safe"), true);
  assert.equal(metrics.snapshot().events.some((event) =>
    event.name === "recovery-step-failed" && event.detail.errorCode === "timeout"), true);
});

for (const [name,receipt,expected] of [
  ['clamped target',{targetMs:7750,errorMs:3,after:{currentTimeMs:7753}},-247],
  ['unclamped target',{targetMs:8000,errorMs:3,after:{currentTimeMs:8003}},3],
  ['missing receipt',undefined,null],
  ['command error without observed coordinate',{targetMs:7750,errorMs:3},null],
  ['non-finite observed coordinate',{targetMs:7750,errorMs:3,after:{currentTimeMs:NaN}},null]
]) test(`seek evidence uses requested resume coordinate: ${name}`,async()=>{
  const {adapter,engine,metrics}=harness();adapter.seek=async target=>{assert.equal(target,8000);return receipt;};
  await engine.execute(3000);const snapshot=metrics.snapshot();assert.equal(snapshot.cycles[0].timings.nativeSeekErrorMs,expected);
  const event=snapshot.events.find(e=>e.name==='native-seek');assert.equal(event.detail.errorBasis,'requested-resume-target');assert.equal(event.detail.requestedTargetMs,8000);
  assert.equal(event.detail.commandTargetMs,receipt?.targetMs??null);assert.equal(event.detail.observedTimeMs,Number.isFinite(receipt?.after?.currentTimeMs)?receipt.after.currentTimeMs:null);
  assert.equal(snapshot.cycles[0].status,'success');
});

function stagingHarness({ pausedAtMs = 3_000 } = {}) {
  const h = harness();
  const { adapter, overlay, calls } = h;
  let staged = null;
  adapter.readState = async () => ({ currentTimeMs: pausedAtMs, muted: false, volume: 0.5 });
  adapter.stageOverlayHost = async () => { calls.push("stage-host"); staged = { hidden: true }; return staged; };
  adapter.unstageOverlayHost = () => { calls.push("unstage-host"); staged = null; };
  adapter.mountOverlayHost = async () => { calls.push(staged ? "adopt-host" : "overlay-host"); const host = staged ?? {}; staged = null; return host; };
  overlay.unmount = async () => { calls.push("unmount"); };
  overlay.primeForPlayback = async () => { calls.push("warmup"); };
  return h;
}

test("a staged cut does no renderer round trips before the cover", async () => {
  const { calls, engine, metrics } = stagingHarness();
  await engine.preload({ id: "segment-1", triggerMs: 3000, resumeMs: 8000, clipUrl: "fixture.mp4", gainDb: -6 });
  assert.equal(await engine.stage({ id: "segment-1", triggerMs: 3000, resumeMs: 8000, clipUrl: "fixture.mp4", gainDb: -6 }), true);
  const staging = calls.splice(0);
  // preload, then staging (whose prepare is instant for the already-current clip)
  assert.deepEqual(staging, ["prepare", "prepare", "stage-host", "overlay-mount", "audio:0.5:-6", "overlay-show", "warmup"]);
  const result = await engine.execute(3016);
  assert.equal(result.status, "success");
  const cover = calls.indexOf("covered:true");
  assert.deepEqual(calls.slice(0, cover + 1), ["snapshot", "adopt-host", "pause", "muted:true", "mute", "covered:true"]);
  assert.ok(!calls.includes("prepare") && !calls.includes("overlay-mount") && !calls.includes("overlay-show"));
  assert.ok(calls.includes("restore:8000:true:true"));
  assert.deepEqual(metrics.events.find(event => event.name === "cover-path")?.detail, { staged: true, entry: false });
});

test("cancelling a preload hands a staged renderer back before removing its host", async () => {
  const { calls, engine } = stagingHarness();
  await engine.preload({ id: "segment-1", triggerMs: 3000, resumeMs: 8000, clipUrl: "fixture.mp4" });
  await engine.stage({ id: "segment-1", triggerMs: 3000, resumeMs: 8000, clipUrl: "fixture.mp4" });
  calls.length = 0;
  await engine.cancelPreload("native-seek");
  assert.deepEqual(calls.slice(0, 2), ["unmount", "unstage-host"]);
  assert.equal(engine.staged, null);
  // Unstaged, the next transition takes the full path again.
  calls.length = 0;
  await engine.execute(3000);
  assert.ok(calls.includes("prepare") && calls.includes("overlay-host") && calls.includes("overlay-show"));
});

test("INSERT resumes where native actually paused instead of replaying the overshoot", async () => {
  const { calls, engine } = stagingHarness({ pausedAtMs: 3_020 });
  engine.arm({ id: "insert-1", action: "INSERT", triggerMs: 3_000, resumeMs: 3_000, clipUrl: "fixture.mp4" });
  assert.equal((await engine.execute(3_016)).status, "success");
  assert.ok(calls.includes("seek:3020"));
  assert.ok(calls.includes("restore:3020:true:true"));
});

test("full (unstaged) path keeps the cover hidden until native is paused and the clip shown", async () => {
  const { calls, engine } = harness();
  await engine.execute(3000);
  const order = name => calls.indexOf(name);
  assert.ok(order("pause") < order("covered:true") && order("overlay-show") < order("covered:true"));
});

test("adjacent scenes play inside one cover and restore once at the last join", async () => {
  const { calls, engine, overlay, adapter } = harness();
  overlay.prepareNext = async clip => { calls.push(`prepare-next:${clip}`); };
  overlay.advance = async () => { calls.push("advance"); };
  const advanced = [];
  engine.arm({ id: "a", triggerMs: 3000, resumeMs: 8000, clipUrl: "a.mp4", onAdvance: id => advanced.push(id),
    chain: [{ id: "b", triggerMs: 8000, resumeMs: 12000, clipUrl: "b.mp4", gainDb: -3 }, { id: "c", action: "INSERT", triggerMs: 12020, resumeMs: 12020, clipUrl: "c.mp4" }] });
  const result = await engine.execute(3000);
  assert.deepEqual(result.chained, ["b", "c"]);
  assert.deepEqual(advanced, ["b", "c"]);
  assert.equal(calls.filter(call => call === "covered:true").length, 1, "one cover for the whole chain");
  assert.equal(calls.filter(call => call.startsWith("restore:")).length, 1);
  assert.ok(calls.includes("restore:12020:true:true"));
  assert.deepEqual(calls.filter(call => call.startsWith("seek:")), ["seek:8000", "seek:12000", "seek:12020"]);
  assert.ok(calls.includes("audio:0.5:-3"), "the next scene's own gain is applied");
  void adapter;
});

test("a chain ends at the current join when the next clip is not ready", async () => {
  const { calls, engine, overlay, metrics } = harness();
  overlay.prepareNext = async () => { throw new Error("decode failed"); };
  overlay.advance = async () => { calls.push("advance"); };
  engine.arm({ id: "a", triggerMs: 3000, resumeMs: 8000, clipUrl: "a.mp4", chain: [{ id: "b", triggerMs: 8000, resumeMs: 12000, clipUrl: "b.mp4" }] });
  const result = await engine.execute(3000);
  assert.equal(result.status, "success");
  assert.equal(result.chained, undefined);
  assert.ok(!calls.includes("advance"));
  assert.ok(calls.includes("restore:8000:true:true"));
  assert.ok(metrics.events.some(event => event.name === "chain-ended"));
});

test("chained segments must follow one another in time", () => {
  const { engine } = harness();
  assert.throws(() => engine.arm({ id: "a", triggerMs: 3000, resumeMs: 8000, clipUrl: "a.mp4", chain: [{ id: "b", triggerMs: 7000, resumeMs: 9000, clipUrl: "b.mp4" }] }), /follow in time/);
});

test("entering mid-scene covers native (black) before loading, and shows the clip only once cued", async () => {
  const { calls, engine, overlay } = harness();
  overlay.cue = async fraction => { calls.push(`cue:${fraction}`); };
  engine.arm({ id: "segment-1", triggerMs: 3000, resumeMs: 8000, clipUrl: "fixture.mp4", entryFraction: 0.25 });
  assert.equal((await engine.execute(4250)).status, "success");
  assert.ok(calls.indexOf("pause") < calls.indexOf("covered:true"), "native is held before it is covered");
  assert.ok(calls.indexOf("covered:true") < calls.indexOf("prepare"), "the removed footage is covered while the clip loads");
  assert.ok(calls.indexOf("prepare") < calls.indexOf("cue:0.25") && calls.indexOf("cue:0.25") < calls.indexOf("overlay-show"));
  assert.equal(calls.filter(call => call === "covered:true").length, 1);
  assert.throws(() => engine.arm({ id: "i", action: "INSERT", triggerMs: 3000, resumeMs: 3000, clipUrl: "x.mp4", entryFraction: 0.5 }), /entryFraction/);
});

test("a preloaded mid-scene entry pauses native first and cues once at where it stopped", async () => {
  const { calls, engine, overlay, adapter } = harness();
  overlay.cue = async fraction => { calls.push(`cue:${fraction}`); };
  adapter.readState = async () => ({ currentTimeMs: 5500 });
  await engine.preload({ id: "segment-1", triggerMs: 3000, resumeMs: 8000, clipUrl: "fixture.mp4" });
  calls.length = 0;
  engine.arm({ id: "segment-1", triggerMs: 3000, resumeMs: 8000, clipUrl: "fixture.mp4", entryFraction: 0.3 });
  assert.equal((await engine.execute(4500)).status, "success");
  assert.ok(!calls.includes("prepare"), "no second prepare/rewind for an already preloaded clip");
  assert.ok(calls.indexOf("pause") < calls.indexOf("cue:0.5"), "native is frozen before the entry point is measured");
  assert.equal(calls.filter(call => call === "pause").length, 1);
  assert.ok(calls.indexOf("covered:true") < calls.indexOf("cue:0.5") && calls.indexOf("cue:0.5") < calls.indexOf("overlay-show"));
});

test("a viewer's pause holds the local playback watchdog; keys do nothing outside a replacement", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const calls = [];
  let finishPlay;
  const adapter = {
    async snapshot() { return { currentTimeMs: 3000, paused: false, muted: false, volume: 0.5 }; },
    async mountOverlayHost() { return {}; }, async pause() {}, async setMuted() {}, async setNativeCovered() {},
    async seek() {}, async restore(_s, options) { calls.push(`restore:${options.targetTimeMs}`); }, async forceSafeNativeState() {}
  };
  const overlay = {
    async prepare() {}, async mount() {}, async configureAudio() {}, async show() {}, async stop() { calls.push("stop"); }, async teardown() {}, forceTeardown() {},
    play() { return new Promise(resolve => { finishPlay = resolve; }); },
    async localPause() { calls.push("pause"); }, async localResume() { calls.push("resume"); },
    async localSeek(delta) { calls.push(`seek:${delta}`); }, async localMute(muted) { calls.push(`mute:${muted}`); }
  };
  const engine = new TransitionEngine({ adapter, overlay, metrics: new MetricsRecorder(), now: () => Date.now(), operationTimeouts: { "local-playback": 1000 }, joinSeekDelayMs: 0 });
  assert.equal(await engine.toggleLocalPause(), null, "nothing is playing yet");
  engine.arm({ id: "segment-1", triggerMs: 3000, resumeMs: 8000, clipUrl: "fixture.mp4" });
  const running = engine.execute(3000);
  for (let i = 0; i < 20 && engine.state !== TransitionState.PLAYING_LOCAL; i += 1) await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.state, TransitionState.PLAYING_LOCAL);
  t.mock.timers.tick(500);
  assert.equal(await engine.toggleLocalPause(), "paused");
  t.mock.timers.tick(60_000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.state, TransitionState.PLAYING_LOCAL, "a minute paused is not a hung clip");
  assert.equal(await engine.seekLocal(-5000), true); assert.equal(await engine.setLocalMuted(true), true);
  assert.equal(await engine.toggleLocalPause(), "resumed");
  finishPlay({ durationMs: 5000, localTimeAtEndMs: 5000, unplayedTailMs: 0 }); await running;
  assert.equal(engine.state, TransitionState.COMPLETE);
  assert.deepEqual(calls.filter(c => !c.startsWith("restore")), ["pause", "seek:-5000", "mute:true", "resume"]);
  assert.equal(await engine.seekLocal(5000), false, "no replacement is playing");
});

test("native is seeked to the join once the clip is under way, not at the cut", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = []; let finishPlay;
  const adapter = { async snapshot() { return { currentTimeMs: 3000, paused: false, muted: false, volume: 0.5 }; }, async mountOverlayHost() { return {}; },
    async pause() {}, async setMuted() {}, async setNativeCovered() {}, async seek(ms) { calls.push(`seek:${ms}`); }, async restore() { calls.push("restore"); }, async forceSafeNativeState() {} };
  const overlay = { async prepare() {}, async mount() {}, async configureAudio() {}, async show() {}, async stop() {}, async teardown() {}, forceTeardown() {},
    play() { calls.push("play"); return new Promise(resolve => { finishPlay = resolve; }); } };
  const engine = new TransitionEngine({ adapter, overlay, metrics: new MetricsRecorder(), operationTimeouts: { "local-playback": 60_000 } });
  engine.arm({ id: "segment-1", triggerMs: 3000, resumeMs: 8000, clipUrl: "fixture.mp4" });
  const running = engine.execute(3000);
  for (let i = 0; i < 20 && !calls.includes("play"); i += 1) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["play"]);
  t.mock.timers.tick(499); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["play"]);
  t.mock.timers.tick(1); for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["play", "seek:8000"]);
  finishPlay({ durationMs: 5000, localTimeAtEndMs: 5000, unplayedTailMs: 0 }); await running;
});

// 0.66.2: hold-only watch (adapter.planHold) while a scene is not staged.
function holdHarness(options) {
  const h = stagingHarness(options);
  const plans = []; let held = null;
  Object.assign(h.adapter, {
    planHold(triggerMs) { plans.push(`hold:${triggerMs}`); h.plan = 'hold'; return true; },
    planCut(triggerMs) { plans.push(`cut:${triggerMs}`); h.plan = 'cut'; return true; },
    cancelPlannedCut() { if (h.plan) plans.push(`cancel:${h.plan}`); h.plan = null; },
    cutHoldOnly(triggerMs) { return held === triggerMs; }
  });
  const unstageHost = h.adapter.unstageOverlayHost;
  h.adapter.unstageOverlayHost = options => { plans.push(`unstage-host:${options?.keepCutHold === true ? 'keep' : 'release'}`); h.plan = null; unstageHost(); };
  h.fireHold = triggerMs => { held = triggerMs; h.plan = null; };
  h.plans = plans;
  return h;
}
const SEGMENT = { id: "segment-1", triggerMs: 3000, resumeMs: 8000, clipUrl: "fixture.mp4", gainDb: -6 };

test("staging watches native with a hold-only cut until the planned cut replaces it", async () => {
  const { engine, plans } = holdHarness();
  await engine.preload(SEGMENT);
  assert.equal(await engine.stage(SEGMENT), true);
  assert.deepEqual(plans, ["hold:3000", "hold:3000", "cut:3000"], "before the host is staged, after it, then the planned cut");
  assert.equal(engine.holdPlanned, false);
});

test("a failed stage leaves the hold-only watch in place, and a seek or the transition drops it", async () => {
  const h = holdHarness(); const { engine, plans, overlay } = h;
  await engine.preload(SEGMENT);
  const mount = overlay.mount; overlay.mount = async () => { throw new Error("mount failed"); };
  await assert.rejects(engine.stage(SEGMENT), { name: "TransitionStepError" });
  assert.equal(engine.staged, null);
  assert.equal(plans.at(-1), "hold:3000", "registered again after the failed stage was removed");
  assert.equal(engine.holdPlanned, true); assert.equal(h.plan, "hold");
  await engine.cancelPreload("native-seek");
  assert.equal(h.plan, null, "a seek cancels the watch"); assert.equal(engine.holdPlanned, false);

  overlay.mount = async () => { throw new Error("mount failed"); };
  await assert.rejects(engine.stage(SEGMENT));
  assert.equal(h.plan, "hold");
  overlay.mount = mount;
  h.fireHold(3000); // the watch stopped native on the frame before the trigger and woke the scheduler
  h.calls.length = 0;
  assert.equal((await engine.execute(3000)).status, "success");
  assert.ok(h.calls.includes("prepare") && h.calls.includes("overlay-host") && h.calls.includes("overlay-show"), "the unstaged path");
  assert.ok(h.calls.indexOf("snapshot") < h.calls.indexOf("covered:true"));
  assert.equal(engine.holdPlanned, false);
});

test("a stage replaced by a seek or another clip does not leave a hold-only watch", async () => {
  const h = holdHarness(); const { engine, overlay } = h;
  await engine.preload(SEGMENT);
  let release; overlay.mount = () => new Promise(resolve => { release = resolve; });
  const staging = engine.stage(SEGMENT); staging.catch(() => {});
  for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.plan, "hold");
  const cancelled = engine.cancelPreload("native-seek"); release();
  await cancelled; await assert.rejects(staging, { name: "AbortError" });
  assert.equal(h.plan, null); assert.equal(engine.holdPlanned, false);
});

test("a trigger during staging keeps the hold-only cut while the unfinished stage is discarded", async () => {
  const h = holdHarness(); const { engine, overlay, plans } = h;
  await engine.preload(SEGMENT);
  let release; const mount = overlay.mount; overlay.mount = () => new Promise(resolve => { release = resolve; });
  const staging = engine.stage(SEGMENT); staging.catch(() => {});
  for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve));
  h.fireHold(3000); overlay.mount = mount;
  engine.arm(SEGMENT);
  const running = engine.execute(3000); release();
  assert.equal((await running).status, "success");
  assert.ok(plans.includes("unstage-host:keep"), "the hold survives the discarded stage");
  assert.ok(!plans.includes("cut:3000"), "no planned cut was registered for the discarded stage");
});
