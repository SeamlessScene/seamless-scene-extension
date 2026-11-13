import { maximumAssetDurationMs, LOCAL_STALL_BUDGET_MS } from "./asset-duration-policy.mjs";
import { pausableDeadline } from "./pausable-deadline.mjs";
import { playbackQuality, longFrameLog, relativeLongFrames } from "./exit-diagnostics.mjs";
import { keyframeTimes, entryPosition, ENTRY_KEYFRAME_TOLERANCE_SECONDS } from "./mp4-keyframes.mjs";

// Typical play() to first moving frame (lab: 92–144 ms); replaced by the warm-up measurement.
const DEFAULT_START_LATENCY_MS = 110;
// How long before a clip's end the page hears when it will end.
const ENDING_NOTICE_MS = 400;
const PREROLL_MARGIN_MS = 40;
// 0.65.3: a chained next clip starts at least this long before the current one ends,
// so its audio is already playing when its fade-in begins; its fade-in finishes this long
// before the end, before the current clip's fade-out starts; and the current clip stays on
// screen until the next one has presented a frame, for at most CHAIN_REVEAL_CAP_MS.
const CHAIN_MIN_LEAD_MS = 150;
const CHAIN_FADE_IN_EARLY_MS = 50;
const CHAIN_REVEAL_CAP_MS = 250;
// 0.65.6: after a viewer's resume, the ending notice waits for the clip's
// first new frame (its clock is moving again), at most this long.
const RESUME_FRAME_WAIT_MS = 250;
// 0.65.7 short-gap priming: the standby is warmed only while the current clip has at least this
// long left, so its decode never overlaps the current clip's ending notice and native's exit pre-roll.
const STANDBY_PRIME_MIN_REMAINING_MS = ENDING_NOTICE_MS + 200;
import { assertActive, boundedOperation, abortError } from "./operation-context.mjs";
import { CROSSFADE_MS, EXIT_CLIP_FADE_MS, EXIT_CLIP_TAIL_MARGIN_MS, VolumeRamp, crossfadeAllowed } from "./audio-crossfade.mjs";

function observeFirstMovingFrame(video, from, signal) {
  let cancel = () => {};
  const promise = new Promise((resolve, reject) => {
    if (typeof video.requestVideoFrameCallback !== 'function') { resolve(null); return; }
    let settled = false, frameId = null;
    const finish = (value = null, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (frameId !== null) { try { video.cancelVideoFrameCallback(frameId); } catch {} }
      frameId = null;
      if (error) reject(error); else resolve(value);
    };
    cancel = () => finish();
    const timer = setTimeout(cancel, 400);
    const request = () => {
      try { frameId = video.requestVideoFrameCallback(onFrame); }
      catch (error) { finish(null, error); }
    };
    const onFrame = (now, meta) => {
      if (settled) return;
      frameId = null;
      if (Number.isFinite(meta?.mediaTime) && meta.mediaTime <= from + 0.001) { request(); return; }
      finish(meta?.expectedDisplayTime ?? now);
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel(); else request();
  });
  // Registration can fail while play() is still pending. Its eventual await
  // retains that error without producing an interim unhandled rejection.
  void promise.catch(() => {});
  return { promise, cancel: () => cancel() };
}

function waitForVideo(video, events, { timeoutMs = 5000, signal, condition = () => true } = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for ${events.join("/")}`)), timeoutMs);
    const listeners = events.map((event) => [event, () => { if (condition()) finish(); }]);
    const onError = () => finish(video.error ?? new Error("Local video failed"));
    const onAbort = () => finish(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const finish = (error) => {
      clearTimeout(timeout);
      for (const [event, listener] of listeners) video.removeEventListener(event, listener);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    for (const [event, listener] of listeners) video.addEventListener(event, listener);
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

const MIN_GAIN_DB = -24;
const MAX_GAIN_DB = 6;
const DEFAULT_FRAME_DURATION_SECONDS = 1 / 30;
const MIN_END_GUARD_SECONDS = 0.02;
const MAX_END_GUARD_SECONDS = 0.1;

export function localPlaybackVolume(nativeVolume, gainDb = 0) {
  if (!Number.isFinite(nativeVolume) || nativeVolume < 0 || nativeVolume > 1) {
    throw new TypeError("Native volume must be between 0 and 1");
  }
  if (!Number.isSafeInteger(gainDb) || gainDb < MIN_GAIN_DB || gainDb > MAX_GAIN_DB) {
    throw new TypeError(`Local gain must be an integer between ${MIN_GAIN_DB} and ${MAX_GAIN_DB} dB`);
  }
  return Math.min(1, Math.max(0, nativeVolume * (10 ** (gainDb / 20))));
}

export class LocalOverlay {
  constructor({ document, now = () => performance.now(), crossfadeMs = CROSSFADE_MS, fadeClock = {} }) {
    this.document = document;
    // E58: the clip's own volume fades in over the crossfadeMs before a planned cut
    // and out over its last crossfadeMs when native takes over again. 0 disables.
    this.crossfadeMs = crossfadeMs; this.audioFade = null; this.fadeClock = fadeClock;
    // The clip's end fade at an exit (0.62.11: 40 ms; the entry fade-in keeps crossfadeMs).
    this.exitFadeMs = crossfadeMs > 0 ? EXIT_CLIP_FADE_MS : 0;
    this.now = now; this.playControl = null; this.preroll = null; this.startLatencyMs = null; this.onLocalEnding = null;
    // Keyframe times per clip URL, read in the background when a clip is prepared.
    this.keyframeIndex = new Map();
    this.video = null;
    this.objectUrl = null;
    this.source = null;
    this.heldFrame = null;
    this.generation = 0; this.lifetime = new AbortController(); this.playAttempt = 0;
    this.motion = null;
    this.standby = null; this.standbyLifetime = new AbortController();
    // 0.65.7: the current decoder was warmed as the standby (primeStandby) and not played since,
    // so the stage's warm-up can be skipped; and, while scene timing records, the first frame
    // callback of each started clip (callback and display times).
    this.primedVideo = null; this.stampFirstFrames = false; this.firstFrameStamp = null;
  }

  fadesAllowed() { return crossfadeAllowed(this.document, this.crossfadeMs); }

  // Ends any clip fade at its full level (or leaves a volume someone else set).
  releaseAudioFade() {
    const fade = this.audioFade; this.audioFade = null;
    fade?.restore();
  }

  beginMotion() {
    this.motion?.abort(abortError('Local playback superseded'));
    const motion = new AbortController(); this.motion = motion; return motion;
  }

  resetDecoderLifetime() {
    this.motion?.abort(abortError('Local decoder reset')); this.motion = null;
    this.lifetime.abort(); this.lifetime = new AbortController(); this.generation += 1;
  }

  createVideo() {
    const video = this.document.createElement("video");
    video.dataset.sceneSubstitutionOverlay = "true";
    video.playsInline = true;
    video.preload = "auto";
    video.controls = false;
    Object.assign(video.style, {
      position: "absolute",
      inset: "0",
      zIndex: "2147483646",
      width: "100%",
      height: "100%",
      objectFit: "contain",
      background: "#000",
      display: "none"
    });
    return video;
  }

  // A second, detached decoder for the next clip, loaded while the current one
  // plays so adjacent and closely spaced scenes are ready at their trigger.
  async prepareNext(source, signal) {
    assertActive(signal);
    void this.indexKeyframes(source);
    if (this.source === source && this.video) return Object.freeze({ readyState: this.video.readyState });
    if (this.standby?.source === source) {
      await this.standby.ready;
      return Object.freeze({ readyState: this.standby.video.readyState });
    }
    this.releaseStandby();
    const lifetime = this.standbyLifetime;
    const video = this.createVideo(), standby = { source, video, ready: null, complete: false };
    this.standby = standby;
    video.src = source;
    video.load();
    const combined = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]);
    standby.ready = (async () => {
      if (video.readyState < 3) {
        await waitForVideo(video, ["canplay", "loadeddata", "progress"], { signal: combined, condition: () => video.readyState >= 3 });
      }
      if (this.standby !== standby) throw abortError('Next decoder replaced');
      await this.rewind(video, combined);
      standby.complete = true;
    })();
    try { await standby.ready; }
    catch (error) { if (this.standby === standby) this.releaseStandby(); throw error; }
    return Object.freeze({ readyState: video.readyState });
  }

  releaseStandby() {
    const standby = this.standby;
    this.standbyLifetime.abort(); this.standbyLifetime = new AbortController();
    this.standby = null;
    if (!standby) return;
    clearTimeout(standby.prerollTimer); clearTimeout(standby.revealTimer); standby.onFirstFrame = null; standby.fade?.abandon?.();
    try { standby.video.pause(); standby.video.removeAttribute("src"); standby.video.load(); standby.video.remove(); } catch {}
  }

  // 0.65.7 short-gap priming: warm the standby decoder while the current clip plays, so a scene
  // that follows the current one after a short stretch of the episode (under 500 ms) needs no
  // warm-up at its stage. The standby is placed under the playing clip (which stays on top and
  // covers it), muted, played to its first moving frame, paused and put back on its first frame.
  // It stays there, paused, silent and covered, until it is promoted or released. One decoder:
  // the existing standby. Skipped (not an error) when there is no playing clip or too little left.
  async primeStandby(signal) {
    assertActive(signal);
    const standby = this.standby, current = this.video, parent = current?.parentNode;
    const skipped = reason => Object.freeze({ status: 'skipped', reason, startLatencyMs: null });
    if (!standby?.complete) return skipped('not-prepared');
    if (standby.prerolled || standby.primed || standby.priming) return skipped('busy');
    if (!current || !parent || standby.video === current || current.paused) return skipped('no-playing-clip');
    const remaining = (current.duration - current.currentTime) * 1000 / (current.playbackRate || 1);
    if (!(remaining >= STANDBY_PRIME_MIN_REMAINING_MS)) return skipped('too-late');
    const video = standby.video;
    const combined = AbortSignal.any([this.standbyLifetime.signal, ...(signal ? [signal] : [])]);
    const owns = () => this.standby === standby && !standby.prerolled && this.video === current;
    const previousMuted = video.muted;
    standby.priming = true;
    video.muted = true;
    video.style.display = 'block';
    if (typeof parent.insertBefore === 'function') parent.insertBefore(video, current); else parent.append?.(video);
    if (typeof parent.insertBefore !== 'function' && typeof parent.append === 'function') parent.append(current); // the current clip stays on top
    let firstFrame = null, startLatencyMs = null;
    try {
      const startedAt = performance.now();
      firstFrame = observeFirstMovingFrame(video, video.currentTime, combined);
      await boundedOperation(() => {
        const playing = video.play();
        void playing?.then?.(() => { if (combined.aborted && !owns()) { try { video.pause(); } catch {} } }, () => {});
        return playing;
      }, { signal: combined, timeoutMs: 1000, label: 'standby-warmup' });
      const presentedAt = await firstFrame.promise;
      if (Number.isFinite(presentedAt)) startLatencyMs = Math.round(Math.min(250, Math.max(30, presentedAt - startedAt)) * 10) / 10;
      assertActive(combined);
      if (!owns()) throw abortError('Standby replaced');
      video.pause();
      await this.rewind(video, combined);
      if (!owns()) throw abortError('Standby replaced');
      standby.primed = { startLatencyMs };
      if (startLatencyMs !== null) this.startLatencyMs = startLatencyMs;
    } finally {
      firstFrame?.cancel();
      standby.priming = false;
      if (this.standby === standby && !standby.prerolled) {
        try { video.pause(); } catch {}
        video.muted = previousMuted;
        // Not primed (aborted or failed): out of the page again, as a plain standby.
        if (!standby.primed) { video.style.display = 'none'; try { video.remove(); } catch {} }
      }
    }
    return Object.freeze({ status: 'primed', reason: null, startLatencyMs });
  }

  // 0.65.7 short-gap hand-over: the current clip has ended and native is uncovered; the cover host
  // stays (hidden) as the next scene's staged host. The primed standby becomes the current clip in
  // its place, shown and paused on its first frame, and the ended clip's decoder is released. Like
  // prepare's promotion, without the host being removed and rebuilt.
  async promoteStandby(signal) {
    assertActive(signal);
    const standby = this.standby;
    if (!standby?.complete || standby.prerolled || standby.priming) throw new Error("Next local clip is not prepared");
    const previous = this.video, parent = standby.video.parentNode ?? previous?.parentNode ?? null;
    if (!parent) throw new Error("Overlay is not mounted");
    this.cancelPreroll(); this.releaseAudioFade();
    this.standby = null;
    this.resetDecoderLifetime();
    this.heldFrame?.remove(); this.heldFrame = null;
    if (previous && previous !== standby.video) {
      try { previous.pause(); previous.removeAttribute("src"); previous.load(); previous.remove(); } catch {}
    }
    const video = standby.video, generation = this.generation;
    this.video = video; this.source = standby.source;
    this.primedVideo = standby.primed ? video : null;
    video.style.display = "block";
    if (parent && video.parentNode !== parent) parent.append(video);
    await this.rewind(video, AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]));
    if (this.video !== video || this.generation !== generation) throw abortError('Local decoder replaced');
    try { this.onPresentationChange?.(); } catch {}
  }

  // 0.65.7 short-gap fallback: a cover that lands after the trigger starts the clip where native
  // already is (clip position = native - trigger), never back at its first frame. An exact seek,
  // not cue()'s keyframe snap; kept 0.5 s clear of the clip's end, as cue() is.
  async cueAt(positionMs, signal) {
    assertActive(signal);
    this.cancelPreroll();
    if (!this.video) throw new Error("Overlay was not prepared");
    this.releaseAudioFade();
    if (!Number.isFinite(positionMs) || positionMs < 0) throw new RangeError("Cue position must be a non-negative number of milliseconds");
    const video = this.video, generation = this.generation;
    if (this.primedVideo === video) this.primedVideo = null;
    signal = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    if (!Number.isFinite(video.duration)) return { positionMs: Math.round(video.currentTime * 1000) || 0 };
    const target = Math.min(positionMs / 1000, Math.max(0, video.duration - 0.5));
    if (Math.abs(video.currentTime - target) < 0.0005 && !video.seeking && video.readyState >= 2) return { positionMs: Math.round(video.currentTime * 1000) };
    video.currentTime = target;
    await waitForVideo(video, ["seeked", "canplay"], { signal, condition: () => !video.seeking && video.readyState >= 2 });
    assertActive(signal);
    if (this.video !== video || this.generation !== generation) throw abortError('Local decoder replaced');
    return { positionMs: Math.round(video.currentTime * 1000) };
  }

  // 0.65.7 (scene timing on): the first frame callback after a clip starts moving, with the time the
  // callback ran and the frame's expectedDisplayTime, kept separately (epoch ms on this document).
  // 0.65.9: also when the clip's 'playing' event came (logging only: a one-time listener).
  stampFirstFrame(video) {
    if (!this.stampFirstFrames || typeof video?.requestVideoFrameCallback !== 'function') return;
    const stamp = { video, callbackMs: null, displayMs: null, mediaMs: null, playingMs: null };
    this.firstFrameStamp = stamp;
    try {
      video.addEventListener?.('playing', () => {
        if (this.firstFrameStamp === stamp && stamp.playingMs === null) stamp.playingMs = Math.round((performance.timeOrigin + performance.now()) * 10) / 10;
      }, { once: true });
    } catch {}
    try {
      video.requestVideoFrameCallback((now, metadata) => {
        if (this.firstFrameStamp !== stamp) return;
        stamp.callbackMs = Math.round((performance.timeOrigin + performance.now()) * 10) / 10;
        const shown = Number.isFinite(metadata?.expectedDisplayTime) ? metadata.expectedDisplayTime : null;
        stamp.displayMs = shown === null ? null : Math.round((performance.timeOrigin + shown) * 10) / 10;
        stamp.mediaMs = Number.isFinite(metadata?.mediaTime) ? Math.round(metadata.mediaTime * 1000 * 10) / 10 : null;
      });
    } catch {}
  }

  firstFrameReport(video) {
    const stamp = this.firstFrameStamp;
    if (!stamp || stamp.video !== video || !Number.isFinite(stamp.callbackMs)) return null;
    return { callbackMs: stamp.callbackMs, displayMs: stamp.displayMs, mediaMs: stamp.mediaMs, ...(Number.isFinite(stamp.playingMs) ? { playingMs: stamp.playingMs } : {}) };
  }

  // W7 (0.65.2, owner D3): a chained join hands over without a held picture or a silence. The
  // next clip, already loaded in the standby decoder, is mounted under the current one and
  // started early (its start-up latency, at least CHAIN_MIN_LEAD_MS), so it is playing when the
  // current clip ends. Its audio fades in and reaches its level CHAIN_FADE_IN_EARLY_MS before the
  // end, before the current clip fades out, so the two overlap instead of leaving a gap (0.65.3).
  // The current clip stays on top until the next one has presented a frame (revealStandby).
  // Called from play() with the time left in the clip; false when the next clip is not ready.
  prerollStandby(remainingMs) {
    const standby = this.standby, current = this.video, parent = current?.parentNode;
    if (!standby?.complete || standby.prerolled || !parent || standby.video === current) return false;
    const video = standby.video;
    video.style.display = 'block';
    // 0.65.6: a next clip still mounted under this one (a withdrawn pre-roll) stays where it is;
    // re-inserting it makes Chrome rebuild its layer (0.65.3).
    const inPlace = video.parentNode === parent && video.nextSibling === current;
    if (inPlace) { /* already under the current clip */ } else if (typeof parent.insertBefore === 'function') parent.insertBefore(video, current); else parent.append?.(video);
    if (video.parentNode === parent && typeof parent.append === 'function' && typeof parent.insertBefore !== 'function') parent.append(current); // keep the current clip on top
    video.muted = current.muted;
    const level = current.volume, fade = !video.muted && level > 0 && this.fadesAllowed();
    const clockNow = this.fadeClock.now?.() ?? performance.now(), endAt = performance.now() + remainingMs;
    const leadMs = Math.max((this.startLatencyMs ?? DEFAULT_START_LATENCY_MS) + PREROLL_MARGIN_MS, CHAIN_MIN_LEAD_MS);
    if (fade) {
      const fadeEnd = Math.max(clockNow, clockNow + remainingMs - CHAIN_FADE_IN_EARLY_MS);
      const start = Math.max(fadeEnd - this.crossfadeMs, clockNow + Math.max(0, remainingMs - leadMs));
      standby.fade = new VolumeRamp(video, { ...this.fadeClock, direction: 'in', level, startAt: Math.min(start, fadeEnd), durationMs: Math.max(1, fadeEnd - Math.min(start, fadeEnd)) });
    } else video.volume = level;
    const delay = endAt - leadMs - performance.now();
    const token = {};
    standby.prerolled = { endAt, fade, cueTime: video.currentTime, token };
    standby.chain = { playLeadMs: Math.round(Math.min(leadMs, remainingMs)), playAt: null, firstFrameAt: null, firstFrameMediaMs: null, presentedFrames: null };
    standby.prerollTimer = setTimeout(() => {
      if (this.standby !== standby || standby.prerolled?.token !== token) return;
      standby.chain.playAt = performance.now();
      // The first frame the next clip presents after it starts: until then it may show nothing.
      // 0.65.6: each later frame until the reveal updates presentedFrames, which the
      // report gives as revealPresentedFrames (how many frames the next clip had shown by then).
      const watch = (_now, metadata) => {
        if (standby.prerolled?.token !== token && !standby.revealing) return;
        if (Number.isSafeInteger(metadata?.presentedFrames)) standby.chain.presentedFrames = metadata.presentedFrames;
        if (standby.chain.firstFrameAt === null) {
          standby.chain.firstFrameAt = performance.now();
          standby.chain.firstFrameMediaMs = Number.isFinite(metadata?.mediaTime) ? Math.round(metadata.mediaTime * 1000) : null;
          standby.onFirstFrame?.();
        }
        if (!standby.revealedVia) try { video.requestVideoFrameCallback?.(watch); } catch {}
      };
      try { video.requestVideoFrameCallback?.(watch); } catch {}
      void Promise.resolve().then(() => video.play()).catch(() => {});
    }, Math.max(0, delay));
    return true;
  }

  // 0.65.3: the current clip has ended. Hide it only once the next clip has
  // presented a frame (or after CHAIN_REVEAL_CAP_MS): hiding it earlier showed the next
  // element before it had a picture, which is black. The ended clip keeps its last frame.
  revealStandby(standby, previous, done) {
    if (!standby?.prerolled || standby.revealing) { done?.(); return; }
    standby.revealing = true;
    const endedAt = performance.now();
    const reveal = via => {
      if (standby.revealedVia) return;
      clearTimeout(standby.revealTimer); standby.onFirstFrame = null;
      standby.revealedVia = via;
      standby.chain.revealMs = Math.round(performance.now() - endedAt);
      standby.chain.revealPresentedFrames = standby.chain.presentedFrames;
      if (previous) previous.style.display = 'none';
      try { this.onPresentationChange?.(); } catch {}
      done?.();
    };
    standby.chain.endedAt = endedAt;
    if (standby.chain.firstFrameAt !== null) { reveal('already-presenting'); return; }
    standby.onFirstFrame = () => reveal('first-frame');
    standby.revealTimer = setTimeout(() => reveal('cap'), CHAIN_REVEAL_CAP_MS);
  }

  // Chain telemetry for the play result (times relative to the current clip's end).
  chainReport(standby) {
    const c = standby?.chain;
    if (!c) return null;
    const rel = t => (Number.isFinite(t) && Number.isFinite(c.endedAt) ? Math.round((t - c.endedAt) * 10) / 10 : null);
    return { playLeadMs: c.playLeadMs, playMs: rel(c.playAt), firstFrameMs: rel(c.firstFrameAt), firstFrameMediaMs: c.firstFrameMediaMs,
      revealVia: standby.revealedVia ?? 'pending', revealMs: Number.isFinite(c.revealMs) ? c.revealMs : null,
      revealPresentedFrames: Number.isSafeInteger(c.revealPresentedFrames) ? c.revealPresentedFrames : null };
  }

  // A viewer pause or seek in the last moments of a chained clip: stop the next clip again and
  // put it back on its first frame; the next ending notice pre-rolls it afresh.
  withdrawStandbyPreroll() {
    const standby = this.standby;
    if (!standby?.prerolled) return;
    clearTimeout(standby.prerollTimer); clearTimeout(standby.revealTimer); standby.fade?.abandon?.(); standby.fade = null;
    const started = Number.isFinite(standby.chain?.playAt);
    standby.onFirstFrame = null; standby.revealing = false; standby.chain = null;
    const { cueTime } = standby.prerolled; standby.prerolled = null;
    // 0.65.6: a next clip whose play timer never fired is still on its first frame:
    // no seek (a covered seek is what may leave its layer without a picture at the join).
    if (!started) return;
    try { standby.video.pause(); if (Number.isFinite(cueTime)) standby.video.currentTime = cueTime; } catch {}
  }

  // Swap the prepared next clip into the mounted position of the current one
  // without uncovering: the current clip's held last frame stays on top until
  // the next clip presents its first frame. A pre-rolled next clip (W7) is already
  // mounted under the current one and playing: it keeps its own volume ramp and its place in
  // the DOM (0.65.3: re-appending the playing element made Chrome rebuild its layer, black
  // until its next frame) and is simply made current; the hidden previous clip is removed.
  async advance(signal) {
    assertActive(signal);
    const next = this.standby;
    if (!next?.complete) throw new Error("Next local clip is not prepared");
    const previous = this.video, parent = previous?.parentNode;
    if (!parent) throw new Error("Overlay is not mounted");
    this.standby = null;
    const held = this.heldFrame; this.heldFrame = null;
    this.transitionHeldFrame = held;
    this.resetDecoderLifetime();
    this.releaseAudioFade();
    const inPlace = Boolean(next.prerolled) && next.video.parentNode === parent;
    if (next.prerolled) {
      // Already under the current clip and playing (W7): keep its fade-in, drop the previous one.
      clearTimeout(next.prerollTimer);
      if (next.fade) this.audioFade = next.fade;
      if (next.video.paused) void Promise.resolve().then(() => next.video.play()).catch(() => {});
      if (!next.revealedVia) { clearTimeout(next.revealTimer); next.onFirstFrame = null; next.revealedVia = 'advance'; }
      next.prerolled = null;
    } else { next.video.muted = previous.muted; next.video.volume = previous.volume; }
    next.video.style.display = "block";
    if (!inPlace) parent.append(next.video);
    this.video = next.video; this.source = next.source;
    try { previous.pause(); previous.removeAttribute("src"); previous.load(); previous.remove(); } catch {}
    if (held) {
      const release = () => {
        held.remove();
        if (this.transitionHeldFrame === held) this.transitionHeldFrame = null;
        try { this.onPresentationChange?.(); } catch {}
      };
      setTimeout(release, 500);
      try { next.video.requestVideoFrameCallback?.(release); } catch { release(); }
    }
  }

  indexKeyframes(source) {
    if (typeof source !== "string") return Promise.resolve(null);
    if (!this.keyframeIndex.has(source)) {
      if (this.keyframeIndex.size >= 16) this.keyframeIndex.delete(this.keyframeIndex.keys().next().value);
      const fetchBlob = globalThis.fetch ? fetch(source).then(response => response.blob()) : Promise.reject(Error("no fetch"));
      this.keyframeIndex.set(source, fetchBlob.then(keyframeTimes, () => null));
    }
    return this.keyframeIndex.get(source);
  }

  async prepare(source, signal) {
    assertActive(signal);
    this.cancelPreroll(); this.releaseAudioFade();
    void this.indexKeyframes(source);
    if (this.standby?.complete && this.standby.source === source && !(this.video && this.source === source)) {
      // Promote the already-loaded next decoder instead of loading again.
      const standby = this.standby; this.standby = null;
      await this.teardown();
      this.video = standby.video; this.source = standby.source;
      if (standby.primed) this.primedVideo = standby.video;
      const video = this.video, generation = this.generation;
      await this.rewind(video, AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]));
      if (this.video !== video || this.generation !== generation) throw abortError('Local decoder replaced');
      return Object.freeze({ readyState: video.readyState });
    }
    if (this.video && this.source === source && this.video.readyState >= 3) {
      this.resetDecoderLifetime();
      this.video.pause(); this.heldFrame?.remove(); this.heldFrame = null;
      const video = this.video, generation = this.generation;
      await this.rewind(video, AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]));
      if (this.video !== video || this.generation !== generation) throw abortError('Local decoder replaced');
      return Object.freeze({ readyState: video.readyState });
    }
    const generation = this.generation + 1;
    await this.teardown();
    assertActive(signal);
    if (this.generation !== generation) throw abortError('Local decoder replaced');
    signal = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    this.video = this.createVideo();
    const video = this.video;
    this.source = source;
    this.video.src = source;
    this.video.load();
    if (this.video.readyState < 3) {
      await waitForVideo(video, ["canplay", "loadeddata", "progress"], { signal, condition: () => video.readyState >= 3 });
    }
    assertActive(signal);
    if (this.video !== video || this.generation !== generation) throw abortError('Local decoder replaced');
    if (video.readyState < 3) throw new Error("Local overlay did not reach start readiness");
    await this.rewind(video, signal);
    return Object.freeze({ readyState: video.readyState });
  }

  async rewind(video, signal) {
    assertActive(signal);
    if (video.currentTime === 0 && !video.seeking) return;
    video.currentTime = 0;
    if (video.seeking || video.readyState < 3) {
      await waitForVideo(video, ["seeked", "canplay", "loadeddata"], {
        signal, condition: () => !video.seeking && video.readyState >= 3 && video.currentTime <= 0.001
      });
    }
    assertActive(signal);
  }

  // Position the prepared clip part-way in, for a viewer who seeked into the
  // middle of a replaced interval. The clip and the interval can differ in length,
  // so the entry point is proportional.
  async cue(fraction, signal) {
    assertActive(signal);
    this.cancelPreroll();
    if (!this.video) throw new Error("Overlay was not prepared");
    this.releaseAudioFade();
    if (!Number.isFinite(fraction) || fraction < 0 || fraction >= 1) throw new RangeError("Cue fraction must be in [0, 1)");
    const video = this.video, generation = this.generation;
    signal = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    const assertCurrent = () => {
      assertActive(signal);
      if (this.video !== video || this.generation !== generation) throw abortError('Local decoder replaced');
    };
    if (!Number.isFinite(video.duration)) return { positionMs: 0 };
    // Preserve enough clip tail for playback. The keyframe displacement bound
    // is relative to this guarded target, not an unsafe near-ended position.
    const maximumPosition = Math.max(0, video.duration - 0.5);
    const target = Math.min(fraction * video.duration, maximumPosition);
    let keyframes = null;
    if (target > 0) {
      try {
        keyframes = await boundedOperation(() => this.indexKeyframes(this.source), {
          signal, timeoutMs: 150, label: 'entry-keyframe-index'
        });
      } catch {
        // Index failure or delay costs precision-seek work, never a large replay.
        // Cancellation still belongs to the caller/decoder and must propagate.
        assertCurrent();
      }
    }
    assertCurrent();
    const keyframePosition = entryPosition(target, keyframes);
    const position = Math.min(keyframePosition + (keyframePosition === target ? 0 : 0.001),
      target + ENTRY_KEYFRAME_TOLERANCE_SECONDS, maximumPosition);
    // Already there (a freshly prepared clip entered at its first keyframe): no seek.
    if (Math.abs(video.currentTime - position) < 0.01 && Math.abs(video.currentTime - target) <= ENTRY_KEYFRAME_TOLERANCE_SECONDS &&
      video.currentTime <= maximumPosition && !video.seeking && video.readyState >= 2) return { positionMs: Math.round(video.currentTime * 1000) };
    video.currentTime = position;
    await waitForVideo(video, ["seeked", "canplay"], {
      signal,
      condition: () => !video.seeking && video.readyState >= 2
    });
    assertCurrent();
    return { positionMs: Math.round(video.currentTime * 1000) };
  }

  async mount(host, signal) {
    assertActive(signal);
    if (!this.video) throw new Error("Overlay was not prepared");
    host.append(this.video);
  }

  // Undo a staged mount without releasing the prepared decoder, so a cancelled
  // stage can be staged again or played through the normal path.
  async unmount(signal) {
    assertActive(signal);
    this.cancelPreroll(); this.releaseAudioFade();
    if (!this.video) return;
    this.video.pause();
    this.video.style.display = "none";
    this.video.remove();
  }

  async configureAudio(snapshot, gainDb = 0, signal) {
    assertActive(signal);
    if (!this.video) throw new Error("Overlay was not prepared");
    const muted = snapshot?.muted === true, volume = localPlaybackVolume(snapshot?.volume, gainDb);
    const fade = this.audioFade;
    if (fade?.active && fade.element === this.video && !muted) {
      // A fade is under way (the cut's fade-in): it takes the confirmed level as
      // its ceiling instead of jumping to it.
      this.video.muted = false; fade.setLevel(volume);
      if (fade.active) return Object.freeze({ muted: false, volume, gainDb });
    }
    if (fade) this.releaseAudioFade();
    this.video.muted = muted;
    this.video.volume = volume;
    return Object.freeze({ muted: this.video.muted, volume: this.video.volume, gainDb });
  }

  async primeForPlayback(signal) {
    assertActive(signal);
    if (!this.video) return;
    // 0.65.7: already warmed as the standby and still paused on its first frame (short-gap priming).
    if (this.primedVideo) {
      const video = this.primedVideo; this.primedVideo = null;
      if (video === this.video && video.paused && !video.seeking && video.currentTime === 0) return;
    }
    const warmup = this.beginMotion();
    const video = this.video, generation = this.generation, attempt = ++this.playAttempt;
    signal = AbortSignal.any([this.lifetime.signal, warmup.signal, ...(signal ? [signal] : [])]);
    assertActive(signal);
    const owns = () => this.video === video && this.generation === generation && this.playAttempt === attempt;
    const previousMuted = video.muted;
    let releasedMute = false;
    const releaseMute = () => {
      if (releasedMute) return; releasedMute = true;
      if (owns()) { video.pause(); if (video.muted === true) video.muted = previousMuted; }
    };
    video.muted = true;
    // A superseding play starts synchronously. Restore the warmup-owned mute
    // during abort, not in a later finally that could overwrite the new play.
    signal.addEventListener('abort', releaseMute, { once: true });
    let firstFrame = null;
    try {
      const startedAt = performance.now();
      // The first presented frame after play() gives this decoder's start-up
      // latency, which a planned cut uses to start the clip early.
      // Measure to the first *moving* frame: the callback can first re-present the
      // paused frame, which would understate the latency.
      const from = video.currentTime;
      firstFrame = observeFirstMovingFrame(video, from, signal);
      await boundedOperation(() => {
        const playing = video.play();
        void playing.then(() => {
          if (signal.aborted && this.video === video && this.playAttempt === attempt) video.pause();
        }, () => {});
        return playing;
      }, { signal, timeoutMs: 3000, label: 'local-warmup' });
      const presentedAt = await firstFrame.promise;
      if (Number.isFinite(presentedAt)) this.startLatencyMs = Math.min(250, Math.max(30, presentedAt - startedAt));
      assertActive(signal);
      if (!owns()) throw abortError('Local decoder replaced');
      video.pause();
      await this.rewind(video, signal);
    } finally {
      firstFrame?.cancel();
      warmup.abort();
      releaseMute(); signal.removeEventListener('abort', releaseMute);
      if (this.motion === warmup) this.motion = null;
    }
  }

  async show(signal) {
    assertActive(signal);
    if (!this.video) throw new Error("Overlay was not prepared");
    this.video.style.display = "block";
    try { this.onPresentationChange?.(); } catch {}
  }

  holdDecodedFrame(video, mediaTime = null) {
    try {
      const canvas = this.document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      if (!canvas.width || !canvas.height || !video.parentNode) return false;
      canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0);
      Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', background: '#000', zIndex: '2147483647', pointerEvents: 'none' });
      video.parentNode.append(canvas); this.heldFrame = canvas;
      canvas.sceneTimingMediaTime = mediaTime;
      try { this.onPresentationChange?.(); } catch {}
      return true;
    } catch { return false; }
  }

  play(signal, { profileClass = "mvp", chainNext = false } = {}) {
    assertActive(signal);
    if (!this.video) throw new Error("Overlay was not prepared");
    // Adopt a clip a planned cut already started; its audio follows configureAudio
    // (and keeps the cut's fade-in running).
    this.cancelPreroll({ keepPlaying: true });
    const durationLimit = maximumAssetDurationMs(profileClass), motion = this.beginMotion();
    const video = this.video;
    if (this.primedVideo === video) this.primedVideo = null;
    if (video.paused && this.firstFrameStamp?.video !== video) this.stampFirstFrame(video);
    this.heldFrame?.remove(); this.heldFrame = null;
    signal = AbortSignal.any([this.lifetime.signal, motion.signal, ...(signal ? [signal] : [])]);
    const generation = this.generation, attempt = ++this.playAttempt;
    const owns = () => this.video === video && this.generation === generation && this.playAttempt === attempt;
    return new Promise((resolve, reject) => {
      let settled = false;
      let frameCallbackId = null;
      let resumedFrom = null, resumeTimer = null;
      let previousMediaTime = null;
      let previousPresentedFrames = null;
      let frameDurationSeconds = DEFAULT_FRAME_DURATION_SECONDS;
      let frameHoldMode = 'natural-end', heldFrameMediaTimeMs = null, chained = false;
      const expectedDurationMs = Number.isFinite(video.duration) ? video.duration * 1000 : 5000;
      // The deadline counts playing time only. Buffering (waiting, or stalled
      // without enough data) suspends it and draws on a cumulative stall budget,
      // so a slow disk or cloud-synced file is not cut off; a clip that stops
      // making progress fails as local-stall and native resumes at the join.
      // A viewer's pause suspends it too, within the shared pause budget.
      const deadline = pausableDeadline(Math.min(durationLimit + 5000, Math.max(3000, expectedDurationMs + 2000)),
        () => finish(new Error("Local overlay playback timed out")), { now: () => this.now() });
      let stalledMs = 0, stalledAt = null, stallTimer = null, viewerPaused = false;
      const endStall = () => { clearTimeout(stallTimer); stallTimer = null; stalledMs += this.now() - stalledAt; stalledAt = null; };
      const onStall = () => {
        if (settled || viewerPaused || stalledAt !== null || (video.readyState ?? 0) >= 3) return;
        deadline.pause(); stalledAt = this.now();
        stallTimer = setTimeout(() => finish(Object.assign(new Error("private-local-stall"), { code: "local-stall" })), Math.max(0, LOCAL_STALL_BUDGET_MS - stalledMs));
      };
      const onProgress = () => {
        if (settled || stalledAt === null || (video.readyState ?? 0) < 3) return;
        endStall(); if (!viewerPaused) deadline.resume();
      };
      const control = {
        pause() {
          if (settled || viewerPaused) return;
          viewerPaused = true; if (stalledAt !== null) endStall();
          deadline.pause(); video.pause(); withdrawEnding();
        },
        resume() {
          if (settled || !viewerPaused) return;
          viewerPaused = false; deadline.resume();
          { const at = video.currentTime; resumedFrom = Number.isFinite(at) ? at : null; }
          Promise.resolve().then(() => video.play()).catch(error => finish(error));
        },
        seek(deltaMs) {
          if (settled || !Number.isFinite(video.duration)) return;
          // Never seek onto the final frame guard; the natural end completes the scene.
          const from = video.currentTime, to = Math.min(Math.max(0, from + deltaMs / 1000), Math.max(0, video.duration - 0.25));
          if (to < from) deadline.extend((from - to) * 1000);
          video.currentTime = to; resumedFrom = null; withdrawEnding();
        },
        mute(muted) { if (!settled) video.muted = muted === true; },
        // The page asks for the end fade once native is set to fade in (E58).
        fadeOut(on, endInMs = null) {
          if (settled) return { status: 'skipped', reason: 'clip-finished' };
          fadeWanted = on === true;
          if (!fadeWanted) { cancelEndFade(); return { status: 'cancelled' }; }
          if (video.paused || viewerPaused || !Number.isFinite(video.duration)) return { status: 'skipped', reason: 'clip-not-playing' };
          // 0.62.14: 'cut' is the Smooth-off exit (a hard cut, no fade).
          fadeMode = endInMs === 'cut' ? 'cut' : 'fade';
          // 0.62.11: native is already at full level (it runs ahead): finish sooner, from
          // wherever the fade is now, instead of overlapping the two for longer.
          if (Number.isFinite(endInMs)) return shortenFade(Math.max(1, Math.min(endInMs, remaining())));
          return fadeOutAt(clock() + remaining());
        },
        get paused() { return viewerPaused; }
      };
      this.playControl = control;
      // Tell the page when the clip will end, shortly before, so native can be
      // started early under the cover and uncovered on its first frame at the join.
      let endingTimer = null;
      const remaining = () => (video.duration - video.currentTime) * 1000 / (video.playbackRate || 1);
      const clock = () => this.fadeClock.now?.() ?? performance.now();
      const announceEnding = () => {
        clearTimeout(endingTimer); endingTimer = null;
        if (settled || (typeof this.onLocalEnding !== "function" && !chainNext) || !Number.isFinite(video.duration) || video.paused || viewerPaused) return;
        const notify = () => {
          if (settled || video.paused || viewerPaused || this.video !== video) return;
          // W7: a chained next clip starts under this one; this clip fades out at its end.
          if (chainNext && this.prerollStandby(remaining())) {
            chained = true;
            if (this.standby?.prerolled?.fade) { fadeWanted = true; fadeMode = 'fade'; }
          }
          if (fadeWanted) fadeOutAt(clock() + remaining());
          if (typeof this.onLocalEnding === "function") try { this.onLocalEnding(performance.timeOrigin + performance.now() + remaining()); } catch {}
        };
        if (remaining() <= ENDING_NOTICE_MS) notify(); else endingTimer = setTimeout(notify, remaining() - ENDING_NOTICE_MS);
      };
      // E58: when the page has native fading in at the join (fadeOut(true)), the
      // clip reaches zero volume at its own end over the same window. Both ends of
      // the window are on this clip's end, which is the join. A viewer pause or
      // seek cancels it; the page asks again with the next ending notice.
      let endFade = null, fadeWanted = false, fadeEndAt = null, endFadeReport = null, fadeMode = 'fade';
      const fadeMs = this.exitFadeMs || this.crossfadeMs;
      const shortenFade = durationMs => {
        if (!endFade?.active || this.audioFade !== endFade) return { status: 'skipped', reason: 'clip-not-playing' };
        const now = clock(), end = now + durationMs, remainingMs = Math.round(fadeEndAt - end);
        if (end >= fadeEndAt) return { status: 'scheduled', startMs: -fadeMs, endMs: 0 };
        const gain = endFade.currentGain(), previous = endFade;
        previous.abandon();
        endFade = new VolumeRamp(video, { ...this.fadeClock, direction: 'out', level: previous.level, scale: gain, startAt: now, durationMs, trace: true });
        endFade.trace = [...(previous.trace ?? []), ...(endFade.trace ?? [])].slice(-48);
        this.audioFade = endFade;
        return { status: 'scheduled', startMs: -fadeMs, endMs: 0, shortenedMs: Math.max(0, remainingMs) };
      };
      // 0.62.14: Chrome drops the last ~25 ms of an ending clip's audio, so the clip is silent
      // EXIT_CLIP_TAIL_MARGIN_MS before its end: faded over [end - margin - 30, end - margin]
      // (Smooth on) or cut there (off). Times stay relative to the clip's end.
      const fadeOutAt = endAt => {
        const span = fadeMode === 'cut' ? 1 : fadeMs, stop = endAt - EXIT_CLIP_TAIL_MARGIN_MS, from = stop - span;
        const report = () => ({ status: 'scheduled', startMs: -(EXIT_CLIP_TAIL_MARGIN_MS + span), endMs: -EXIT_CLIP_TAIL_MARGIN_MS,
          ...(clock() > from ? { lateMs: Math.round(clock() - from) } : {}) });
        // A repeated notice re-aims a fade that has not begun; a running one keeps going.
        if (endFade?.active && this.audioFade === endFade) { if (endFade.retime(from)) fadeEndAt = endAt; return report(); }
        endFade = null;
        if (!crossfadeAllowed(this.document, this.crossfadeMs)) return { status: 'skipped', reason: 'hidden-tab' };
        if (video.muted || !(video.volume > 0)) return { status: 'skipped', reason: 'clip-muted' };
        if (this.video !== video) return { status: 'skipped', reason: 'clip-replaced' };
        if (this.audioFade?.element === video) this.releaseAudioFade();
        endFade = new VolumeRamp(video, { ...this.fadeClock, direction: 'out', level: video.volume, startAt: from, durationMs: span, trace: true });
        fadeEndAt = endAt;
        this.audioFade = endFade;
        return report();
      };
      const cancelEndFade = () => { if (endFade && this.audioFade === endFade) this.releaseAudioFade(); endFade = null; };
      const withdrawEnding = () => {
        clearTimeout(endingTimer); endingTimer = null; clearTimeout(resumeTimer); resumeTimer = null; fadeWanted = false; cancelEndFade();
        // Once this clip has ended the handover is under way (the next clip is playing): keep it.
        if (chained && !video.ended) { chained = false; frameHoldMode = 'natural-end'; this.withdrawStandbyPreroll(); }
        try { this.onLocalEnding?.(null); } catch {}
      };
      // 0.65.6: on 'playing' after a resume the clip's clock has not restarted
      // (its first new frame came ~52 ms later), so an end time read then was ~50 ms early and a
      // chained next clip started ~200 ms ahead instead of ~150 (4 frames skipped at the join).
      // After a resume the notice waits for a frame newer than the paused one.
      const announceAfterResume = () => {
        clearTimeout(resumeTimer); resumeTimer = null;
        if (resumedFrom === null) return;
        resumedFrom = null; announceEnding();
      };
      const awaitResumedFrame = () => {
        try {
          video.requestVideoFrameCallback((_now, metadata) => {
            if (settled || viewerPaused || resumedFrom === null) return;
            const media = metadata?.mediaTime;
            if (Number.isFinite(media) && media <= resumedFrom + 0.001) { awaitResumedFrame(); return; }
            announceAfterResume();
          });
        } catch { announceAfterResume(); }
      };
      const onPlaying = () => {
        if (resumedFrom === null || typeof video.requestVideoFrameCallback !== "function") { resumedFrom = null; announceEnding(); return; }
        clearTimeout(resumeTimer);
        resumeTimer = setTimeout(() => { if (!settled && !viewerPaused) announceAfterResume(); }, RESUME_FRAME_WAIT_MS);
        awaitResumedFrame();
      };
      // W7: at the end of a chained clip, hide it once the pre-rolled next clip shows a frame.
      let chainReport = null;
      const onEnded = () => {
        const standby = this.standby;
        if (!(chained && this.video === video && standby?.prerolled)) { finish(); return; }
        frameHoldMode = 'chain-handover';
        this.revealStandby(standby, video, () => { chainReport = this.chainReport(standby); finish(); });
      };
      const onError = () => finish(video.error ?? new Error("Local video failed"));
      const onAbort = () => finish(signal.reason ?? new DOMException("Aborted", "AbortError"));
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(endingTimer); clearTimeout(resumeTimer); video.removeEventListener("playing", onPlaying);
        // 0.62.10 diagnostics: how the end fade met the clip's actual end. endedAtMs < 0 with
        // gainAtEnd > 0 means the clip stopped before its fade reached zero (a cut-off tail).
        if (endFade && fadeEndAt !== null) {
          const rel = t => Math.round((t - fadeEndAt) * 10) / 10;
          let gainAtEnd = null; try { gainAtEnd = endFade.level > 0 ? Math.round(video.volume / endFade.level * 1000) / 1000 : null; } catch {}
          endFadeReport = { endedAtMs: rel(clock()), gainAtEnd, ended: video.ended === true,
            trace: (endFade.trace ?? []).map(([t, gain]) => [rel(t), Math.round(gain * 1000) / 1000]) };
        }
        // Ended (or stopped): its volume goes back to the clip's level, unheard.
        cancelEndFade();
        deadline.clear(); if (stalledAt !== null) endStall();
        if (this.playControl === control) this.playControl = null;
        if (frameCallbackId !== null && typeof video.cancelVideoFrameCallback === "function") {
          video.cancelVideoFrameCallback(frameCallbackId);
        }
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("error", onError);
        for (const type of ["waiting", "stalled"]) video.removeEventListener(type, onStall);
        for (const type of ["playing", "timeupdate", "canplay"]) video.removeEventListener(type, onProgress);
        signal?.removeEventListener("abort", onAbort);
        // Completion also closes the local play request: a pending native
        // play() promise must not restart a timeout or held-frame fallback.
        motion.abort(error ?? abortError('Local playback finished'));
        if (this.motion === motion) this.motion = null;
        if (error) { if (owns()) video.pause(); reject(error); }
        else {
          // E72 (0.64.3): the clip's decoder counts and this renderer's long animation frames over
          // its last second (ms relative to its end), where the browser reports them.
          if (this.longFrames === undefined) this.longFrames = longFrameLog(this.document.defaultView);
          const endedAt = performance.now(), quality = playbackQuality(video);
          const exitDiag = quality || this.longFrames ? { quality, longFrames: this.longFrames ? relativeLongFrames(this.longFrames.between(endedAt - 1000, endedAt), endedAt) : [] } : null;
          resolve({
          durationMs: video.duration * 1000,
          localTimeAtEndMs: video.currentTime * 1000,
          unplayedTailMs: Math.max(0, (video.duration - video.currentTime) * 1000),
          frameHoldMode, heldFrameMediaTimeMs, localEnded: video.ended === true, ...(endFadeReport ? { endFade: endFadeReport } : {}),
          ...(chainReport ? { chain: chainReport } : {}),
          ...(this.firstFrameReport(video) ? { firstFrame: this.firstFrameReport(video) } : {}),
          ...(stalledMs >= 1 ? { stalledMs: Math.min(LOCAL_STALL_BUDGET_MS, Math.round(stalledMs)) } : {}),
          ...(exitDiag ? { exitDiag } : {})
          });
        }
      };
      const watchFinalFrame = () => {
        if (typeof video.requestVideoFrameCallback !== "function") return;
        try { frameCallbackId = video.requestVideoFrameCallback((_now, metadata) => {
          frameCallbackId = null;
          if (settled) return;
          if (!owns()) { finish(abortError('Local playback superseded')); return; }
          const mediaTime = metadata?.mediaTime;
          if (Number.isFinite(mediaTime)) {
            const presentedFrames = Number.isSafeInteger(metadata?.presentedFrames) && metadata.presentedFrames > 0
              ? metadata.presentedFrames : null;
            if (Number.isFinite(previousMediaTime) && mediaTime > previousMediaTime &&
                previousPresentedFrames !== null && presentedFrames !== null && presentedFrames > previousPresentedFrames) {
              // rVFC delivery can skip many presented frames. Its callback gap
              // is not a frame duration and must not widen the final-frame hold.
              frameDurationSeconds = Math.min(
                MAX_END_GUARD_SECONDS,
                Math.max(MIN_END_GUARD_SECONDS, (mediaTime - previousMediaTime) / (presentedFrames - previousPresentedFrames))
              );
            }
            previousMediaTime = mediaTime;
            previousPresentedFrames = presentedFrames;
            const endGuardSeconds = Math.min(
              MAX_END_GUARD_SECONDS,
              Math.max(MIN_END_GUARD_SECONDS, frameDurationSeconds * 1.1)
            );
            if (Number.isFinite(video.duration) && video.duration - mediaTime <= endGuardSeconds && chained) {
              // W7: no held canvas: the next clip, already playing underneath, shows when this one ends.
              heldFrameMediaTimeMs = mediaTime * 1000; frameHoldMode = 'chain-handover';
              return;
            }
            if (Number.isFinite(video.duration) && video.duration - mediaTime <= endGuardSeconds) {
              heldFrameMediaTimeMs = mediaTime * 1000;
              if (this.holdDecodedFrame(video, mediaTime)) {
                // Only the selected local clip is sampled. Its audio continues
                // to natural completion while a retained image covers ended.
                frameHoldMode = 'local-canvas-audio-to-ended';
              } else {
                frameHoldMode = 'paused-frame-fallback';
                try { video.pause(); finish(); } catch (error) { finish(error); }
              }
              return;
            }
          }
          watchFinalFrame();
        }); } catch (error) { finish(error); }
      };
      video.addEventListener("ended", onEnded, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.addEventListener("playing", onPlaying);
      for (const type of ["waiting", "stalled"]) video.addEventListener(type, onStall);
      for (const type of ["playing", "timeupdate", "canplay"]) video.addEventListener(type, onProgress);
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        watchFinalFrame();
        if (!settled) video.play().then(() => {
          // A same-decoder prepare still intends pause; a newer play/warmup
          // changes playAttempt and must never be paused by this completion.
          if (signal.aborted && this.video === video && this.playAttempt === attempt) video.pause();
          else announceEnding();
        }, finish);
      } catch (error) { finish(error); }
    });
  }

  // Start the staged clip, still covered, so it is already moving when a planned
  // cut reveals it: at epochMs minus the start-up latency measured during warm-up.
  // Its audio fades in to end at audioEndAtMs, when native stops (or it plays
  // muted when fades are off). play() adopts it; configureAudio after the cut
  // confirms its level. Anything that stops or replaces the clip cancels it.
  prerollAt(epochMs, signal, { audioEndAtMs = null, fadeMs = null } = {}) {
    assertActive(signal);
    this.cancelPreroll();
    const video = this.video;
    if (!video) return;
    // The warm-up measures a warm pipeline; a clip started from its paused first
    // frame at the cut is slower, so start a little earlier. Starting early at
    // worst skips the clip's first frame; late would hold it.
    const delay = epochMs - (this.startLatencyMs ?? DEFAULT_START_LATENCY_MS) - PREROLL_MARGIN_MS - (performance.timeOrigin + performance.now());
    const preroll = { video, muted: video.muted, started: false };
    preroll.timer = setTimeout(() => {
      if (this.preroll !== preroll || this.video !== video || !video.paused) return;
      preroll.started = true;
      // E58: rather than muted, the clip plays from zero volume and fades in
      // (equal power) over the crossfadeMs before the cut, while native fades out.
      // Only when the page sends the audio end (fades on): otherwise muted, as in 0.62.5.
      if (Number.isFinite(audioEndAtMs) && !preroll.muted && this.fadesAllowed() && video.volume > 0) {
        this.releaseAudioFade();
        // Ends when native stops. A clip started inside that window fades from its
        // own start instead of jumping in part-way (at least half a fade long).
        const end = audioEndAtMs - performance.timeOrigin, now = this.fadeClock.now?.() ?? performance.now();
        // fadeMs 0 (Smooth audio off, 0.62.14): no fade, a step from 0 to full at the cut,
        // with the clip's audio output already running. Otherwise unchanged.
        const hard = fadeMs === 0;
        const start = hard ? Math.max(end - 1, now) : Math.max(end - this.crossfadeMs, now);
        preroll.fade = new VolumeRamp(video, { ...this.fadeClock, direction: 'in', level: video.volume,
          startAt: start, durationMs: hard ? 1 : Math.max(this.crossfadeMs / 2, end - start) });
        this.audioFade = preroll.fade;
      } else video.muted = true;
      if (this.primedVideo === video) this.primedVideo = null;
      this.stampFirstFrame(video);
      void video.play().catch(() => {});
    }, Math.max(0, delay));
    this.preroll = preroll;
  }

  cancelPreroll({ keepPlaying = false } = {}) {
    const preroll = this.preroll; this.preroll = null;
    if (!preroll) return;
    clearTimeout(preroll.timer);
    if (preroll.started && !keepPlaying) {
      if (preroll.fade && this.audioFade === preroll.fade) this.releaseAudioFade();
      try { preroll.video.pause(); preroll.video.muted = preroll.muted; } catch {}
    }
  }

  // Viewer keys while a replacement plays. They act only on the playing attempt.
  playing() { if (!this.playControl) throw Error("Local clip is not playing"); return this.playControl; }
  localPause(signal) { assertActive(signal); this.playing().pause(); }
  localResume(signal) { assertActive(signal); this.playing().resume(); }
  localSeek(deltaMs, signal) { assertActive(signal); this.playing().seek(deltaMs); }
  localMute(muted, signal) { assertActive(signal); this.playing().mute(muted); }
  localFadeOut(on, signal, endInMs = null) {
    assertActive(signal);
    if (!this.playControl) return { status: 'skipped', reason: 'clip-not-playing' };
    return this.playControl.fadeOut(on === true, endInMs);
  }

  async stop(signal) {
    assertActive(signal);
    this.cancelPreroll(); this.releaseAudioFade();
    if (this.standby?.prerolled) this.releaseStandby(); // W7: a started next clip stops too
    this.motion?.abort(abortError('Local playback stopped'));
    if (this.video) this.video.pause();
  }

  async teardown(signal) {
    assertActive(signal);
    this.cancelPreroll(); this.releaseAudioFade();
    this.primedVideo = null; this.firstFrameStamp = null;
    if (this.standby?.prerolled) this.releaseStandby(); // W7: a started next clip stops too
    this.resetDecoderLifetime();
    this.heldFrame?.remove(); this.heldFrame = null;
    if (!this.video) return;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
    this.video = null;
    this.source = null;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  forceTeardown(signal) {
    assertActive(signal);
    this.cancelPreroll(); this.releaseAudioFade();
    this.primedVideo = null; this.firstFrameStamp = null;
    this.releaseStandby();
    this.resetDecoderLifetime();
    this.heldFrame?.remove(); this.heldFrame = null;
    if (this.video) {
      try { this.video.pause(); } catch {}
      try { this.video.removeAttribute("src"); } catch {}
      try { this.video.remove(); } catch {}
    }
    this.video = null;
    this.source = null;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}
