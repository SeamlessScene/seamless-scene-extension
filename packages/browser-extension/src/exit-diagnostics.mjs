// E72 (0.64.3) exit diagnostics, shared by the page (Prime adapter) and the clip renderer.
// They only observe: nothing here changes playback.

/** [droppedVideoFrames, totalVideoFrames] of a media element, or null where unsupported. */
export function playbackQuality(video) {
  try {
    const q = video?.getVideoPlaybackQuality?.();
    return q && Number.isSafeInteger(q.droppedVideoFrames) && Number.isSafeInteger(q.totalVideoFrames) ? [q.droppedVideoFrames, q.totalVideoFrames] : null;
  } catch { return null; }
}

/**
 * A rolling log of this document's long animation frames (LoAF), or null where the browser has
 * none. between(from, to) returns [startTime, duration, blockingDuration] rows (performance
 * clock) overlapping that span, after flushing records the observer has not delivered yet.
 */
export function longFrameLog(view = globalThis) {
  const Observer = view?.PerformanceObserver;
  if (typeof Observer !== 'function' || !Observer.supportedEntryTypes?.includes?.('long-animation-frame')) return null;
  const entries = [];
  const keep = list => {
    for (const entry of list ?? []) {
      if (!Number.isFinite(entry?.startTime) || !Number.isFinite(entry?.duration)) continue;
      entries.push([entry.startTime, entry.duration, Number.isFinite(entry.blockingDuration) ? entry.blockingDuration : null]);
      if (entries.length > 64) entries.shift();
    }
  };
  let observer;
  try { observer = new Observer(list => keep(list.getEntries())); observer.observe({ type: 'long-animation-frame', buffered: true }); }
  catch { return null; }
  return {
    between(from, to) {
      try { keep(observer.takeRecords?.()); } catch {}
      return entries.filter(([start, duration]) => start + duration >= from && start <= to).slice(-16);
    },
    disconnect() { try { observer.disconnect(); } catch {} }
  };
}

const tenth = value => Math.round(value * 10) / 10;

/** Long frames as [start, duration, blocking] in ms relative to `origin` (performance clock). */
export function relativeLongFrames(rows, origin) {
  return (rows ?? []).map(([start, duration, blocking]) => [tenth(start - origin), tenth(duration), blocking === null ? null : tenth(blocking)]);
}
