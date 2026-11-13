// Equal-power audio crossfade at the hand-overs between Prime and a local clip (E58).
//
// Both sides are ordinary media elements, so a fade writes element.volume (a linear
// amplitude scale) on a short timer. Native Prime audio is EME-protected, which
// rules out routing it through Web Audio, but its element volume is the same
// property Prime's own slider sets. A ramp only ever scales *down* from `level`,
// the viewer's own setting read when the ramp starts, and restore() writes that
// exact value back. If anything else changes the volume mid-ramp (the viewer, or
// Prime itself) the ramp lets go at once and never overwrites that change.

// Length of each fade. The measured hand-over errors on Prime are about ±30–40 ms,
// so both sources overlap for a little longer than that. Tune here.
export const CROSSFADE_MS = 50;
// Timer step between volume writes. Chrome applies element volume per audio
// buffer (about 10 ms), so finer steps would not be heard.
export const CROSSFADE_TICK_MS = 4;
// A fade-in that waits for the media clock to move starts anyway after this long.
export const CROSSFADE_START_DEADLINE_MS = 250;
// Exit shape (0.62.11), from the 0.62.10 exit captures. Native is seeked to the
// join itself (no audio handle: the 0.62.7 handle held the picture ~90 ms) and its fade-up
// follows native's own media clock, not wall time:
// - gain 0 until native's media time is at least EXIT_NATIVE_START_MS past the join
//   (0: never audible before the join, so no removed-scene audio leaks);
// - then up over EXIT_NATIVE_RAMP_MS of native media time (equal-power sine), held
//   while native stalls;
// - the clip fades out over its last EXIT_CLIP_FADE_MS (wall time, ending at its end);
// - if native is at full level more than EXIT_AHEAD_TOLERANCE_MS before the clip's end,
//   the clip finishes its fade in EXIT_AHEAD_CLIP_FADE_MS instead of overlapping longer;
// - native reaches full level by EXIT_NATIVE_DEADLINE_MS after its ramp is created
//   whatever its clock does (never left quiet).
export const EXIT_HANDLE_MS = 0;
export const EXIT_NATIVE_START_MS = 0;
export const EXIT_NATIVE_RAMP_MS = 30;
export const EXIT_CLIP_FADE_MS = 30;
// 0.62.13: native's ramp starts on its 'playing' event after the pre-roll (still covered),
// from max(join, where it is then); if it is already more than EXIT_FAR_AHEAD_MS past the
// join it rises over EXIT_NATIVE_FAST_RAMP_MS instead.
export const EXIT_FAR_AHEAD_MS = 50;
// 0.62.14: Chrome drops the last ~25 ms of an ending clip's audio and needs ~41 ms
// after an unmute before an element is audible. The clip is silent this long before its end
// (its fade or, with Smooth audio off, its cut ends there), and native's output is started
// (unmuted while paused) at least EXIT_WARM_MIN_LEAD_MS before the clip's end.
export const EXIT_CLIP_TAIL_MARGIN_MS = 30;
// 0.62.15: Chrome treats a media element at volume 0 like a muted one. Its audio
// output starts only when it becomes audible (~41 ms later, EXIT_OUTPUT_STARTUP_MS), and an
// audible start also delays its first video frame (to ~80 ms). So:
// - the exit pre-roll starts a fixed EXIT_PREROLL_LEAD_MS before the clip's end in both modes
//   (no longer learned from the last first-frame time, which flipped between 30 and 90);
// - with Smooth audio on native is held at EXIT_SILENT_GAIN (-60 dB), not 0, so it is audible
//   to Chrome from play() and its output starts with playback, as with Smooth audio off;
// - native is never uncovered earlier than EXIT_UNCOVER_NOT_BEFORE_MS before the clip's end.
export const EXIT_PREROLL_LEAD_MS = 105;
// 0.65.6: from a pause at the join, 0.65.4's native showed its first
// new frame 163-183 ms after play() (its media clock stalls until then), 71-98 ms after the
// clip's end, and the clip's last frame held. The lead now follows that start-up when it has
// been measured: the median of the last EXIT_PREROLL_LATENCY_SAMPLES paused-at-join exits (at
// least two, so one outlier never sets it) plus EXIT_PREROLL_LATENCY_MARGIN_MS, never below
// EXIT_PREROLL_LEAD_MS (0.62.15's floor: native audible before the clip's audio ends) nor above
// EXIT_PREROLL_MAX_LEAD_MS. Frames native shows early stay under the cover (uncover not before
// the clip's end less EXIT_UNCOVER_NOT_BEFORE_MS).
export const EXIT_PREROLL_MAX_LEAD_MS = 200;
export const EXIT_PREROLL_LATENCY_SAMPLES = 3;
export const EXIT_PREROLL_LATENCY_MARGIN_MS = 10;
export function exitPrerollLeadMs(latencies = []) {
  const recent = (Array.isArray(latencies) ? latencies : []).filter(value => Number.isFinite(value) && value > 0).slice(-EXIT_PREROLL_LATENCY_SAMPLES);
  if (recent.length < 2) return EXIT_PREROLL_LEAD_MS;
  const sorted = [...recent].sort((a, b) => a - b), median = sorted[(sorted.length - 1) >> 1];
  return Math.round(Math.min(EXIT_PREROLL_MAX_LEAD_MS, Math.max(EXIT_PREROLL_LEAD_MS, median + EXIT_PREROLL_LATENCY_MARGIN_MS)));
}
// 0.66.2 (exit jump): the lead above covers native's start-up, but native's media clock does not
// wait for it. From a pause at the join the clock starts 23-73 ms after play() (22 exits, software
// decoding, 2026-11-10), so by the clip's end native is already lead - that delay (35-135 ms) past
// the join, and the first frame it can show is 1-3 frames after the join frame. The only copy of
// the join frame was the paused one. So with Exit reveal 'precise' native now waits *before* the
// join by the media its clock is expected to cover before the clip's end (exitParkMs), started at
// the same lead: its clock then reaches the join at the clip's end and the join frame is the one
// that is presented there. Frames before the join stay covered (the reveal gate's "at the join"),
// and native's gain follows its own clock from EXIT_PARK_AUDIO_START_MS before the join (below).
// The clock's start delay is measured at every exit (play() to the clip's end, less the media
// native covered by then): the median of the last EXIT_PARK_DELAY_SAMPLES, EXIT_PARK_DEFAULT_DELAY_MS
// before the first one. EXIT_PARK_LATE_BIAS_MS parks that much further back: a clock that reaches
// the join early skips the join frame (the fault being fixed), one that reaches it late only holds
// the clip's last frame for that long. Never more than EXIT_PARK_MAX_MS, nor than the lead.
export const EXIT_PARK_DEFAULT_DELAY_MS = 50;
export const EXIT_PARK_DELAY_SAMPLES = 3;
export const EXIT_PARK_LATE_BIAS_MS = 10;
export const EXIT_PARK_MAX_MS = 150;
// Parked, native's ramp starts this long before the join, on native's own clock, so there is no
// quiet stretch at the exit. With 0 (a ramp from the join, as EXIT_NATIVE_START_MS) the ~30 ms
// after the clip's own audio ends (EXIT_CLIP_TAIL_MARGIN_MS) were silent until native's ramp. At
// -60 native rises over [join - 60, join - 30] and is at full level for the last 30 ms before the
// join, which is when the clip's audio has ended: up to 60 ms of the original's audio just before
// the join is heard under the cover (30 ms rising, 30 ms at full level). A park shorter than this
// starts the ramp where native is parked. The ramp never moves while native is paused or seeking.
// Unparked exits keep EXIT_NATIVE_START_MS. Must stay at or below
// -(EXIT_NATIVE_RAMP_MS + EXIT_CLIP_TAIL_MARGIN_MS), or the quiet stretch returns.
export const EXIT_PARK_AUDIO_START_MS = -60;
// 0.66.2 (exit dropout): parked, native's clock was measured 9-31 ms behind its predicted position
// at the clip's end, so a ramp on that clock alone rose after the clip (wall time, [-60, -30] ms
// from its end) had gone: about 47 ms of silence at 22-24 ms behind. While native's clock is
// advancing its ramp is therefore never below a wall-time one aligned to the clip's own fade window
// (from EXIT_CLIP_TAIL_MARGIN_MS + EXIT_CLIP_FADE_MS before the clip's end, over EXIT_CLIP_FADE_MS).
// A late clock then only means slightly earlier audio of the original at that level. A clock that
// has not started, has stalled, is paused or seeking holds the gain as before (media time only),
// and unparked exits never use the floor (0.62.7: wall time failed for a native stalled at the join).
export const EXIT_PARK_DELAY_MAX_MS = 150;
// A failed or cancelled exit treats native as still parked when it sits between the parked
// position, less this much for a seek that landed short, and the join.
export const EXIT_PARK_RECOVERY_SLACK_MS = 100;
export function exitParkMs(leadMs, delays = []) {
  if (!Number.isFinite(leadMs) || !(leadMs > 0)) return 0;
  const recent = (Array.isArray(delays) ? delays : []).filter(value => Number.isFinite(value) && value >= 0 && value <= EXIT_PARK_DELAY_MAX_MS).slice(-EXIT_PARK_DELAY_SAMPLES);
  const sorted = [...recent].sort((a, b) => a - b), delay = sorted.length ? sorted[(sorted.length - 1) >> 1] : EXIT_PARK_DEFAULT_DELAY_MS;
  return Math.round(Math.max(0, Math.min(EXIT_PARK_MAX_MS, leadMs, leadMs - delay + EXIT_PARK_LATE_BIAS_MS)));
}
// 0.65.7 X1 (E72, Exit reveal "precise") also had its own, shorter lead: max(40, start-up - one
// native frame), capped at 105 ms. 0.65.8 retires it (A/B 2026-11-01): it did not reduce the exit
// skip, it moved Chrome's cold start out from under the cover (a hold, then a jump), and every lead
// under about 71 ms predicted an audio gap. Every policy now uses exitPrerollLeadMs. The precise
// reveal gate still needs native's frame length; EXIT_PRECISE_DEFAULT_FRAME_MS when unmeasured.
export const EXIT_PRECISE_DEFAULT_FRAME_MS = 1000 / 30;
// 0.65.8: native's frame length for the precise gate, from the planned cut's frame callbacks. 0.65.7
// took the last callback pair only, and one frame Chrome dropped before presenting it (media +80 ms,
// presentedFrames +1) read FS 29's 40 ms frames as 80. Now: the lower median of the last
// NATIVE_FRAME_SAMPLES per-frame deltas (a callback that skipped frames is divided by the frames
// presented, as the cut rule does), so isolated doubled steps never set it, clamped to a plausible
// NATIVE_FRAME_MIN_MS..NATIVE_FRAME_MAX_MS; null with no sample (EXIT_PRECISE_DEFAULT_FRAME_MS then).
export const NATIVE_FRAME_SAMPLES = 8;
export const NATIVE_FRAME_MIN_MS = 16;
export const NATIVE_FRAME_MAX_MS = 50;
export function nativeFrameLengthMs(deltasMs = []) {
  const recent = (Array.isArray(deltasMs) ? deltasMs : []).filter(value => Number.isFinite(value) && value > 0).slice(-NATIVE_FRAME_SAMPLES);
  if (!recent.length) return null;
  const sorted = [...recent].sort((a, b) => a - b), median = sorted[(sorted.length - 1) >> 1];
  return Math.min(NATIVE_FRAME_MAX_MS, Math.max(NATIVE_FRAME_MIN_MS, median));
}
export const EXIT_SILENT_GAIN = 0.001;
export const EXIT_UNCOVER_NOT_BEFORE_MS = 10;
export const EXIT_OUTPUT_STARTUP_MS = 41;
export const EXIT_CLIP_DROPPED_TAIL_MS = 25;
// 0.62.18: the cover's opacity from native's pre-roll start to the uncover (not opaque, so
// Chrome keeps compositing native underneath; 0.1% of native shows through, invisibly).
export const EXIT_COVER_PRE_REVEAL_OPACITY = 0.999;
export const EXIT_WARM_MIN_LEAD_MS = 100;
export const EXIT_NATIVE_FAST_RAMP_MS = 15;
export const EXIT_AHEAD_TOLERANCE_MS = 15;
export const EXIT_AHEAD_CLIP_FADE_MS = 15;
export const EXIT_NATIVE_DEADLINE_MS = 1500;

// Most volume changes a ramp's diagnostic trace keeps (a 50 ms ramp at 4 ms ticks is ~14).
export const TRACE_LIMIT = 48;

const clamp01 = value => Math.min(1, Math.max(0, value));
const EPSILON = 1e-6;

// Equal power: in² + out² = 1 at every point, so the overlap neither dips nor bulges.
export function equalPowerGain(progress, direction) {
  const p = clamp01(Number.isFinite(progress) ? progress : 0);
  // Exact ends (cos(π/2) is 6e-17, not 0).
  if (p === 1) return direction === 'in' ? 1 : 0;
  return direction === 'in' ? Math.sin(p * Math.PI / 2) : Math.cos(p * Math.PI / 2);
}

// Can this element be faded at all? Fakes and players without a numeric volume cannot.
export function fadeableVolume(element) {
  try {
    const volume = element?.volume;
    return Number.isFinite(volume) && volume > 0 && volume <= 1 && element.muted !== true;
  } catch { return false; }
}

// Timers are throttled to about once a second in a hidden tab; a fade there would
// sit at a partial volume. Hidden tabs keep the hard switch.
export function crossfadeAllowed(document, durationMs = CROSSFADE_MS) {
  return Number.isFinite(durationMs) && durationMs > 0 && document?.visibilityState !== 'hidden';
}

export class VolumeRamp {
  // direction 'out' goes level → 0 and then holds 0 until restore(); 'in' goes 0 → level
  // and finishes by itself. startAt is on the `now` clock; null waits for startWhen()
  // (polled every tick) and for notBefore, or the start deadline (counted from
  // notBefore when given).
  constructor(element, { direction, level, startAt = null, durationMs = CROSSFADE_MS, startWhen = null, notBefore = null,
    startDeadlineMs = CROSSFADE_START_DEADLINE_MS, autoRestoreMs = null, now = () => performance.now(), trace = null,
    setTimer = (callback, ms) => setTimeout(callback, ms), clearTimer = handle => clearTimeout(handle),
    tickMs = CROSSFADE_TICK_MS, scale = 1, floor = 0 } = {}) {
    if (direction !== 'in' && direction !== 'out') throw new TypeError('Ramp direction must be in or out');
    // An 'out' ramp may start below its level (continuing an earlier fade): gain × scale.
    this.scale = clamp01(Number.isFinite(scale) ? scale : 1);
    // Lowest gain written (0.62.15 exit: a -60 dB floor keeps Chrome's audio output running).
    this.floor = clamp01(Number.isFinite(floor) ? floor : 0);
    this.element = element;
    this.direction = direction;
    this.level = clamp01(Number.isFinite(level) ? level : 0);
    this.durationMs = Math.max(1, durationMs);
    this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer; this.tickMs = tickMs;
    this.startWhen = startWhen; this.createdAt = now(); this.startDeadlineMs = startDeadlineMs;
    this.notBefore = Number.isFinite(notBefore) ? notBefore : null;
    this.autoRestoreMs = autoRestoreMs;
    // Diagnostics (0.62.10): every volume change as [time, gain 0-1 of level, sample()],
    // at most TRACE_LIMIT entries. `trace` is true or a function adding a third value.
    this.traceSample = typeof trace === 'function' ? trace : null;
    this.trace = trace ? [] : null;
    this.startAt = Number.isFinite(startAt) ? startAt : null;
    // pending | ramping | holding (out, at 0) | done (in, at level) | restored | released
    this.state = 'pending';
    this.timer = null; this.autoRestoreTimer = null;
    this.written = null;
    this.write(this.gainAt(this.now()) * this.level);
    this.schedule();
  }

  // Where the ramp sits, for diagnostics: start and end on the `now` clock (null
  // while it has not started), and how it ended.
  report() {
    return { state: this.state, startAt: this.startAt, endAt: this.startAt === null ? null : this.startAt + this.durationMs };
  }

  get active() { return this.state === 'pending' || this.state === 'ramping' || this.state === 'holding'; }

  // Gain (0–1, before `level`) at time t.
  gainAt(t) {
    if (this.startAt === null) return Math.max(this.floor ?? 0, this.direction === 'in' ? 0 : this.scale);
    return Math.max(this.floor ?? 0, equalPowerGain((t - this.startAt) / this.durationMs, this.direction) * (this.direction === 'out' ? this.scale : 1));
  }

  // The current gain (0-1 of level), as last written.
  currentGain() { return this.level > 0 && Number.isFinite(this.written) ? this.written / this.level : 0; }

  // Stop without writing anything (a successor ramp takes over from this volume).
  abandon() { this.stop(); if (this.active) this.state = 'released'; }

  write(volume) {
    try { this.element.volume = clamp01(volume); this.written = this.element.volume; }
    catch { this.release(); return; }
    if (this.trace && this.lastTraced !== this.written) {
      this.lastTraced = this.written;
      let extra = null; try { extra = this.traceSample?.() ?? null; } catch {}
      // Past the limit the last entry is overwritten, so the final volume is always there.
      this.trace[Math.min(this.trace.length, TRACE_LIMIT - 1)] = [this.now(), this.level > 0 ? this.written / this.level : 0, extra];
    }
  }

  // Someone else changed the volume since our last write: theirs wins.
  changedExternally() {
    try { return this.written !== null && Math.abs(this.element.volume - this.written) > EPSILON; }
    catch { return true; }
  }

  schedule() {
    this.clearTimer(this.timer); this.timer = null;
    if (this.state !== 'pending' && this.state !== 'ramping') return;
    this.timer = this.setTimer(() => { this.timer = null; this.step(); }, this.tickMs);
  }

  step() {
    if (!this.active) return;
    if (this.changedExternally()) { this.release(); return; }
    const t = this.now();
    if (this.startAt === null && (this.notBefore === null || t >= this.notBefore)) {
      let ready = this.startWhen === null;
      try { if (!ready) ready = this.startWhen() === true; } catch {}
      if (ready || t - Math.max(this.createdAt, this.notBefore ?? -Infinity) >= this.startDeadlineMs) this.startAt = t;
    }
    if (this.state === 'holding') return;
    if (this.startAt !== null && t >= this.startAt) this.state = 'ramping';
    this.write(this.gainAt(t) * this.level);
    if (!this.active) return;
    if (this.startAt !== null && t >= this.startAt + this.durationMs) {
      if (this.direction === 'in') { this.write(this.level); this.state = 'done'; }
      else { this.write(this.floor * this.level); this.hold(); }
      return;
    }
    this.schedule();
  }

  // Move a ramp that has not begun (a refined cut prediction). A running ramp keeps
  // its timing so the volume never jumps.
  retime(startAt) {
    if (this.state !== 'pending' || !Number.isFinite(startAt)) return false;
    this.startAt = startAt;
    this.write(this.gainAt(this.now()) * this.level);
    return true;
  }

  // Stop moving and keep the current volume (native has paused at the cut). An
  // 'out' ramp that completes holds the same way; restore() ends either.
  hold() {
    if (!this.active) return;
    this.clearTimer(this.timer); this.timer = null;
    this.state = 'holding';
    if (Number.isFinite(this.autoRestoreMs) && this.autoRestoreTimer === null) {
      this.autoRestoreTimer = this.setTimer(() => { this.autoRestoreTimer = null; this.restore(); }, this.autoRestoreMs);
    }
  }

  // The owner took over the hold (no automatic restore any more).
  claim() { this.clearTimer(this.autoRestoreTimer); this.autoRestoreTimer = null; }

  // New ceiling, for example the clip volume the page confirms after the cut.
  setLevel(level) {
    if (!this.active || !Number.isFinite(level)) return;
    if (this.changedExternally()) { this.release(); return; }
    this.level = clamp01(level);
    this.write((this.state === 'holding' ? (this.direction === 'in' ? 1 : 0) : this.gainAt(this.now())) * this.level);
  }

  // Cancel: put back exactly the level the ramp started from, unless something else
  // already changed the volume. Safe to call more than once.
  restore() {
    if (!this.active) return this.state;
    const external = this.changedExternally();
    this.stop();
    if (external) { this.state = 'released'; return this.state; }
    this.write(this.level);
    this.state = 'restored';
    return this.state;
  }

  // Let go without writing (the volume was changed by someone else).
  release() {
    this.stop();
    if (this.state !== 'restored' && this.state !== 'done') this.state = 'released';
  }

  stop() {
    this.clearTimer(this.timer); this.timer = null;
    this.clearTimer(this.autoRestoreTimer); this.autoRestoreTimer = null;
  }
}

// A fade-in driven by the element's own media clock (0.62.11 exit): progress() returns 0-1
// (or null when unknown); gain = sin(progress·π/2), never lower than before, so a stalled
// clock holds the gain. Done at progress 1, or at full level after deadlineMs.
export class MediaTimeRamp extends VolumeRamp {
  constructor(element, { progress, deadlineMs = EXIT_NATIVE_DEADLINE_MS, onFull = null, ...options } = {}) {
    super(element, { ...options, direction: 'in', startAt: null, startWhen: () => false, startDeadlineMs: Infinity });
    this.progress = progress; this.deadlineMs = deadlineMs; this.onFull = onFull;
    this.best = 0; this.doneAt = null;
  }
  gainAt() { return Math.max(this.floor ?? 0, this.best === undefined ? 0 : equalPowerGain(this.best, 'in')); }
  report() { return { state: this.state, startAt: this.startAt, endAt: this.doneAt }; }
  step() {
    if (!this.active) return;
    if (this.changedExternally()) { this.release(); return; }
    const t = this.now();
    let p = null; try { p = this.progress(); } catch {}
    if (Number.isFinite(p)) this.best = Math.max(this.best, Math.min(1, Math.max(0, p)));
    if (this.best > 0 && this.startAt === null) { this.startAt = t; this.state = 'ramping'; }
    const late = t - this.createdAt >= this.deadlineMs;
    if (this.best >= 1 || late) {
      this.write(this.level); if (!this.active) return;
      this.state = 'done'; this.doneAt = t; this.startAt ??= t; this.reason = late && this.best < 1 ? 'deadline' : 'media';
      try { this.onFull?.(t); } catch {}
      return;
    }
    this.write(this.gainAt(t) * this.level);
    if (this.active) this.schedule();
  }
}

// Exit diagnostics (0.62.13): the combined level of the two sides across the overlap, from
// their traces. nativeTrace rows are [ms from clip end, gain, ...], clipTrace [ms, gain];
// each gain holds until its next row; native is 0 before its first row and the clip 1.
// Returns the window where either is changing and the lowest sqrt(native² + clip²) in it.
export function combinedGain(nativeTrace = [], clipTrace = [], stepMs = 1) {
  const rows = list => (Array.isArray(list) ? list : []).filter(r => Number.isFinite(r?.[0]) && Number.isFinite(r?.[1])).sort((a, b) => a[0] - b[0]);
  const native = rows(nativeTrace), clip = rows(clipTrace);
  if (!native.length || !clip.length) return null;
  const at = (list, t, before) => { let g = before; for (const [time, gain] of list) { if (time <= t) g = gain; else break; } return g; };
  const nativeStart = (native.find(r => r[1] > 0) ?? native.at(-1))[0], nativeFull = (native.find(r => r[1] >= 0.999) ?? native.at(-1))[0];
  const clipStart = (clip.find(r => r[1] < 0.999) ?? clip[0])[0], clipZero = (clip.find(r => r[1] <= 0.001) ?? clip.at(-1))[0];
  const startMs = Math.min(nativeStart, clipStart), endMs = Math.max(nativeFull, clipZero);
  let minGain = Infinity, minAtMs = startMs;
  for (let t = startMs; t <= endMs + 1e-9; t += stepMs) {
    const g = Math.hypot(at(native, t, 0), at(clip, t, 1));
    if (g < minGain) { minGain = g; minAtMs = t; }
  }
  return { startMs, endMs, nativeStartMs: nativeStart, nativeFullMs: nativeFull, clipStartMs: clipStart, clipZeroMs: clipZero,
    // From the gain traces only: it leaves out Chrome's output start-up after an unmute and
    // the dropped tail of an ending clip, so it does not predict what is heard.
    minCombinedTraceGain: Math.round(minGain * 1000) / 1000, minAtMs: Math.round(minAtMs * 10) / 10, excludesOutputLatency: true };
}
