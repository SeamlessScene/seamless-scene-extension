import { auditEdge } from './timing-edge-audit.mjs';
import { mapClockTiming } from './clock-timing-map.mjs';

// E92 (0.66.1): the replacement clip pauses and ends by itself at its scheduled end, just before the
// uncover (45-57 ms in the 11-05 store test). A pause or end that starts this close to the sampled
// uncover is the clip finishing, not the viewer interrupting playback.
const CLIP_END_GRACE_MS = 150;
const round = n => Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
const median = values => values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;
const unavailable = reason => ({ status: 'insufficient-evidence', reason, largestGapMs: null, lowerBoundMs: null });
function at(rows, time) {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (rows[mid][0] <= time) lo = mid + 1; else hi = mid; }
  return rows[lo - 1] ?? null;
}
function stream(value) {
  if (!value || Array.isArray(value) || !Array.isArray(value.states) || !Array.isArray(value.spans)) return null;
  const frames = [...value.frames].sort((a, b) => a[0] - b[0]), byId = new Map();
  for (const frame of frames) { if (!byId.has(frame[2])) byId.set(frame[2], []); byId.get(frame[2]).push(frame); }
  return { ...value, frames, states: [...value.states].sort((a, b) => a[0] - b[0]),
    playback: [...(value.playback ?? [])].sort((a, b) => a[0] - b[0]), byId };
}
function picture(source, time) {
  if (!source) return null;
  const state = at(source.states, time);
  if (!state || state[1] === null) return null;
  if (state[2] === 'held') return Number.isFinite(state[3]) ? { id: state[1], media: state[3] } : null;
  if (state[2] !== 'video') return null;
  const frame = at(source.byId.get(state[1]) ?? [], time);
  return frame ? { id: frame[2], media: frame[1] } : null;
}
function cadence(source) {
  if (!source) return null;
  const deltas = [];
  for (const frames of source.byId.values()) for (let i = 1; i < frames.length; i++) {
    const d = frames[i][0] - frames[i - 1][0]; if (d > 0 && d < 200) deltas.push(d);
  }
  return round(median(deltas));
}

export function analyzeTiming({ native = [], clip = [], cover = [], events = [] } = {}) {
  const clockMap = clip && Object.hasOwn(clip, 'clockCalibration') ? mapClockTiming(clip) : null;
  const n = stream(native), c = stream(clockMap?.stream ?? clip), covers = [...cover].sort((a, b) => a[0] - b[0]);
  const intervals = [];
  for (let i = 0; i < covers.length; i++) if (covers[i][1] === 'covered' && covers[i - 1]?.[1] !== 'covered') {
    intervals.push([covers[i][0], covers.slice(i + 1).find(row => row[1] === 'open')?.[0] ?? null]);
  }
  const nativeFrames = n?.frames ?? (Array.isArray(native) ? native : []);
  const clipFrames = c?.frames ?? (Array.isArray(clip) ? clip : []);
  // Retain simultaneous state changes as a single sampled state. Frame identity
  // includes the decoder generation; equal media times on different players differ.
  const times = n && c ? [...new Set([...n.frames, ...c.frames, ...n.states, ...c.states, ...covers].map(row => row[0]))].sort((a, b) => a - b) : [];
  const changes = [], unknown = [];
  for (let i = 0; i < times.length; i++) {
    const time = times[i], covering = at(covers, time)?.[1], source = covering === 'covered' ? c : covering === 'open' ? n : null;
    const value = picture(source, time);
    if (!value) { unknown.push([time, times[i + 1] ?? Infinity]); continue; }
    const playerId = `${covering === 'covered' ? 'c' : 'n'}${value.id}`;
    const previous = changes.at(-1);
    if (!previous || previous.playerId !== playerId || previous.mediaTime !== value.media) changes.push({ timeMs: time, mediaTime: value.media, playerId });
  }
  const selectionBoundaries = n && c ? [...new Set([...covers, ...n.states, ...c.states].map(row => row[0]))].sort((a, b) => a - b) : [];
  function evidenceFailure(fromMs, toMs) {
    if (clockMap && clockMap.uncertainty(fromMs,toMs) === null) return 'clock-calibration-unavailable';
    // Native recorder and cover sampler share the controller's animation clock.
    // Its heartbeat must cover the whole interval even while the clip is shown.
    if (!n.spans.some(([a, b]) => a <= fromMs && b >= toMs)) return 'observation-interrupted-or-truncated';
    if (unknown.some(([a, b]) => a < toMs && b > fromMs)) return 'selected-picture-not-observed';
    const points = [fromMs, ...selectionBoundaries.filter(t => t > fromMs && t < toMs), toMs];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], covering = at(covers, a)?.[1];
      const source = covering === 'covered' ? c : covering === 'open' ? n : null;
      if (!source) return 'selected-picture-not-observed';
      if (!source.spans.some(([from, to]) => from <= a && to >= b)) return 'observation-interrupted-or-truncated';
      const state = at(source.states, a);
      // A recorded canvas is the picture; callbacks from the video behind it
      // cannot establish changes or losses in that canvas.
      if (state?.[2] !== 'video') continue;
      if (source.losses?.some(([from, to]) => from < b && to > a)) return 'frame-callbacks-skipped';
      if (source.dropped?.losses > 0 && (!source.losses.length || source.losses[0][0] > a)) return 'loss-history-truncated';
      const frames = source.byId.get(state[1]) ?? [], supportingFrame = at(frames, a);
      if (supportingFrame?.[3] === null || frames.some(row => row[0] >= a && row[0] <= b && row[3] === null)) return 'frame-loss-counter-unavailable';
    }
    return null;
  }
  function edge(edgeMs) {
    if (!n || !c) return unavailable('player-mapping-and-observation-bounds-missing');
    const lo = edgeMs - 200, hi = edgeMs + 300;
    if (clockMap && clockMap.uncertainty(lo,hi) === null) return unavailable('clock-calibration-unavailable');
    const observedUntilMs = n.spans.at(-1)?.[1] ?? -Infinity;
    const observedFromMs = n.spans[0]?.[0] ?? Infinity;
    if (unknown.some(([a, b]) => a < Math.min(hi, observedUntilMs) && b > lo)) return unavailable('selected-picture-not-observed');
    // A heartbeat gap is a missing observation, not proof that a frame froze.
    const end = Math.min(hi, observedUntilMs);
    const windowFailure = evidenceFailure(lo, end);
    if (windowFailure) return unavailable(windowFailure);
    const auditedChanges = changes.filter(x => x.timeMs >= observedFromMs && x.timeMs <= observedUntilMs);
    const result = auditEdge({ changes: auditedChanges, edgeMs,
      observedFromMs, observedUntilMs, mappingKnown: true });
    // A hold may finish beyond the +300 ms window. Its entire measured interval
    // still needs uninterrupted observations and an unambiguous picture mapping.
    const ranges = [...(result.intervals ?? [])];
    const lastChange = auditedChanges.at(-1)?.timeMs;
    if (result.status === 'censored' && lastChange < hi) ranges.push({ fromMs: lastChange, toMs: observedUntilMs });
    for (const interval of ranges) {
      const a = interval.fromMs, b = interval.toMs;
      const failure = evidenceFailure(a, b);
      if (failure) return unavailable(failure);
    }
    // Account only for the selected player's transport state. A native player
    // paused underneath a running replacement is expected, not a viewer pause.
    // These flags do not say who paused it (user, engine, service or natural end).
    const playbackContext = { pausedMs: 0, seekingMs: 0, endedMs: 0, unknownMs: 0 };
    const boundaries = [...new Set([...covers, ...n.states, ...c.states, ...n.playback, ...c.playback].map(row => row[0]))].sort((a, b) => a - b);
    for (const { fromMs, toMs } of ranges) {
      const points = [fromMs, ...boundaries.filter(t => t > fromMs && t < toMs), toMs];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], duration = points[i] - a;
        const covering = at(covers, a)?.[1], source = covering === 'covered' ? c : covering === 'open' ? n : null;
        const state = source && at(source.states, a), transport = source && at(source.playback, a);
        if (!transport || !state || transport[1] !== state[1] || transport.slice(2).some(flag => flag === null)) playbackContext.unknownMs += duration;
        else {
          // E92: like the native player paused under a running replacement, the covering clip paused or
          // ended at its own end is expected: the covered interval ends with an uncover within the grace.
          const cover = covering === 'covered' ? intervals.find(([on, off]) => on <= a && off !== null && a < off) : null;
          const finished = Boolean(cover) && transport[0] >= cover[0] && cover[1] - transport[0] <= CLIP_END_GRACE_MS;
          if (transport[2] && !finished) playbackContext.pausedMs += duration;
          if (transport[3]) playbackContext.seekingMs += duration;
          if (transport[4] && !finished) playbackContext.endedMs += duration;
        }
      }
    }
    for (const key of Object.keys(playbackContext)) playbackContext[key] = round(playbackContext[key]);
    if (playbackContext.unknownMs > 0) return { ...unavailable('selected-playback-state-unknown'), playbackContext,
      observedLargestGapMs: round(result.observedLargestGapMs) };
    if (playbackContext.pausedMs > 0 || playbackContext.seekingMs > 0 || playbackContext.endedMs > 0) return {
      status: 'playback-interrupted', reason: 'selected-player-paused-seeking-or-ended', playbackContext,
      largestGapMs: null, lowerBoundMs: null, observedLargestGapMs: round(result.observedLargestGapMs),
      observedLowerBoundMs: round(result.lowerBoundMs), intervals: result.intervals };
    if (clockMap) return { ...result, status: result.status === 'observed' ? 'clock-bounded-estimate' : result.status, reason: result.status === 'observed' ? 'cross-domain-clock-uncertainty' : result.reason,
      clockUncertaintyMs: round(Math.max(clockMap.uncertainty(lo,hi), ...ranges.map(r=>clockMap.uncertainty(r.fromMs,r.toMs)??Infinity))),
      estimatedLargestGapMs: round(result.observedLargestGapMs), estimatedLowerBoundMs: round(result.lowerBoundMs), largestGapMs: null, lowerBoundMs: null,
      observedLargestGapMs: round(result.observedLargestGapMs), playbackContext };
    return { ...result, largestGapMs: round(result.largestGapMs), lowerBoundMs: round(result.lowerBoundMs),
      observedLargestGapMs: round(result.observedLargestGapMs), playbackContext };
  }
  const around = (rows, t) => rows.filter(row => row[0] >= t - 1000 && row[0] <= t + 1500).map(row => [round(row[0] - t), ...row.slice(1)]);
  // Engine markers survive when the animation clock does not. Keep those
  // attempts in the denominator without inventing a sampled cover boundary.
  // Associate all retained intervals before limiting the detailed output, so
  // an older sampled attempt is not misclassified as missing after truncation.
  const markers = events.filter(([t, name, detail]) => Number.isFinite(t) && name === 'transition' && Number.isFinite(detail?.triggerMs));
  const matched = new Set();
  const attempts = intervals.map(([on, off]) => {
    const marker = [...markers].reverse().find(row => !matched.has(row) && row[0] <= on + 300 && row[0] > on - 5000);
    if (marker) matched.add(marker);
    return { time: on, on, off, segment: marker?.[2] ?? null };
  });
  const unsampled = markers.filter(marker => !matched.has(marker));
  for (const marker of unsampled) attempts.push({ time: marker[0], on: null, off: null, segment: marker[2] });
  attempts.sort((a, b) => a.time - b.time);
  const transitions = attempts.slice(-12).map(({ on, off, segment }) => {
    if (on === null) return {
      kind: segment.entry ? 'seek-entry' : segment.action === 'INSERT' ? 'insert' : 'replace',
      triggerMs: segment.triggerMs, resumeMs: segment.resumeMs ?? null,
      observation: 'cover-not-observed', removedFramesShown: null, removedNativeCallbacks: null,
      entry: unavailable('cover-boundary-not-observed'), exit: unavailable('cover-boundary-not-observed'),
      entryLargestGapMs: null, exitLargestGapMs: null, coveredMs: null,
      lastNativeBeforeCover: null, clipFrameAtCover: null, nativeAtUncover: null,
      frames: { entry: { native: [], clip: [] }, exit: { native: [], clip: [] } }, events: []
    };
    const entry = edge(on), exit = off === null ? null : edge(off);
    const nativeBefore = nativeFrames.filter(row => row[0] < on && row[0] >= on - 400 && (!n || picture(n, row[0])?.id === row[2]));
    const removedCallbacks = !segment || !n ? null : nativeFrames.filter(([t, media, id]) => t >= on - 1500 && t < on && at(covers, t)?.[1] === 'open' && picture(n, t)?.id === id && media >= segment.triggerMs / 1000 && media < segment.resumeMs / 1000).length;
    const out = { kind: segment?.entry ? 'seek-entry' : segment ? segment.action === 'INSERT' ? 'insert' : 'replace' : 'unknown',
      triggerMs: segment?.triggerMs ?? null, resumeMs: segment?.resumeMs ?? null,
      removedFramesShown: null, removedNativeCallbacks: removedCallbacks,
      entry, entryLargestGapMs: entry.largestGapMs, lastNativeBeforeCover: nativeBefore.at(-1)?.[1] ?? null,
      clipFrameAtCover: picture(c, on)?.media ?? null,
      ...(off !== null ? { coveredMs: round(off - on), exit, exitLargestGapMs: exit.largestGapMs, nativeAtUncover: picture(n, off)?.media ?? null,
        // E72 (0.64.3): the last native callback before the sampled uncover. When callbacks were
        // lost just before it, the picture actually revealed is later: see the cycle's
        // audioFade.exit.uncoverFrameMediaTimeMs (the adapter's own reveal frame).
        ...(n?.losses?.some(([from, to]) => from < off + 50 && to > off - 150) ? { nativeAtUncoverMayBeStale: true } : {}) } : {}) };
    const seek = segment?.entry ? [...events].reverse().find(([t, name]) => t <= on && t > on - 5000 && name === 'native-seeking') : null;
    if (seek) {
      const landed = nativeFrames.find(([t, m]) => t > seek[0] && t < (off ?? on + 5000) && Math.abs(m - (seek[2]?.toMs ?? 0) / 1000) < .25);
      const firstClip = clipFrames.find(([t, , id]) => t >= on && (!c || picture(c, t)?.id === id));
      out.seekToCoverMs = round(on - seek[0]);
      if (landed) out.nativeLandedAfterSeekMs = round(landed[0] - seek[0]);
      if (firstClip) out.firstClipFrameAfterSeekMs = round(firstClip[0] - seek[0]);
    }
    out.frames = { entry: { native: around(nativeFrames, on), clip: around(clipFrames, on) }, ...(off !== null ? { exit: { native: around(nativeFrames, off), clip: around(clipFrames, off) } } : {}) };
    out.events = events.filter(([t]) => t > on - 3000 && t < (off ?? on) + 1000).map(([t, ...rest]) => [round(t - on), ...rest]);
    return out;
  });
  // Keep the recorder's bounded frame history, not only the display windows.
  // A staged picture can predate those windows, and a measured hold can end
  // after them. Both must survive export for the verdict to be reproducible.
  const metadata = source => source ? { frames: source.frames, states: source.states, spans: source.spans, losses: source.losses, playback: source.playback, dropped: source.dropped, maximumHeartbeatGapMs: source.maximumHeartbeatGapMs } : null;
  return { measurementScope: 'Retained transition attempts and attributed frame-callback gaps using sampled cover state; not pixel or audio continuity. Attempts without sampled cover boundaries remain insufficient evidence. Private renderer clocks require bracketing calibration and yield qualified estimates only. Cover changes have animation-frame sampling uncertainty.',
    nativeFrameMs: cadence(n), clipFrameMs: cadence(c), transitionCount: attempts.length,
    sampledTransitionCount: intervals.length, unobservedTransitionCount: unsampled.length, transitions,
    ...(clockMap ? { clockAlignment: { status: clockMap.segments.length ? 'bounded-estimates-only' : 'unavailable', coverage: clockMap.coverage, maximumUncertaintyMs: clockMap.segments.length ? round(Math.max(...clockMap.segments.map(s=>s.uncertaintyMs))) : null } } : {}),
    observations: { native: metadata(n), clip: clockMap ? structuredClone(clip) : metadata(c), cover: covers, events } };
}
