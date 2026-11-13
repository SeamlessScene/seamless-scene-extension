// Opt-in scene timing recorder for tuning on real players (Settings → Advanced →
// "Record scene timing"). While on, it records video frame callbacks, sampled
// cover and transport state, and engine state changes on the controller clock.
// Private renderer timestamps require retained cross-domain calibration. A
// report attributes callback timing around transitions;
// callback metadata does not prove what pixels reached the screen. It holds
// media times and timings only:
// no titles, account data, URLs or pixels.
import { createFrameTimingStream } from './frame-timing-stream.mjs';
import { analyzeTiming } from './timing-analysis.mjs';
export { analyzeTiming } from './timing-analysis.mjs';
export const TIMING_SCHEMA = 'seamless-timing-v4';
const MAX_EVENTS = 2_000;

const push = (list, value, max) => { list.push(value); if (list.length > max) list.splice(0, list.length - max); };
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const median = values => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export function createTransitionTiming({ window, getPlayer, getHost, clock = () => performance.timeOrigin + performance.now() }) {
  const cover = [], events = [], refresh = [];
  const native = createFrameTimingStream({ window, getPlayer, clock, maximumFrames: 20000 });
  let enabled = false, animation = null, lastCover = null, lastTick = null;
  const dropped = { cover: 0, events: 0 };
  const tick = timestamp => {
    if (!enabled) return;
    if (lastTick !== null) push(refresh, timestamp - lastTick, 240);
    lastTick = timestamp;
    let host = null; try { host = getHost(); } catch {}
    // 0.62.18: a staged cover is visible at opacity 0 (invisible), so only an opaque-enough
    // cover counts as covered.
    const state = host?.isConnected && host.style?.visibility === 'visible' && !(host.style?.opacity && Number(host.style.opacity) < 0.5) ? 'covered' : 'open';
    if (state !== lastCover) { if (cover.length === MAX_EVENTS) dropped.cover++; push(cover, [round(clock()), state], MAX_EVENTS); lastCover = state; }
    animation = window.requestAnimationFrame(tick);
  };
  return {
    get enabled() { return enabled; },
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on === true;
      native.setEnabled(enabled);
      if (enabled) { lastCover = null; lastTick = null; animation = window.requestAnimationFrame(tick); mark('recording-started'); }
      else { if (animation !== null) window.cancelAnimationFrame(animation); animation = null; }
    },
    mark,
    clear() { native.clear(); cover.length = events.length = refresh.length = 0; lastCover = null; lastTick = null; dropped.cover = dropped.events = 0; },
    report({ clip = [], metrics = null, environment = {} } = {}) {
      return Object.freeze({ schema: TIMING_SCHEMA, recordedAt: new Date(clock()).toISOString(), recording: enabled,
        environment: { ...environment, displayFrameMs: round(median(refresh) ?? NaN) },
        ...analyzeTiming({ native: native.snapshot(), cover, clip: clip && !Array.isArray(clip) ? { ...clip, clockCalibration: clip.clockCalibration ?? null } : clip, events }), retention: { ...dropped }, metrics });
    }
  };
  function mark(name, detail = {}) { if (enabled) { if (events.length === MAX_EVENTS) dropped.events++; push(events, [round(clock()), name, detail], MAX_EVENTS); } }
}

// Marks each transition's scene and the viewer's seeks, for the report.
export function watchTransitions(timing, { engine, document, getPlayer, signal }) {
  engine.addEventListener('statechange', event => {
    const state = event.detail?.state;
    timing.mark('state', { state });
    const segment = engine.segment;
    if (state === 'PREFLIGHT' && segment) timing.mark('transition', { triggerMs: segment.triggerMs, resumeMs: segment.resumeMs, action: segment.action ?? 'REPLACE', entry: segment.entryFraction !== undefined });
  }, { signal });
  // 0.65.7: which caller cleared the edit (a known code, never free text).
  engine.addEventListener('session-cleared', event => timing.mark('session-cleared', { reason: event.detail?.reason ?? 'other' }), { signal });
  document.addEventListener('seeking', event => {
    if (event.target?.dataset?.sceneSubstitutionOverlay === 'true') return;
    if (getPlayer && event.target !== getPlayer()) return;
    timing.mark('native-seeking', { toMs: Math.round((event.target?.currentTime ?? 0) * 1000) });
  }, { capture: true, signal });
}

export function timingEnvironment({ navigator, document, player, version }) {
  const brands = navigator.userAgentData?.brands ?? [];
  return { extensionVersion: version, platform: navigator.userAgentData?.platform ?? navigator.platform ?? null,
    chrome: brands.find(brand => /Chrom/.test(brand.brand))?.version ?? (/Chrome\/(\d+)/.exec(navigator.userAgent ?? '')?.[1] ?? null),
    devicePixelRatio: globalThis.devicePixelRatio ?? null, cores: navigator.hardwareConcurrency ?? null,
    fullscreen: Boolean(document.fullscreenElement), video: player ? { width: player.videoWidth, height: player.videoHeight } : null };
}
