import assert from "node:assert/strict";
import test from "node:test";
import { ManifestActionExecutor } from "../src/manifest-action-executor.mjs";

function harness({ transitionResult = { status: "success", cycleId: "cycle-1" } } = {}) {
  const calls = [];
  const transitionEngine = {
    async preload(segment) { calls.push(["preload", segment]); return { readyState: 3 }; },
    async cancelPreload(reason) { calls.push(["cancel-preload", reason]); },
    arm(segment) { calls.push(["arm", segment]); },
    async execute(observedTimeMs) { calls.push(["execute", observedTimeMs]); return transitionResult; },
    cancel(reason) { calls.push(["cancel", reason]); return true; }
  };
  const adapter = {
    async snapshot() { calls.push(["snapshot"]); return { paused: false }; },
    async seek(targetMs) { calls.push(["seek", targetMs]); },
    async beginMuteAction(action) { calls.push(["mute-start", action.id]); },
    async finishMuteAction(action) { calls.push(["mute-finish", action.id]); }
  };
  return { calls, executor: new ManifestActionExecutor({ transitionEngine, adapter }) };
}

test("maps replace and equal-runtime insert actions into the transition engine", async () => {
  const { calls, executor } = harness();
  await executor.executeLocal({ id: "insert-1", type: "INSERT", triggerMs: 3_000, resumeMs: 3_000, clipUrl: "blob:insert" }, 3_010);
  assert.deepEqual(calls, [
    ["arm", { id: "insert-1", action: "INSERT", evidenceOrigin: 'automatic-packet', triggerMs: 3_000, resumeMs: 3_000, clipUrl: "blob:insert", gainDb: 0 }],
    ["execute", 3_010]
  ]);
});

test("turns transition cancellation into the scheduler's AbortError contract", async () => {
  const { executor } = harness({ transitionResult: { status: "cancelled", cycleId: "cycle-1" } });
  await assert.rejects(
    executor.executeLocal({ id: "replace-1", type: "REPLACE", triggerMs: 1_000, resumeMs: 2_000, clipUrl: "blob:replace" }, 1_000),
    (error) => error.name === "AbortError" && error.message === "local-action-cancelled"
  );
});

test("validates source state before a skip seek", async () => {
  const { calls, executor } = harness();
  await executor.executeSkip({ id: "skip-1", resumeMs: 7_000 });
  assert.deepEqual(calls, [["snapshot"], ["seek", 7_000]]);
});

test("delegates mute ownership and cancellation through narrow adapter operations", async () => {
  const { calls, executor } = harness();
  const action = { id: "mute-1" };
  await executor.startMute(action);
  await executor.finishMute(action);
  await executor.honorNativeSeek(500);
  assert.equal(await executor.cancel("native-seek"), true);
  assert.deepEqual(calls, [["mute-start", "mute-1"], ["mute-finish", "mute-1"], ["seek", 500], ["cancel", "native-seek"]]);
});

test("maps local preflight and cancellation into the transition engine", async () => {
  const { calls, executor } = harness();
  const action = { id: "replace-1", type: "REPLACE", triggerMs: 1_000, resumeMs: 2_000, clipUrl: "blob:replace" };
  assert.deepEqual(await executor.preloadLocal(action), { readyState: 3 });
  await executor.cancelPreload("native-seek");
  assert.deepEqual(calls, [
    ["preload", { id: "replace-1", action: "REPLACE", triggerMs: 1_000, resumeMs: 2_000, clipUrl: "blob:replace", gainDb: 0 }],
    ["cancel-preload", "native-seek"]
  ]);
});
