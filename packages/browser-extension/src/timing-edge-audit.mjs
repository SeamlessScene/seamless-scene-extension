// Audits an attributed frame-callback timeline. This measures metadata gaps;
// it does not certify pixels, audible continuity or a seamlessness release gate.
export function auditEdge({ changes = [], edgeMs, observedFromMs, observedUntilMs,
  mappingKnown = false, droppedSamples = 0, beforeMs = 200, afterMs = 300 } = {}) {
  const unavailable = reason => ({ status: 'insufficient-evidence', reason, largestGapMs: null,
    observedLargestGapMs: null, lowerBoundMs: null });
  if (![edgeMs, observedFromMs, observedUntilMs, beforeMs, afterMs].every(Number.isFinite) ||
      observedUntilMs <= observedFromMs || beforeMs < 0 || afterMs <= 0 ||
      edgeMs < observedFromMs || edgeMs > observedUntilMs) return unavailable('invalid-observation-bounds');
  if (mappingKnown !== true) return unavailable('visible-player-mapping-unknown');
  if (!Number.isSafeInteger(droppedSamples) || droppedSamples !== 0) return unavailable('dropped-or-unknown-samples');
  if (!Array.isArray(changes) || !changes.length) return unavailable('no-visible-frame-evidence');
  if (changes.some(x => !x || !Number.isFinite(x.timeMs) || !Number.isFinite(x.mediaTime) ||
      typeof x.playerId !== 'string' || !x.playerId || x.timeMs < observedFromMs || x.timeMs > observedUntilMs)) {
    return unavailable('invalid-frame-evidence');
  }
  const frames = [...changes].sort((a, b) => a.timeMs - b.timeMs);
  const samePicture = (a, b) => a.playerId === b.playerId && a.mediaTime === b.mediaTime;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].timeMs === frames[i-1].timeMs && !samePicture(frames[i], frames[i-1])) {
      return unavailable('ambiguous-simultaneous-frames');
    }
  }
  const unique = frames.filter((x, i) => i === 0 || !samePicture(x, frames[i-1]));
  const lo = edgeMs - beforeMs, hi = edgeMs + afterMs;
  const intervals = [];
  for (let i = 1; i < unique.length; i++) {
    const left = unique[i-1].timeMs, right = unique[i].timeMs;
    // Count a gap crossing the window even if its right endpoint is far beyond it.
    if (left < hi && right > lo) intervals.push({ fromMs: left, toMs: right, gapMs: right-left });
  }
  const maxCompleted = intervals.length ? Math.max(...intervals.map(x=>x.gapMs)) : null;
  const last = unique.at(-1).timeMs;
  const trailing = last < hi && observedUntilMs > lo ? observedUntilMs-last : null;
  const lowerBound = Math.max(maxCompleted ?? 0, trailing ?? 0);
  if (observedFromMs > lo || unique[0].timeMs > lo) return {
    ...unavailable('left-window-not-observed'), observedLargestGapMs: maxCompleted,
    lowerBoundMs: lowerBound || null, intervals
  };
  if (trailing !== null || observedUntilMs < hi) return {
    status: 'censored', reason: 'next-change-or-window-end-not-observed', largestGapMs: null,
    observedLargestGapMs: maxCompleted, lowerBoundMs: lowerBound, intervals
  };
  return { status: 'observed', reason: null, largestGapMs: maxCompleted,
    observedLargestGapMs: maxCompleted, lowerBoundMs: maxCompleted, intervals };
}
