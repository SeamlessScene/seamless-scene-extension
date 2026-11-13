import { EXECUTING_BUILD } from './build-info.mjs';

export class MetricsRecorder {
  constructor({ now = () => performance.now(), wallClock = () => new Date().toISOString() } = {}) {
    this.now = now;
    this.wallClock = wallClock;
    this.events = [];
    this.cycles = [];
    this.activeCycle = null;
    this.cycleSequence = 0;
    this.droppedEvents = 0;
    this.droppedCycles = 0;
  }

  mark(name, detail = {}) {
    const event = { name, atMs: this.now(), detail };
    this.events.push(event);
    if (this.events.length > 2000) { this.events.shift(); this.droppedEvents += 1; }
    return event;
  }

  startCycle(segment, observedTimeMs, cutObservation = null) {
    const entering = segment.entryFraction !== undefined;
    const offsetMs = Number.isFinite(observedTimeMs) && Number.isFinite(segment.triggerMs) ? observedTimeMs - segment.triggerMs : null;
    const triggerObservationMs = cutObservation ? cutObservation.currentTimeMs : observedTimeMs;
    const triggerErrorMs = Number.isFinite(triggerObservationMs) && Number.isFinite(segment.triggerMs) ? triggerObservationMs - segment.triggerMs : null;
    const cycle = {
      id: `${segment.id}-${++this.cycleSequence}`,
      sequence: this.cycleSequence,
      evidenceOrigin: segment.evidenceOrigin === 'automatic-packet' ? 'automatic-packet' : 'unspecified',
      evidenceRunSequence: Number.isSafeInteger(segment.evidenceRunSequence) && segment.evidenceRunSequence > 0 ? segment.evidenceRunSequence : null,
      evidenceActionOrdinal: Number.isSafeInteger(segment.evidenceActionOrdinal) && segment.evidenceActionOrdinal > 0 && segment.evidenceActionOrdinal <= 1000 ? segment.evidenceActionOrdinal : null,
      segmentId: segment.id,
      action: segment.action ?? "REPLACE",
      startedAt: this.wallClock(),
      triggerMs: segment.triggerMs,
      resumeMs: segment.resumeMs,
      expectedDurationMs: Number.isFinite(segment.expectedDurationMs) ? segment.expectedDurationMs : null,
      observedTimeMs,
      // A viewer landing inside a scene deliberately skips its trigger. Keep
      // that displacement out of trigger-accuracy statistics, including zero.
      entryMode: entering ? 'seek-entry' : 'from-start',
      triggerErrorMs: entering ? null : triggerErrorMs,
      triggerErrorBasis: entering ? 'not-applicable' : cutObservation ? 'native-cut-clock' : 'scheduler-observation',
      nativeCutFrameErrorMs: !entering && Number.isFinite(cutObservation?.frameTimeMs) && Number.isFinite(segment.triggerMs)
        ? cutObservation.frameTimeMs - segment.triggerMs : null,
      entryOffsetMs: entering ? offsetMs : null,
      // E58 crossfade diagnostics per hand-over (entry from the cut, exit from restore).
      audioFade: {},
      status: "running",
      timings: {}
    };
    this.cycles.push(cycle);
    if (this.cycles.length > 1000) { this.cycles.shift(); this.droppedCycles += 1; }
    this.activeCycle = cycle;
    this.mark("cycle-started", { cycleId: cycle.id, entryMode: cycle.entryMode,
      triggerErrorMs: cycle.triggerErrorMs, entryOffsetMs: cycle.entryOffsetMs });
    return cycle;
  }

  // 0.65.1: how the cut was made, on the cycle itself (the timing export carries
  // cycles, not the event list): 'staged' (planned cut), 'unstaged' or 'entry' (seek into a scene).
  coverPath(path) {
    if (this.activeCycle && ['staged', 'unstaged', 'entry'].includes(path)) this.activeCycle.coverPath = path;
  }

  // 0.65.3: each internal join of a chain, on the cycle (the timing export carries
  // cycles): the clip's frameHoldMode ('chain-handover'), the renderer's handover report and
  // the advance time.
  chainJoin(value) {
    if (!this.activeCycle || !value || typeof value !== 'object') return;
    (this.activeCycle.chainJoins ??= []).push(structuredClone(value));
    if (this.activeCycle.chainJoins.length > 32) this.activeCycle.chainJoins.shift();
  }

  // 0.65.7: the cycle's stage trace (stage start, warm-up, planned-cut registration, pre-roll
  // request, cut and the clip's first frame callback), merged as its parts arrive.
  stageTrace(value) {
    if (this.activeCycle && value && typeof value === 'object') this.activeCycle.stage = { ...(this.activeCycle.stage ?? {}), ...structuredClone(value) };
  }

  audioFade(side, value) {
    if (this.activeCycle && value && typeof value === 'object') this.activeCycle.audioFade = { ...this.activeCycle.audioFade, [side]: value };
  }

  timing(name, valueMs) {
    if (this.activeCycle) this.activeCycle.timings[name] = Number.isFinite(valueMs) ? valueMs : null;
  }

  finishCycle(status, detail = {}) {
    if (!this.activeCycle) return;
    this.activeCycle.status = status;
    this.activeCycle.finishedAt = this.wallClock();
    this.activeCycle.detail = detail;
    this.mark("cycle-finished", { cycleId: this.activeCycle.id, status, ...detail });
    this.activeCycle = null;
  }

  snapshot() {
    return {
      schemaVersion: 2,
      executingBuild: EXECUTING_BUILD,
      generatedAt: this.wallClock(),
      retention: { maximumEvents: 2000, maximumCycles: 1000, droppedEvents: this.droppedEvents, droppedCycles: this.droppedCycles },
      cycles: structuredClone(this.cycles),
      events: structuredClone(this.events)
    };
  }
}
