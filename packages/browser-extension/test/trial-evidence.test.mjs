import assert from "node:assert/strict";
import test from "node:test";
import { classifyTrialError, evaluateTransitionEvidence, TrialEvidenceRecorder } from "../src/trial-evidence.mjs";

function state(overrides = {}) {
  return {
    currentTimeMs: 100000,
    runtimeMs: 1000000,
    paused: false,
    muted: false,
    volume: 1,
    readyState: 4,
    ...overrides
  };
}

function successResult(overrides = {}) {
  return {
    command: "local-replacement",
    confirmed: true,
    durationMs: 5211.1,
    before: state(),
    after: state({ currentTimeMs: 110020 }),
    transition: {
      status: "success",
      metrics: {
        timings: {
          triggerToCoveredMs: 23.4,
          nativeSeekMs: 129.6,
          restoreMs: 108.5,
          coveredDurationMs: 5186.5,
          nativeUncoverErrorMs: 20
        }
      }
    },
    ...overrides
  };
}

test("records only coarse local evidence and excludes content identity and absolute playback positions", () => {
  const recorder = new TrialEvidenceRecorder({ extensionVersion: "0.5.0" });
  const result = successResult();
  const record = recorder.recordResult({
    command: "local-replacement",
    result,
    scenario: {
      titleSlot: "episode-01",
      contentKind: "episodic",
      networkProfile: "normal",
      presentationMode: "windowed",
      clipDurationMs: 5000,
      triggerMode: "manual-spike",
      title: "Sensitive title text",
      contentId: "sensitive-provider-id",
      url: "https://provider.example/watch/sensitive"
    },
    teardown: { overlayAbsent: true, localVideoAbsent: true }
  });

  assert.equal(record.scenario.positionBucket, "start");
  assert.equal(record.metrics.timelineAdvanceMs, 10020);
  assert.equal(record.metrics.timelineErrorMs, 20);
  assert.equal(record.restoration.passed, true);
  const serialized = JSON.stringify(recorder.snapshot());
  assert.doesNotMatch(serialized, /Sensitive title text|sensitive-provider-id|provider\.example/);
  assert.doesNotMatch(serialized, /100000|110020/);
});

test("records cancellation as a restored outcome instead of a command failure", () => {
  const recorder = new TrialEvidenceRecorder({ extensionVersion: "0.5.0" });
  const record = recorder.recordResult({
    command: "local-replacement",
    result: successResult({
      confirmed: false,
      before: state({ currentTimeMs: 550117 }),
      after: state({ currentTimeMs: 550182 }),
      transition: { status: "cancelled", metrics: { timings: { triggerToCoveredMs: 46, nativeRecoveryErrorMs: 65 } } }
    }),
    teardown: { overlayAbsent: true, localVideoAbsent: true }
  });

  assert.equal(record.outcome, "cancelled");
  assert.equal(record.metrics.timelineAdvanceMs, 65);
  assert.equal(record.metrics.timelineErrorMs, 65);
  assert.equal(record.restoration.timelineRestored, true);
  assert.equal(record.restoration.passed, true);
});

test("uses bounded error codes and requires evidence of usable native playback", () => {
  const recorder = new TrialEvidenceRecorder({ extensionVersion: "0.5.0" });
  const record = recorder.recordFailure({
    command: "local-replacement",
    error: new Error("Timed out while reading secret-title-at-123.456s"),
    before: state(),
    after: null,
    teardown: { overlayAbsent: true, localVideoAbsent: true }
  });

  assert.equal(record.errorCode, "timeout");
  assert.equal(record.restoration.passed, false);
  assert.doesNotMatch(JSON.stringify(recorder.snapshot()), /secret-title|123\.456/);
});

test("summarizes matrix coverage and interpolated p50 and p95 timing", () => {
  const recorder = new TrialEvidenceRecorder({ extensionVersion: "0.5.0" });
  for (const [index, triggerToCoveredMs] of [10, 20, 30, 40, 50].entries()) {
    recorder.recordResult({
      command: "local-replacement",
      result: successResult({
        transition: { status: "success", metrics: { timings: { triggerToCoveredMs, nativeUncoverErrorMs: 20 } } }
      }),
      scenario: {
        titleSlot: `film-${index + 1}`,
        contentKind: "film",
        networkProfile: "normal",
        presentationMode: "windowed",
        clipDurationMs: 5000
      },
      teardown: { overlayAbsent: true, localVideoAbsent: true }
    });
  }

  const summary = recorder.summary();
  assert.equal(summary.total, 5);
  assert.equal(summary.commandSuccessRate, 1);
  assert.equal(summary.restorationSuccessRate, 1);
  assert.equal(summary.matrix.contentKinds.film, 5);
  assert.equal(summary.timings.triggerToCovered.p50Ms, 30);
  assert.equal(summary.timings.triggerToCovered.p95Ms, 48);
});

test("sanitizes opaque slots and classifies common failures without retaining messages", () => {
  const recorder = new TrialEvidenceRecorder();
  const record = recorder.recordResult({
    command: "pause",
    result: {
      command: "pause",
      confirmed: true,
      durationMs: 1,
      before: state(),
      after: state({ paused: true })
    },
    scenario: { titleSlot: "Actual Movie Title (2024)" },
    teardown: { overlayAbsent: true, localVideoAbsent: true }
  });
  assert.equal(record.scenario.titleSlot, "unassigned");
  assert.equal(record.restoration, null);
  assert.equal(classifyTrialError(new Error("Active Prime player was lost during transition")), "player-unavailable");
  assert.equal(classifyTrialError(new Error("decode failed")), "local-media-failure");
});

test("refuses to pass a small successful transition sample", () => {
  const recorder = new TrialEvidenceRecorder();
  for (let index = 0; index < 5; index += 1) {
    recorder.recordResult({
      command: "local-replacement",
      result: successResult(),
      scenario: { titleSlot: `fixture-${index}`, clipDurationMs: 5_000 },
      teardown: { overlayAbsent: true, localVideoAbsent: true }
    });
  }

  const evaluation = evaluateTransitionEvidence(recorder.snapshot());
  assert.equal(evaluation.status, "insufficient-evidence");
  assert.equal(evaluation.checks.transitionSampleSize.actual, 5);
  assert.equal(evaluation.checks.cycleSuccessRate.status, "insufficient-evidence");
  assert.ok(evaluation.checks.clipDurationsMs.missing.includes("30000"));
  assert.equal(recorder.snapshot().schemaVersion, 3);
  assert.equal(recorder.snapshot().transitionGateEvaluation.status, "insufficient-evidence");
});

test("passes only a complete 100-transition cleared matrix with threshold metrics", () => {
  const recorder = new TrialEvidenceRecorder();
  const positions = [100_000, 500_000, 800_000];
  for (let index = 0; index < 100; index += 1) {
    const currentTimeMs = positions[index % positions.length];
    recorder.recordResult({
      command: "local-replacement",
      result: successResult({
        before: state({ currentTimeMs }),
        after: state({ currentTimeMs: currentTimeMs + 10_020 })
      }),
      scenario: {
        titleSlot: `slot-${index % 10}`,
        contentKind: index % 2 ? "film" : "episodic",
        networkProfile: index % 2 ? "normal" : "throttled",
        presentationMode: index % 2 ? "windowed" : "fullscreen",
        clipDurationMs: [5_000, 30_000, 60_000][index % 3]
      },
      teardown: { overlayAbsent: true, localVideoAbsent: true }
    });
  }

  const evaluation = evaluateTransitionEvidence(recorder.snapshot());
  assert.equal(evaluation.status, "passed");
  assert.equal(evaluation.checks.cycleSuccessRate.actual, 1);
  assert.equal(evaluation.checks.timelineErrorP95Ms.actual, 20);
});

test("fails a sufficiently large sample that misses reliability thresholds", () => {
  const recorder = new TrialEvidenceRecorder();
  for (let index = 0; index < 100; index += 1) {
    const result = successResult({ confirmed: index >= 3 });
    recorder.recordResult({
      command: "local-replacement",
      result,
      scenario: {
        positionBucket: "start",
        networkProfile: index % 2 ? "normal" : "throttled",
        presentationMode: index % 2 ? "windowed" : "fullscreen",
        clipDurationMs: [5_000, 30_000, 60_000][index % 3]
      },
      teardown: { overlayAbsent: true, localVideoAbsent: true }
    });
  }

  const evaluation = evaluateTransitionEvidence(recorder.snapshot(), {
    requiredPositionBuckets: ["start"]
  });
  assert.equal(evaluation.status, "failed");
  assert.equal(evaluation.checks.cycleSuccessRate.actual, 0.97);
  assert.equal(evaluation.checks.cycleSuccessRate.status, "failed");
});

test("arbitrary REPLACE and long INSERT measure source error at uncover, not a later UI sample", () => {
  for (const [command, advanceMs, clipDurationMs] of [
    ["local-replacement", 14_000, 14_000],
    ["local-replacement", 9_250, 60_000],
    ["local-insertion", 0, 120_000]
  ]) {
    const recorder = new TrialEvidenceRecorder();
    const record = recorder.recordResult({ command, result: successResult({
      // Deliberately late, so the old after-before calculation would fail.
      after: state({currentTimeMs: 100_000 + advanceMs + 1500}),
      transition: {status: "success", metrics: {triggerErrorMs: 12, timings: {
        nativeSeekErrorMs: -2, nativeUncoverErrorMs: 37, localUnplayedTailMs: 0
      }}}
    }), scenario: {clipDurationMs}, teardown: {overlayAbsent: true, localVideoAbsent: true} });
    assert.equal(record.metrics.timelineErrorMs, 37);
    assert.equal(record.metrics.triggerErrorMs, 12);
    assert.equal(record.metrics.nativeSeekErrorMs, -2);
    assert.equal(record.metrics.localUnplayedTailMs, 0);
    assert.equal(record.restoration.passed, true);
    assert.equal(evaluateTransitionEvidence(recorder.snapshot()).checks.transitionSampleSize.actual, 1);
  }
});

test("missing or non-finite source receipts never become successful timeline restoration", () => {
  for (const value of [undefined, null, NaN, Infinity, "0"]) {
    const recorder = new TrialEvidenceRecorder();
    const record = recorder.recordResult({command: "local-replacement", result: successResult({
      transition: {status: "success", metrics: {timings: {nativeUncoverErrorMs: value}}}
    }), teardown: {overlayAbsent: true, localVideoAbsent: true}});
    assert.equal(record.metrics.timelineErrorMs, null);
    assert.equal(record.restoration.timelineRestored, null);
    assert.equal(record.restoration.passed, false);
    assert.equal(recorder.summary().timings.absoluteTimelineError.samples, 0);
  }
});

test("seek cancellation does not invent a return-to-old-position measurement", () => {
  const recorder = new TrialEvidenceRecorder();
  const record = recorder.recordResult({command: "local-replacement", result: successResult({
    confirmed: false, after: state({currentTimeMs: 700_000}),
    transition: {status: "cancelled", metrics: {timings: {}}}
  }), teardown: {overlayAbsent: true, localVideoAbsent: true}});
  assert.equal(record.metrics.timelineErrorMs, null);
  assert.equal(record.restoration.timelineRestored, null);
  assert.equal(record.outcome, "cancelled");
});

test("bounded history discloses eviction, preserves unique sequences and refuses selection-biased gates", () => {
  const recorder = new TrialEvidenceRecorder();
  for (let index = 0; index < 2002; index++) {
    recorder.recordResult({command: "local-replacement", result: successResult(),
      teardown: {overlayAbsent: true, localVideoAbsent: true}});
  }
  const snapshot = recorder.snapshot();
  assert.equal(snapshot.records.length, 2000);
  assert.equal(snapshot.records[0].sequence, 3);
  assert.equal(snapshot.records.at(-1).sequence, 2002);
  assert.equal(snapshot.retention.droppedRecords, 2);
  assert.equal(snapshot.transitionGateEvaluation.checks.retainedEvidence.status, "insufficient-evidence");
  recorder.clear();
  assert.equal(recorder.snapshot().retention.droppedRecords, 0);
  assert.equal(recorder.recordResult({command: "pause", result: {confirmed: true}}).sequence, 2003);
});
