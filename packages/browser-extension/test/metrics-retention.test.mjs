import assert from "node:assert/strict";
import test from "node:test";
import {MetricsRecorder} from "../src/metrics.mjs";

test("transition diagnostics are bounded and cycle identities survive retention rollover", () => {
  const metrics = new MetricsRecorder();
  for (let index = 0; index < 1002; index++) {
    metrics.startCycle({id: "repeat", action: "INSERT", triggerMs: 0, resumeMs: 0}, 1);
    metrics.timing("nativeUncoverErrorMs", index === 1001 ? null : 0);
    metrics.finishCycle("success");
  }
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.cycles.length, 1000);
  assert.equal(snapshot.events.length, 2000);
  assert.equal(snapshot.retention.droppedCycles, 2);
  assert.equal(snapshot.retention.droppedEvents, 4);
  assert.equal(snapshot.cycles[0].id, "repeat-3");
  assert.equal(snapshot.cycles.at(-1).id, "repeat-1002");
  assert.equal(snapshot.cycles.at(-1).action, "INSERT");
  assert.equal(snapshot.cycles.at(-1).timings.nativeUncoverErrorMs, null);
  snapshot.cycles.at(-1).timings.nativeUncoverErrorMs = 100;
  assert.equal(metrics.snapshot().cycles.at(-1).timings.nativeUncoverErrorMs, null);
});

test("an absent clock is not a zero-error trigger", () => {
  const metrics = new MetricsRecorder();
  const cycle = metrics.startCycle({id: "unknown", triggerMs: 0, resumeMs: 5000}, null);
  assert.equal(cycle.triggerErrorMs, null);
  for (const value of [null, undefined, NaN, Infinity, "0"]) {
    metrics.timing("nativeSeekErrorMs", value);
    assert.equal(cycle.timings.nativeSeekErrorMs, null);
  }
});

test('zero-fraction entries and missing clocks cannot masquerade as on-time trigger crossings', () => {
  const metrics = new MetricsRecorder();
  for (const observedTimeMs of [null, undefined, NaN, Infinity, '1000']) {
    const cycle = metrics.startCycle({ id: 'entry', triggerMs: 1000, resumeMs: 2000, entryFraction: 0 }, observedTimeMs);
    assert.equal(cycle.entryMode, 'seek-entry');
    assert.equal(cycle.triggerErrorMs, null);
    assert.equal(cycle.entryOffsetMs, null);
    metrics.finishCycle('cancelled');
  }
  const cycle = metrics.startCycle({ id: 'entry', triggerMs: 1000, resumeMs: 2000, entryFraction: 0 }, 1000);
  assert.equal(cycle.triggerErrorMs, null);
  assert.equal(cycle.entryOffsetMs, 0);
});
