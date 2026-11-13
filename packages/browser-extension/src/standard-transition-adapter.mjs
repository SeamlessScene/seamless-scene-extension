import { OwnershipLedger } from "./ownership-ledger.mjs";
import { abortError, assertActive } from "./operation-context.mjs";
import { PresentationHost } from './presentation-host.mjs';
import { playbackQuality, longFrameLog, relativeLongFrames } from './exit-diagnostics.mjs';
import { CROSSFADE_MS, VolumeRamp, MediaTimeRamp, crossfadeAllowed, fadeableVolume, EXIT_HANDLE_MS, EXIT_PARK_RECOVERY_SLACK_MS, EXIT_NATIVE_START_MS, EXIT_NATIVE_RAMP_MS, EXIT_AHEAD_TOLERANCE_MS, EXIT_NATIVE_DEADLINE_MS, EXIT_FAR_AHEAD_MS, EXIT_NATIVE_FAST_RAMP_MS, EXIT_WARM_MIN_LEAD_MS, EXIT_PREROLL_LEAD_MS, exitPrerollLeadMs, exitParkMs, EXIT_PARK_DELAY_MAX_MS, EXIT_PARK_AUDIO_START_MS, EXIT_PRECISE_DEFAULT_FRAME_MS, nativeFrameLengthMs, NATIVE_FRAME_SAMPLES, EXIT_SILENT_GAIN, EXIT_UNCOVER_NOT_BEFORE_MS, EXIT_OUTPUT_STARTUP_MS, EXIT_CLIP_DROPPED_TAIL_MS, EXIT_CLIP_TAIL_MARGIN_MS, EXIT_CLIP_FADE_MS, EXIT_COVER_PRE_REVEAL_OPACITY } from './audio-crossfade.mjs';

// Hidden tabs and some protected renderers never deliver video frame callbacks.
// That is a degraded uncover, not a failed restore: native is already playing at
// the resume point, so recovery must not seek it back into the replaced interval.
const PRESENTED_FRAME_TIMEOUT = 'presented-frame-timeout';

// E72 (0.64.3): how native is revealed at a scene's end (Settings → Advanced → Exit reveal).
// 'new' (default): on native's first frame newer than where it sat paused at the join.
// 'previous' (0.62.17-0.64.2): only on a frame newer than native's first presented frame. That
// always hid native's first new frame under the clip's held last picture, and every missed frame
// callback hid another (~106 ms held, native revealed 3 frames late).
// 'precise' (0.65.7 X1, the viewer default from 0.65.7): on the first native frame at or after the
// join less 1 ms (a paused join frame counts) whose display time is at least the clip's end less
// half a frame. 0.65.8: with the same pre-roll lead as 'new' (exitPrerollLeadMs; 0.65.7's shorter
// precise lead is retired). An adapter built without viewer preferences keeps 'new'.
export const EXIT_REVEAL_POLICIES = Object.freeze(['new', 'previous', 'precise']);
// 0.66.2: a parked exit lifts the cover only once the qualifying native frame is confirmed on
// screen (see confirmUncover): one display refresh (60 Hz assumed) past its expected display time,
// and never more than the timeout after its callback.
export const EXIT_UNCOVER_CONFIRM_DISPLAY_MS = 1000 / 60;
export const EXIT_UNCOVER_CONFIRM_TIMEOUT_MS = 60;
// The scene-timing sync patch (E72): a small square at the video's top-left corner whose colour
// marks the moments a timing export records, so a screen recording can be matched to it.
export const SYNC_PATCH_COLORS = Object.freeze({ cut: '#ff00ff', preroll: '#ff0000', first: '#00ff00', uncover: '#0000ff' });

function waitForPresentedFrame(player, {
  timeoutMs = 1_500,
  requestAnimationFrame,
  cancelAnimationFrame,
  signal
} = {}) {
  assertActive(signal);
  if (typeof player.requestVideoFrameCallback !== "function") return Promise.resolve({status:"unsupported"});
  const registeredAt = performance.now();
  return new Promise((resolve, reject) => {
    let callbackId = null;
    let animationFrameId = null;
    let settled = false;
    let presentedAt = null;
    const timeout = setTimeout(() => {
      const error = new Error("Timed out waiting for a presented native frame");
      error.code = PRESENTED_FRAME_TIMEOUT;
      finish(error);
    }, timeoutMs);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (error && callbackId !== null && typeof player.cancelVideoFrameCallback === "function") {
        player.cancelVideoFrameCallback(callbackId);
      }
      if (error && animationFrameId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(animationFrameId);
      }
      if (error) reject(error);
      else resolve({status:"presented", frameWaitMs:presentedAt-registeredAt, compositorWaitMs:performance.now()-presentedAt});
    };
    const onAbort = () => finish(signal.reason ?? abortError());
    signal?.addEventListener("abort", onAbort, { once: true });
    const requestCompositorFrame = (remaining) => {
      if (settled) return;
      try {
        animationFrameId = requestAnimationFrame(() => {
          animationFrameId = null;
          if (settled) return;
          if (remaining > 1) requestCompositorFrame(remaining - 1);
          else finish();
        });
      } catch (error) { finish(error); }
    };
    const requestFrame = () => {
      if (settled) return;
      try { callbackId = player.requestVideoFrameCallback(() => {
        callbackId = null;
        if (settled) return;
        // Registered before play() so its first resumed frame cannot be missed.
        // A queued frame from the preceding paused seek is not a resumed frame.
        if (player.paused) { requestFrame(); return; }
        presentedAt = performance.now();
        if (typeof requestAnimationFrame === "function") {
          // rVFC runs before animation callbacks: the first rAF can run in the
          // same rendering update. Nest one more to retain the cover through
          // a subsequent update. Both stages share the original deadline.
          requestCompositorFrame(2);
        } else {
          finish();
        }
      }); } catch (error) { finish(error); }
    };
    requestFrame();
  });
}

// Typical native play() to first new frame after a paused seek (lab: 75–82 ms); replaced by measurement.
const DEFAULT_NATIVE_START_LATENCY_MS = 90;
// A pre-cut fade-out whose cut never comes (the prediction failed) gives the
// viewer's volume back after this long.
const NATIVE_FADE_UNCLAIMED_RESTORE_MS = 400;
// 0.65.10 (developer mode only): planned-cut frame callbacks are logged within this window of the trigger.
export const CUT_FRAME_LOG_WINDOW_MS = 500;

export class StandardTransitionAdapter {
  constructor({ document, passiveAdapter, commandAdapter, presentationTimeoutMs = 1_500, beforeHostTeardown, onPresentationError, crossfadeMs = CROSSFADE_MS, fadeClock = {} }) {
    this.document = document;
    // E58: equal-power volume fades on native at the cut and at the join. 0 disables.
    this.crossfadeMs = crossfadeMs; this.nativeFade = null; this.crossfadeEnabled = true;
    // Ramp timing (performance.now and timers unless a test supplies its own).
    this.fadeClock = fadeClock;
    this.passiveAdapter = passiveAdapter;
    this.commandAdapter = commandAdapter;
    this.presentationTimeoutMs = presentationTimeoutMs;
    this.exitReveal = 'new'; this.syncPatchEnabled = false; this.syncPatch = null; this.syncPatchTimer = null; this.longFrames = undefined;
    this.ledger = new OwnershipLedger();
    this.pauseLedger = new OwnershipLedger();
    this.muteActionLedger = null;
    this.completedSeek = null;
    this.seekSequence = 0;
    this.ownedSeekDepth = 0;
    this.ownedSeekTargetMs = null;
    this.overlayHost = null;
    this.stagedHost = null;
    this.plannedCut = null; this.cutHold = null; this.stateSubscribers = new Set();
    this.nativePreroll = null; this.nativeStartLatencyMs = null; this.exitStartLatencies = []; this.exitClockDelays = [];
    this.ownedFullscreenPosition = null;
    this.boundPlayer = null;
    this.boundSnapshot = null; this.snapshotToken = null;
    this.snapshotRecords = new WeakMap();
    this.contextValid = true;
    this.beforeHostTeardown = beforeHostTeardown;
    this.presentationErrorListeners = new Set();
    this.presentation = new PresentationHost({ document, getPlayer: () => this.player(), onError: error => {
      // A geometry failure does not change the source. Invalidating it here
      // prevents the pause ledger from resuming the still-owned native player.
      for (const listener of this.presentationErrorListeners) listener(error);
      onPresentationError?.(error);
    } });
  }

  subscribePresentationErrors(listener) {
    this.presentationErrorListeners.add(listener);
    return () => this.presentationErrorListeners.delete(listener);
  }

  player() {
    const player = this.passiveAdapter.activePlayer();
    if (!player) throw new Error("Active Prime player was lost during transition");
    if (!this.contextValid || (this.boundPlayer && this.boundPlayer !== player)) throw abortError("Native player context changed");
    return player;
  }

  async readState() {
    const state = await this.commandAdapter.readState();
    // While a fade runs, report the viewer's volume (the clip is matched to it).
    const fade = this.nativeFade;
    if (fade?.active && state && Number.isFinite(state.volume)) {
      let player = null; try { player = this.passiveAdapter.activePlayer(); } catch {}
      if (player === fade.element) return { ...state, volume: fade.level };
    }
    return state;
  }

  // --- E58 native volume fades -------------------------------------------------
  // At most one native fade exists. Every path that ends a cut or a transition
  // calls releaseNativeFade(), which puts the viewer's exact volume back unless
  // the viewer (or Prime) changed it meanwhile.
  nativeFadesAllowed() { return this.crossfadeEnabled !== false && crossfadeAllowed(this.document, this.crossfadeMs); }

  // Settings → Playback → "Smooth audio at scene changes". Off is the 0.62.5 hard
  // switch on both sides; it applies from the next hand-over.
  setCrossfadeEnabled(enabled) { this.crossfadeEnabled = enabled !== false; }

  // Settings → Advanced → Exit reveal (E72); it applies from the next exit.
  setExitRevealPolicy(policy) { this.exitReveal = EXIT_REVEAL_POLICIES.includes(policy) ? policy : 'new'; }

  // On while scene timing records (E72 F3).
  // 0.65.9 (developer mode only): a sync mark for the engine event export (EngineEventLog, set by
  // main.mjs). Logging only: a flag check and one ring-buffer write; nothing without the log.
  logSync(name, detail) {
    const log = this.eventLog;
    if (log?.enabled) { try { log.record('sync', name, detail); } catch {} }
  }

  setSyncPatch(enabled) { this.syncPatchEnabled = enabled === true; if (!this.syncPatchEnabled) this.syncMark(null); }

  // Colours the sync patch for one recorded moment; null removes it. Returns the time (ms,
  // performance clock) the colour was set, or null when the patch is off or not placeable.
  syncMark(name, { clearAfterMs = null } = {}) {
    clearTimeout(this.syncPatchTimer); this.syncPatchTimer = null;
    if (name === null || !this.syncPatchEnabled) { try { this.syncPatch?.remove(); } catch {} this.syncPatch = null; return null; }
    try {
      const player = this.passiveAdapter.activePlayer(), rect = player?.getBoundingClientRect?.();
      if (!rect || !this.document.createElement) return null;
      let patch = this.syncPatch;
      if (!patch) {
        patch = this.document.createElement('div');
        patch.id = 'scene-substitution-sync-patch'; patch.setAttribute?.('aria-hidden', 'true');
        Object.assign(patch.style, { position: 'fixed', width: '8px', height: '8px', zIndex: '2147483647', pointerEvents: 'none' });
        this.syncPatch = patch;
      }
      const parent = this.document.fullscreenElement ?? this.document.documentElement;
      if (patch.parentNode !== parent) parent.append(patch);
      Object.assign(patch.style, { left: `${Math.round(rect.left + 4)}px`, top: `${Math.round(rect.top + 4)}px`, background: SYNC_PATCH_COLORS[name] ?? '#ffffff' });
      if (Number.isFinite(clearAfterMs)) this.syncPatchTimer = setTimeout(() => this.syncMark(null), clearAfterMs);
      return performance.now();
    } catch { return null; }
  }

  // Why native will not fade at a hand-over, or null when it will.
  nativeFadeSkipReason(player, snapshot) {
    if (this.crossfadeEnabled === false || !(this.crossfadeMs > 0)) return 'disabled';
    if (!crossfadeAllowed(this.document, this.crossfadeMs)) return 'hidden-tab';
    if (snapshot?.muted === true) return 'viewer-muted';
    let volume = null, muted = null;
    try { volume = player.volume; muted = player.muted; } catch {}
    if (!Number.isFinite(volume) || volume <= 0) {
      // Warmed with Smooth audio on, native already sits at 0 under the warm hold.
      if (!(this.nativeWarm?.player === player && this.nativeWarm.hold?.active)) return 'zero-volume';
    }
    if (muted !== true && this.nativeWarm?.player !== player) return 'native-not-muted';
    return null;
  }

  // How far before the join the engine seeks native for an exit crossfade.
  exitHandleMs() {
    const snapshot = this.boundSnapshot;
    if (this.crossfadeEnabled === false || !(this.crossfadeMs > 0) || !snapshot || snapshot.muted === true || snapshot.paused) return 0;
    if (!(snapshot.volume > 0)) return 0;
    // 0.62.11: none. Seeking native 50 ms early (0.62.7-0.62.10) made its first frame a
    // pre-join one and held the cover ~90 ms at every exit.
    return EXIT_HANDLE_MS;
  }

  // 0.66.2 (exit jump): how far before the join the engine parks native for the exit, so that its
  // clock reaches the join at the clip's end instead of 35-135 ms earlier (exitParkMs in
  // audio-crossfade.mjs). Exit reveal 'precise' only (its gate takes the join frame itself), and
  // only where native is muted or under the exit ramp: the viewer has it muted, or Smooth audio
  // will hold it at -60 dB until its clock reaches the ramp's start (EXIT_PARK_AUDIO_START_MS).
  exitParkMs() {
    const snapshot = this.boundSnapshot;
    if (this.exitReveal !== 'precise' || !snapshot || snapshot.paused) return 0;
    if (snapshot.muted !== true && (this.crossfadeEnabled === false || !(this.crossfadeMs > 0) || !crossfadeAllowed(this.document, this.crossfadeMs) || !(snapshot.volume > 0))) return 0;
    return exitParkMs(exitPrerollLeadMs(this.exitStartLatencies), this.exitClockDelays);
  }

  // 0.62.14: Chrome needs ~41 ms after an unmute before a media element is
  // audible (L), and drops the last ~25 ms of an ending clip's audio (D). So native's audio
  // output is started early: unmuted while it is paused at the join, seconds before the clip
  // ends. Paused, it makes no sound. With Smooth audio on its volume is held at 0 first (the
  // exit ramp then raises it from the join); with it off it is unmuted at the viewer's level
  // and simply starts sounding when the pre-roll plays it.
  warmNativeOutput(mode = 'paused-at-join', endAtMs = null) {
    const snapshot = this.boundSnapshot, record = snapshot && this.snapshotRecords.get(snapshot);
    if (!record || record.token !== this.snapshotToken || record.released || snapshot.paused || snapshot.muted === true) return false;
    if (this.nativeWarm?.token === record.token) return true;
    let player; try { player = this.player(); } catch { return false; }
    if (player.muted !== true) return false; // not ours to unmute (the viewer changed it)
    let volume = null; try { volume = player.volume; } catch {}
    if (!Number.isFinite(volume) || volume <= 0) return false;
    const now = this.fadeClock.now?.() ?? performance.now();
    const warm = { player, token: record.token, mode, at: now, smooth: this.nativeFadesAllowed(), hold: null,
      ...(Number.isFinite(endAtMs) ? { leadMs: Math.round(endAtMs - performance.timeOrigin - performance.now()) } : {}) };
    if (warm.smooth) {
      // Volume to 0 (restorable: any cleanup puts the viewer's level back), then unmute.
      this.releaseNativeFade();
      // Held at -60 dB, not 0: at volume 0 Chrome treats the element as muted and starts its
      // audio output only when the volume rises, ~41 ms late.
      warm.hold = new VolumeRamp(player, { ...this.fadeClock, direction: 'out', level: volume, startAt: now - 1, durationMs: 1, floor: EXIT_SILENT_GAIN });
      this.nativeFade = warm.hold;
    }
    player.muted = false;
    this.nativeWarm = warm;
    return true;
  }

  // The OFF path's exit: native was warmed at full level, so the clip's audio is cut
  // EXIT_CLIP_TAIL_MARGIN_MS before its end (its dropped tail never matters).
  exitCutArmed() {
    const preroll = this.nativePreroll;
    return Boolean(preroll && !preroll.cancelled && preroll.fadePlanned !== true && this.nativeWarm && !this.nativeWarm.smooth);
  }

  // A pending or running pre-roll that will fade native in: the clip should fade out.
  exitFadeArmed() {
    const preroll = this.nativePreroll;
    return Boolean(preroll && !preroll.cancelled && preroll.fadePlanned === true);
  }

  // Diagnostics for one exit, times on the join's clock (0 = the clip's end).
  // 0.62.11 exit diagnostics: native's media events from its pre-roll start until the
  // receipt (at most 2 s), as [ms from the clip's end, event, readyState, media - join ms].
  watchExitEvents(preroll, player, joinMs) {
    const events = preroll.events = [], at = () => this.fadeClock.now?.() ?? performance.now();
    const add = type => {
      if (events.length >= 40) return;
      let readyState = null, media = null;
      try { readyState = player.readyState; const ms = player.currentTime * 1000; media = Number.isFinite(ms) && Number.isFinite(joinMs) ? Math.round(ms - joinMs) : null; } catch {}
      events.push([Math.round((at() - preroll.endAt) * 10) / 10, type, Number.isInteger(readyState) ? readyState : null, media]);
    };
    const types = ['play', 'playing', 'waiting', 'stalled', 'seeking', 'seeked', 'pause', 'canplay', 'canplaythrough', 'suspend', 'progress'];
    const handler = event => add(event?.type ?? 'event');
    for (const type of types) player.addEventListener?.(type, handler);
    add('preroll-start');
    // The pre-roll lead (ms before the clip's end that native was started), on that entry.
    if (Number.isFinite(preroll.leadMs)) events.at(-1)?.push(preroll.leadMs);
    const stop = () => { clearTimeout(timer); for (const type of types) player.removeEventListener?.(type, handler); preroll.stopEvents = null; };
    const timer = setTimeout(stop, Math.max(0, preroll.endAt - performance.now()) + 2000);
    preroll.stopEvents = stop; preroll.markEvent = add;
  }

  exitAudioReport(preroll) {
    preroll.stopEvents?.();
    const report = { handleMs: preroll.handleMs, ...(preroll.parkMs > 0 ? { parkMs: preroll.parkMs } : {}), joinMs: preroll.joinMs, ...(Number.isFinite(preroll.leadMs) ? { prerollLeadMs: preroll.leadMs } : {}),
      // 0.65.6: play() to native's first frame on screen (what the next exits' lead learns from).
      ...(Number.isFinite(preroll.startLatencyMs) ? { startLatencyMs: preroll.startLatencyMs } : {}),
      ...(Number.isFinite(preroll.fadeBaseMediaMs) ? { fadeBaseMediaMs: preroll.fadeBaseMediaMs } : {}),
      firstFrameMediaTimeMs: preroll.firstFrameMediaTimeMs, uncoverFrameMediaTimeMs: preroll.uncoverFrameMediaTimeMs };
    const fade = preroll.fade;
    if (Number.isFinite(preroll.unmutedAt)) {
      report.unmuteAtMs = Math.round((preroll.unmutedAt - preroll.endAt) * 10) / 10;
      // 0.62.14: how long before the clip's end native was unmuted (its output needs ~41 ms),
      // and how: paused at the join, early (at the ending notice), or the fallback (at its
      // playing event or the uncover). Recorded with Smooth audio on and off alike.
      report.unmuteLeadMs = -report.unmuteAtMs;
      report.outputWarmMode = preroll.warm?.mode ?? 'fallback';
    }
    if (Number.isFinite(preroll.frameWaitMs)) report.frameWaitMs = Math.round(preroll.frameWaitMs * 10) / 10;
    // 0.62.15 prediction from the measured Chrome behaviour: native audible ~41 ms after play(),
    // the clip's audio really ending ~25 ms before its end. A positive gap predicts silence.
    if (Number.isFinite(preroll.playAt)) {
      const audibleAt = Math.round((preroll.playAt - preroll.endAt + EXIT_OUTPUT_STARTUP_MS) * 10) / 10;
      // The clip is silent from EXIT_CLIP_TAIL_MARGIN_MS before its end (faded or cut), which
      // also covers the dropped tail.
      const clipSilentAt = -Math.max(EXIT_CLIP_DROPPED_TAIL_MS, EXIT_CLIP_TAIL_MARGIN_MS);
      report.predicted = { audibleAtMs: audibleAt, clipAudioEndMs: clipSilentAt, gapMs: Math.max(0, Math.round((audibleAt - clipSilentAt) * 10) / 10) };
    }
    // 0.62.16: when play() was called and when native reported 'playing', relative to the clip's
    // end; actualStartMs is the later one seen (the nominal lead loses 9-21 ms to play()).
    {
      const at = value => Number.isFinite(value) ? Math.round((value - preroll.endAt) * 10) / 10 : null;
      const playCallMs = at(preroll.playCallAt), playingMs = at(preroll.playingAt);
      if (playCallMs !== null) report.playCallMs = playCallMs;
      if (playingMs !== null) report.playingMs = playingMs;
      if (playCallMs !== null || playingMs !== null) report.actualStartMs = playingMs ?? playCallMs;
    }
    if (Number.isFinite(preroll.firstFrameMediaTimeMs) && Number.isFinite(preroll.joinMs)) report.firstFrameVsJoinMs = Math.round(preroll.firstFrameMediaTimeMs - preroll.joinMs);
    // 0.62.17: every native frame callback until the uncover as [ms from clip end, media - join,
    // presentedFrames]; the uncover's own frame and wall time; whether the fallback uncovered.
    if (preroll.frameLog) report.frames = preroll.frameLog;
    if (Number.isFinite(preroll.uncoverFrameAt)) {
      report.uncoverAtMs = Math.round((preroll.uncoverFrameAt - preroll.endAt) * 10) / 10;
      const first = preroll.frameLog?.[0]?.[0];
      if (Number.isFinite(first)) report.uncoverHeldMs = Math.round(report.uncoverAtMs - first);
    }
    if (preroll.uncovered) report.uncoverVia = preroll.uncoverViaFallback ? 'fallback' : 'frame';
    // E72 (0.64.3): the reveal policy this exit used and its diagnostics.
    report.revealPolicy = preroll.revealPolicy ?? this.exitReveal;
    // 0.65.7 X1: the native frame length the 'precise' gate used (0.65.8: the gate only).
    if (Number.isFinite(preroll.revealFrameMs)) report.revealFrameMs = Math.round(preroll.revealFrameMs * 10) / 10;
    {
      const vsJoin = value => Number.isFinite(value) && Number.isFinite(preroll.joinMs) ? Math.round((value - preroll.joinMs) * 10) / 10 : null;
      const paused = vsJoin(preroll.pausedMediaMs), clock = vsJoin(preroll.timeAtUncoverMs);
      if (paused !== null) report.pausedVsJoinMs = paused;
      if (clock !== null) report.timeAtUncoverVsJoinMs = clock;
      // 0.66.2 (exit jump) diagnostics, in native frames (the measured frame length, else 1/30 s):
      // at the uncover, how far past the join the revealed frame is (0 = the join frame; under 1 =
      // the frame that holds the join) and native's clock, and how much of the clip was left
      // (negative: the clip had ended and its last frame was held that long). Then native's clock
      // at the clip's end (0 = at the join; positive = ahead, frames skipped) and the clock's start
      // delay after play() that the next exits' park is taken from.
      const frameMs = Number.isFinite(preroll.revealFrameMs) && preroll.revealFrameMs > 0 ? preroll.revealFrameMs
        : Number.isFinite(this.nativeFrameMs) && this.nativeFrameMs > 0 ? this.nativeFrameMs : EXIT_PRECISE_DEFAULT_FRAME_MS;
      const frames = value => Math.round(value / frameMs * 100) / 100, shown = vsJoin(preroll.uncoverFrameMediaTimeMs);
      if (preroll.uncovered && Number.isFinite(preroll.uncoveredAt)) {
        const left = Math.round((preroll.endAt - preroll.uncoveredAt) * 10) / 10;
        report.uncover = { frameMs: Math.round(frameMs * 10) / 10,
          ...(shown !== null ? { frameVsJoinMs: shown, frameVsJoinFrames: frames(shown) } : {}),
          ...(clock !== null ? { clockVsJoinMs: clock, clockVsJoinFrames: frames(clock), clockAtClipEndVsJoinMs: Math.round((clock + left) * 10) / 10 } : {}),
          clipRemainingMs: left, clipFramesRemaining: frames(left),
          ...(Number.isFinite(preroll.clockDelayMs) ? { clockDelayMs: preroll.clockDelayMs } : {}),
          // Parked exits: how the qualifying frame was confirmed on screen before the cover went
          // (native's next frame, an animation frame, or the timeout) and how long that took.
          ...(preroll.confirmVia ? { confirmVia: preroll.confirmVia, confirmMs: Math.round(preroll.confirmMs * 10) / 10 } : {}) };
      }
    }
    if (preroll.quality) report.quality = preroll.quality;
    if (preroll.rafLog?.length) report.rafs = preroll.rafLog;
    if (preroll.syncLog?.length) report.sync = preroll.syncLog;
    if (this.longFrames && Number.isFinite(preroll.playAt)) report.longFrames = relativeLongFrames(this.longFrames.between(preroll.playAt - 500, performance.now()), preroll.endAt);
    if (preroll.layers) report.layers = preroll.layers;
    if (!fade) {
      // Every exit names its native status; a planned fade that never began says why.
      const native = preroll.audio?.status === 'planned' || preroll.audio?.status === 'running'
        ? { status: 'not-started', reason: preroll.uncovered ? 'fade-not-created' : 'no-playing-or-uncover-before-receipt' } : { ...preroll.audio };
      return { ...report, events: preroll.events ?? [], native };
    }
    const ramp = fade.report(), at = value => value === null ? null : Math.round((value - preroll.endAt) * 10) / 10;
    const status = ramp.state === 'released' ? 'skipped' : ramp.startAt === null ? 'not-started' : ramp.state === 'done' ? 'ran' : 'running';
    const notStartedReason = status === 'not-started' ? (ramp.state === 'restored' ? 'cancelled-before-rising' : 'native-media-not-past-join') : null;
    // Each volume change: [ms from the clip's end, native gain 0-1, native media time - join (ms)].
    const join = Number.isFinite(preroll.joinMs) ? preroll.joinMs : null;
    const trace = (fade.trace ?? []).map(([t, gain, media]) => [at(t), Math.round(gain * 1000) / 1000,
      join !== null && Number.isFinite(media) ? Math.round(media - join) : null]);
    // Native's clock at the clip's end (the last change at or before it): which native audio was
    // playing when the clip's fade reached zero. 0 = exactly the join; negative = still before it.
    const atEnd = trace.filter(entry => entry[0] !== null && entry[0] <= 0).at(-1);
    // Native media time when its gain first rose above zero (0 = exactly at the join).
    const firstAudible = trace.find(entry => entry[1] > 0);
    return { ...report, events: preroll.events ?? [], native: { status, ...(ramp.state === 'released' ? { reason: 'volume-changed' } : {}),
      ...(notStartedReason ? { reason: notStartedReason } : {}),
      mode: fade instanceof MediaTimeRamp ? 'media-time' : 'wall-time', ...(preroll.fadeTrigger ? { trigger: preroll.fadeTrigger, rampMs: preroll.fadeRampMs } : {}), ...(preroll.fadeWallFloor ? { wallFloor: true } : {}),
      ...(Number.isFinite(preroll.fadeClockMovingAt) ? { clockMovingMs: at(preroll.fadeClockMovingAt) } : {}),
      startMs: at(ramp.startAt), endMs: at(ramp.endAt),
      ...(fade.reason ? { fullBy: fade.reason } : {}), ...(Number.isFinite(preroll.aheadMs) ? { aheadMs: preroll.aheadMs } : {}),
      ...(firstAudible && firstAudible[2] !== null ? { rampStartMediaMs: firstAudible[2] } : {}),
      ...(atEnd && atEnd[2] !== null ? { nativeClockAtClipEndMs: atEnd[2], nativeClockSampleMs: atEnd[0] } : {}), trace } };
  }

  releaseNativeFade(direction = null) {
    const fade = this.nativeFade;
    if (!fade || (direction && fade.direction !== direction)) return false;
    this.nativeFade = null;
    fade.restore();
    return true;
  }

  // The viewer's volume, not a fade's momentary one.
  viewerVolume(player, volume) {
    const fade = this.nativeFade;
    return fade?.active && fade.element === player ? fade.level : volume;
  }

  async snapshot(signal) {
    assertActive(signal);
    const previous = this.snapshotRecords.get(this.boundSnapshot);
    // Only retry a finished final-cleanup failure. Active transition ownership
    // must still reject replacement; the ledger retains its external-change checks.
    if (previous?.forceCleanupFailed && !this.overlayHost && !this.muteActionLedger) {
      await this.forceSafeNativeState(this.boundSnapshot, signal);
      assertActive(signal);
    }
    if (this.ledger.entries.length || this.pauseLedger.entries.length || this.muteActionLedger || (this.boundSnapshot && this.overlayHost)) throw abortError('Previous native ownership must be restored before a new snapshot');
    this.clearCompletedSeek();
    this.commandAdapter.invalidateContext?.('Native snapshot superseded', { sourceChanged: false });
    this.snapshotToken?.cleanupController?.abort(abortError('Native snapshot superseded'));
    this.snapshotToken?.detachSource?.();
    const token = {}; this.snapshotToken = token; this.boundSnapshot = null;
    this.boundPlayer = this.passiveAdapter.activePlayer();
    const player = this.boundPlayer;
    // A join fade-in still running from the previous scene ends at the viewer's level.
    this.releaseNativeFade('in');
    this.nativeWarm = null;
    const onSourceChange = () => { if (this.snapshotToken === token) this.invalidateContext(); };
    player?.addEventListener?.('emptied', onSourceChange);
    player?.addEventListener?.('loadstart', onSourceChange);
    token.detachSource = () => { player?.removeEventListener?.('emptied', onSourceChange); player?.removeEventListener?.('loadstart', onSourceChange); };
    this.contextValid = true;
    this.ledger = new OwnershipLedger();
    this.pauseLedger = new OwnershipLedger();
    try {
      const state = await this.readState(); assertActive(signal);
      if (this.snapshotToken !== token) throw abortError('Native snapshot superseded');
      this.player();
      // A planned cut already paused native at the frame before the trigger; the
      // viewer was playing, and that is what the transition must restore.
      const snapshot = this.cutHold?.player === player ? { ...state, paused: false } : { ...state };
      // Taken right after the cut, while native sits at its faded-out volume: the
      // transition must restore, and match the clip to, the viewer's own level.
      if (Number.isFinite(snapshot.volume)) snapshot.volume = this.viewerVolume(player, snapshot.volume);
      this.boundSnapshot = snapshot;
      this.snapshotRecords.set(snapshot, { token, ledger: this.ledger, pauseLedger: this.pauseLedger });
      return snapshot;
    } catch (error) {
      if (this.snapshotToken === token) { token.detachSource(); this.boundPlayer = null; this.boundSnapshot = null; this.snapshotToken = null; this.contextValid = true; }
      throw error;
    }
  }

  // SKIP owns a short-lived source binding, not a paused/muted presentation.
  // Its late finally must never release a later transition's snapshot.
  releaseSnapshot(snapshot) {
    if (!snapshot || this.boundSnapshot !== snapshot || this.ledger.entries.length || this.pauseLedger.entries.length || this.muteActionLedger || this.overlayHost) return false;
    this.clearCompletedSeek();
    this.snapshotToken?.detachSource?.();
    this.boundPlayer = null; this.boundSnapshot = null; this.snapshotToken = null; this.contextValid = true;
    return true;
  }

  invalidateContext() { this.releaseNativeFade(); this.clearCompletedSeek(); this.contextValid = false; this.commandAdapter.invalidateContext?.(); }

  async pause(signal) {
    const player = this.player(), token = this.snapshotToken;
    const assertCurrent = () => { if (this.snapshotToken !== token) throw abortError('Native pause superseded'); this.player(); };
    await this.pauseLedger.apply({
      key: "prime-native-paused",
      // The cut hold's pause is the transition's own: its baseline is "playing".
      read: async () => { if (this.cutHold?.player === player) { this.eventLog?.enabled && this.logSync('cut-hold-adopted', { triggerMs: this.cutHold.triggerMs }); this.adoptCutHold(); return false; } return player.paused; },
      write: async (paused, { restoring, signal: operationSignal }) => {
        if (this.snapshotToken !== token) throw abortError('Native pause ownership superseded');
        if (restoring && (!this.contextValid || this.passiveAdapter.activePlayer() !== player)) return;
        assertActive(operationSignal);
        const via = restoring ? 'restore' : 'transition';
        this.eventLog?.enabled && this.logSync(paused ? 'native-pause-issued' : 'native-play-issued', { via });
        if (paused) await this.commandAdapter.pause(operationSignal, player, { assertCurrent });
        else await this.commandAdapter.play(operationSignal, player, { assertCurrent });
        this.eventLog?.enabled && this.logSync(paused ? 'native-pause-done' : 'native-play-done', { via });
      },
      value: true, signal, assertCurrent
    });
  }

  async play(signal) {
    const player = this.player(), token = this.snapshotToken;
    const assertCurrent = () => { if (this.snapshotToken !== token) throw abortError('Native play superseded'); this.player(); };
    await this.commandAdapter.play(signal, player, { assertCurrent });
  }

  clearCompletedSeek() {
    this.completedSeek?.dispose();
    this.completedSeek = null;
  }

  canReuseCompletedSeek(targetMs) {
    const receipt = this.completedSeek;
    if (!receipt || receipt.token !== this.snapshotToken || receipt.targetMs !== targetMs || !this.contextValid) return false;
    const player = this.player();
    return player === receipt.player && player.isConnected !== false && player.paused === true &&
      player.seeking === false && player.readyState >= 2 && player.currentTime === receipt.time;
  }

  rememberCompletedSeek(targetMs, player, token, result) {
    // Reuse a confirmed owned result, never a proximity estimate or a clamped
    // endpoint. Source ownership uses the snapshot lifecycle, never media URLs.
    if (!token || result?.confirmed !== true || result.targetMs !== targetMs ||
        !Number.isFinite(result.errorMs) || !Number.isFinite(result.toleranceMs) ||
        Math.abs(result.errorMs) > result.toleranceMs || player.paused !== true ||
        player.seeking !== false || player.readyState < 2 || !Number.isFinite(player.currentTime) ||
        result.after?.currentTimeMs !== Math.round(player.currentTime * 1000) ||
        typeof player.addEventListener !== 'function') return;
    const receipt = { token, targetMs, player, time: player.currentTime };
    const invalidate = () => { if (this.completedSeek === receipt) this.clearCompletedSeek(); };
    const onTime = () => { if (player.currentTime !== receipt.time) invalidate(); };
    const events = ['seeking', 'play', 'emptied', 'loadstart', 'durationchange', 'ratechange', 'waiting', 'stalled'];
    receipt.dispose = () => {
      for (const name of events) player.removeEventListener(name, invalidate);
      player.removeEventListener('timeupdate', onTime);
    };
    for (const name of events) player.addEventListener(name, invalidate);
    player.addEventListener('timeupdate', onTime);
    this.completedSeek = receipt;
  }

  async seek(targetMs, signal) {
    assertActive(signal);
    this.clearCompletedSeek();
    const sequence = ++this.seekSequence;
    const player = this.player(), token = this.snapshotToken;
    const state = await this.readState();
    assertActive(signal);
    if (this.snapshotToken !== token || sequence !== this.seekSequence) throw abortError('Native seek superseded');
    this.player();
    if (Math.abs(state.currentTimeMs - targetMs) <= 1 && state.readyState >= 2) return { targetMs, errorMs: state.currentTimeMs - targetMs, after: state };
    this.ownedSeekDepth += 1;
    this.ownedSeekTargetMs = targetMs;
    try {
      const result = await this.commandAdapter.seekToWithPlaybackWarmup(targetMs, "transition-seek", { signal, player,
        assertCurrent: () => { if (this.snapshotToken !== token || sequence !== this.seekSequence) throw abortError('Native seek superseded'); this.player(); } });
      assertActive(signal);
      if (this.snapshotToken !== token || sequence !== this.seekSequence) throw abortError('Native seek superseded');
      this.player();
      this.rememberCompletedSeek(targetMs, player, token, result);
      return result;
    } finally {
      this.ownedSeekDepth -= 1;
      if (this.ownedSeekDepth === 0) this.ownedSeekTargetMs = null;
    }
  }

  isOwnedSeekEvent(observedTimeMs) {
    return this.ownedSeekDepth > 0 && Math.abs(observedTimeMs - this.ownedSeekTargetMs) <= 250;
  }

  async setMuted(muted, signal) {
    const player = this.player(), token = this.snapshotToken;
    const assertCurrent = () => { if (this.snapshotToken !== token) throw abortError('Native mute superseded'); this.player(); };
    await this.ledger.apply({
      key: "prime-native-muted",
      read: async () => player.muted,
      write: async (value) => {
        if (this.snapshotToken !== token) throw abortError('Native mute ownership superseded');
        player.muted = value;
        // Native is paused and now muted: the cut's faded-out volume can go back
        // to the viewer's level without being heard.
        if (value === true && this.nativeFade?.element === player) this.releaseNativeFade('out');
      },
      value: muted, signal, assertCurrent
    });
  }

  async beginMuteAction(_action, signal) {
    if (this.muteActionLedger) throw new Error("mute-action-already-active");
    const ledger = new OwnershipLedger(), token = this.snapshotToken;
    this.muteActionLedger = ledger;
    const assertCurrent = () => {
      assertActive(signal);
      if (this.muteActionLedger !== ledger || this.snapshotToken !== token) throw abortError('Native mute action superseded');
      this.player();
    };
    try {
      await this.readState(); assertCurrent();
      const player = this.player();
      await ledger.apply({
      key: "native-muted",
      read: async () => player.muted,
      write: async (value) => { player.muted = value; },
      value: true, signal, assertCurrent
      });
    } catch (error) {
      if (this.muteActionLedger === ledger) { await ledger.restore(); this.muteActionLedger = null; }
      throw error;
    }
  }

  async finishMuteAction() {
    const ledger = this.muteActionLedger;
    try { await ledger?.restore(); }
    finally { if (this.muteActionLedger === ledger) this.muteActionLedger = null; }
  }

  // The cover host stays invisible until setNativeCovered(true), which the engine
  // calls only after native is paused and the local frame is shown. Showing it at
  // mount put black (and briefly the picker) over still-playing native video.
  mountHiddenHost() {
    try {
      const host = this.presentation.mount();
      // 0.62.18: staged at opacity 0, not visibility:hidden. A hidden host made
      // the clip's extension frame (a separate-process iframe) stop producing frames, so at
      // the cut its first visible frame was a stale, differently sized one that snapped into
      // place a frame later. At opacity 0 it renders at its final size all along; it is still
      // invisible, takes no pointer events and does not hide native.
      host.style.opacity = '0'; host.style.visibility = 'visible';
      return host;
    } catch (error) {
      // Initial mount failures need the same controller/engine notification as
      // a later resize or fullscreen update failure.
      this.presentation.onError(error);
      throw error;
    }
  }

  // Staging mounts the hidden host shortly before a trigger so the renderer can
  // be moved in, configured and shown ahead of time. It owns no native state:
  // snapshot, pause and mute still happen only when the transition runs.
  //
  // 0.66.2 (keepCutHold): a hold-only cut (planHold) that fired while the stage was still preparing
  // has already stopped native on the frame before the trigger. Staging the host must not release
  // it (native would run on, uncovered, until the transition's own pause).
  async stageOverlayHost(signal, { keepCutHold = false } = {}) {
    assertActive(signal);
    if (this.overlayHost) throw new Error("Local overlay host is already active");
    // 0.66.2: invalidateContext() while no transition owns native (the player element changed
    // between scenes, the session was cleared and armed again) left contextValid false until the
    // next snapshot. The first stage of the new run then failed in player() with "Native player
    // context changed" and that scene cut unstaged (scheduler-stage-failed, unstaged-fallback,
    // on the first scene of a second pass). An invalidation with nothing bound
    // has nothing left to protect; staging starts from the player that is active now. A snapshot
    // that is still bound (not yet released) keeps its invalidation.
    if (!this.contextValid && (!this.snapshotToken || this.snapshotRecords.get(this.boundSnapshot)?.released === true) &&
        !this.ledger.entries.length && !this.pauseLedger.entries.length && !this.muteActionLedger) this.contextValid = true;
    this.unstageOverlayHost({ keepCutHold });
    this.stagedHost = this.mountHiddenHost();
    return this.stagedHost;
  }

  // Planned cut: while a scene is staged, watch native's presented frames and, in
  // the callback for the last frame before the trigger, pause native and reveal the
  // staged cover in the same task, so no frame of the replaced footage reaches the
  // screen and no round trip sits inside the cut. The scheduler is then woken with
  // the trigger time. onPredict receives the expected cut time (epoch ms) on every
  // frame, which lets the renderer start the clip early by its start-up latency.
  //
  // E58: the last crossfadeMs before the predicted cut also fade native's volume
  // out (equal power), while the renderer fades the pre-rolled clip in over the
  // same window. Native still pauses at the same frame; the cut then holds the
  // faded volume until native is muted, and gives the viewer's level back.
  //
  // 0.65.7 short-gap priming (deferLateReveal, set only for a scene after a short native gap): a
  // cut that comes at least half a frame after the trigger (native already shows replaced footage)
  // pauses native but does not reveal the staged clip, which still sits on its first frame; the
  // transition first moves the clip to native's position and then covers, so the picture never
  // steps back. Without the option nothing changes.
  //
  // 0.65.8 short-gap hand-over (redeliverWake, set only for a cut registered at the hand-over, while
  // the scheduler may still be busy with the previous scene): the cut's wake-up is delivered again on
  // every playback sample (sampledState) until the transition takes over the cut hold, so a wake-up
  // the busy scheduler dropped is never lost. Without the option nothing changes.
  //
  // 0.66.2 (holdOnly, set only by planHold): the same frame watch and the same cut rule, without a
  // staged cover. The cut pauses native on the last frame before the trigger and wakes the
  // scheduler; nothing is revealed, and the transition shows the clip when it is ready.
  planCut(triggerMs, { onPredict = () => {}, onAbort = () => {}, onHoldReleased = null, fadeNative = true, deferLateReveal = false, redeliverWake = false, holdOnly = false } = {}) {
    this.cancelPlannedCut();
    let player;
    try { player = this.passiveAdapter.activePlayer(); } catch { return false; }
    if (!player || typeof player.requestVideoFrameCallback !== "function" || (!this.stagedHost && holdOnly !== true)) return false;
    const trigger = triggerMs / 1000, epoch = value => performance.timeOrigin + value;
    const plan = { player, triggerMs, handle: null, done: false, ...(redeliverWake === true ? { redeliverWake: true } : {}), ...(holdOnly === true ? { holdOnly: true } : {}),
      ...(typeof onHoldReleased === 'function' ? { onHoldReleased } : {}) };
    let previous = null, previousCount = null, frame = 1 / 30;
    const frameDeltasMs = []; // 0.65.8: per-frame deltas for nativeFrameMs (observation only)
    // 0.65.10 (developer mode only, logging only): every frame callback the cut rule considers within
    // CUT_FRAME_LOG_WINDOW_MS of the trigger, its decision and tolerance, and any presentedFrames gap.
    // Earlier callbacks are only counted. Nothing here feeds the cut.
    const frameLog = this.eventLog?.enabled ? { callbacks: 0, logged: 0, earlier: 0, missedFrames: 0 } : null;
    const onFrame = (now, meta) => {
      if (plan.done || this.plannedCut !== plan) return;
      const media = meta?.mediaTime, count = meta?.presentedFrames;
      const callbackAt = frameLog ? performance.now() : null;
      // Frames presented without a callback of their own since the previous one (logged afterwards).
      const gap = frameLog && Number.isFinite(media) && previous !== null && Number.isSafeInteger(count) && Number.isSafeInteger(previousCount) && count - previousCount > 1
        ? { previousMediaMs: previous * 1000, missedCallbacks: count - previousCount - 1 } : null;
      // Called only after the rule has acted (cut, or prediction sent), so logging never delays either.
      const logFrame = frameLog ? (decision, frameS) => {
        frameLog.callbacks += 1;
        if (gap) {
          frameLog.missedFrames += gap.missedCallbacks;
          this.logSync('cut-frame-gap', { triggerMs, mediaMs: media * 1000, previousMediaMs: gap.previousMediaMs, presentedFrames: count, missedCallbacks: gap.missedCallbacks });
        }
        if (decision !== 'cut' && decision !== 'missed' && decision !== 'cut-trigger-frame' && triggerMs - media * 1000 > CUT_FRAME_LOG_WINDOW_MS) { frameLog.earlier += 1; return; }
        frameLog.logged += 1;
        this.logSync('cut-frame', { triggerMs, mediaMs: Number.isFinite(media) ? media * 1000 : null, callbackAt,
          displayAt: Number.isFinite(meta?.expectedDisplayTime) ? meta.expectedDisplayTime : null, presentedFrames: Number.isSafeInteger(count) ? count : null,
          decision, frameMs: frameS * 1000, toleranceMs: 2, lateLimitMs: frameS * 500,
          ...(Number.isFinite(media) ? { untilTriggerMs: triggerMs - media * 1000 } : {}) });
      } : null;
      if (Number.isFinite(media)) {
        // Callbacks can skip frames under load; divide by the frames actually
        // presented, or a skipped callback doubles the estimate and cuts a frame early.
        if (previous !== null && media > previous) {
          const frames = Number.isSafeInteger(count) && Number.isSafeInteger(previousCount) && count > previousCount ? count - previousCount : 1;
          frame = Math.min(0.1, Math.max(0.008, (media - previous) / frames));
          // 0.65.7: native's frame length, for the 'precise' exit (observation only). 0.65.8: from
          // the last few frames (nativeFrameLengthMs), not this pair alone; the cut rule still uses
          // `frame`, unchanged.
          frameDeltasMs.push((media - previous) * 1000 / frames);
          if (frameDeltasMs.length > NATIVE_FRAME_SAMPLES) frameDeltasMs.shift();
          const frameMs = nativeFrameLengthMs(frameDeltasMs);
          if (frameMs !== null) this.nativeFrameMs = frameMs;
        }
        previous = media; previousCount = count;
        if (!player.paused && !player.seeking && player.playbackRate === 1) {
          if (media + frame >= trigger - 0.002) {
            const late = deferLateReveal === true && media * 1000 - triggerMs >= frame * 500;
            this.cutNow(plan, media * 1000, { reveal: !late && plan.holdOnly !== true, invokedAt: performance.now(), shownAt: Number.isFinite(meta?.expectedDisplayTime) ? meta.expectedDisplayTime : null });
            // 0.65.11: a cut that reveals the clip without ever having sent a
            // prediction (no earlier frame callback, so no pre-roll) starts the clip now, with a hard
            // audio step at full level, instead of leaving it paused and silent on its first frame until
            // the transition (behind this scene's source check) plays it. After cutNow, so the pause is
            // never delayed; the same audio condition as a predicted cut's audioEnd.
            if (!late && !plan.predicted && fadeNative && (this.nativeFadesAllowed() || crossfadeAllowed(this.document, this.crossfadeMs))) {
              plan.prerollAtCut = true;
              const at = epoch(performance.now());
              try { onPredict(at, at, { hard: true }); } catch {}
            }
            // Logged after the cut, so the pause is not delayed. 'missed': the cut came half a
            // frame or more after the trigger (whether or not this scene defers a late reveal).
            // 0.65.11 Fix 2: 'cut-trigger-frame': an on-time cut on a frame at or within 2 ms of the
            // trigger, which is already the first replaced picture and was presented before this
            // callback ran (seen in testing: one original sample). The rule is unchanged.
            if (logFrame) {
              const mediaMs = media * 1000;
              logFrame(mediaMs - triggerMs >= frame * 500 ? 'missed' : mediaMs >= triggerMs - 2 ? 'cut-trigger-frame' : 'cut', frame);
              this.logSync('cut-plan-end', { triggerMs, outcome: 'cut', ...frameLog, prerollAtCut: plan.prerollAtCut === true });
            }
            return;
          }
          const shownAt = meta.expectedDisplayTime ?? now, cutAt = shownAt + (trigger - media) * 1000;
          // Native stops on the callback of the last frame before the trigger, up
          // to a frame before cutAt; the audio fades must end there, not at cutAt.
          const lastFrameAt = shownAt + Math.max(0, Math.ceil((trigger - 0.002 - media) / frame) - 1) * frame * 1000;
          if (fadeNative) this.planNativeFadeOut(plan, lastFrameAt, frame * 1000);
          // The clip fades in when fades are on (the setting, a visible tab). With the setting
          // off (0.62.14) it still gets the time, to step from 0 to full at the cut with its
          // audio output already running (118-159 ms of silence otherwise).
          const fadesOn = this.nativeFadesAllowed(), visible = crossfadeAllowed(this.document, this.crossfadeMs);
          const audioEnd = fadeNative && (fadesOn || visible) ? lastFrameAt : null;
          plan.audioEndAt = fadesOn ? audioEnd : null;
          plan.predicted = true;
          try { if (audioEnd === null) onPredict(epoch(cutAt)); else if (fadesOn) onPredict(epoch(cutAt), epoch(audioEnd)); else onPredict(epoch(cutAt), epoch(audioEnd), { hard: true }); } catch {}
          logFrame?.('wait', frame);
        } else logFrame?.('ineligible', frame);
      } else logFrame?.('no-media', frame);
      plan.handle = player.requestVideoFrameCallback(onFrame);
    };
    const abort = () => { if (plan.done || this.plannedCut !== plan) return; plan.aborted = true; this.cancelPlannedCut(); try { onAbort(); } catch {} };
    plan.dispose = () => {
      // A plan that ends without its cut gives the volume back; a cut keeps the hold.
      if (!plan.cut && plan.fade && this.nativeFade === plan.fade) this.releaseNativeFade();
      if (!plan.cut && frameLog) this.logSync('cut-plan-end', { triggerMs, outcome: plan.aborted ? 'aborted' : 'cancelled', ...frameLog });
      try { if (plan.handle !== null) player.cancelVideoFrameCallback?.(plan.handle); } catch {}
      player.removeEventListener?.("pause", abort); player.removeEventListener?.("seeking", abort);
    };
    player.addEventListener?.("pause", abort); player.addEventListener?.("seeking", abort);
    this.plannedCut = plan;
    plan.handle = player.requestVideoFrameCallback(onFrame);
    return true;
  }

  // 0.66.2: a scene whose clip is not staged yet (staging still running, or failed) still stops
  // native on the last frame before its trigger, so the original never runs on visibly while the
  // unstaged path loads and shows the clip. Native's audio is not faded (no clip is pre-rolled to
  // fade against). The hold is the planned cut's own: the transition adopts it, and it is released
  // after 2 s if no transition takes it over.
  planHold(triggerMs, { onAbort = () => {}, onHoldReleased = null } = {}) {
    return this.planCut(triggerMs, { onAbort, onHoldReleased, fadeNative: false, holdOnly: true });
  }
  cutHoldOnly(triggerMs) { return this.cutHold?.triggerMs === triggerMs && this.cutHold.holdOnly === true; }

  // Start (or re-aim) the pre-cut fade, ending at endAt (the predicted last frame
  // before the trigger), once that is within one fade and two frames, so the next
  // frame callback cannot arrive inside the window.
  planNativeFadeOut(plan, endAt, frameMs) {
    const player = plan.player, fadeMs = this.crossfadeMs;
    if (plan.fade) {
      if (plan.fade.active) plan.fade.retime(endAt - fadeMs);
      return;
    }
    if (endAt - (this.fadeClock.now?.() ?? performance.now()) > fadeMs + 2 * frameMs) return;
    if (!this.nativeFadesAllowed() || !fadeableVolume(player)) {
      plan.fade = false;
      plan.fadeSkip = this.crossfadeEnabled === false || !(fadeMs > 0) ? 'disabled' : !this.nativeFadesAllowed() ? 'hidden-tab'
        : player.muted === true ? 'viewer-muted' : 'zero-volume';
      return;
    }
    this.releaseNativeFade();
    plan.fade = new VolumeRamp(player, { ...this.fadeClock, direction: 'out', level: player.volume, startAt: endAt - fadeMs,
      durationMs: fadeMs, autoRestoreMs: NATIVE_FADE_UNCLAIMED_RESTORE_MS });
    this.nativeFade = plan.fade;
  }

  cancelPlannedCut() {
    const plan = this.plannedCut; this.plannedCut = null;
    if (plan && !plan.done) { plan.done = true; plan.dispose(); }
  }

  cutNow(plan, frameTimeMs = null, { reveal = true, invokedAt = null, shownAt = null } = {}) {
    plan.done = true; plan.cut = true; plan.dispose(); this.plannedCut = null;
    const player = plan.player, host = this.stagedHost;
    let currentTimeMs = null;
    try { const value = player.currentTime * 1000; if (Number.isFinite(value)) currentTimeMs = value; } catch {}
    this.cutHold = { player, triggerMs: plan.triggerMs,
      observation: { currentTimeMs, frameTimeMs: Number.isFinite(frameTimeMs) ? frameTimeMs : null }, audioFade: this.entryAudioReport(plan),
      expiry: setTimeout(() => this.releaseCutHold(), 2000), ...(plan.onHoldReleased ? { onReleased: plan.onHoldReleased } : {}) };
    // 0.65.7 diagnostics: when the cut's native frame callback ran, and that frame's display time.
    if (Number.isFinite(invokedAt)) this.cutHold.frameCallback = { invokedAt, shownAt: Number.isFinite(shownAt) ? shownAt : null };
    if (plan.redeliverWake === true) this.cutHold.redeliverWake = true;
    player.pause();
    this.eventLog?.enabled && this.logSync('native-pause-issued', { via: plan.holdOnly === true ? 'planned-hold' : 'planned-cut', triggerMs: plan.triggerMs, mediaMs: currentTimeMs, frameMs: frameTimeMs, reveal });
    if (reveal) {
      // When the cover (with the staged clip on it) became visible: coveredDurationMs and
      // clipVisibleMs count from here (0.62.12), not from the transition's later cover step.
      this.cutHold.coveredAt = performance.now();
    } else if (plan.holdOnly === true) this.cutHold.holdOnly = true; // 0.66.2: nothing staged to reveal
    else this.cutHold.revealDeferred = true;
    // Keep the faded volume while paused; the mute step (or any cleanup) restores it.
    if (plan.fade && this.nativeFade === plan.fade) { plan.fade.hold(); plan.fade.claim(); }
    if (host && reveal) { host.dataset.nativeCovered = "true"; host.style.visibility = "visible"; host.style.opacity = "1"; this.eventLog?.enabled && this.logSync('cover-commit', { via: 'planned-cut', triggerMs: plan.triggerMs }); }
    this.cutHold.layout = this.layoutSnapshot(host, player);
    this.syncMark('cut', { clearAfterMs: 1000 });
    this.eventLog?.enabled && this.logSync('planned-cut-wake-sent', { triggerMs: plan.triggerMs, redeliver: plan.redeliverWake === true });
    for (const listener of this.stateSubscribers) { try { listener({ currentTimeMs: plan.triggerMs, paused: false, event: "planned-cut" }); } catch {} }
  }

  // Diagnostics for one entry, times relative to the cut (native's stop; 0).
  entryAudioReport(plan) {
    const cutAt = this.fadeClock.now?.() ?? performance.now(), at = value => Number.isFinite(value) ? Math.round((value - cutAt) * 10) / 10 : null;
    const fadeMs = this.crossfadeMs;
    const clip = Number.isFinite(plan.audioEndAt) ? { status: 'planned', startMs: at(plan.audioEndAt - fadeMs), endMs: at(plan.audioEndAt) }
      : { status: 'skipped', reason: plan.fadeSkip === 'hidden-tab' || plan.fadeSkip === 'disabled' ? plan.fadeSkip : (this.nativeFadesAllowed() ? 'no-prediction' : 'disabled-or-hidden') };
    if (!plan.fade) return { native: { status: 'skipped', reason: plan.fadeSkip ?? 'cut-before-fade-window' }, clip };
    const ramp = plan.fade.report();
    let gainAtCut = null; try { gainAtCut = plan.fade.level > 0 ? Math.round(plan.player.volume / plan.fade.level * 1000) / 1000 : null; } catch {}
    const status = ramp.state === 'released' || ramp.state === 'restored' ? 'skipped' : ramp.startAt === null || cutAt < ramp.startAt ? 'not-started' : 'ran';
    return { native: { status, ...(status === 'skipped' ? { reason: 'volume-changed' } : {}), startMs: at(ramp.startAt), endMs: at(ramp.endAt), gainAtCut }, clip };
  }

  // The scheduled wake coordinate is not a measurement of the native clock.
  // Read this before snapshot adoption consumes the hold; never reuse another cut.
  cutObservation(triggerMs) {
    return this.cutHold?.triggerMs === triggerMs ? { ...this.cutHold.observation } : null;
  }

  // 0.62.18 diagnostics: the cover's and native's layer state, and their rectangles.
  layoutSnapshot(host, player) {
    const rect = node => { try { const r = node?.getBoundingClientRect?.(); return r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null; } catch { return null; } };
    let native = null;
    try {
      const style = this.document.defaultView?.getComputedStyle?.(player);
      if (style) native = { visibility: style.visibility, opacity: style.opacity, display: style.display };
    } catch {}
    return { host: host ? { visibility: host.style.visibility || null, opacity: host.style.opacity || null, rect: rect(host) } : null,
      native: { ...(native ?? {}), rect: rect(player) } };
  }

  cutLayout(triggerMs) { return this.cutHold?.triggerMs === triggerMs && this.cutHold.layout ? structuredClone(this.cutHold.layout) : null; }

  cutCoveredAt(triggerMs) {
    return this.cutHold?.triggerMs === triggerMs && Number.isFinite(this.cutHold.coveredAt) ? this.cutHold.coveredAt : null;
  }

  // 0.65.7: a late short-gap cut that paused native without revealing the clip (deferLateReveal).
  cutRevealDeferred(triggerMs) { return this.cutHold?.triggerMs === triggerMs && this.cutHold.revealDeferred === true; }

  cutFrameCallback(triggerMs) { return this.cutHold?.triggerMs === triggerMs && this.cutHold.frameCallback ? { ...this.cutHold.frameCallback } : null; }

  // 0.65.8: what a playback sample reports. Native's own state, except while a hand-over's cut hold
  // (redeliverWake) waits for the transition to take it over: then the cut's wake-up again, as the
  // cut itself sent it (native is paused by the cut; the viewer is playing).
  sampledState(state) {
    const hold = this.cutHold;
    return hold?.redeliverWake === true ? { currentTimeMs: hold.triggerMs, paused: false, event: "planned-cut" } : state;
  }

  cutAudioFade(triggerMs) {
    return this.cutHold?.triggerMs === triggerMs && this.cutHold.audioFade ? structuredClone(this.cutHold.audioFade) : null;
  }

  adoptCutHold() {
    const hold = this.cutHold; this.cutHold = null;
    if (hold) clearTimeout(hold.expiry);
  }

  // Exit side of a seamless cut: the clip ends at endAtMs (epoch). Start native,
  // still covered, early by its start-up latency; on its first frame at or after
  // the join uncover it in the same task. restore() then finds native already
  // running. null withdraws a pending start.
  //
  // E58 exit (0.62.7): with fades on, the engine seeks native handleMs *before*
  // the join (exitHandleMs). Native then starts handleMs earlier still, at zero
  // volume and unmuted, and fades up over [end - crossfadeMs, end] while the clip
  // fades down over the same window: the overlap uses native's own audio just
  // before the join (under the cover, at low gain), so at the clip's end native
  // is at full level and exactly at the join. The cover stays until the first
  // frame at or after the join, so no earlier frame is shown and picture timing
  // is unchanged. In 0.62.6 native only began at end - lead and its fade waited
  // for the clock, so the clip had faded out before native was audible: a dip.
  //
  // 0.62.11: with the handle gone the picture path is 0.62.5's again (seek at the join,
  // start lead ms early, uncover on the first frame). Audio only: native plays unmuted
  // at zero and its gain follows its own media clock (MediaTimeRamp), never wall time;
  // onAhead(ms) reports native at full level that long before the clip's end.
  prerollNative(endAtMs, { joinMs = null, handleMs = 0, parkMs = 0 } = {}) {
    const pending = this.nativePreroll;
    if (endAtMs === null) {
      if (pending && !pending.uncovered) pending.cancel();
      return false;
    }
    if (pending?.started) return false;
    if (pending) clearTimeout(pending.timer);
    const snapshot = this.boundSnapshot, record = snapshot && this.snapshotRecords.get(snapshot);
    const host = this.overlayHost;
    if (!record || record.token !== this.snapshotToken || record.token.prerollWithdrawn || !host || snapshot.paused) return false;
    const token = this.snapshotToken;
    let player; try { player = this.player(); } catch { return false; }
    if (typeof player.requestVideoFrameCallback !== "function") return false;
    // 0.62.15: not the learned first-frame time (it flipped between 30 and 90, and 30 left
    // native inaudible until after the clip's audio had ended). 0.65.6: at least that fixed
    // lead, longer when paused-at-join exits measured a slower start-up (exitPrerollLeadMs).
    // 0.65.8: every Exit reveal policy, 'precise' included, uses this lead (0.65.7's shorter
    // precise lead is retired); 'precise' keeps its reveal gate, which needs native's frame length.
    const frameMs = Number.isFinite(this.nativeFrameMs) && this.nativeFrameMs > 0 ? this.nativeFrameMs : EXIT_PRECISE_DEFAULT_FRAME_MS;
    const lead = exitPrerollLeadMs(this.exitStartLatencies);
    const handle = Number.isFinite(joinMs) && Number.isFinite(handleMs) && handleMs > 0 ? handleMs : 0;
    const joinSeconds = Number.isFinite(joinMs) ? joinMs / 1000 : null;
    // 0.66.2: native was parked this far before the join (exitParkMs) and starts at the usual lead.
    const park = Number.isFinite(joinMs) && Number.isFinite(parkMs) && parkMs > 0 ? parkMs : 0;
    const endAt = endAtMs - performance.timeOrigin; // performance.now() clock
    const preroll = { started: false, uncovered: false, cancelled: false, frame: null, token, endAt, joinMs, handleMs: handle, parkMs: park,
      firstFrameMediaTimeMs: null, uncoverFrameMediaTimeMs: null };
    // Not warmed after the join seek (no seek, or a very short clip): warm now if the
    // clip's end is still at least EXIT_WARM_MIN_LEAD_MS away; otherwise the 0.62.13 path.
    if (this.nativeWarm?.token !== token && endAt - performance.now() >= EXIT_WARM_MIN_LEAD_MS) this.warmNativeOutput('early', endAtMs);
    // Whether native will fade in (the renderer then fades the clip out to match).
    const skip = this.nativeFadeSkipReason(player, snapshot);
    preroll.fadePlanned = skip === null;
    preroll.audio = skip === null ? { status: 'planned' } : { status: 'skipped', reason: skip };
    const ownsPlayer = () => this.snapshotToken === token && !record.released && this.contextValid &&
      this.passiveAdapter.activePlayer() === player && this.overlayHost === host;
    preroll.cancel = () => {
      if (preroll.cancelled) return;
      preroll.cancelled = true;
      clearTimeout(preroll.timer); clearTimeout(preroll.fallback); preroll.stopEvents?.(); preroll.stopPlaying?.();
      preroll.clearConfirm?.();
      if (preroll.frame !== null) { try { player.cancelVideoFrameCallback?.(preroll.frame); } catch {} preroll.frame = null; }
      if (preroll.fade && this.nativeFade === preroll.fade) this.releaseNativeFade();
      if (preroll.fadePlanned) preroll.audio = { status: 'skipped', reason: 'preroll-withdrawn' };
      if (preroll.started && ownsPlayer()) {
        // Native may already have advanced. Keep the local clip visible and let
        // normal restore seek to the exact join; another pre-roll cannot reuse it.
        token.prerollWithdrawn = true;
        this.clearCompletedSeek();
        player.pause();
        // Back under the mute ledger, which unmutes it at the normal restore.
        if (preroll.fade || preroll.warm) player.muted = true;
        if (preroll.warm && this.nativeWarm === preroll.warm) this.nativeWarm = null;
      }
      if (this.nativePreroll === preroll) this.nativePreroll = null;
      preroll.resolveFirstFrame?.({ status: 'preroll-withdrawn', frameWaitMs: null, compositorWaitMs: null });
    };
    preroll.firstFrame = new Promise(resolve => { preroll.resolveFirstFrame = resolve; });
    const start = () => {
      if (this.nativePreroll !== preroll || !ownsPlayer() || !player.paused || player.seeking) {
        if (this.nativePreroll === preroll) this.nativePreroll = null;
        if (preroll.fadePlanned) preroll.audio = { status: 'skipped', reason: 'native-not-ready' };
        return;
      }
      // Native must actually wait handleMs before the join; if it sits nearer
      // (a clamped or skipped seek), start later by the difference so its join
      // frame still lands at the clip's end.
      if (handle > 0 && !preroll.realigned) {
        preroll.realigned = true;
        const ahead = joinMs - player.currentTime * 1000;
        const missing = handle - Math.max(0, Math.min(handle, Number.isFinite(ahead) ? ahead : 0));
        if (missing > 4) { preroll.timer = setTimeout(start, missing); return; }
      }
      // 0.66.2: parked before the join, native would be heard there at the viewer's level unless
      // it is muted or held at -60 dB until its ramp. If neither holds any more (Smooth audio went
      // off, the tab was hidden), it is not started early: the normal restore seeks it to the join.
      // Nor when it is not silent right now: a warm-up made while Smooth audio was off or the tab
      // hidden (during the awaited join seek) unmuted native at the viewer's level with no hold,
      // and a later switch back makes a fade look possible again. Silent means still muted (the
      // ramp starts at 0 before the unmute) or held at -60 dB by this transition's own warm hold.
      if (park > 0 && snapshot.muted !== true) {
        const hold = this.nativeWarm?.player === player && this.nativeWarm.token === token ? this.nativeWarm.hold : null;
        let silent = false;
        try { silent = player.muted === true || (hold?.active === true && !hold.changedExternally()); } catch {}
        const skip = this.nativeFadeSkipReason(player, snapshot);
        if (skip !== null || !silent) {
          if (this.nativePreroll === preroll) this.nativePreroll = null;
          if (preroll.fadePlanned || skip === null) preroll.audio = { status: 'skipped', reason: skip === null ? 'parked-audible' : 'parked-without-fade' };
          return;
        }
      }
      preroll.started = true;
      const startedAt = performance.now();
      preroll.playAt = startedAt;
      // E72: the policy this exit uses, where native sits paused (its first *new* frame is any
      // later one) and the diagnostics recorded for it.
      preroll.revealPolicy = this.exitReveal;
      if (preroll.revealPolicy === 'precise') preroll.revealFrameMs = frameMs;
      { const ms = player.currentTime * 1000; preroll.pausedMediaMs = Number.isFinite(ms) ? ms : null; }
      preroll.quality = { start: playbackQuality(player) };
      if (this.longFrames === undefined) this.longFrames = longFrameLog(this.document.defaultView);
      preroll.syncLog = [];
      const sync = name => { const at = this.syncMark(name); if (at !== null) preroll.syncLog.push([name, Math.round((at - endAt) * 10) / 10]); };
      preroll.sync = sync;
      sync('preroll');
      if (preroll.fadePlanned) {
        const late = this.nativeFadeSkipReason(player, snapshot);
        if (late !== null) { preroll.fadePlanned = false; preroll.audio = { status: 'skipped', reason: late }; }
      }
      preroll.leadMs = Math.round(lead + handle);
      this.watchExitEvents(preroll, player, joinMs);
      // 0.62.18: at every exit the picture was black for 1-2 frames when the cover
      // went, although native had presented frames. Nothing of ours hides native; it sits under
      // an opaque cover, and Chrome does not keep compositing a fully covered video. So from
      // native's start the cover is made very slightly translucent (0.999: invisible), which
      // keeps native drawn underneath; the uncover then also waits for two animation frames
      // after that, so only our layer is removed from an already painted picture.
      preroll.layers = { prerollStart: this.layoutSnapshot(host, player) };
      host.style.opacity = String(EXIT_COVER_PRE_REVEAL_OPACITY);
      preroll.rafReady = false;
      const view = this.document.defaultView;
      if (typeof view?.requestAnimationFrame === 'function') {
        let frames = 0;
        // E72: also logs each animation frame (ms from the clip's end) until the uncover.
        preroll.rafLog = [];
        const count = timestamp => {
          if (preroll.cancelled || preroll.uncovered) return;
          frames += 1; if (frames >= 2) preroll.rafReady = true;
          if (Number.isFinite(timestamp) && preroll.rafLog.length < 24) preroll.rafLog.push(Math.round((timestamp - endAt) * 10) / 10);
          if (frames < 2 || preroll.rafLog.length < 24) view.requestAnimationFrame(count);
        };
        view.requestAnimationFrame(count);
      } else preroll.rafReady = true;
      // 0.62.12: nothing here differs from Smooth audio off. Native starts muted and its
      // volume is untouched until the uncover (unmuting at volume 0 before
      // play() delayed native's first frame by ~50 ms, and the learned lead then started
      // every later pre-roll ~30 ms earlier than with the setting off).
      // 0.62.13: the ramp starts on native's 'playing' event (it is then still covered,
      // ~28-40 ms before the clip's end), so it overlaps the clip's 30 ms end fade. Only
      // after 'playing': touching muted/volume before play() delayed the first frame in
      // 0.62.11. If 'playing' never comes, it starts at the uncover (0.62.12).
      const startNativeFade = trigger => {
        if (!preroll.fadePlanned || preroll.fade) return false;
        const late = this.nativeFadeSkipReason(player, snapshot);
        if (late !== null) { preroll.fadePlanned = false; preroll.audio = { status: 'skipped', reason: late }; return false; }
        // A warm hold (volume 0) is handed over, never restored in between (that would be audible).
        const warm = this.nativeWarm?.player === player && this.nativeWarm.hold?.active && !this.nativeWarm.hold.changedExternally() ? this.nativeWarm.hold : null;
        if (warm && this.nativeFade === warm) this.nativeFade = null;
        this.releaseNativeFade();
        const media = () => { const ms = player.currentTime * 1000; return Number.isFinite(ms) ? ms : null; };
        // Media-time ramp from max(join, where native is now): unparked, never audible before
        // the join. Parked, from max(join + EXIT_PARK_AUDIO_START_MS, where native is now). A
        // stalled clock holds the gain. Far ahead of the join: a fast ramp.
        const now = media(), join = Number.isFinite(joinMs) ? joinMs : now ?? 0;
        const base = Math.max(join + (park > 0 ? EXIT_PARK_AUDIO_START_MS : EXIT_NATIVE_START_MS), now ?? -Infinity);
        const rampMs = Number.isFinite(now) && now - join > EXIT_FAR_AHEAD_MS ? EXIT_NATIVE_FAST_RAMP_MS : EXIT_NATIVE_RAMP_MS;
        // 0.66.2 (exit dropout), parked only: while native's clock is advancing, its ramp is never
        // below a wall-time ramp over the clip's own fade window (see EXIT_PARK_AUDIO_START_MS).
        // `last` is native's clock at the previous reading: no advance since then, no floor, so a
        // clock that has not started or has stalled holds the gain exactly as before. The report
        // says when the clock was first seen advancing (clockMovingMs) and whether the floor ever
        // raised the gain (wallFloor).
        const wallFrom = endAt - (EXIT_CLIP_TAIL_MARGIN_MS + EXIT_CLIP_FADE_MS);
        let last = Number.isFinite(now) ? now : null;
        const withWallFloor = (m, p) => {
          const moving = last !== null && m > last; last = m;
          if (!moving) return p;
          const t = this.fadeClock.now?.() ?? performance.now();
          preroll.fadeClockMovingAt ??= t;
          const wall = (t - wallFrom) / EXIT_CLIP_FADE_MS;
          if (!(wall > p)) return p;
          if (wall > 0) preroll.fadeWallFloor = true;
          return wall;
        };
        // A warm hold already keeps native at 0: take the viewer's level from it.
        const level = warm ? warm.level : player.volume;
        if (warm) warm.abandon();
        preroll.fadeTrigger = trigger; preroll.fadeRampMs = rampMs;
        preroll.fadeBaseMediaMs = Number.isFinite(base) && Number.isFinite(joinMs) ? Math.round(base - joinMs) : null;
        preroll.fade = new MediaTimeRamp(player, { ...this.fadeClock, level, deadlineMs: EXIT_NATIVE_DEADLINE_MS, floor: warm ? EXIT_SILENT_GAIN : 0,
          progress: () => {
            if (player.paused || player.seeking) return null;
            const m = media();
            if (m === null) return null;
            const p = (m - base) / rampMs;
            return park > 0 ? withWallFloor(m, p) : p;
          },
          onFull: at => { preroll.fullAt = at; const early = endAt - at; if (early > EXIT_AHEAD_TOLERANCE_MS) preroll.aheadMs = Math.round(early); },
          // Diagnostics: native's media clock at each volume change.
          trace: media });
        this.nativeFade = preroll.fade;
        preroll.audio = { status: 'running' };
        return true;
      };
      const onPlaying = () => {
        player.removeEventListener?.('playing', onPlaying);
        preroll.playingAt ??= performance.now(); // 0.62.16 diagnostics: native's actual start
        if (preroll.cancelled || preroll.uncovered || this.nativePreroll !== preroll || !ownsPlayer()) return;
        // Volume 0 first (written by the ramp), then audible, in this same task.
        if (startNativeFade('playing')) {
          player.muted = snapshot.muted === true;
          preroll.unmutedAt = this.fadeClock.now?.() ?? performance.now();
          preroll.markEvent?.('unmute');
        }
      };
      preroll.stopPlaying = () => player.removeEventListener?.('playing', onPlaying);
      const uncover = status => {
        if (preroll.uncovered || this.nativePreroll !== preroll || !ownsPlayer()) return;
        clearTimeout(preroll.fallback); preroll.clearConfirm?.();
        // Restore can run well after pre-roll has revealed native. Retain the
        // position at this actual uncover for the receipt, not the later one.
        const positionMs = player.currentTime * 1000;
        preroll.timeAtUncoverMs = Number.isFinite(positionMs) ? positionMs : null;
        if (preroll.layers) preroll.layers.beforeUncover = this.layoutSnapshot(host, player);
        host.style.visibility = "hidden"; host.dataset.nativeCovered = "false";
        preroll.uncoveredAt = performance.now();
        // 0.66.2: how long after play() native's clock effectively started: play() to the clip's
        // end, less the media native covered by then (its position now, taken back to the clip's
        // end). The next exits park native by lead - this (exitParkMs). Frame uncovers only.
        if (!preroll.uncoverViaFallback && Number.isFinite(preroll.timeAtUncoverMs) && Number.isFinite(preroll.pausedMediaMs) && Number.isFinite(preroll.playCallAt)) {
          const advancedAtEnd = preroll.timeAtUncoverMs - preroll.pausedMediaMs - (preroll.uncoveredAt - endAt);
          const delay = Math.round((endAt - preroll.playCallAt - advancedAtEnd) * 10) / 10;
          preroll.clockDelayMs = delay;
          if (delay >= 0) this.exitClockDelays = [...(this.exitClockDelays ?? []), Math.min(delay, EXIT_PARK_DELAY_MAX_MS)].slice(-8);
        }
        this.eventLog?.enabled && this.logSync('uncover-commit', { via: 'exit-preroll', status, joinMs, mediaMs: preroll.timeAtUncoverMs });
        if (preroll.quality) preroll.quality.uncover = playbackQuality(player);
        if (preroll.sync) { preroll.sync('uncover'); if (this.syncPatch) this.syncPatchTimer = setTimeout(() => this.syncMark(null), 1000); }
        // Fallback when 'playing' did not come first: the ramp starts here, at volume 0, just
        // before the unmute that happens at this moment either way (0.62.12 behaviour).
        preroll.stopPlaying?.();
        if (startNativeFade('uncover')) preroll.unmutedAt = this.fadeClock.now?.() ?? performance.now();
        // Smooth audio off without a warm-up unmutes here (0.62.5); record it the same way.
        if (!Number.isFinite(preroll.unmutedAt) && player.muted === true && snapshot.muted !== true) preroll.unmutedAt = this.fadeClock.now?.() ?? performance.now();
        player.muted = snapshot.muted === true;
        preroll.uncovered = true;
        preroll.markEvent?.('uncover');
        preroll.frameWaitMs = performance.now() - startedAt;
        preroll.resolveFirstFrame({ status, frameWaitMs: preroll.frameWaitMs, compositorWaitMs: 0 });
      };
      const onFrame = (now, meta) => {
        preroll.frame = null;
        if (preroll.cancelled || this.nativePreroll !== preroll || !ownsPlayer()) return;
        const media = meta?.mediaTime;
        if (preroll.firstFrameMediaTimeMs === null) {
          // Start-up latency is to native's first frame, wherever it starts.
          this.nativeStartLatencyMs = Math.min(250, Math.max(30, (meta?.expectedDisplayTime ?? now) - startedAt));
          // 0.65.6: play() to this first frame's display, from a pause at the join with no handle
          // (the start-up the exit lead covers); kept for the next exits' lead.
          const shown = meta?.expectedDisplayTime ?? now;
          if (Number.isFinite(preroll.playCallAt) && Number.isFinite(shown)) preroll.startLatencyMs = Math.round((shown - preroll.playCallAt) * 10) / 10;
          if (preroll.warm?.mode === 'paused-at-join' && handle === 0 && Number.isFinite(preroll.playCallAt) && Number.isFinite(shown) && shown > preroll.playCallAt) {
            this.exitStartLatencies = [...(this.exitStartLatencies ?? []), Math.round((shown - preroll.playCallAt) * 10) / 10].slice(-8);
          }
          preroll.firstFrameMediaTimeMs = Number.isFinite(media) ? media * 1000 : null;
          this.eventLog?.enabled && this.logSync('native-first-frame', { via: 'exit-preroll', callbackAt: now, displayAt: meta?.expectedDisplayTime ?? null, joinMs, mediaMs: preroll.firstFrameMediaTimeMs });
          if (preroll.quality) preroll.quality.first = playbackQuality(player);
          preroll.sync?.('first');
        }
        // Frames of the handle before the join stay under the cover.
        if (handle > 0 && joinSeconds !== null) {
          const position = Number.isFinite(media) ? media : player.currentTime;
          if (Number.isFinite(position) && position < joinSeconds - 0.012) {
            try { preroll.frame = player.requestVideoFrameCallback(onFrame); } catch { uncover("prerolled"); }
            return;
          }
        }
        // 0.62.17: uncover only inside a fresh native frame callback that is (a) at or after the
        // clip's end less EXIT_UNCOVER_NOT_BEFORE_MS, (b) at or after the join and (c) newer
        // than native's first presented frame (its clock is moving). Never on a bare timer:
        // 0.62.16 released on a timer between frames (possible flash). The
        // 300 ms fallback below still bounds the cover.
        const wall = this.fadeClock.now?.() ?? performance.now(), mediaMs = Number.isFinite(media) ? media * 1000 : null;
        preroll.frameLog ??= [];
        if (preroll.frameLog.length < 24) preroll.frameLog.push([Math.round((wall - endAt) * 10) / 10,
          mediaMs !== null && Number.isFinite(joinMs) ? Math.round((mediaMs - joinMs) * 10) / 10 : null,
          Number.isSafeInteger(meta?.presentedFrames) ? meta.presentedFrames : null]);
        let late, atJoin, moving;
        if (preroll.revealPolicy === 'precise') {
          // 0.65.7 X1: "late enough" is judged by when this frame will be shown (its
          // expectedDisplayTime, else the callback time): at least the clip's end less half a native
          // frame, so the clip's last frame keeps its display slot and a correct frame that arrives
          // early is not thrown away. The target is the frame at the join: any frame at or after
          // the join less 1 ms, including the paused join frame itself; never one before it.
          const shownAt = Number.isFinite(meta?.expectedDisplayTime) ? meta.expectedDisplayTime : now;
          late = Number.isFinite(shownAt) && shownAt >= endAt - preroll.revealFrameMs / 2 && preroll.rafReady !== false;
          atJoin = mediaMs === null || !Number.isFinite(joinMs) || mediaMs >= joinMs - 1;
          moving = true;
        } else {
          late = wall >= endAt - EXIT_UNCOVER_NOT_BEFORE_MS && preroll.rafReady !== false;
          atJoin = mediaMs === null || !Number.isFinite(joinMs) || mediaMs >= joinMs;
          // 0.64.3 (E72): with Exit reveal 'new', "newer" means newer than native's paused position,
          // so native's first new frame (the expected next picture) reveals it; a re-presented
          // paused frame still never does. 'previous' keeps 0.62.17's "newer than the first frame".
          moving = mediaMs === null || (preroll.revealPolicy === 'new' && Number.isFinite(preroll.pausedMediaMs)
            ? mediaMs > preroll.pausedMediaMs + 1
            : preroll.firstFrameMediaTimeMs === null || mediaMs > preroll.firstFrameMediaTimeMs);
        }
        if (!(late && atJoin && moving)) {
          try { preroll.frame = player.requestVideoFrameCallback(onFrame); } catch { uncover("prerolled"); }
          return;
        }
        preroll.uncoverFrameMediaTimeMs = mediaMs;
        preroll.uncoverFrameAt = wall;
        if (park > 0) { confirmUncover(now, meta); return; }
        uncover("prerolled");
      };
      // 0.66.2 (parked exits only): the qualifying frame's callback runs when that frame is handed
      // to the compositor, not when it is on screen, and the cover's removal is committed on its
      // own. Lifting inside the callback could show one display refresh of the frame before it,
      // which after a park is a picture of the removed scene (unparked it is the paused join frame).
      // So the cover stays until the frame is certainly shown: native's next frame callback, or
      // the first animation frame at least one display refresh after the qualifying frame's
      // expected display time, whichever comes first; a short timeout bounds the wait.
      const confirmUncover = (now, meta) => {
        const from = performance.now(), view = this.document.defaultView;
        const shownAt = Number.isFinite(meta?.expectedDisplayTime) ? meta.expectedDisplayTime : Number.isFinite(now) ? now : from;
        const pending = { raf: null, timer: null };
        preroll.clearConfirm = () => {
          preroll.clearConfirm = null;
          clearTimeout(pending.timer);
          if (pending.raf !== null) { try { view?.cancelAnimationFrame?.(pending.raf); } catch {} pending.raf = null; }
          if (preroll.frame !== null) { try { player.cancelVideoFrameCallback?.(preroll.frame); } catch {} preroll.frame = null; }
        };
        const lift = via => {
          if (preroll.clearConfirm === null || preroll.cancelled || preroll.uncovered || this.nativePreroll !== preroll || !ownsPlayer()) return;
          preroll.confirmVia = via; preroll.confirmMs = performance.now() - from;
          uncover("prerolled");
        };
        pending.timer = setTimeout(() => lift('timeout'), EXIT_UNCOVER_CONFIRM_TIMEOUT_MS);
        try { preroll.frame = player.requestVideoFrameCallback(() => { preroll.frame = null; lift('frame'); }); } catch {}
        if (typeof view?.requestAnimationFrame === 'function') {
          const tick = timestamp => {
            pending.raf = null;
            if (preroll.clearConfirm === null || preroll.cancelled || preroll.uncovered) return;
            if ((Number.isFinite(timestamp) ? timestamp : performance.now()) >= shownAt + EXIT_UNCOVER_CONFIRM_DISPLAY_MS - 1) { lift('raf'); return; }
            pending.raf = view.requestAnimationFrame(tick);
          };
          pending.raf = view.requestAnimationFrame(tick);
        }
      };
      preroll.frame = player.requestVideoFrameCallback(onFrame);
      // If no frame callback arrives, do not hold the cover for the full restore timeout.
      // 0.66.2: parked, a clock still before the join gets one more wait (the rest of the way plus
      // 100 ms) before the cover goes whatever native shows.
      const fallback = () => {
        if (player.paused) return;
        const behind = park > 0 && !preroll.fallbackExtended ? joinMs - player.currentTime * 1000 : 0;
        if (behind > 12) { preroll.fallbackExtended = true; preroll.fallback = setTimeout(fallback, Math.min(400, behind + 100)); return; }
        preroll.uncoverViaFallback = true; uncover("prerolled-without-frame-callback");
      };
      preroll.fallback = setTimeout(fallback, 300 + handle + park);
      // Warmed (0.62.14): native is already unmuted with its output running. With Smooth
      // audio on, the media-time ramp takes over from the warm hold now (still 0 until
      // native's media moves past max(join, where it is)); with it off, native simply
      // sounds from its first played sample. Either way nothing changes before play().
      const warm = this.nativeWarm?.player === player && this.nativeWarm.token === token ? this.nativeWarm : null;
      if (warm) {
        preroll.warm = warm; preroll.unmutedAt = warm.at;
        if (warm.smooth) startNativeFade('warm');
      }
      // Listening changes nothing on the element; the handler runs only after 'playing'.
      player.addEventListener?.('playing', onPlaying);
      preroll.playCallAt = performance.now();
      this.eventLog?.enabled && this.logSync('native-play-issued', { via: 'exit-preroll', leadMs: preroll.leadMs, joinMs, mediaMs: preroll.pausedMediaMs });
      void player.play().then(() => {
        if (preroll.cancelled && ownsPlayer() && !token.cleanupController) player.pause();
      }, () => {});
    };
    preroll.timer = setTimeout(start, Math.max(0, endAtMs - lead - handle - (performance.timeOrigin + performance.now())));
    this.nativePreroll = preroll;
    return true;
  }

  // A cut the transition never took over (for example a seek at that instant)
  // must not leave native paused and covered.
  releaseCutHold() {
    const hold = this.cutHold; if (!hold) return;
    this.cutHold = null; clearTimeout(hold.expiry);
    if (this.nativeFade?.element === hold.player) this.releaseNativeFade();
    // A hold-only cut never revealed the host: a host staged since then stays as staged (0.66.2).
    if (this.stagedHost && hold.holdOnly !== true) { this.stagedHost.style.visibility = "hidden"; this.stagedHost.dataset.nativeCovered = "false"; }
    try { void hold.player.play?.()?.catch?.(() => {}); } catch {}
    // 0.65.11: the engine stops a clip it started for this cut (onHoldReleased), so a clip pre-rolled
    // for a cut the transition never took over is not left playing under the hidden host.
    try { hold.onReleased?.(); } catch {}
  }

  // 0.66.2 (keepCutHold): a hold-only cut (planHold) that has already stopped native stays in
  // force while the unfinished stage is discarded; the transition that asked adopts it.
  unstageOverlayHost({ keepCutHold = false } = {}) {
    this.cancelPlannedCut();
    if (this.cutHold && !this.overlayHost && !(keepCutHold === true && this.cutHold.holdOnly === true)) this.releaseCutHold();
    const host = this.stagedHost;
    if (!host) return false;
    this.stagedHost = null;
    if (this.overlayHost) return false;
    this.beforeHostTeardown?.();
    this.presentation.dispose();
    host.remove();
    return true;
  }

  async mountOverlayHost() {
    const staged = this.stagedHost;
    this.stagedHost = null;
    if (staged?.isConnected && this.presentation.host === staged) {
      this.overlayHost = staged;
      return staged;
    }
    this.teardownOverlayHost();
    this.overlayHost = this.mountHiddenHost();
    return this.overlayHost;
  }

  async setNativeCovered(covered) {
    if (covered && !this.overlayHost?.isConnected) throw new Error("Local overlay host is not connected");
    if (this.overlayHost) {
      this.overlayHost.dataset.nativeCovered = String(covered);
      this.overlayHost.style.visibility = covered ? 'visible' : 'hidden';
      if (covered) { this.overlayHost.style.opacity = '1'; this.coverShownAt = performance.now(); }
      this.eventLog?.enabled && this.logSync(covered ? 'cover-commit' : 'uncover-commit', { via: 'transition' });
    }
  }

  // 0.65.7 short-gap priming (keepHost): a successful restore keeps the hidden cover host as the
  // next scene's staged host instead of removing it (the renderer stays in it). Any failure removes
  // it exactly as before. Without the option nothing changes. 0.65.10: the kept host is hidden at
  // opacity 0, like any staged host, so its renderer keeps presenting frames.
  //
  // 0.66.2 (parkedJoin, passed only by a failed or cancelled transition): the join seek parked
  // native before the join ({ joinMs, parkMs }). If native still sits in that parked stretch
  // (paused there, or started by the pre-roll and not yet at the join), uncovering it would show
  // and play removed footage. It is then taken to the engine's target, or to the join when the
  // engine keeps native's own time (a viewer seek, a source or page change). Wherever else native
  // is, somebody else moved it (the viewer's own seek target): it is left alone, as before.
  async restore(snapshot, { targetTimeMs, resumePlayback = !snapshot?.paused, awaitPresentedFrame = false, signal, keepHost = false, parkedJoin = null } = {}) {
    const record = this.snapshotRecords.get(snapshot);
    if (!record || record.token !== this.snapshotToken) throw abortError('Native restore snapshot is stale or unknown');
    if (record.released) return { presentation: 'already-restored', timeAtUncoverMs: null, errorMs: null };
    record.token.cleanupController?.abort(abortError('Native restoration superseded'));
    const cleanupController = new AbortController(); record.token.cleanupController = cleanupController;
    signal = signal ? AbortSignal.any([signal, cleanupController.signal]) : cleanupController.signal;
    const assertCleanup = () => {
      assertActive(signal);
      if (this.snapshotToken !== record.token || record.token.cleanupController !== cleanupController) throw abortError('Native restoration superseded');
    };
    // Before the mute ledger is restored: a withdrawn pre-roll goes back under it.
    const rejoinMs = this.parkedRecoveryTargetMs(record, parkedJoin, targetTimeMs);
    if (rejoinMs !== null) targetTimeMs = rejoinMs;
    // A cut's held fade-out never outlives the transition.
    this.releaseNativeFade('out');
    let firstError = null;
    let presentation = 'not-requested', timeAtUncoverMs = null;
    let presentationWait = null;
    let frameWaitMs = null, compositorWaitMs = null, nativeResumeMs = null, audioFade = null, uncoveredAtMs = null, keptHost = null;
    // A kept host is released on any failure below, as the finally would have done.
    const releaseKeptHost = () => { if (keptHost && this.overlayHost === keptHost) this.teardownOverlayHost(); keptHost = null; };
    const frameController = new AbortController();
    const abortFrame = () => frameController.abort(signal?.reason ?? abortError());
    signal?.addEventListener('abort', abortFrame, {once:true});
    if (signal?.aborted) abortFrame();
    if (!awaitPresentedFrame) {
      try {
        await record.ledger.restore({ signal, assertCurrent: assertCleanup });
      } catch (error) {
        firstError = error;
      }
    }
    // Native already started from the join under the cover (prerollNative).
    const prerolled = this.nativePreroll?.started && this.nativePreroll.token === record.token ? this.nativePreroll : null;
    if (this.nativePreroll && !prerolled) { clearTimeout(this.nativePreroll.timer); this.nativePreroll = null; }
    try {
      assertCleanup();
      if (!prerolled && Number.isFinite(targetTimeMs) && this.contextValid &&
          !(awaitPresentedFrame && this.canReuseCompletedSeek(targetTimeMs))) await this.seek(targetTimeMs, signal);
    } catch (error) {
      firstError ??= error;
    }
    try {
      assertCleanup();
      // A hidden document presents no frames; waiting would only hold native
      // muted for the full timeout after every clip.
      if (awaitPresentedFrame && resumePlayback && this.document.visibilityState === "hidden") presentation = 'hidden-document';
      else if (awaitPresentedFrame && resumePlayback && prerolled) {
        presentationWait = Promise.race([prerolled.firstFrame, new Promise(resolve => setTimeout(() => resolve(null), this.presentationTimeoutMs))])
          .then(value => value ? { value } : { error: Object.assign(Error("prerolled frame timeout"), { code: PRESENTED_FRAME_TIMEOUT }) });
      }
      else if (awaitPresentedFrame && resumePlayback) {
        const view = this.document.defaultView;
        presentationWait = waitForPresentedFrame(this.player(), {
          timeoutMs: this.presentationTimeoutMs,
          requestAnimationFrame: view?.requestAnimationFrame?.bind(view),
          cancelAnimationFrame: view?.cancelAnimationFrame?.bind(view), signal: frameController.signal
        }).then(value => ({value}), error => ({error}));
      }
      const resumeStartedAt = performance.now();
      await record.pauseLedger.restore({ signal, assertCurrent: assertCleanup });
      nativeResumeMs = performance.now() - resumeStartedAt;
    } catch (error) {
      firstError ??= error;
      frameController.abort(error);
    }
    try {
      assertCleanup();
      const player = this.player();
      if (presentationWait && !player.paused) {
        const result = await presentationWait;
        if (result.error?.code === PRESENTED_FRAME_TIMEOUT) presentation = 'frame-timeout';
        else if (result.error) throw result.error;
        else {
          presentation = result.value.status;
          frameWaitMs = result.value.frameWaitMs ?? null;
          compositorWaitMs = result.value.compositorWaitMs ?? null;
        }
      }
      assertCleanup();
      timeAtUncoverMs = prerolled?.uncovered ? prerolled.timeAtUncoverMs : player.currentTime * 1000;
      if (prerolled?.uncovered && Number.isFinite(prerolled.uncoveredAt)) uncoveredAtMs = prerolled.uncoveredAt;
    } catch (error) {
      firstError ??= error;
    } finally {
      signal?.removeEventListener('abort', abortFrame);
      frameController.abort(abortError('presentation-wait-finished'));
      if (this.snapshotToken === record.token && record.token.cleanupController === cleanupController) {
        uncoveredAtMs ??= performance.now();
        if (keepHost && !firstError && this.overlayHost) {
          // Uncovered now, exactly when the host would have been removed. 0.65.10: and staged as
          // mountHiddenHost stages one, at opacity 0 and NOT visibility:hidden (0.62.18): a
          // hidden host's renderer frame stops producing frames, so the next cover showed its last
          // picture, the ended clip's, for about 50 ms before the next clip.
          keptHost = this.overlayHost; keptHost.dataset.nativeCovered = "false";
          keptHost.style.opacity = "0"; keptHost.style.visibility = "visible";
          this.eventLog?.enabled && this.logSync('host-released', { kept: true });
        } else { this.teardownOverlayHost(); this.eventLog?.enabled && this.logSync('host-released', { kept: false }); }
      }
      if (prerolled && this.nativePreroll === prerolled) this.nativePreroll = null;
    }
    if (awaitPresentedFrame) {
      // Without a pre-roll, native is unmuted here, on its presented frame: fade
      // that in too rather than switching hard.
      let joinFade = null;
      try {
        const player = this.player();
        if (!prerolled && !firstError && snapshot.muted !== true && player.muted === true && !player.paused &&
            this.nativeFadesAllowed() && Number.isFinite(player.volume) && player.volume > 0) {
          this.releaseNativeFade();
          joinFade = new VolumeRamp(player, { ...this.fadeClock, direction: 'in', level: player.volume, startAt: this.fadeClock.now?.() ?? performance.now(), durationMs: this.crossfadeMs });
          this.nativeFade = joinFade;
        }
      } catch {}
      try {
        await record.ledger.restore({ signal, assertCurrent: assertCleanup });
      } catch (error) {
        firstError ??= error;
        if (joinFade && this.nativeFade === joinFade) this.releaseNativeFade();
      }
      audioFade = prerolled ? this.exitAudioReport(prerolled)
        : { native: joinFade ? { status: 'ran-at-restore', reason: 'no-preroll', startMs: null, endMs: null }
          : { status: 'skipped', reason: 'no-preroll' } };
    }
    if (firstError) { releaseKeptHost(); throw firstError; }
    try { assertCleanup(); } catch (error) { releaseKeptHost(); throw error; }
    this.clearCompletedSeek();
    record.released = true; record.token.detachSource?.();
    this.boundPlayer = null;
    this.contextValid = true;
    if (this.nativeWarm?.token === record.token) this.nativeWarm = null;
    if (keptHost && this.overlayHost === keptHost) {
      // Already uncovered (opacity 0); it now waits as the next scene's staged host.
      this.overlayHost = null; this.stagedHost = keptHost;
    }
    return { presentation, frameWaitMs, compositorWaitMs, nativeResumeMs, timeAtUncoverMs, targetTimeMs,
      ...(audioFade ? { audioFade } : {}), ...(Number.isFinite(uncoveredAtMs) ? { uncoveredAtMs } : {}),
      ...(Number.isFinite(prerolled?.firstFrameMediaTimeMs) ? { firstFrameMediaTimeMs: prerolled.firstFrameMediaTimeMs } : {}), errorMs: Number.isFinite(timeAtUncoverMs) && Number.isFinite(targetTimeMs) ? timeAtUncoverMs - targetTimeMs : null };
  }

  // 0.66.2: where a failed or cancelled exit must take native that is still parked before the
  // join, or null when it is not there (never parked, already uncovered at the join, the context
  // changed, or moved elsewhere by the viewer). A pre-roll already playing the parked stretch
  // under the cover is withdrawn (paused, muted again), so the restore seeks instead of adopting it.
  parkedRecoveryTargetMs(record, parkedJoin, targetTimeMs) {
    const joinMs = parkedJoin?.joinMs, parkMs = parkedJoin?.parkMs;
    if (!Number.isFinite(joinMs) || !(parkMs > 0) || !this.contextValid) return null;
    const preroll = this.nativePreroll?.token === record.token ? this.nativePreroll : null;
    if (preroll?.uncovered) return null;
    let positionMs = null;
    try { positionMs = this.player().currentTime * 1000; } catch { return null; }
    if (!Number.isFinite(positionMs) || positionMs < joinMs - parkMs - EXIT_PARK_RECOVERY_SLACK_MS || positionMs >= joinMs - 1) return null;
    if (preroll?.started) preroll.cancel();
    this.eventLog?.enabled && this.logSync('parked-recovery', { joinMs, parkMs, mediaMs: positionMs, preserved: !Number.isFinite(targetTimeMs) });
    return Number.isFinite(targetTimeMs) ? targetTimeMs : joinMs;
  }

  async forceSafeNativeState(snapshot, signal) {
    const record = this.snapshotRecords.get(snapshot);
    if (!record || record.token !== this.snapshotToken) throw abortError('Native force cleanup snapshot is stale or unknown');
    if (record.released) return;
    record.token.cleanupController?.abort(abortError('Native force cleanup superseded restoration'));
    const cleanupController = new AbortController(); record.token.cleanupController = cleanupController;
    signal = signal ? AbortSignal.any([signal, cleanupController.signal]) : cleanupController.signal;
    const assertCleanup = () => {
      assertActive(signal);
      if (record.token !== this.snapshotToken || record.token.cleanupController !== cleanupController) throw abortError('Native force cleanup superseded');
    };
    record.forceCleanupFailed = false;
    try {
    assertCleanup();
    this.releaseNativeFade();
    if (this.nativeWarm?.token === record.token) this.nativeWarm = null;
    this.teardownOverlayHost();
    // A mute failure must not prevent an independent owned pause restoration.
    let firstError;
    try { await record.ledger.restore({ signal, assertCurrent: assertCleanup }); } catch (error) { firstError = error; }
    try { await record.pauseLedger.restore({ signal, assertCurrent: assertCleanup }); } catch (error) { firstError ??= error; }
    if (firstError) throw firstError;
    assertCleanup();
    this.clearCompletedSeek();
    record.released = true; record.token.detachSource?.();
    this.boundPlayer = null;
    this.contextValid = true;
    } catch (error) {
      if (record.token === this.snapshotToken && record.token.cleanupController === cleanupController) record.forceCleanupFailed = true;
      throw error;
    }
  }

  teardownOverlayHost() {
    this.stagedHost = null;
    this.beforeHostTeardown?.();
    this.presentation.dispose();
    this.overlayHost?.remove();
    this.overlayHost = null;
    if (this.ownedFullscreenPosition
      && this.ownedFullscreenPosition.host.style.position === this.ownedFullscreenPosition.applied) {
      this.ownedFullscreenPosition.host.style.position = this.ownedFullscreenPosition.prior;
    }
    this.ownedFullscreenPosition = null;
  }

  subscribe(listener) {
    let stopped = false;
    let frame = null;
    this.stateSubscribers.add(listener);
    const read = async () => {
      try {
        const state = await this.readState();
        if (!stopped) listener(this.sampledState(state));
      } catch {
        // A lifecycle gap is reported by the passive probe; do not command a stale player.
      }
    };
    const sample = async () => {
      if (stopped) return;
      try { await read(); }
      finally { if (!stopped) frame = requestAnimationFrame(sample); }
    };
    frame = requestAnimationFrame(sample);
    // Animation frames stop in a hidden tab or occluded window, which used to
    // miss triggers and preloads entirely. Media timeupdate keeps firing (about
    // 4 Hz) there, so it is a coarse but continuous fallback clock.
    const onTimeUpdate = event => {
      if (stopped || event.target?.dataset?.sceneSubstitutionOverlay === "true") return;
      void read();
    };
    this.document.addEventListener?.("timeupdate", onTimeUpdate, true);
    return () => {
      stopped = true;
      this.stateSubscribers.delete(listener);
      if (frame !== null) cancelAnimationFrame(frame);
      this.document.removeEventListener?.("timeupdate", onTimeUpdate, true);
    };
  }
}
