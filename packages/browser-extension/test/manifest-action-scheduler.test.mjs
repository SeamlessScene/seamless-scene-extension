import assert from "node:assert/strict";
import test from "node:test";
import { fixtureManifest } from "../src/fixture-signed-manifest.mjs";
import { compileManifestActions, ManifestActionScheduler } from "../src/manifest-action-scheduler.mjs";

function asset() {
  return structuredClone(fixtureManifest.segments[0].asset);
}

function multiActionManifest() {
  const manifest = {
    ...structuredClone(fixtureManifest),
    segments: [
      { ...structuredClone(fixtureManifest.segments[0]), segment_id: "replace-1", trigger_time_ms: 1_000, resume_time_ms: 2_000 },
      { ...structuredClone(fixtureManifest.segments[0]), segment_id: "insert-1", action: "INSERT", trigger_time_ms: 3_000, resume_time_ms: 3_000 },
      { segment_id: "mute-1", action: "MUTE", trigger_time_ms: 4_000, resume_time_ms: 5_000, asset: null, transition: { type: "hard_cut" }, failure_policy: "continue_native" },
      { segment_id: "skip-1", action: "SKIP", trigger_time_ms: 6_000, resume_time_ms: 7_000, asset: null, transition: { type: "hard_cut" }, failure_policy: "continue_native" }
    ],
    feature_flags: {
      replace_enabled: true,
      insert_enabled: true,
      skip_enabled: true,
      mute_enabled: true,
      emergency_disable: false
    }
  };
  manifest.segments[0].transition.gain_db = -8;
  return manifest;
}

function activation() {
  return { status: "activated", manifest: multiActionManifest() };
}

function harness(actions) {
  const calls = [];
  const executor = {
    async preloadLocal() {},
    async cancelPreload() {},
    async executeLocal(action) { calls.push(`${action.type}:${action.id}:${action.resumeMs}`); },
    async executeSkip(action) { calls.push(`SKIP:${action.resumeMs}`); },
    async startMute(action) { calls.push(`MUTE:start:${action.id}`); },
    async finishMute(action) { calls.push(`MUTE:finish:${action.id}`); },
    async cancel(reason) { calls.push(`cancel:${reason}`); }
  };
  return { calls, executor, scheduler: new ManifestActionScheduler({ actions, executor }) };
}

test("compiles all four manifest actions and resolves assets only for local actions", () => {
  const resolutions = [];
  const actions = compileManifestActions(activation(), {
    resolveAssetUrl(hash, id) {
      resolutions.push({ hash, id });
      return `blob:${id}`;
    }
  });
  assert.deepEqual(actions.map(({ type, triggerMs, resumeMs }) => ({ type, triggerMs, resumeMs })), [
    { type: "REPLACE", triggerMs: 1_000, resumeMs: 2_000 },
    { type: "INSERT", triggerMs: 3_000, resumeMs: 3_000 },
    { type: "MUTE", triggerMs: 4_000, resumeMs: 5_000 },
    { type: "SKIP", triggerMs: 6_000, resumeMs: 7_000 }
  ]);
  assert.equal(resolutions.length, 2);
  assert.equal(resolutions.every(({ hash }) => hash === asset().sha256), true);
  assert.deepEqual(actions.map(({ gainDb }) => gainDb), [-8, 0, 0, 0]);
});

test("refuses to compile a disabled or unverified manifest", () => {
  assert.throws(() => compileManifestActions({ status: "disabled", manifest: null }), /verified active manifest/);
  assert.throws(() => compileManifestActions(multiActionManifest()), /verified active manifest/);
});

test("executes ordered replace, insert, mute, and skip semantics", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const { calls, scheduler } = harness(actions);
  await scheduler.observe({ currentTimeMs: 0, paused: false });
  await scheduler.observe({ currentTimeMs: 1_001, paused: false });
  await scheduler.observe({ currentTimeMs: 2_500, paused: false });
  await scheduler.observe({ currentTimeMs: 3_001, paused: false });
  await scheduler.observe({ currentTimeMs: 4_001, paused: false });
  await scheduler.observe({ currentTimeMs: 5_001, paused: false });
  await scheduler.observe({ currentTimeMs: 6_001, paused: false });
  assert.deepEqual(calls, [
    "REPLACE:replace-1:2000",
    "INSERT:insert-1:3000",
    "MUTE:start:mute-1",
    "MUTE:finish:mute-1",
    "SKIP:7000"
  ]);
  assert.deepEqual(Object.values(scheduler.snapshot().statuses), ["completed", "completed", "completed", "completed"]);
});

test("does not trigger actions when a seek jumps past them", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const { calls, scheduler } = harness(actions);
  await scheduler.observe({ currentTimeMs: 0, paused: false });
  await scheduler.observe({ currentTimeMs: 7_500, paused: false, event: "seek" });
  assert.deepEqual(calls, []);
  assert.deepEqual(Object.values(scheduler.snapshot().statuses), ["skipped", "skipped", "skipped", "skipped"]);
});

test("seeking before a completed trigger rearms it", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const { calls, scheduler } = harness(actions);
  await scheduler.observe({ currentTimeMs: 0, paused: false });
  await scheduler.observe({ currentTimeMs: 1_001, paused: false });
  await scheduler.observe({ currentTimeMs: 500, paused: false, event: "seek" });
  await scheduler.observe({ currentTimeMs: 600, paused: false });
  await scheduler.observe({ currentTimeMs: 1_001, paused: false });
  assert.deepEqual(calls, ["REPLACE:replace-1:2000", "REPLACE:replace-1:2000"]);
});

test("a later native seek retains completed scenes and skips only bypassed pending scenes", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const { calls, scheduler } = harness(actions);
  await scheduler.observe({ currentTimeMs: 0, paused: false });
  await scheduler.observe({ currentTimeMs: 1_001, paused: false });
  const completionsBefore = scheduler.snapshot().events.filter(e => e.outcome === 'completed').length;
  await scheduler.observe({ currentTimeMs: 3_500, paused: false, event: 'seek' });
  assert.deepEqual(Object.values(scheduler.snapshot().statuses), ['completed', 'skipped', 'pending', 'pending']);
  await scheduler.observe({ currentTimeMs: 3_501, paused: false, event: 'seek' });
  assert.deepEqual(Object.values(scheduler.snapshot().statuses), ['completed', 'skipped', 'pending', 'pending']);
  assert.deepEqual(calls, ['REPLACE:replace-1:2000']);
  assert.equal(scheduler.snapshot().events.filter(e => e.outcome === 'completed').length, completionsBefore);
  assert.equal(scheduler.snapshot().events.some(e => e.actionId === 'replace-1' && e.reason === 'seek-after-trigger'), false);
});

test("seeking back before a completed scene then jumping past it records a skip in the new traversal", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const { calls, scheduler } = harness(actions);
  await scheduler.observe({ currentTimeMs: 0, paused: false });
  await scheduler.observe({ currentTimeMs: 1_001, paused: false });
  await scheduler.observe({ currentTimeMs: 500, paused: true, event: 'seek' });
  assert.equal(scheduler.snapshot().statuses['replace-1'], 'pending');
  await scheduler.observe({ currentTimeMs: 2_500, paused: true, event: 'seek' });
  assert.equal(scheduler.snapshot().statuses['replace-1'], 'skipped');
  assert.deepEqual(calls, ['REPLACE:replace-1:2000']);
});

test("seeking during a mute interval restores it and marks past actions skipped", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const { calls, scheduler } = harness(actions);
  scheduler.observe({ currentTimeMs: 3_500, paused: false });
  await scheduler.observe({ currentTimeMs: 4_001, paused: false });
  await scheduler.observe({ currentTimeMs: 4_500, paused: false, event: "seek" });
  assert.deepEqual(calls, ["MUTE:start:mute-1", "MUTE:finish:mute-1"]);
  assert.equal(scheduler.snapshot().statuses["mute-1"], "skipped");
  assert.equal(scheduler.snapshot().statuses["skip-1"], "pending");
});

test("a missed replacement interval is skipped instead of seeking the source backwards", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const { calls, scheduler } = harness(actions);
  await scheduler.observe({ currentTimeMs: 0, paused: false });
  await scheduler.observe({ currentTimeMs: 6_500, paused: false });
  assert.deepEqual(calls, []);
  assert.equal(scheduler.snapshot().statuses["replace-1"], "skipped");
  assert.equal(scheduler.snapshot().statuses["insert-1"], "pending");
  await scheduler.observe({ currentTimeMs: 2_500, paused: false, event: "seek" });
  await scheduler.observe({ currentTimeMs: 3_001, paused: false });
  assert.deepEqual(calls, ["INSERT:insert-1:3000"]);
});

test("a seek during a running local action invokes cancellation before rescheduling", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  let rejectLocal;
  const calls = [];
  const executor = {
    async preloadLocal() {},
    async cancelPreload() {},
    executeLocal() {
      calls.push("local:start");
      return new Promise((_resolve, reject) => { rejectLocal = reject; });
    },
    async executeSkip() {},
    async startMute() {},
    async finishMute() {},
    async cancel(reason) {
      calls.push(`cancel:${reason}`);
      const error = new Error(reason);
      error.name = "AbortError";
      rejectLocal(error);
    }
  };
  const scheduler = new ManifestActionScheduler({ actions, executor });
  await scheduler.observe({ currentTimeMs: 0, paused: false });
  const running = scheduler.observe({ currentTimeMs: 1_001, paused: false });
  await Promise.resolve();
  await scheduler.observe({ currentTimeMs: 500, paused: false, event: "seek" });
  await running;
  assert.deepEqual(calls, ["local:start", "cancel:native-seek"]);
  assert.equal(scheduler.snapshot().statuses["replace-1"], "pending");
});

test("cancelling the plan restores active mute and cancels remaining actions", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const { calls, scheduler } = harness(actions);
  scheduler.observe({ currentTimeMs: 3_500, paused: false });
  await scheduler.observe({ currentTimeMs: 4_001, paused: false });
  const snapshot = await scheduler.cancelAll("user-cancelled");
  assert.deepEqual(calls, ["MUTE:start:mute-1", "MUTE:finish:mute-1"]);
  assert.equal(Object.values(snapshot.statuses).every((status) => ["skipped", "cancelled"].includes(status)), true);
});

test("identity cancellation remains terminal when it races a native seek", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  let rejectLocal;
  const calls = [];
  const executor = {
    async preloadLocal() {},
    async cancelPreload() {},
    executeLocal() {
      calls.push("local:start");
      return new Promise((_resolve, reject) => { rejectLocal = reject; });
    },
    async executeSkip() {},
    async startMute() {},
    async finishMute() {},
    async honorNativeSeek(targetTimeMs) { calls.push(`seek:${targetTimeMs}`); },
    async cancel(reason) {
      calls.push(`cancel:${reason}`);
      if (!rejectLocal) return;
      const reject = rejectLocal;
      rejectLocal = null;
      const error = new Error(reason);
      error.name = "AbortError";
      reject(error);
    }
  };
  const scheduler = new ManifestActionScheduler({ actions, executor });
  await scheduler.observe({ currentTimeMs: 0, paused: false });
  const running = scheduler.observe({ currentTimeMs: 1_001, paused: false });
  await Promise.resolve();

  const seek = scheduler.observe({ currentTimeMs: 0, paused: false, event: "seek" });
  const cancellation = scheduler.cancelAll("source-identity-became-incompatible");
  const [seekSnapshot, cancelledSnapshot] = await Promise.all([seek, cancellation, running]);

  assert.equal(calls.includes("seek:0"), false);
  assert.equal(Object.values(seekSnapshot.statuses).every((status) => status === "cancelled"), true);
  assert.equal(Object.values(cancelledSnapshot.statuses).every((status) => status === "cancelled"), true);
  assert.equal(scheduler.observe({ currentTimeMs: 1_500, paused: false }), null);
});

test("preloads only inside the configured window and requires readiness at the trigger", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const calls = [];
  const executor = {
    async preloadLocal(action) { calls.push(`preload:${action.id}`); },
    async cancelPreload() {},
    async executeLocal(action) { calls.push(`execute:${action.id}`); },
    async executeSkip() {}, async startMute() {}, async finishMute() {}
  };
  const scheduler = new ManifestActionScheduler({ actions, executor, preloadWindowMs: 500 });
  assert.equal(scheduler.observe({ currentTimeMs: 400, paused: false }), null);
  await scheduler.observe({ currentTimeMs: 501, paused: false });
  assert.equal(scheduler.snapshot().preflightStatuses["replace-1"], "ready");
  assert.equal(scheduler.snapshot().preflightStatuses["insert-1"], "idle");
  await scheduler.observe({ currentTimeMs: 1_001, paused: false });
  assert.deepEqual(calls, ["preload:replace-1", "execute:replace-1"]);
});

test("skips local execution when preflight is unresolved at the trigger", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  let rejectPreload;
  const calls = [];
  const executor = {
    preloadLocal() { calls.push("preload:start"); return new Promise((_resolve, reject) => { rejectPreload = reject; }); },
    async cancelPreload(reason) {
      calls.push(`preload:cancel:${reason}`);
      const error = new Error(reason);
      error.name = "AbortError";
      rejectPreload(error);
    },
    async executeLocal() { calls.push("execute"); },
    async executeSkip() {}, async startMute() {}, async finishMute() {}
  };
  const scheduler = new ManifestActionScheduler({ actions, executor });
  scheduler.observe({ currentTimeMs: 0, paused: false });
  await Promise.resolve();
  await scheduler.observe({ currentTimeMs: 1_001, paused: false });
  assert.deepEqual(calls, ["preload:start", "preload:cancel:trigger-before-ready"]);
  assert.equal(scheduler.snapshot().statuses["replace-1"], "skipped");
  assert.equal(scheduler.snapshot().events.some((event) =>
    event.outcome === "skipped" && event.reason === "preflight-not-ready"), true);
});

test("records a bounded failed preflight and continues native scheduling", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const executor = {
    async preloadLocal() { throw new Error("C:\\private\\clip-name.mp4 failed"); },
    async cancelPreload() {},
    async executeLocal() { throw new Error("must-not-execute"); },
    async executeSkip() {}, async startMute() {}, async finishMute() {}
  };
  const scheduler = new ManifestActionScheduler({ actions, executor });
  await scheduler.observe({ currentTimeMs: 0, paused: false });
  await scheduler.observe({ currentTimeMs: 1_001, paused: false });
  const snapshot = scheduler.snapshot();
  assert.equal(snapshot.statuses["replace-1"], "skipped");
  assert.equal(snapshot.preflightStatuses["replace-1"], "failed");
  assert.equal(JSON.stringify(snapshot).includes("clip-name"), false);
  assert.equal(snapshot.events.some((event) => event.outcome === "preflight-failed" && event.reason === "not-ready"), true);
});

test("stages a preloaded action inside the stage window and restages after a seek", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const calls = [];
  const executor = {
    async preloadLocal(action) { calls.push(`preload:${action.id}`); },
    async stageLocal(action) { calls.push(`stage:${action.id}`); return true; },
    async cancelPreload(reason) { calls.push(`cancel-preload:${reason}`); },
    async honorNativeSeek() {},
    async executeLocal(action) { calls.push(`execute:${action.id}`); },
    async executeSkip() {}, async startMute() {}, async finishMute() {}
  };
  const scheduler = new ManifestActionScheduler({ actions, executor, preloadWindowMs: 900, stageWindowMs: 300 });
  await scheduler.observe({ currentTimeMs: 200, paused: false });
  scheduler.observe({ currentTimeMs: 600, paused: false });
  await Promise.resolve();
  assert.deepEqual(calls, ["preload:replace-1"], "outside the stage window nothing is staged");
  scheduler.observe({ currentTimeMs: 750, paused: false });
  scheduler.observe({ currentTimeMs: 800, paused: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["preload:replace-1", "stage:replace-1"], "staged exactly once");
  assert.ok(scheduler.snapshot().events.some(event => event.outcome === "staged"));
  await scheduler.observe({ currentTimeMs: 100, paused: false, event: "seek" });
  assert.ok(calls.includes("cancel-preload:native-seek"));
  await scheduler.observe({ currentTimeMs: 800, paused: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(call => call === "stage:replace-1").length, 2, "a seek clears the stage so it can be staged again");
});

for (const firstStageFails of [false, true]) test(`replaying a completed action stages again after ${firstStageFails ? "failed" : "successful"} initial staging`, async () => {
  const [action] = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  let stages = 0, executions = 0;
  const scheduler = new ManifestActionScheduler({ actions: [action], preloadWindowMs: 900, stageWindowMs: 300,
    executor: {
      async preloadLocal() {}, async cancelPreload() {}, async honorNativeSeek() {},
      async stageLocal() { stages++; if (firstStageFails && stages === 1) throw Error("stage unavailable"); return true; },
      async executeLocal() { executions++; }
    } });
  for (let traversal = 0; traversal < 3; traversal++) {
    await scheduler.observe({ currentTimeMs: 200, paused: false, event: traversal ? "seek" : "tick" });
    await scheduler.observe({ currentTimeMs: 750, paused: false });
    await scheduler.observe({ currentTimeMs: 800, paused: false });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stages, traversal + 1, "stage once per traversal, including after completed playback");
    await scheduler.observe({ currentTimeMs: 1_001, paused: false });
    assert.equal(executions, traversal + 1);
    assert.equal(scheduler.snapshot().preflightStatuses[action.id], "consumed");
  }
});

test("a seek invalidates a queued stage before it reaches the executor", async () => {
  const [action] = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  let stages = 0;
  const scheduler = new ManifestActionScheduler({ actions: [action], preloadWindowMs: 900, stageWindowMs: 300,
    executor: { async preloadLocal() {}, async cancelPreload() {}, async honorNativeSeek() {},
      async stageLocal() { stages++; return true; } } });
  await scheduler.observe({ currentTimeMs: 200, paused: false });
  scheduler.observe({ currentTimeMs: 750, paused: false });
  await scheduler.observe({ currentTimeMs: 200, paused: false, event: "seek" });
  assert.equal(stages, 0, "the old traversal cannot mount a clip after seek invalidation");
  await scheduler.observe({ currentTimeMs: 750, paused: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stages, 1);
});

test("late staging completion after rapid seeks cannot certify the new traversal", async () => {
  const [action] = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const finish = [];
  const scheduler = new ManifestActionScheduler({ actions: [action], preloadWindowMs: 900, stageWindowMs: 300,
    executor: { async preloadLocal() {}, async cancelPreload() {}, async honorNativeSeek() {}, async cancel() {},
      stageLocal() { return new Promise(resolve => finish.push(resolve)); } } });
  await scheduler.observe({ currentTimeMs: 200, paused: false });
  await scheduler.observe({ currentTimeMs: 750, paused: false });
  await new Promise(resolve => setImmediate(resolve));
  await Promise.all([
    scheduler.observe({ currentTimeMs: 100, paused: false, event: "seek" }),
    scheduler.observe({ currentTimeMs: 200, paused: false, event: "seek" })
  ]);
  await scheduler.observe({ currentTimeMs: 750, paused: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finish.length, 2);
  finish[0](true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.snapshot().events.filter(e => e.outcome === "staged").length, 0);
  finish[1](true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.snapshot().events.filter(e => e.outcome === "staged").length, 1);
});

test("a failed stage is recorded and the action still executes", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const calls = [];
  const executor = {
    async preloadLocal() {}, async cancelPreload() {},
    async stageLocal() { throw new Error("stage failed"); },
    async executeLocal(action) { calls.push(`execute:${action.id}`); },
    async executeSkip() {}, async startMute() {}, async finishMute() {}
  };
  const scheduler = new ManifestActionScheduler({ actions, executor, preloadWindowMs: 900, stageWindowMs: 900 });
  await scheduler.observe({ currentTimeMs: 200, paused: false });
  scheduler.observe({ currentTimeMs: 300, paused: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(scheduler.snapshot().events.some(event => event.outcome === "stage-failed"));
  await scheduler.observe({ currentTimeMs: 1_001, paused: false });
  assert.deepEqual(calls, ["execute:replace-1"]);
});

function adjacentActions() {
  const base = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` })[0];
  const make = (id, triggerMs, resumeMs) => Object.freeze({ ...base, id, triggerMs, resumeMs, clipUrl: `blob:${id}` });
  return [make("a", 1_000, 2_000), make("b", 2_000, 3_000), make("c", 3_030, 4_000), make("d", 6_000, 7_000)];
}

test("adjacent scenes are chained into one execution; later ones are preloaded during it", async () => {
  const actions = adjacentActions(), calls = [];
  let finishLocal;
  const executor = {
    async preloadLocal(action) { calls.push(`preload:${action.id}`); },
    async preloadNextLocal(action) { calls.push(`preload-next:${action.id}`); },
    async cancelPreload() {},
    executeLocal(action, _observed, options = {}) {
      calls.push(`execute:${action.id}:${(options.chain ?? []).map(member => member.id).join("+")}`);
      options.onAdvance?.("b"); options.onAdvance?.("c");
      return new Promise(resolve => { finishLocal = () => resolve({ status: "success", chained: ["b", "c"] }); });
    },
    async executeSkip() {}, async startMute() {}, async finishMute() {}
  };
  const scheduler = new ManifestActionScheduler({ actions, executor, chainGapMs: 50, preloadWindowMs: 5_000 });
  await scheduler.observe({ currentTimeMs: 500, paused: false });
  const running = scheduler.observe({ currentTimeMs: 1_001, paused: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.snapshot().runningActionId, "c", "the viewer timeline follows the scene now playing");
  scheduler.observe({ currentTimeMs: 1_100, paused: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.includes("preload-next:d"), "the scene after the chain loads during it");
  assert.equal(scheduler.snapshot().preflightStatuses.d, "ready");
  finishLocal(); await running;
  assert.equal(calls.find(call => call.startsWith("execute:")), "execute:a:b+c");
  assert.deepEqual(["a", "b", "c"].map(id => scheduler.snapshot().statuses[id]), ["completed", "completed", "completed"]);
  assert.equal(scheduler.snapshot().statuses.d, "pending");
});

test("without chainGapMs scenes are never chained", async () => {
  const actions = adjacentActions(), calls = [];
  const executor = { async preloadLocal() {}, async cancelPreload() {},
    async executeLocal(action, _observed, options) { calls.push(options?.chain?.length ?? 0); },
    async executeSkip() {}, async startMute() {}, async finishMute() {} };
  const scheduler = new ManifestActionScheduler({ actions, executor });
  await scheduler.observe({ currentTimeMs: 500, paused: false });
  await scheduler.observe({ currentTimeMs: 1_001, paused: false });
  assert.deepEqual(calls, [0]);
});

test("a playing viewer's seek into a replaced interval enters it at once, without waiting for a preload", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const replace = Object.freeze({ ...actions.find(action => action.id === "replace-1"), resumeMs: 5_000 });
  const calls = [];
  const executor = {
    async preloadLocal(action) { calls.push(`preload:${action.id}`); }, async cancelPreload() {}, async honorNativeSeek(target) { calls.push(`honor:${target}`); },
    async executeLocal(action, observed, options) { calls.push(`execute:${action.id}:${observed}:${options?.entryFraction ?? "start"}`); },
    async executeSkip() {}, async startMute() {}, async finishMute() {}
  };
  // The viewer seeks to 1200 ms, inside a REPLACE covering 1000..5000 ms of native.
  const scheduler = new ManifestActionScheduler({ actions: [replace], executor, enterReplacedOnSeek: true });
  await scheduler.observe({ currentTimeMs: 1_200, paused: false, event: "seek" });
  await scheduler.running;
  assert.deepEqual(calls, ["honor:1200", "execute:replace-1:1200:0.05"], "the engine loads the clip under its cover; no separate preload first");
  assert.equal(scheduler.snapshot().statuses["replace-1"], "completed");
});

test("a paused viewer's seek into a replaced interval preloads, then enters part-way once playing", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const replace = actions.find(action => action.id === "replace-1");
  const calls = []; let finishPreload;
  const executor = {
    preloadLocal(action) { calls.push(`preload:${action.id}`); return new Promise(resolve => { finishPreload = resolve; }); },
    async cancelPreload() {}, async honorNativeSeek(target) { calls.push(`honor:${target}`); },
    async executeLocal(action, observed, options) { calls.push(`execute:${action.id}:${options?.entryFraction ?? "start"}`); },
    async executeSkip() {}, async startMute() {}, async finishMute() {}
  };
  const wide = new ManifestActionScheduler({ actions: [Object.freeze({ ...replace, resumeMs: 5_000 })], executor, enterReplacedOnSeek: true });
  const seeking = wide.observe({ currentTimeMs: 1_200, paused: true, event: "seek" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(wide.snapshot().statuses["replace-1"], "pending");
  assert.ok(calls.includes("preload:replace-1"), "the entered scene preloads at once");
  finishPreload(); await seeking;
  await wide.observe({ currentTimeMs: 1_400, paused: false });
  const executed = calls.find(call => call.startsWith("execute:"));
  assert.equal(executed, "execute:replace-1:0.1", "entered at the native position reached, as a fraction of the interval");
});

test("without enterReplacedOnSeek a seek into a replaced interval skips it as before", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const replace = Object.freeze({ ...actions.find(action => action.id === "replace-1"), resumeMs: 5_000 });
  const executor = { async preloadLocal() {}, async cancelPreload() {}, async honorNativeSeek() {}, async executeLocal() {}, async executeSkip() {}, async startMute() {}, async finishMute() {} };
  const scheduler = new ManifestActionScheduler({ actions: [replace], executor });
  await scheduler.observe({ currentTimeMs: 1_200, paused: false, event: "seek" });
  assert.equal(scheduler.snapshot().statuses["replace-1"], "skipped");
});

test("a paused seek entry whose clip fails to load is skipped, not retried in a loop", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const replace = Object.freeze({ ...actions.find(action => action.id === "replace-1"), resumeMs: 5_000 });
  const calls = [];
  const executor = { async preloadLocal() { throw new Error("decode failed"); }, async cancelPreload() {}, async honorNativeSeek() {},
    async executeLocal(action) { calls.push(action.id); }, async executeSkip() {}, async startMute() {}, async finishMute() {} };
  const scheduler = new ManifestActionScheduler({ actions: [replace], executor, enterReplacedOnSeek: true });
  await scheduler.observe({ currentTimeMs: 1_200, paused: true, event: "seek" });
  await scheduler.observe({ currentTimeMs: 1_300, paused: false });
  assert.equal(scheduler.snapshot().statuses["replace-1"], "skipped");
  assert.ok(scheduler.snapshot().events.some(event => event.reason === "seek-entry-not-ready"));
  assert.deepEqual(calls, []);
});

test("an immediate seek entry that fails is recorded once and not retried", async () => {
  const actions = compileManifestActions(activation(), { resolveAssetUrl: (_hash, id) => `blob:${id}` });
  const replace = Object.freeze({ ...actions.find(action => action.id === "replace-1"), resumeMs: 5_000 });
  const calls = [];
  const executor = { async preloadLocal() {}, async cancelPreload() {}, async honorNativeSeek() {},
    async executeLocal(action) { calls.push(action.id); throw new Error("decode failed"); }, async executeSkip() {}, async startMute() {}, async finishMute() {} };
  const scheduler = new ManifestActionScheduler({ actions: [replace], executor, enterReplacedOnSeek: true });
  await scheduler.observe({ currentTimeMs: 1_200, paused: false, event: "seek" });
  await scheduler.running;
  await scheduler.observe({ currentTimeMs: 1_300, paused: false });
  assert.equal(scheduler.snapshot().statuses["replace-1"], "failed");
  assert.deepEqual(calls, ["replace-1"]);
});
