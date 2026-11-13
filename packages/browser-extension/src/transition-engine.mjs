import { combinedGain, EXIT_PREROLL_LEAD_MS } from "./audio-crossfade.mjs";
import { supportsAssetDuration, localPlaybackTimeoutMs } from "./asset-duration-policy.mjs";
import { pausableDeadline } from "./pausable-deadline.mjs";
import { assertActive } from "./operation-context.mjs";
import { clearCause } from "./packet-playback-journal.mjs";

export const TransitionState = Object.freeze({
  IDLE: "IDLE",
  ARMED: "ARMED",
  PREFLIGHT: "PREFLIGHT",
  SNAPSHOTTING: "SNAPSHOTTING",
  COVERING: "COVERING",
  PLAYING_LOCAL: "PLAYING_LOCAL",
  RESTORING: "RESTORING",
  COMPLETE: "COMPLETE",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED"
});

function abortError(reason = "Transition cancelled") {
  const error = new Error(reason);
  error.name = "AbortError";
  return error;
}

// How long before a planned cut the renderer is told when it will happen: enough
// for a relay hop plus the clip's start-up latency.
const PREROLL_NOTICE_MS = 400;
// How long into the clip native is seeked to the join (lab/harness: seeking at the
// cut caused a one-frame hitch in the clip's first 150 ms).
const JOIN_SEEK_DELAY_MS = 500;
// E71 (0.64.2): a short clip seeks sooner, so the seek (Prime: up to ~270 ms seen) is done
// before native's exit pre-roll starts EXIT_PREROLL_LEAD_MS before the clip's end:
// min(500, max(150, duration - 105 - 350)). Clips of 955 ms or more keep the full 500 ms.
const JOIN_SEEK_MIN_DELAY_MS = 150;
const JOIN_SEEK_BUDGET_MS = 350;
export function joinSeekDelayMs(durationMs, delayMs = JOIN_SEEK_DELAY_MS) {
  if (!(delayMs > 0) || !Number.isFinite(durationMs)) return delayMs;
  return Math.min(delayMs, Math.max(JOIN_SEEK_MIN_DELAY_MS, durationMs - EXIT_PREROLL_LEAD_MS - JOIN_SEEK_BUDGET_MS));
}

const DEFAULT_TIMEOUTS = Object.freeze({
  prepare: 8_000,
  snapshot: 3_000,
  "read-state": 3_000,
  "overlay-host": 3_000,
  "overlay-mount": 3_000,
  pause: 3_000,
  mute: 3_000,
  "overlay-show": 3_000,
  cover: 3_000,
  seek: 10_000,
  "local-playback": 65_000,
  "prepare-next": 8_000,
  "stage-handover": 3_000,
  cue: 5_000,
  "entry-gate": 8_000,
  advance: 3_000,
  restore: 10_000,
  "overlay-stop": 3_000,
  "overlay-teardown": 3_000,
  "force-overlay-teardown": 3_000,
  "force-native-safe": 3_000
});

const ERROR_CODE_BY_PHASE = Object.freeze({
  prepare: "local-media-failure",
  "entry-gate": "source-check-failed",
  snapshot: "snapshot-failure",
  "read-state": "snapshot-failure",
  "overlay-host": "overlay-failure",
  "overlay-mount": "overlay-failure",
  pause: "native-control-failure",
  mute: "native-control-failure",
  "overlay-show": "overlay-failure",
  cover: "native-control-failure",
  seek: "seek-failure",
  "local-playback": "local-media-failure",
  "prepare-next": "local-media-failure",
  "stage-handover": "overlay-failure",
  cue: "local-media-failure",
  advance: "overlay-failure",
  restore: "restore-failure",
  "overlay-stop": "overlay-failure",
  "overlay-teardown": "overlay-failure",
  "force-overlay-teardown": "overlay-failure",
  "force-native-safe": "restore-failure"
});

class TransitionStepError extends Error {
  constructor(phase, code, { timedOut = false } = {}) {
    super(`${phase}-${code}`);
    this.name = timedOut ? "TransitionTimeoutError" : "TransitionStepError";
    this.phase = phase;
    this.code = code;
  }
}

function stepError(error, phase, timedOut = false) {
  if (error?.name === "AbortError") return error;
  if (error instanceof TransitionStepError) return error;
  // A local clip that ran out of its buffering budget keeps its own code.
  if (phase === "local-playback" && error?.code === "local-stall") return new TransitionStepError(phase, "local-stall");
  return new TransitionStepError(phase, timedOut ? "timeout" : (ERROR_CODE_BY_PHASE[phase] ?? "transition-failure"), { timedOut });
}

function validateSegment(segment) {
  if (!segment?.id) throw new TypeError("Segment id is required");
  const action = segment.action ?? "REPLACE";
  if (!["REPLACE", "INSERT"].includes(action)) throw new TypeError("Transition action must be REPLACE or INSERT");
  if (!Number.isFinite(segment.triggerMs) || segment.triggerMs < 0) {
    throw new TypeError("Segment triggerMs must be a non-negative number");
  }
  const validResume = action === "INSERT"
    ? segment.resumeMs === segment.triggerMs
    : Number.isFinite(segment.resumeMs) && segment.resumeMs > segment.triggerMs;
  if (!validResume) {
    throw new TypeError(action === "INSERT"
      ? "INSERT resumeMs must equal triggerMs"
      : "REPLACE resumeMs must be greater than triggerMs");
  }
  if (!segment.clipUrl) throw new TypeError("Segment clipUrl is required");
  if (segment.expectedDurationMs !== undefined && !supportsAssetDuration(segment.expectedDurationMs, segment.profileClass)) {
    throw new TypeError("Segment duration is outside its playback profile");
  }
  const gainDb = segment.gainDb ?? 0;
  if (!Number.isSafeInteger(gainDb) || gainDb < -24 || gainDb > 6) {
    throw new TypeError("Segment gainDb must be an integer between -24 and 6");
  }
  if (segment.entryFraction !== undefined && (action !== "REPLACE" || !Number.isFinite(segment.entryFraction) || segment.entryFraction <= 0 || segment.entryFraction >= 1)) {
    throw new TypeError("entryFraction applies to REPLACE and must be in (0, 1)");
  }
  if (segment.chain !== undefined) {
    if (!Array.isArray(segment.chain) || segment.chain.length > MAX_CHAIN) throw new TypeError(`Segment chain must hold at most ${MAX_CHAIN} segments`);
    let previous = segment;
    for (const next of segment.chain) {
      validateSegment({ ...next, chain: undefined });
      if (next.triggerMs < previous.resumeMs) throw new TypeError("Chained segments must follow in time");
      previous = next;
    }
  }
}

// 0.65.7 short-gap priming (Settings → Advanced, on by default; off is exactly 0.65.6): a scene
// whose trigger follows the previous scene's join by more than 0 and less than SHORT_GAP_MS of
// native footage. Its clip's standby decoder is warmed while the previous clip plays (after that
// clip's join seek), the previous transition keeps its hidden cover host and hands it to the next
// scene as its staged host, and the planned cut is registered as soon as native is uncovered.
// The gap itself is never bridged or retimed: native plays it, and the cut stays on its frame.
// If the cover still comes late, the clip starts where native is (clip position = native - trigger).
export const SHORT_GAP_MS = 500;
// A late cover moves the clip only when native is at least this far past the trigger (about half a
// frame); nearer, the clip's first frame is native's own frame index.
export const SHORT_GAP_OFFSET_MIN_MS = 15;

// Scenes that follow one another with (almost) no native footage between them
// play inside one cover; this bounds how many a single transition may hold.
const MAX_CHAIN = 32;

export class TransitionEngine extends EventTarget {
  constructor({
    adapter,
    overlay,
    metrics,
    now = () => performance.now(),
    boundaryHysteresisMs = 250,
    operationTimeouts = {},
    joinSeekDelayMs = JOIN_SEEK_DELAY_MS
  }) {
    super();
    this.adapter = adapter;
    this.overlay = overlay;
    this.metrics = metrics;
    this.now = now;
    this.boundaryHysteresisMs = boundaryHysteresisMs;
    this.joinSeekDelayMs = joinSeekDelayMs;
    this.operationTimeouts = Object.freeze({ ...DEFAULT_TIMEOUTS, ...operationTimeouts });
    this.hasPlaybackTimeoutOverride = Object.hasOwn(operationTimeouts, "local-playback");
    this.state = TransitionState.IDLE;
    this.segment = null;
    this.previousTimeMs = null;
    this.triggered = false;
    this.running = null;
    this.abortController = null;
    this.preloadController = null;
    this.preloadTask = null;
    this.preloadClipUrl = null;
    this.staged = null; this.holdPlanned = false;
    this.resumeTargetMs = null;
    // The clip the renderer holds prepared at position 0 after a successful preload.
    this.preparedClipUrl = null;
    // 0.65.7 short-gap priming: off unless the viewer setting turns it on (main.mjs).
    this.shortGapPriming = false; this.standbyPrime = null; this.joinSeekGate = null; this.lastResumeMs = null;
    // 0.65.8: a next clip loaded before the transition it follows had started (see preloadNext).
    this.loadedNext = null;
  }

  // 0.65.9 (developer mode only): an engine mark for the engine event export (EngineEventLog, set by
  // main.mjs). Logging only: a flag check and one ring-buffer write; nothing without the log.
  logEngine(kind, name, detail) {
    const log = this.eventLog;
    if (log?.enabled) { try { log.record(kind, name, detail); } catch {} }
  }

  // Settings → Advanced → Short-gap priming (0.65.7); it applies from the next scene.
  setShortGapPriming(enabled) {
    this.shortGapPriming = enabled === true;
    if (!this.shortGapPriming) this.abandonStandbyPrime("short-gap-priming-off");
  }

  // A scene after a short stretch of native footage since the last completed transition's join.
  shortGapMs(segment) {
    if (!this.shortGapPriming || !Number.isFinite(this.lastResumeMs) || segment?.entryFraction !== undefined) return null;
    const gap = segment.triggerMs - this.lastResumeMs;
    return gap > 0 && gap < SHORT_GAP_MS ? gap : null;
  }

  abandonStandbyPrime(reason) {
    const prime = this.standbyPrime; this.standbyPrime = null;
    prime?.controller.abort(abortError(reason));
  }

  // Warm the standby (already loaded by preloadNext) once the playing clip's join seek is done, so
  // its decode never competes with that clip's first frames or the seek. Best effort.
  primeStandbyFor(segment, gapMs) {
    this.abandonStandbyPrime("standby-prime-replaced");
    const prime = { segment: { ...segment }, clipUrl: segment.clipUrl, gapMs, controller: new AbortController(), status: "waiting",
      requestedAt: this.now(), startedAt: null, completedAt: null, reason: null, startLatencyMs: null };
    this.standbyPrime = prime;
    const current = () => this.standbyPrime === prime && !prime.controller.signal.aborted;
    void (async () => {
      try {
        await this.joinSeekGate?.promise;
        if (!current()) return;
        prime.status = "priming"; prime.startedAt = this.now();
        const result = await this.overlay.primeStandby(prime.controller.signal);
        if (!current()) return;
        prime.completedAt = this.now();
        prime.status = result?.status === "primed" ? "primed" : "skipped";
        prime.reason = result?.reason ?? null;
        prime.startLatencyMs = Number.isFinite(result?.startLatencyMs) ? result.startLatencyMs : null;
      } catch (error) {
        if (!current()) return;
        prime.status = "failed"; prime.completedAt = this.now(); prime.reason = error?.name === "AbortError" ? "aborted" : "failed";
      }
      this.metrics.mark("standby-primed", { segmentId: segment.id, status: prime.status, reason: prime.reason, gapMs,
        startLatencyMs: prime.startLatencyMs, waitMs: prime.startedAt === null ? null : Math.round((prime.startedAt - prime.requestedAt) * 10) / 10,
        primeMs: prime.startedAt === null ? null : Math.round((prime.completedAt - prime.startedAt) * 10) / 10 });
    })();
  }

  // 0.65.8: the next clip was loaded into the standby while no transition was running yet
  // (preloadNext): warm it as preloadNext would have, if it follows the playing scene after a short
  // gap. Not after a chained scene (its members pass through the standby; the scheduler preloads the
  // next clip only once the chain's last member plays, so preloadNext decides then).
  primeNextAfter(playing, next) {
    if (!this.shortGapPriming || playing.chain?.length || next.clipUrl === playing.clipUrl || this.standbyPrime) return;
    const gapMs = next.triggerMs - playing.resumeMs;
    if (gapMs > 0 && gapMs < SHORT_GAP_MS) this.primeStandbyFor(next, gapMs);
  }

  // The primed standby that the transition now ending can hand its cover host to, or null.
  shortGapHandover() {
    const prime = this.standbyPrime;
    if (!this.shortGapPriming || prime?.status !== "primed" || this.staged || typeof this.overlay.promoteStandby !== "function" ||
      typeof this.adapter.stageOverlayHost !== "function" || typeof this.adapter.planCut !== "function") return null;
    const gap = prime.segment.triggerMs - this.resumeTargetMs;
    return gap > 0 && gap < SHORT_GAP_MS ? prime : null;
  }

  setState(state, detail = {}) {
    this.state = state;
    this.metrics.mark("state", { state, ...detail });
    this.dispatchEvent(new CustomEvent("statechange", { detail: { state, ...detail } }));
  }

  arm(segment) {
    validateSegment(segment);
    if (this.running) throw new Error("Cannot arm while a transition is running");
    this.segment = { ...segment };
    this.previousTimeMs = null;
    this.triggered = false;
    this.setState(TransitionState.ARMED, { segmentId: segment.id });
  }

  disarm(reason = "disarmed") {
    if (this.running) throw new Error("Cannot disarm while a transition is running");
    this.segment = null;
    this.previousTimeMs = null;
    this.triggered = false;
    this.setState(TransitionState.IDLE, { reason });
  }

  observe(playbackState) {
    if (!this.segment || this.running) return this.running;
    const currentTimeMs = playbackState.currentTimeMs;

    if (currentTimeMs < this.segment.triggerMs - this.boundaryHysteresisMs) {
      this.triggered = false;
      if ([TransitionState.COMPLETE, TransitionState.CANCELLED, TransitionState.FAILED].includes(this.state)) {
        this.setState(TransitionState.ARMED, { reason: "seek-before-trigger" });
      }
    }

    const crossedBoundary =
      !this.triggered &&
      !playbackState.paused &&
      this.previousTimeMs !== null &&
      this.previousTimeMs < this.segment.triggerMs &&
      currentTimeMs >= this.segment.triggerMs;

    this.previousTimeMs = currentTimeMs;
    if (!crossedBoundary) return null;

    this.triggered = true;
    return this.execute(currentTimeMs);
  }

  execute(observedTimeMs = this.segment?.triggerMs ?? 0) {
    if (!this.segment) throw new Error("No segment is armed");
    if (this.running) return this.running;
    this.lastRecoveryFailures = [];
    this.abortController = new AbortController();
    this.running = this.runTransition(observedTimeMs, this.abortController.signal).finally(() => {
      this.running = null;
      this.abortController = null;
      if (this.overlay && "onLocalEnding" in this.overlay) this.overlay.onLocalEnding = null;
    });
    return this.running;
  }

  preload(segment) {
    validateSegment(segment);
    if (this.running) throw new Error("Cannot preload while a transition is running");
    if (this.preloadTask && this.preloadClipUrl === segment.clipUrl) return this.preloadTask;
    if (this.staged && this.staged.clipUrl !== segment.clipUrl) void this.unstage("preload-replaced");
    else if (!this.staged) this.dropHoldPlan();
    if (this.preloadController) this.preloadController.abort(abortError("preload-replaced"));
    this.preloadController = new AbortController();
    this.preloadClipUrl = segment.clipUrl;
    const controller = this.preloadController;
    this.metrics.mark("preflight-started", { segmentId: segment.id });
    this.preloadTask = this.step(
      "prepare",
      stepSignal => this.overlay.prepare(segment.clipUrl, stepSignal),
      controller.signal
    ).then((result) => {
      this.metrics.mark("preflight-ready", { segmentId: segment.id });
      this.preparedClipUrl = segment.clipUrl;
      return result;
    }).finally(() => {
      if (this.preloadController === controller) {
        this.preloadController = null;
        this.preloadTask = null;
      }
    });
    return this.preloadTask;
  }

  // Load the next clip into the renderer's standby decoder while a transition
  // is playing, so a closely following scene is ready at its own trigger.
  // 0.65.7: with short-gap priming on, a next scene that starts less than SHORT_GAP_MS of native
  // footage after the playing scene's (last chained) join also has its loaded standby warmed.
  preloadNext(segment) {
    validateSegment(segment);
    if (typeof this.overlay.prepareNext !== "function") return Promise.resolve(false);
    if (this.nextPreload?.clipUrl === segment.clipUrl) return this.nextPreload.task;
    const playing = this.running && this.segment ? (this.segment.chain?.at(-1) ?? this.segment) : null;
    const gapMs = playing ? segment.triggerMs - playing.resumeMs : null;
    const prime = this.shortGapPriming && typeof this.overlay.primeStandby === "function" && Number.isFinite(gapMs) && gapMs > 0 && gapMs < SHORT_GAP_MS;
    // 0.65.8: the scheduler asks for the next clip as soon as a scene starts, and with a catalog edit
    // that scene's transition only starts after its source check and catalog round trip, so often no
    // transition is running yet and the gap is unknown. The loaded clip is then remembered, and the
    // transition decides when it starts (primeNextAfter), or now if it started meanwhile.
    const decideLater = !playing && this.shortGapPriming && typeof this.overlay.primeStandby === "function";
    this.loadedNext = null;
    this.nextPreload?.controller.abort(abortError("next-preload-replaced"));
    const controller = new AbortController();
    const entry = { clipUrl: segment.clipUrl, controller, task: null };
    this.nextPreload = entry;
    entry.task = this.step("prepare-next", stepSignal => this.overlay.prepareNext(segment.clipUrl, stepSignal), controller.signal)
      .then(() => {
        if (prime && this.nextPreload === entry && this.shortGapPriming) this.primeStandbyFor(segment, gapMs);
        else if (decideLater && this.nextPreload === entry && this.shortGapPriming) {
          if (this.running && this.segment) this.primeNextAfter(this.segment, segment);
          else this.loadedNext = { ...segment };
        }
        return true;
      })
      .finally(() => { if (this.nextPreload === entry) this.nextPreload = null; });
    return entry.task;
  }

  // Stage a prepared clip shortly before its trigger: mount the (hidden) cover
  // host, move the renderer into it, set audio and show the first local frame.
  // Native playback is untouched. At the trigger the transition then only has to
  // snapshot, pause, mute and reveal, with no renderer round trips before the cut.
  stage(segment) {
    validateSegment(segment);
    if (this.running) throw new Error("Cannot stage while a transition is running");
    if (typeof this.adapter.stageOverlayHost !== "function" || typeof this.overlay.unmount !== "function") return Promise.resolve(false);
    if (this.staged?.clipUrl === segment.clipUrl) {
      // 0.65.7: a short-gap hand-over staged this clip while the previous transition was ending. Its
      // planned cut is registered at the hand-over (0.65.8); only if that failed is it registered
      // here, when the scheduler asks to stage.
      const handedOver = this.staged;
      if (handedOver.complete && handedOver.planPending) { handedOver.planPending = false; this.planCut(handedOver, segment); }
      return handedOver.task;
    }
    const previous = this.staged ? this.unstage("stage-replaced") : Promise.resolve();
    const controller = new AbortController();
    // 0.65.7: stage-start and warm-up times for the cycle's stage trace (diagnostics only).
    const staged = { clipUrl: segment.clipUrl, controller, complete: false, task: null, trace: { via: "stage", stageStartAt: this.now() } };
    const standbyPrime = this.standbyPrime?.clipUrl === segment.clipUrl && this.standbyPrime.status === "primed" ? this.standbyPrime : null;
    if (standbyPrime) staged.trace.standbyPrimedAt = standbyPrime.completedAt;
    this.staged = staged;
    const stopPresentationErrors = this.adapter.subscribePresentationErrors?.(() => {
      if (this.staged === staged && !this.running) void this.unstage("stage-presentation-failed");
    });
    staged.task = previous.then(async () => {
      // 0.66.2: from here until the stage completes (when the planned cut replaces it), and after
      // a failed stage, native is watched to stop on the last frame before the trigger.
      this.planHold(staged, segment);
      // Makes the clip current (instant when it is already current or waiting
      // in the standby decoder) before the renderer is moved into the host.
      await this.step("prepare", stepSignal => this.overlay.prepare(segment.clipUrl, stepSignal), controller.signal);
      // A hold-only cut that fired during prepare has already stopped native: staging the host keeps
      // it (released there, native ran on uncovered until the transition's own pause).
      const host = await this.step("overlay-host", stepSignal => this.adapter.stageOverlayHost(stepSignal,
        this.adapter.cutHoldOnly?.(segment.triggerMs) === true ? { keepCutHold: true } : undefined), controller.signal);
      // Staging the host cancelled the watch; register it again, unless the hold is already in force.
      if (this.adapter.cutHoldOnly?.(segment.triggerMs) !== true) this.planHold(staged, segment);
      await this.step("overlay-mount", async stepSignal => {
        await this.overlay.mount(host, stepSignal);
        assertActive(stepSignal);
        const state = await this.adapter.readState?.();
        await this.overlay.configureAudio(state ?? {}, segment.gainDb ?? 0, stepSignal);
      }, controller.signal);
      await this.step("overlay-show", stepSignal => this.overlay.show(stepSignal), controller.signal);
      // Decoder warm-up is best effort; a failure leaves the staged first frame.
      await this.overlay.primeForPlayback?.(controller.signal)?.catch?.(() => {});
      assertActive(controller.signal);
      staged.trace.warmupCompleteAt = this.now();
      staged.complete = true;
      this.metrics.mark("staged", { segmentId: segment.id });
      // A hold-only cut that already stopped native during staging is kept: the transition it woke
      // adopts this stage and covers. Otherwise the planned cut replaces the hold-only watch.
      if (this.adapter.cutHoldOnly?.(segment.triggerMs) !== true) { this.holdPlanned = false; this.planCut(staged, segment); }
      return true;
    }).catch(async error => {
      // 0.66.2: a stage that failed by itself (not one replaced or cancelled by a seek, another
      // clip, a presentation failure or the transition) leaves the scene to the unstaged path.
      // Keep watching native so it still stops on the last frame before the trigger instead of
      // running on visibly.
      if (this.staged === staged) {
        await this.unstage("stage-failed", { awaitTask: false });
        if (!this.staged && !this.running) this.planHold(null, segment);
      }
      throw error;
    }).finally(() => stopPresentationErrors?.());
    return staged.task;
  }

  // 0.66.2: hold-only planned cut (adapter.planHold) for a scene that is not staged yet. `staged`
  // is the stage in progress, or null after it failed. No pre-roll, no reveal: the cut only stops
  // native on the frame before the trigger and wakes the scheduler, and runTransition takes the
  // hold over on its unstaged path. A viewer pause or seek abandons the watch.
  planHold(staged, segment) {
    if (typeof this.adapter.planHold !== "function" || this.running) return false;
    if (staged ? this.staged !== staged : this.staged) return false;
    // onHoldReleased: a hold nothing adopted (its 2 s expiry, or an ordinary unstage) leaves no watch.
    this.holdPlanned = this.adapter.planHold(segment.triggerMs, { onAbort: () => { this.holdPlanned = false; }, onHoldReleased: () => { this.holdPlanned = false; } }) === true;
    return this.holdPlanned;
  }
  // A hold-only watch left by a failed stage belongs to no stage object; drop it explicitly.
  dropHoldPlan() {
    if (!this.holdPlanned) return;
    this.holdPlanned = false;
    if (!this.staged) this.adapter.cancelPlannedCut?.();
  }

  // Let the adapter cut at the exact frame, and have the renderer start the clip
  // early by its start-up latency so it is already moving when the cover appears.
  // 0.65.8 (handover): registered by a short-gap hand-over, before this transition has completed
  // and while the scheduler may still be busy; the cut's wake-up is then re-delivered until taken.
  planCut(staged, segment, { handover = false } = {}) {
    if (typeof this.adapter.planCut !== "function") return false;
    let prerolled = false;
    // 0.65.7: only a scene after a short gap (short-gap priming on) defers a late cut's reveal.
    const deferLateReveal = (segment.action ?? "REPLACE") === "REPLACE" && (handover || this.shortGapMs(segment) !== null);
    const registered = this.adapter.planCut(segment.triggerMs, {
      ...(deferLateReveal ? { deferLateReveal: true } : {}),
      ...(handover ? { redeliverWake: true } : {}),
      // audioEndAtMs: when native stops (the last frame before the trigger); the
      // clip's fade-in ends there, together with native's fade-out (E58).
      onPredict: (epochMs, audioEndAtMs, { hard = false } = {}) => {
        if (prerolled || this.staged !== staged || this.running) return;
        if (epochMs - (performance.timeOrigin + performance.now()) > PREROLL_NOTICE_MS) return;
        prerolled = true;
        if (staged.trace) staged.trace.prerollRequestAt = this.now();
        this.metrics.mark("preroll-requested", { segmentId: segment.id });
        // Smooth audio on: exactly as before. Off (hard): the clip steps to full at the cut.
        void Promise.resolve(this.overlay.prerollAt?.(epochMs, undefined, Number.isFinite(audioEndAtMs) ? { audioEndAtMs, ...(hard ? { fadeMs: 0 } : {}) } : {})).catch(() => {});
      },
      onAbort: () => { if (this.staged === staged && !this.running) void this.unstage("native-left-before-cut"); },
      // 0.65.11: a cut hold released without this transition taking it over (the source check
      // failed, or never finished within the hold) stops a clip pre-rolled for it.
      onHoldReleased: () => { if (prerolled && this.staged === staged && !this.running) void this.unstage("cut-hold-released"); }
    });
    if (registered && staged.trace) staged.trace.planCutAt = this.now();
    if (this.eventLog?.enabled) this.logEngine('engine', 'planned-cut-registered', { segmentId: segment.id, triggerMs: segment.triggerMs, registered: registered === true, handover, deferLateReveal });
    return registered === true;
  }

  async unstage(reason = "unstaged", { awaitTask = true, keepCutHold = false } = {}) {
    const staged = this.staged;
    if (!staged) { this.dropHoldPlan(); return; }
    this.staged = null; this.holdPlanned = false;
    staged.controller.abort(abortError(reason));
    if (awaitTask) await staged.task?.catch(() => {});
    // Hand the renderer back before its host is removed; the decoder stays prepared.
    await this.step("overlay-stop", stepSignal => this.overlay.unmount(stepSignal), null, { ignoreAbort: true }).catch(() => {});
    if (keepCutHold) this.adapter.unstageOverlayHost?.({ keepCutHold: true }); else this.adapter.unstageOverlayHost?.();
  }

  async cancelPreload(reason = "preload-cancelled") {
    this.preparedClipUrl = null;
    this.lastResumeMs = null; this.abandonStandbyPrime(reason); this.loadedNext = null;
    this.nextPreload?.controller.abort(abortError(reason));
    this.nextPreload = null;
    await this.unstage(reason);
    const task = this.preloadTask;
    this.preloadController?.abort(abortError(reason));
    await task?.catch(() => {});
    if (!this.running) await this.overlay.teardown().catch(() => {});
  }

  // 0.65.7: the controller cleared its edit (clear(reason)); recorded for the developer events and
  // the scene timing report. Log only: nothing else changes.
  noteCleared(reason) {
    const cause = clearCause(reason);
    this.metrics.mark("session-cleared", { reason: cause });
    this.dispatchEvent(new CustomEvent("session-cleared", { detail: { reason: cause } }));
  }

  cancel(reason = "user-cancelled") {
    this.lastResumeMs = null;
    if (!this.abortController) return false;
    this.preserveNativeTime = /seek|source|navigation|page|player|disposed/.test(reason);
    this.abortController.abort(abortError(reason));
    return true;
  }

  // Viewer keys while a replacement plays: pause/resume, seek within the clip,
  // mute. Only the playing clip is affected; native stays paused and covered.
  get localControllable() {
    return this.state === TransitionState.PLAYING_LOCAL && this.localDeadline !== null && this.localDeadline !== undefined
      && typeof this.overlay.localPause === "function";
  }
  async toggleLocalPause() {
    if (!this.localControllable) return null;
    const deadline = this.localDeadline;
    if (this.localPaused) {
      this.localPaused = false; deadline.resume();
      await this.overlay.localResume();
      this.metrics.mark("local-resumed"); return "resumed";
    }
    this.localPaused = true; deadline.pause();
    try { await this.overlay.localPause(); }
    catch (error) { if (this.localDeadline === deadline) { this.localPaused = false; deadline.resume(); } throw error; }
    this.metrics.mark("local-paused"); return "paused";
  }
  async seekLocal(deltaMs) {
    if (!this.localControllable) return false;
    if (deltaMs < 0) this.localDeadline.extend(-deltaMs);
    await this.overlay.localSeek(deltaMs);
    this.metrics.mark("local-seek", { deltaMs }); return true;
  }
  async setLocalMuted(muted) {
    if (!this.localControllable) return false;
    await this.overlay.localMute(muted); this.localMuted = muted === true; return true;
  }
  toggleLocalMute() { return this.setLocalMuted(!this.localMuted); }

  async step(phase, operation, signal, { ignoreAbort = false, playbackSegment = this.segment } = {}) {
    const timeoutMs = phase === "local-playback" && !this.hasPlaybackTimeoutOverride
      ? localPlaybackTimeoutMs(playbackSegment?.expectedDurationMs, playbackSegment?.profileClass)
      : this.operationTimeouts[phase];
    let timeout = null, deadline = null;
    let onAbort = null;
    const controller = new AbortController();
    const timeoutPromise = new Promise((_, reject) => {
      const expire = () => {
        const error = stepError(null, phase, true);
        controller.abort(error);
        reject(error);
      };
      // The local clip's watchdog is held while the viewer pauses it.
      if (phase === "local-playback") { deadline = pausableDeadline(timeoutMs, expire, { now: () => this.now() }); this.localDeadline = deadline; this.localPaused = false; }
      else timeout = setTimeout(expire, timeoutMs);
    });
    const abortPromise = new Promise((_, reject) => {
      if (ignoreAbort || !signal) return;
      onAbort = () => { controller.abort(signal.reason ?? abortError()); reject(controller.signal.reason); };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    const stepStartedAt = this.now();
    try {
      return await Promise.race([
        Promise.resolve().then(() => { assertActive(controller.signal); return operation(controller.signal); }).catch((error) => { throw stepError(error, phase); }),
        timeoutPromise,
        abortPromise
      ]);
    } finally {
      clearTimeout(timeout); deadline?.clear();
      if (deadline && this.localDeadline === deadline) { this.localDeadline = null; this.localPaused = false; }
      if (onAbort) signal.removeEventListener("abort", onAbort);
      // Per-step durations of the active cycle, for diagnosing where a cut spends its time.
      if (phase !== "local-playback") this.metrics.timing(`step.${phase}Ms`, this.now() - stepStartedAt);
    }
  }

  // Where in a replaced interval native actually stopped, as a fraction of the interval
  // (the scheduler's estimate is used if the position cannot be read).
  async entryFractionAtPause(segment, signal) {
    try {
      const pausedAt = (await this.step("read-state",
        stepSignal => this.adapter.readState?.({ signal: stepSignal }), signal))?.currentTimeMs;
      assertActive(signal);
      if (Number.isFinite(pausedAt)) {
        const fraction = (pausedAt - segment.triggerMs) / (segment.resumeMs - segment.triggerMs);
        if (fraction > 0) return Math.min(fraction, 0.99);
      }
    } catch { assertActive(signal); }
    return segment.entryFraction;
  }

  // INSERT returns to where native actually paused. Seeking back to the trigger
  // would replay the few frames that played before the cut.
  async insertResumeTargetMs(segment, signal) {
    try {
      const pausedAt = (await this.step("read-state",
        stepSignal => this.adapter.readState?.({ signal: stepSignal }), signal))?.currentTimeMs;
      assertActive(signal);
      if (Number.isFinite(pausedAt) && pausedAt >= segment.triggerMs && pausedAt - segment.triggerMs <= 2_000) return pausedAt;
    } catch { assertActive(signal); }
    return segment.resumeMs;
  }

  // Where native playback resumes after a failed or cancelled transition.
  // Before the cover nothing was replaced, so return to where it paused. Once the
  // cover is up the viewer has left the original footage; resuming at the trigger
  // would replay exactly the interval the edit removes, so resume at the join.
  // A viewer's own seek, navigation or explicit stop keeps its own position.
  recoveryTargetMs(snapshot, segment, coveredAt, signal) {
    if (this.preserveNativeTime) return undefined;
    const reason = signal.reason?.message ?? '';
    if (coveredAt !== null && !/(^|-)user-/.test(reason)) return this.resumeTargetMs ?? segment.resumeMs;
    return snapshot?.currentTimeMs;
  }

  async recover(snapshot, signal, { targetTimeMs, resumePlayback, parkedJoin = null }) {
    const recoveryFailures = [];
    await this.step("overlay-stop", stepSignal => this.overlay.stop(stepSignal), signal, { ignoreAbort: true })
      .catch((error) => recoveryFailures.push(error));
    if (snapshot) {
      await this.step(
        "restore",
        stepSignal => this.adapter.restore(snapshot, { targetTimeMs, resumePlayback, signal: stepSignal, ...(parkedJoin ? { parkedJoin } : {}) }),
        signal,
        { ignoreAbort: true }
      ).then((receipt) => {
        if (Number.isFinite(receipt?.errorMs)) this.metrics.timing("nativeRecoveryErrorMs", receipt.errorMs);
      }).catch((error) => recoveryFailures.push(error));
    }
    await this.step("overlay-teardown", stepSignal => this.overlay.teardown(stepSignal), signal, { ignoreAbort: true })
      .catch((error) => recoveryFailures.push(error));
    await this.step("force-overlay-teardown", stepSignal => this.overlay.forceTeardown?.(stepSignal), signal, { ignoreAbort: true })
      .catch((error) => recoveryFailures.push(error));
    if (snapshot && this.adapter.forceSafeNativeState) {
      await this.step("force-native-safe", stepSignal => this.adapter.forceSafeNativeState(snapshot, stepSignal), signal, { ignoreAbort: true })
        .catch((error) => recoveryFailures.push(error));
    }
    for (const failure of recoveryFailures) {
      this.metrics.mark("recovery-step-failed", { phase: failure.phase, errorCode: failure.code });
    }
    this.lastRecoveryFailures = recoveryFailures;
    return recoveryFailures;
  }

  async runTransition(observedTimeMs, signal) {
    this.preserveNativeTime = false;
    const segment = this.segment;
    const startedAt = this.now();
    const cycle = this.metrics.startCycle(segment, observedTimeMs, this.adapter.cutObservation?.(segment.triggerMs) ?? null);
    // When the cover with the clip became visible, for the cut that woke this transition
    // (read before the hold is adopted); otherwise from the cover/show steps below.
    let clipShownAt = this.adapter.cutCoveredAt?.(segment.triggerMs) ?? null, coverShownAt = clipShownAt;
    // E58 entry crossfade as it ran at the cut (read before the hold is adopted).
    const entryFade = this.adapter.cutAudioFade?.(segment.triggerMs);
    // 0.62.18: the cover's and native's layer state and rectangles at the cut (first clip frame).
    const entryLayout = this.adapter.cutLayout?.(segment.triggerMs);
    if (entryLayout) this.metrics.audioFade?.("entryLayout", entryLayout);
    if (entryFade) this.metrics.audioFade?.("entry", entryFade);
    // Exit crossfade: the native handle the join seek used, and the clip's reply.
    let exitHandleMs = 0, exitParkedMs = 0, exitClipFade = null, exitClipEnd = null, exitClipDiag = null;
    // 0.66.2: set from the moment a parked join seek is asked for (it may be cut short), for recovery.
    let parkedJoin = null;
    let snapshot = null;
    let coveredAt = null;
    // Shared integration: fixture/native consumers must recover just as Prime
    // does, even when the UI did not supply its own presentation callback.
    const stopPresentationErrors = this.adapter.subscribePresentationErrors?.(() => {
      this.abortController?.abort(new TransitionStepError("presentation", "overlay-failure"));
    });

    this.resumeTargetMs = segment.resumeMs;
    // 0.65.7 short-gap priming: diagnostics read before the stage and the cut hold are consumed,
    // and the gate that holds the next clip's standby warm-up until this clip's join seek is done.
    const stageTrace = this.staged?.clipUrl === segment.clipUrl && this.staged.trace ? { ...this.staged.trace, complete: this.staged.complete === true } : null;
    const cutRevealDeferred = this.adapter.cutRevealDeferred?.(segment.triggerMs) === true;
    const cutFrameCallback = this.adapter.cutFrameCallback?.(segment.triggerMs) ?? null;
    const shortGapMs = this.shortGapMs(segment);
    let startOffsetMs = null, nativeOffsetMs = null;
    this.cycleCutAt = null;
    if (this.standbyPrime?.clipUrl === segment.clipUrl) this.standbyPrime = null; // consumed by this scene
    const joinSeekGate = {}; joinSeekGate.promise = new Promise(resolve => { joinSeekGate.resolve = resolve; });
    this.joinSeekGate = joinSeekGate;
    { const loaded = this.loadedNext; this.loadedNext = null; if (loaded) this.primeNextAfter(segment, loaded); }
    // A completed stage for this clip is adopted; anything else is discarded so
    // the full path below starts from a clean, unstaged renderer.
    const staged = this.staged?.clipUrl === segment.clipUrl && this.staged.complete && segment.entryFraction === undefined ? this.staged : null;
    if (staged) { this.staged = null; this.holdPlanned = false; this.adapter.cancelPlannedCut?.(); }
    // 0.66.2: a hold-only cut that stopped native for this trigger survives the discarded stage.
    else if (this.staged) await this.unstage("stage-not-ready", { keepCutHold: this.adapter.cutHoldOnly?.(segment.triggerMs) === true });
    else this.dropHoldPlan();

    const entering = segment.entryFraction !== undefined;
    // An entry's clip was preloaded (the scheduler waits for it) and sits at 0: skip the
    // extra prepare round trip and its rewind, so the entry costs a single local seek.
    const prepared = staged || (entering && this.preparedClipUrl === segment.clipUrl);
    this.preparedClipUrl = null;
    let pausedEarly = false, entryHost = null, coveredEarly = false;

    try {
      this.setState(TransitionState.PREFLIGHT);
      if (!prepared && !entering) await this.step("prepare", stepSignal => this.overlay.prepare(segment.clipUrl, stepSignal), signal);
      if (entering) {
        // A viewer seeked into a replaced interval. Hold native and cover it (the
        // host is black) before anything else, so the removed footage is never on
        // screen while the clip loads; then enter the clip near that point.
        this.setState(TransitionState.SNAPSHOTTING);
        snapshot = await this.step("snapshot", stepSignal => this.adapter.snapshot(stepSignal), signal);
        await this.step("pause", stepSignal => this.adapter.pause(stepSignal), signal);
        pausedEarly = true;
        entryHost = await this.step("overlay-host", stepSignal => this.adapter.mountOverlayHost(stepSignal), signal);
        await this.step("cover", () => this.adapter.setNativeCovered(true), signal);
        coveredEarly = true;
        coveredAt = this.now();
        this.metrics.timing("triggerToCoveredMs", coveredAt - startedAt);
        if (!prepared) await this.step("prepare", stepSignal => this.overlay.prepare(segment.clipUrl, stepSignal), signal);
        const entryFraction = await this.entryFractionAtPause(segment, signal);
        // The in-clip seek lands on a keyframe; mount the (still hidden) clip meanwhile.
        const cued = this.step("cue", stepSignal => this.overlay.cue(entryFraction, stepSignal), signal);
        cued.catch(() => {});
        await this.step("overlay-mount", async stepSignal => {
          await this.overlay.mount(entryHost, stepSignal);
          assertActive(stepSignal);
          await this.overlay.configureAudio(snapshot, segment.gainDb ?? 0, stepSignal);
        }, signal);
        const position = await cued;
        this.metrics.mark("entered-mid-scene", { segmentId: segment.id, entryFraction, positionMs: position?.positionMs ?? null });
        // Source and activity checks ran alongside the hold and load; nothing from
        // the edit is shown before they pass.
        if (segment.entryGate) await this.step("entry-gate", () => segment.entryGate, signal);
      }
      if (signal.aborted) throw signal.reason;

      this.setState(TransitionState.SNAPSHOTTING);
      if (!snapshot) snapshot = await this.step("snapshot", stepSignal => this.adapter.snapshot(stepSignal), signal);
      const overlayHost = entryHost ?? await this.step("overlay-host", stepSignal => this.adapter.mountOverlayHost(stepSignal), signal);
      if (!staged && !entryHost) {
        await this.step("overlay-mount", async stepSignal => {
          await this.overlay.mount(overlayHost, stepSignal);
          assertActive(stepSignal);
          await this.overlay.configureAudio(snapshot, segment.gainDb ?? 0, stepSignal);
        }, signal);
      }

      this.setState(TransitionState.COVERING);
      if (!pausedEarly) await this.step("pause", stepSignal => this.adapter.pause(stepSignal), signal);
      await this.step("mute", stepSignal => this.adapter.setMuted(true, stepSignal), signal);
      if (segment.action === "INSERT") this.resumeTargetMs = await this.insertResumeTargetMs(segment, signal);
      // 0.65.7 short-gap fallback: no planned cut revealed the clip in time, so native ran past the
      // trigger. Start the clip where native stopped (clip position = native - trigger) before it is
      // shown, never back at its first frame. Best effort: on any failure the clip starts as before.
      if (shortGapMs !== null && (segment.action ?? "REPLACE") === "REPLACE" && !(clipShownAt !== null && !cutRevealDeferred) && typeof this.overlay.cueAt === "function") {
        try {
          const pausedAt = (await this.step("read-state", stepSignal => this.adapter.readState?.({ signal: stepSignal }), signal))?.currentTimeMs;
          assertActive(signal);
          if (Number.isFinite(pausedAt)) {
            nativeOffsetMs = Math.round((pausedAt - segment.triggerMs) * 10) / 10;
            if (nativeOffsetMs >= SHORT_GAP_OFFSET_MIN_MS && nativeOffsetMs < segment.resumeMs - segment.triggerMs) {
              const cued = await this.step("cue", stepSignal => this.overlay.cueAt(nativeOffsetMs, stepSignal), signal);
              startOffsetMs = Number.isFinite(cued?.positionMs) ? cued.positionMs : Math.round(nativeOffsetMs);
            }
          }
        } catch (error) { assertActive(signal); if (error?.name === "AbortError") throw error; }
      }
      if (!staged) { await this.step("overlay-show", stepSignal => this.overlay.show(stepSignal), signal); clipShownAt ??= performance.now(); }
      if (!coveredEarly) {
        await this.step("cover", () => this.adapter.setNativeCovered(true), signal);
        coveredAt = this.now();
        this.metrics.timing("triggerToCoveredMs", coveredAt - startedAt);
      }
      this.metrics.timing("triggerToShownMs", this.now() - startedAt);
      this.metrics.mark("cover-path", { staged: Boolean(staged), entry: entering });
      this.metrics.coverPath?.(entering ? "entry" : staged ? "staged" : "unstaged");
      // 0.65.7: stage-start, warm-up, planned-cut registration, pre-roll request and cut times for
      // this cycle (ms relative to the cut: the cut's native frame callback, else the cover).
      if (!entering) {
        const cutAt = Number.isFinite(cutFrameCallback?.invokedAt) ? cutFrameCallback.invokedAt : Number.isFinite(clipShownAt) ? clipShownAt : coveredAt;
        const rel = value => Number.isFinite(value) && Number.isFinite(cutAt) ? Math.round((value - cutAt) * 10) / 10 : null;
        const trace = {
          via: stageTrace?.via ?? "unstaged", complete: Boolean(staged), ...(shortGapMs !== null ? { shortGapMs } : {}),
          stageStartMs: rel(stageTrace?.stageStartAt), warmupCompleteMs: rel(stageTrace?.warmupCompleteAt),
          planCutRegisteredMs: rel(stageTrace?.planCutAt), prerollRequestMs: rel(stageTrace?.prerollRequestAt),
          ...(Number.isFinite(stageTrace?.standbyPrimedAt) ? { standbyPrimedMs: rel(stageTrace.standbyPrimedAt) } : {}),
          cut: { via: cutFrameCallback ? "planned" : "scheduler", revealDeferred: cutRevealDeferred,
            callbackMs: rel(cutFrameCallback?.invokedAt), displayMs: rel(cutFrameCallback?.shownAt), coverMs: rel(Number.isFinite(clipShownAt) ? clipShownAt : coveredAt) },
          ...(nativeOffsetMs !== null ? { nativeOffsetMs } : {}), ...(startOffsetMs !== null ? { startOffsetMs } : {})
        };
        this.metrics.stageTrace?.(trace);
        this.metrics.mark("stage-trace", { segmentId: segment.id, ...trace });
        this.cycleCutAt = cutAt;
      }
      // The staged audio level was read shortly before the trigger; follow any
      // change the viewer made since, without holding up the cut.
      if (staged) void this.overlay.configureAudio(snapshot, segment.gainDb ?? 0, signal)?.catch?.(() => {});

      this.setState(TransitionState.PLAYING_LOCAL);
      this.localMuted = snapshot.muted === true;
      const chain = segment.chain ?? [];
      const chained = [];
      let current = segment;
      for (let index = 0; ; index += 1) {
        const next = chain[index];
        // Load the next adjacent clip while this one plays; a failure only ends the chain.
        const nextReady = next
          ? this.step("prepare-next", stepSignal => this.overlay.prepareNext(next.clipUrl, stepSignal), signal).then(() => true, () => false)
          : null;
        // The last clip of a cover hands its end time to the adapter, which starts
        // native early under the cover and uncovers on native's first frame at the join.
        // E58: once native is set to fade in across the join, the clip is asked to
        // fade its end out over the same window (a chained clip never is).
        if ("onLocalEnding" in this.overlay) this.overlay.onLocalEnding = next ? null : endAtMs => {
          try {
            if (endAtMs === null) {
              this.adapter.prerollNative?.(null);
              if (typeof this.overlay.localFadeOut === "function") void Promise.resolve(this.overlay.localFadeOut(false)).catch(() => {});
              return;
            }
            // 0.62.12: the clip's 40 ms end fade is never shortened; native's start is
            // the same as with the setting off.
            this.adapter.prerollNative?.(endAtMs, { joinMs: this.resumeTargetMs, handleMs: exitHandleMs, ...(exitParkedMs > 0 ? { parkMs: exitParkedMs } : {}) });
            if (this.adapter.exitFadeArmed?.() && typeof this.overlay.localFadeOut === "function") {
              void Promise.resolve(this.overlay.localFadeOut(true)).then(report => { if (report) exitClipFade = report; }, () => {});
            } else if (this.adapter.exitCutArmed?.() && typeof this.overlay.localFadeOut === "function") {
              // Smooth audio off: a hard cut of the clip's audio just before its dropped tail.
              void Promise.resolve(this.overlay.localFadeOut(true, undefined, "cut")).then(report => { if (report) exitClipFade = { ...report, mode: "cut" }; }, () => {});
            }
          } catch {}
        };
        const localPlayback = this.step("local-playback", stepSignal => this.overlay.play(stepSignal, { profileClass: current.profileClass, ...(next ? { chainNext: true } : {}) }), signal, { playbackSegment: current })
          .then(
            (value) => ({ ok: true, value }),
            (error) => ({ ok: false, error })
          );
        // Seek native to the join once the clip is under way, not at the cut: the
        // seek's decode work competed with the clip's first frames (a visible hitch).
        const seekDelayMs = joinSeekDelayMs(current.expectedDurationMs, this.joinSeekDelayMs);
        if (seekDelayMs > 0) {
          let timer = null;
          await Promise.race([new Promise(resolve => { timer = setTimeout(resolve, seekDelayMs); }), localPlayback]);
          clearTimeout(timer);
          if (signal.aborted) throw signal.reason;
        }
        const seekStartedAt = this.now();
        // E58: with the crossfade on, native waits crossfadeMs before the join, so
        // its pre-roll can fade in on its own audio just before the join (still
        // covered); the pre-roll uncovers on the first frame at or after the join.
        const handleMs = next ? 0 : Math.max(0, Math.min(this.adapter.exitHandleMs?.() ?? 0, this.resumeTargetMs));
        // 0.66.2 (exit jump): native also waits before the join by the media its clock covers
        // between its early start and the clip's end (adapter.exitParkMs), so the join frame is
        // the one presented at the clip's end. Not with a handle, nor before a chained clip.
        const parkMs = next || handleMs > 0 ? 0 : Math.max(0, Math.min(this.adapter.exitParkMs?.() ?? 0, this.resumeTargetMs));
        // The pre-roll may be planned while this seek is still running (a short clip's ending
        // notice): it must already know native is being parked. The park does not move the start
        // time, and the pre-roll never starts a seeking native. A handle does move the start time
        // and is still only passed once the seek has completed.
        exitHandleMs = 0; exitParkedMs = parkMs;
        const seekTargetMs = this.resumeTargetMs - handleMs - parkMs;
        parkedJoin = parkMs > 0 ? { joinMs: this.resumeTargetMs, parkMs } : null;
        const seekResult = await this.step("seek", stepSignal => this.adapter.seek(seekTargetMs, stepSignal), signal);
        exitHandleMs = handleMs;
        // 0.62.14: native now sits paused at the join; start its audio output here, seconds
        // before the clip ends (unmuted, at volume 0 with Smooth audio on, else at the
        // viewer's level). Only for the clip that hands back to native.
        if (!next) { try { this.adapter.warmNativeOutput?.("paused-at-join"); } catch {} }
        // 0.65.7: the next scene's standby may now be warmed (short-gap priming).
        if (!next) joinSeekGate.resolve();
        // Command adapters may clamp their target (for example near media end).
        // Playback evidence must still measure against the segment's resume time
        // (less the deliberate audio handle).
        const seekObservedMs = Number.isFinite(seekResult?.after?.currentTimeMs) ? seekResult.after.currentTimeMs : null;
        this.metrics.timing("nativeSeekErrorMs", seekObservedMs === null ? null : seekObservedMs - seekTargetMs);
        this.metrics.mark("native-seek", {
          errorBasis: "requested-resume-target",
          ...(handleMs > 0 ? { audioHandleMs: handleMs } : {}),
          ...(parkMs > 0 ? { parkMs } : {}),
          requestedTargetMs: this.resumeTargetMs,
          commandTargetMs: Number.isFinite(seekResult?.targetMs) ? seekResult.targetMs : null,
          observedTimeMs: seekObservedMs
        });
        this.metrics.timing("nativeSeekMs", this.now() - seekStartedAt);
        const localPlaybackOutcome = await localPlayback;
        if ("onLocalEnding" in this.overlay) this.overlay.onLocalEnding = null;
        if (!localPlaybackOutcome.ok) throw localPlaybackOutcome.error;
        const localEnd = localPlaybackOutcome.value;
        if (Number.isFinite(localEnd?.unplayedTailMs)) this.metrics.timing('localUnplayedTailMs', localEnd.unplayedTailMs);
        if (Number.isFinite(localEnd?.stalledMs)) this.metrics.timing('localStalledMs', localEnd.stalledMs);
        this.metrics.mark('local-end', localEnd ?? { measured: false });
        // 0.62.10: how the clip's end fade met the clip's actual end (exit diagnostics).
        if (localEnd?.endFade && !next) exitClipEnd = localEnd.endFade;
        // E72 (0.64.3): the renderer's end-of-clip diagnostics, with the exit report.
        if (localEnd?.exitDiag && !next) exitClipDiag = localEnd.exitDiag;
        // 0.65.9 (developer mode, scene timing on): the clip's 'playing' event and first frame
        // callback (callback time and expectedDisplayTime) on this page's clock, for the export.
        if (localEnd?.firstFrame && this.eventLog?.enabled) {
          const onPage = epoch => { if (!Number.isFinite(epoch)) return null; const local = this.overlay.clockDomain?.toLocal?.(epoch) ?? epoch; return Number.isFinite(local) ? local - performance.timeOrigin : null; };
          const first = localEnd.firstFrame;
          this.logEngine('sync', 'clip-first-frame', { segmentId: current.id, callbackAt: onPage(first.callbackMs), displayAt: onPage(first.displayMs),
            ...(Number.isFinite(first.playingMs) ? { playingAt: onPage(first.playingMs) } : {}), mediaMs: first.mediaMs });
        }
        // 0.65.7 (scene timing on): the first clip's first frame callback, relative to the cut.
        if (localEnd?.firstFrame && current === segment && !entering) {
          const toLocal = epoch => { if (!Number.isFinite(epoch)) return null; const local = this.overlay.clockDomain?.toLocal?.(epoch) ?? epoch; return Number.isFinite(local) ? local - performance.timeOrigin : null; };
          const rel = value => Number.isFinite(value) && Number.isFinite(this.cycleCutAt) ? Math.round((value - this.cycleCutAt) * 10) / 10 : null;
          this.metrics.stageTrace?.({ clipFirstFrame: { callbackMs: rel(toLocal(localEnd.firstFrame.callbackMs)), displayMs: rel(toLocal(localEnd.firstFrame.displayMs)), mediaMs: localEnd.firstFrame.mediaMs } });
        }
        if (signal.aborted) throw signal.reason;
        const join = next ? { segmentId: current.id, nextSegmentId: next.id, frameHoldMode: localEnd?.frameHoldMode ?? null, ...(localEnd?.chain ? { handover: localEnd.chain } : {}) } : null;
        if (!next || !(await nextReady)) {
          if (next) {
            this.metrics.mark("chain-ended", { segmentId: next.id, reason: "next-not-ready" });
            this.metrics.chainJoin?.({ ...join, advanced: false });
          }
          break;
        }
        // Stay covered: swap the next clip in and move the native join on.
        const advanceStartedAt = this.now();
        await this.step("advance", stepSignal => this.overlay.advance(stepSignal), signal);
        this.metrics.timing("chainAdvanceMs", this.now() - advanceStartedAt);
        this.metrics.chainJoin?.({ ...join, advanced: true, advanceMs: Math.round((this.now() - advanceStartedAt) * 10) / 10 });
        void this.overlay.configureAudio(snapshot, next.gainDb ?? 0, signal)?.catch?.(() => {});
        this.localMuted = snapshot.muted === true;
        chained.push(next.id);
        current = next;
        this.resumeTargetMs = next.resumeMs;
        this.metrics.mark("chained", { segmentId: next.id });
        try { segment.onAdvance?.(next.id); } catch {}
      }

      this.setState(TransitionState.RESTORING, { outcome: "success" });
      const restoreStartedAt = this.now();
      // 0.65.7 short-gap priming: when the next scene's standby is primed, the cover host is kept.
      const handover = this.shortGapHandover();
      const restoreResult = await this.step(
        "restore",
        stepSignal => this.adapter.restore(snapshot, {
          targetTimeMs: this.resumeTargetMs,
          resumePlayback: !snapshot.paused,
          awaitPresentedFrame: true, signal: stepSignal,
          ...(handover ? { keepHost: true } : {})
        }),
        signal
      );
      if (Number.isFinite(restoreResult?.errorMs)) this.metrics.timing('nativeUncoverErrorMs', restoreResult.errorMs);
      this.metrics.timing('nativeResumeMs', restoreResult?.nativeResumeMs);
      this.metrics.timing('nativeFrameWaitMs', restoreResult?.frameWaitMs);
      this.metrics.timing('nativeCompositorWaitMs', restoreResult?.compositorWaitMs);
      this.metrics.mark('native-uncover', restoreResult ?? { measured: false });
      if (restoreResult?.audioFade) {
        this.metrics.audioFade?.("exit", { ...restoreResult.audioFade,
          clip: { ...(exitClipFade ?? (restoreResult.audioFade.native?.status === 'skipped' ? { status: 'skipped', reason: 'native-not-fading' } : { status: 'no-reply' })),
            ...(exitClipEnd ? { end: exitClipEnd } : {}), ...(exitClipDiag ? { diag: exitClipDiag } : {}) },
          // 0.62.13: the overlap window and the lowest combined level in it (1 = no dip).
          ...(() => { const overlap = combinedGain(restoreResult.audioFade.native?.trace, exitClipEnd?.trace); return overlap ? { overlap } : {}; })() });
      }
      if (Number.isFinite(restoreResult?.firstFrameMediaTimeMs)) this.metrics.timing('nativeFirstFrameMediaErrorMs', restoreResult.firstFrameMediaTimeMs - this.resumeTargetMs);
      if (!(handover && await this.handOverCover(handover, snapshot, signal))) {
        await this.step("overlay-teardown", stepSignal => this.overlay.teardown(stepSignal), signal);
      }
      this.metrics.timing("restoreMs", this.now() - restoreStartedAt);
      // coveredDurationMs: cover visible → native uncovered; clipVisibleMs: the clip shown
      // (for a planned cut the same moment) → native uncovered. Both on the page's
      // performance clock (0.62.12). Without those times, the older span (transition
      // cover step → after teardown) is kept.
      coverShownAt ??= Number.isFinite(this.adapter.coverShownAt) ? this.adapter.coverShownAt : null;
      const uncoveredAt = restoreResult?.uncoveredAtMs;
      if (Number.isFinite(uncoveredAt) && Number.isFinite(coverShownAt)) {
        this.metrics.timing("coveredDurationMs", uncoveredAt - coverShownAt);
        if (Number.isFinite(clipShownAt)) this.metrics.timing("clipVisibleMs", uncoveredAt - clipShownAt);
      } else this.metrics.timing("coveredDurationMs", this.now() - coveredAt);
      this.lastResumeMs = this.resumeTargetMs;
      this.metrics.finishCycle("success", { nativePresentation: restoreResult?.presentation ?? null });
      this.setState(TransitionState.COMPLETE, { cycleId: cycle.id });
      return chained.length ? { status: "success", cycleId: cycle.id, chained } : { status: "success", cycleId: cycle.id };
    } catch (error) {
      stopPresentationErrors?.();
      // 0.65.7: no short-gap follow-up after a failed or cancelled scene (it stages normally).
      this.lastResumeMs = null; this.abandonStandbyPrime("transition-ended");
      if (this.staged?.planPending || this.staged?.handover) await this.unstage("transition-ended");
      else if (this.shortGapPriming && !this.staged && this.adapter.stagedHost) this.adapter.unstageOverlayHost?.(); // a kept host not yet handed over
      const cancelled = error?.name === "AbortError" || (signal.aborted && signal.reason?.name === "AbortError");
      if (!cancelled && !signal.aborted) this.abortController?.abort(abortError("transition-failed"));
      const errorCode = cancelled ? "cancelled" : (error?.code ?? "transition-failure");
      const errorPhase = error?.phase ?? null;
      this.setState(TransitionState.RESTORING, { outcome: cancelled ? "cancelled" : "failed" });
      await this.recover(snapshot, signal, {
        targetTimeMs: this.recoveryTargetMs(snapshot, segment, coveredAt, signal),
        resumePlayback: snapshot ? !snapshot.paused : false,
        // 0.66.2: native parked before the join never comes back showing the removed footage.
        ...(parkedJoin ? { parkedJoin } : {})
      });
      this.metrics.finishCycle(cancelled ? "cancelled" : "failed", { errorCode, phase: errorPhase });
      this.setState(cancelled ? TransitionState.CANCELLED : TransitionState.FAILED, {
        errorCode,
        phase: errorPhase,
        message: cancelled ? "Transition cancelled and native playback restored." : `Transition failed safe (${errorCode}).`
      });
      if (!cancelled) throw error;
      return { status: "cancelled", cycleId: cycle.id };
    } finally {
      stopPresentationErrors?.();
      joinSeekGate.resolve();
      if (this.joinSeekGate === joinSeekGate) this.joinSeekGate = null;
    }
  }

  // 0.65.7 short-gap hand-over: native is uncovered and the hidden cover host was kept; the primed
  // standby becomes the current clip in it, its audio level is set, and it waits as the next
  // scene's completed stage. Any failure releases the kept host and the normal teardown runs instead.
  // 0.65.8: its planned cut is registered here, at once, not at the scheduler's next stage request
  // (which waits for the previous scene's catalog round trip, then the source check: one test edit registered
  // ~200 ms after its trigger). The cut's wake-up is re-delivered until the scheduler takes it, and
  // the source check and catalog round trips for this scene run while native plays the gap.
  async handOverCover(prime, snapshot, signal) {
    if (this.standbyPrime !== prime || prime.status !== "primed" || !this.adapter.stagedHost || this.staged) {
      this.adapter.unstageOverlayHost?.();
      return false;
    }
    const startedAt = this.now(), segment = prime.segment;
    try {
      await this.step("stage-handover", stepSignal => this.overlay.promoteStandby(stepSignal), signal);
      await this.overlay.configureAudio(snapshot, segment.gainDb ?? 0, signal);
      assertActive(signal);
    } catch (error) {
      if (signal.aborted) throw error;
      this.adapter.unstageOverlayHost?.();
      return false;
    }
    if (this.standbyPrime === prime) this.standbyPrime = null;
    const controller = new AbortController();
    const staged = { clipUrl: segment.clipUrl, controller, complete: true, planPending: true, handover: true, task: Promise.resolve(true),
      trace: { via: "short-gap-handover", stageStartAt: startedAt, warmupCompleteAt: prime.completedAt } };
    this.staged = staged;
    this.metrics.mark("staged", { segmentId: segment.id, via: "short-gap-handover", gapMs: prime.gapMs });
    staged.planPending = !this.planCut(staged, segment, { handover: true });
    return true;
  }
}
