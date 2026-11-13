import { EXECUTING_BUILD } from './build-info.mjs';

const CONTENT_KINDS = new Set(["unknown", "film", "episodic"]);
const NETWORK_PROFILES = new Set(["normal", "throttled", "temporary-disconnect"]);
const PRESENTATION_MODES = new Set(["windowed", "fullscreen"]);
const LOCAL_TRANSITIONS = new Set(["local-replacement", "local-insertion"]);
const MAX_RECORDS = 2000;

function finite(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function stateSummary(state) {
  if (!state) return null;
  return {
    playback: state.paused ? "paused" : "playing",
    muted: Boolean(state.muted),
    volume: finite(state.volume),
    readyState: Number.isFinite(state.readyState) ? state.readyState : null,
    buffering: Number.isFinite(state.readyState) ? state.readyState < 3 : null
  };
}

function sanitizeSlot(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(normalized) ? normalized : "unassigned";
}

function oneOf(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function positionBucket(state) {
  if (!Number.isFinite(state?.currentTimeMs) || !Number.isFinite(state?.runtimeMs) || state.runtimeMs <= 0) {
    return "unknown";
  }
  const ratio = state.currentTimeMs / state.runtimeMs;
  if (ratio < 0.25) return "start";
  if (ratio < 0.75) return "middle";
  return "final-quarter";
}

function percentile(values, percentileValue) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return finite(sorted[lower]);
  return finite(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

function summarizeMetric(records, selector) {
  const values = records.map(selector).filter(Number.isFinite);
  return {
    samples: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maximumMs: values.length ? finite(Math.max(...values)) : null
  };
}

function counts(records, selector) {
  return Object.fromEntries([...records.reduce((map, record) => {
    const key = String(selector(record));
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map())].sort(([a], [b]) => a.localeCompare(b)));
}

function rate(numerator, denominator) {
  return denominator ? finite(numerator / denominator) : null;
}

function thresholdCheck({ actual, threshold, compare, samples, minimumSamples }) {
  if (samples < minimumSamples || actual === null) {
    return { status: "insufficient-evidence", actual, threshold, samples, minimumSamples };
  }
  return {
    status: compare(actual, threshold) ? "passed" : "failed",
    actual,
    threshold,
    samples,
    minimumSamples
  };
}

function coverageCheck(actualValues, requiredValues) {
  const observed = new Set([...actualValues].map(String));
  const required = requiredValues.map(String);
  const missing = required.filter((value) => !observed.has(value));
  return {
    status: missing.length ? "insufficient-evidence" : "passed",
    observed: [...observed].sort(),
    required,
    missing
  };
}

export function evaluateTransitionEvidence(snapshot, {
  minimumTransitions = 100,
  minimumCycleSuccessRate = 0.98,
  minimumRestorationSuccessRate = 0.95,
  maximumTimelineErrorP95Ms = 250,
  requiredPositionBuckets = ["start", "middle", "final-quarter"],
  requiredNetworkProfiles = ["normal", "throttled"],
  requiredPresentationModes = ["windowed", "fullscreen"],
  requiredClipDurationsMs = [5_000, 30_000, 60_000]
} = {}) {
  const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
  const transitions = records.filter((record) => LOCAL_TRANSITIONS.has(record.command) && record.outcome !== "cancelled");
  const restorations = transitions.filter((record) => record.restoration);
  const timelineErrors = transitions
    .map((record) => record.metrics?.timelineErrorMs)
    .filter(Number.isFinite)
    .map(Math.abs);
  const cycleSuccessRate = rate(transitions.filter((record) => record.outcome === "success").length, transitions.length);
  const restorationSuccessRate = rate(
    restorations.filter((record) => record.restoration?.passed === true).length,
    restorations.length
  );
  const timelineErrorP95Ms = percentile(timelineErrors, 0.95);

  const checks = {
    retainedEvidence: {
      status: snapshot?.retention?.droppedRecords > 0 ? "insufficient-evidence" : "passed",
      droppedRecords: snapshot?.retention?.droppedRecords ?? 0
    },
    transitionSampleSize: {
      status: transitions.length >= minimumTransitions ? "passed" : "insufficient-evidence",
      actual: transitions.length,
      threshold: minimumTransitions
    },
    cycleSuccessRate: thresholdCheck({
      actual: cycleSuccessRate,
      threshold: minimumCycleSuccessRate,
      compare: (actual, threshold) => actual >= threshold,
      samples: transitions.length,
      minimumSamples: minimumTransitions
    }),
    restorationSuccessRate: thresholdCheck({
      actual: restorationSuccessRate,
      threshold: minimumRestorationSuccessRate,
      compare: (actual, threshold) => actual >= threshold,
      samples: restorations.length,
      minimumSamples: minimumTransitions
    }),
    timelineErrorP95Ms: thresholdCheck({
      actual: timelineErrorP95Ms,
      threshold: maximumTimelineErrorP95Ms,
      compare: (actual, threshold) => actual <= threshold,
      samples: timelineErrors.length,
      minimumSamples: minimumTransitions
    }),
    timingCompleteness: {
      status: timelineErrors.length === transitions.length && transitions.length > 0 ? "passed" : "insufficient-evidence",
      measured: timelineErrors.length,
      missing: transitions.length - timelineErrors.length
    },
    positionBuckets: coverageCheck(new Set(transitions.map((record) => record.scenario?.positionBucket)), requiredPositionBuckets),
    networkProfiles: coverageCheck(new Set(transitions.map((record) => record.scenario?.networkProfile)), requiredNetworkProfiles),
    presentationModes: coverageCheck(new Set(transitions.map((record) => record.scenario?.presentationMode)), requiredPresentationModes),
    clipDurationsMs: coverageCheck(new Set(transitions.map((record) => record.scenario?.clipDurationMs)), requiredClipDurationsMs)
  };
  const statuses = Object.values(checks).map((check) => check.status);
  const status = statuses.includes("failed")
    ? "failed"
    : statuses.includes("insufficient-evidence")
      ? "insufficient-evidence"
      : "passed";

  return {
    profile: "SPIKE-002-cleared-transition-v1",
    status,
    checks,
    notEvaluated: [
      "blackout-at-most-100ms-external-observation-required",
      "fullscreen-always-escapable-manual-browser-evidence-required",
      "commercial-provider-command-gates-separate"
    ]
  };
}

export function classifyTrialError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  if (message.includes("context invalidated")) return "extension-context-invalidated";
  if (message.includes("no active") || message.includes("player was lost")) return "player-unavailable";
  if (message.includes("not enough runtime")) return "insufficient-runtime";
  if (message.includes("fullscreen")) return "fullscreen-failure";
  if (message.includes("decode") || message.includes("local video") || message.includes("local overlay")) {
    return "local-media-failure";
  }
  if (message.includes("seek")) return "seek-failure";
  if (message.includes("timed out") || message.includes("timeout")) return "timeout";
  return "command-failure";
}

export class TrialEvidenceRecorder {
  constructor({ serviceId = "prime-video", extensionVersion = "unknown" } = {}) {
    this.serviceId = serviceId;
    this.extensionVersion = extensionVersion;
    this.records = [];
    this.sequence = 0;
    this.droppedRecords = 0;
  }

  recordResult({ command, result, scenario = {}, teardown = {} }) {
    const transitionStatus = result?.transition?.status ?? null;
    const outcome = transitionStatus === "cancelled"
      ? "cancelled"
      : result?.confirmed
        ? "success"
        : "not-confirmed";
    return this.addRecord({
      command,
      outcome,
      errorCode: null,
      before: result?.before,
      after: result?.after,
      durationMs: result?.durationMs,
      seekErrorMs: result?.errorMs,
      transitionTimings: result?.transition?.metrics?.timings,
      triggerErrorMs: result?.transition?.metrics?.triggerErrorMs,
      scenario,
      teardown
    });
  }

  recordFailure({ command, error, before = null, after = null, scenario = {}, teardown = {} }) {
    return this.addRecord({
      command,
      outcome: "failed",
      errorCode: classifyTrialError(error),
      before,
      after,
      durationMs: null,
      seekErrorMs: null,
      transitionTimings: null,
      scenario,
      teardown
    });
  }

  addRecord({ command, outcome, errorCode, before, after, durationMs, seekErrorMs, transitionTimings, triggerErrorMs, scenario, teardown }) {
    const isReplacement = LOCAL_TRANSITIONS.has(command);
    const timelineAdvanceMs = Number.isFinite(before?.currentTimeMs) && Number.isFinite(after?.currentTimeMs)
      ? after.currentTimeMs - before.currentTimeMs
      : null;
    // Only the adapter's source-coordinate receipt measures the actual join.
    // A later UI sample includes elapsed native playback and cannot replace it.
    const timelineErrorMs = finite(outcome === "cancelled" || outcome === "failed"
      ? transitionTimings?.nativeRecoveryErrorMs
      : transitionTimings?.nativeUncoverErrorMs);
    const initial = stateSummary(before);
    const final = stateSummary(after);
    const overlayAbsent = teardown.overlayAbsent === true;
    const localVideoAbsent = teardown.localVideoAbsent === true;
    const playbackRestored = initial && final ? initial.playback === final.playback : null;
    const muteRestored = initial && final ? initial.muted === final.muted : null;
    const volumeRestored = initial && final && initial.volume !== null && final.volume !== null
      ? Math.abs(initial.volume - final.volume) < 0.001
      : null;
    const timelineRestored = outcome === "cancelled" && Number.isFinite(timelineErrorMs)
      ? Math.abs(timelineErrorMs) <= 250
      : outcome === "success" && isReplacement && Number.isFinite(timelineErrorMs)
        ? Math.abs(timelineErrorMs) <= 250
        : null;
    const nativeUsable = final && Number.isFinite(final.readyState) ? final.readyState >= 2 : null;
    const expectsRestoration = isReplacement
      || command?.startsWith("warm-seek")
      || command === "windowed-cover"
      || command === "fullscreen-cover"
      || outcome === "failed";
    const preservationPassed = initial
      ? playbackRestored === true && muteRestored === true && volumeRestored === true
      : true;
    const restorationPassed = expectsRestoration
      && overlayAbsent
      && localVideoAbsent
      && nativeUsable === true
      && preservationPassed
      && (isReplacement ? timelineRestored === true : timelineRestored !== false);

    const record = {
      sequence: ++this.sequence,
      serviceId: this.serviceId,
      integrationDepth: 0,
      extensionVersion: this.extensionVersion,
      command,
      outcome,
      errorCode,
      scenario: {
        titleSlot: sanitizeSlot(scenario.titleSlot),
        contentKind: oneOf(scenario.contentKind, CONTENT_KINDS, "unknown"),
        positionBucket: positionBucket(before),
        networkProfile: oneOf(scenario.networkProfile, NETWORK_PROFILES, "normal"),
        presentationMode: oneOf(scenario.presentationMode, PRESENTATION_MODES, "windowed"),
        clipDurationMs: Number.isFinite(scenario.clipDurationMs) ? Math.round(scenario.clipDurationMs) : null,
        triggerMode: scenario.triggerMode === "natural-boundary" ? "natural-boundary" : "manual-spike"
      },
      initial,
      final,
      metrics: {
        commandDurationMs: finite(durationMs),
        seekErrorMs: finite(seekErrorMs),
        timelineAdvanceMs: finite(timelineAdvanceMs),
        timelineErrorMs: finite(timelineErrorMs),
        timelineErrorBasis: outcome === "cancelled" || outcome === "failed" ? "native-recovery-receipt" : "native-uncover-receipt",
        triggerErrorMs: finite(triggerErrorMs),
        nativeSeekErrorMs: finite(transitionTimings?.nativeSeekErrorMs),
        nativeUncoverErrorMs: finite(transitionTimings?.nativeUncoverErrorMs),
        nativeRecoveryErrorMs: finite(transitionTimings?.nativeRecoveryErrorMs),
        nativeResumeMs: finite(transitionTimings?.nativeResumeMs),
        nativeFrameWaitMs: finite(transitionTimings?.nativeFrameWaitMs),
        nativeCompositorWaitMs: finite(transitionTimings?.nativeCompositorWaitMs),
        localUnplayedTailMs: finite(transitionTimings?.localUnplayedTailMs),
        triggerToCoveredMs: finite(transitionTimings?.triggerToCoveredMs),
        nativeSeekMs: finite(transitionTimings?.nativeSeekMs),
        restoreMs: finite(transitionTimings?.restoreMs),
        coveredDurationMs: finite(transitionTimings?.coveredDurationMs)
      },
      restoration: expectsRestoration ? {
        overlayAbsent,
        localVideoAbsent,
        playbackRestored,
        muteRestored,
        volumeRestored,
        timelineRestored,
        nativeUsable,
        passed: restorationPassed
      } : null
    };
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) {
      this.records.shift();
      this.droppedRecords += 1;
    }
    return structuredClone(record);
  }

  clear() {
    this.records.length = 0;
    this.droppedRecords = 0;
  }

  summary() {
    const records = this.records;
    const attempted = records.filter(record => record.outcome !== "cancelled");
    const restoration = records.filter(record => record.restoration);
    return {
      total: records.length,
      samples: {
        attemptedCommands: attempted.length,
        restorationChecks: restoration.length
      },
      outcomes: counts(records, record => record.outcome),
      commandSuccessRate: attempted.length
        ? finite(attempted.filter(record => record.outcome === "success").length / attempted.length)
        : null,
      restorationSuccessRate: restoration.length
        ? finite(restoration.filter(record => record.restoration.passed).length / restoration.length)
        : null,
      matrix: {
        titleSlots: counts(records, record => record.scenario.titleSlot),
        contentKinds: counts(records, record => record.scenario.contentKind),
        positionBuckets: counts(records, record => record.scenario.positionBucket),
        networkProfiles: counts(records, record => record.scenario.networkProfile),
        presentationModes: counts(records, record => record.scenario.presentationMode),
        clipDurationsMs: counts(records, record => record.scenario.clipDurationMs ?? "unknown")
      },
      timings: {
        absoluteTriggerError: summarizeMetric(records, record => Number.isFinite(record.metrics?.triggerErrorMs) ? Math.abs(record.metrics.triggerErrorMs) : null),
        absoluteTimelineError: summarizeMetric(records, record => Number.isFinite(record.metrics?.timelineErrorMs) ? Math.abs(record.metrics.timelineErrorMs) : null),
        localUnplayedTail: summarizeMetric(records, record => record.metrics.localUnplayedTailMs),
        triggerToCovered: summarizeMetric(records, record => record.metrics.triggerToCoveredMs),
        nativeSeek: summarizeMetric(records, record => record.metrics.nativeSeekMs),
        restore: summarizeMetric(records, record => record.metrics.restoreMs)
      }
    };
  }

  snapshot() {
    const snapshot = {
      schemaVersion: 3,
      executingBuild: EXECUTING_BUILD,
      dataClassification: "local-explicit-export-no-content-identity",
      serviceId: this.serviceId,
      extensionVersion: this.extensionVersion,
      integrationDepth: 0,
      retention: { maximumRecords: MAX_RECORDS, droppedRecords: this.droppedRecords },
      summary: this.summary(),
      records: structuredClone(this.records)
    };
    return {
      ...snapshot,
      transitionGateEvaluation: evaluateTransitionEvidence(snapshot)
    };
  }
}
