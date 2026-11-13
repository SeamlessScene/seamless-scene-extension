import { ClockDomain, CLOCK_DOMAIN_LIMITS } from './clock-domain.mjs';

// Offline projection from retained, bracketing probes. Raw renderer rows remain
// in the export. A latest/current offset must never retime an older lifetime.
export function mapClockTiming(raw) {
  const rows = raw?.clockCalibration?.samples;
  const segments = [];
  let now = 0, previous = null, remoteHighWater = -Infinity, ambiguousHistory = false;
  const domain = new ClockDomain({ clock: () => now });
  if (Array.isArray(rows) && rows.length <= CLOCK_DOMAIN_LIMITS.samples) for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 5) { domain.reset(); previous = null; continue; }
    const [sentMs, receivedMs, remoteMs, elapsedMs, remoteMonotonicMs] = row;
    // Even one rejected probe can reveal reused timestamps. Keep this check
    // across sampling breaks; waiting for an accepted successor pair could
    // project newer frames into an earlier lifetime just before export.
    if (Number.isFinite(remoteMs)) {
      if (remoteMs < remoteHighWater) ambiguousHistory = true;
      remoteHighWater = Math.max(remoteHighWater, remoteMs);
    }
    now = receivedMs;
    const accepted = domain.accept({ sentMs, receivedMs, remoteMs, elapsedMs, remoteMonotonicMs });
    if (accepted && previous) {
      const a = previous, b = row;
      const start = (a[0] + a[1]) / 2, end = (b[0] + b[1]) / 2;
      segments.push({ remoteFrom: a[2], remoteTo: b[2], from: start, to: end,
        uncertaintyMs: Math.max(a[1]-a[0],b[1]-b[0])/2 + CLOCK_DOMAIN_LIMITS.toleranceMs + (end-start)*CLOCK_DOMAIN_LIMITS.driftPerMs });
    }
    previous = domain.previous ? row : null;
  }
  // A backward origin change can reuse timestamp numbers for distinct instants.
  // Without per-row monotonic stamps those histories cannot be disambiguated.
  if (ambiguousHistory || segments.some((s,i)=>i>0&&s.remoteFrom<segments[i-1].remoteTo)) segments.length=0;
  const project = (s,t) => s.from + (t-s.remoteFrom)*(s.to-s.from)/(s.remoteTo-s.remoteFrom);
  const segmentAt = t => segments.find(s => t >= s.remoteFrom && t <= s.remoteTo);
  const at = t => { const s=segmentAt(t);return s ? project(s,t) : null; };
  const intervals = list => (list??[]).flatMap(row=>segments.flatMap(s=>{
    const lo=Math.max(row[0],s.remoteFrom),hi=Math.min(row[1],s.remoteTo);
    return hi>=lo ? [[project(s,lo),project(s,hi),...row.slice(2)]] : [];
  }));
  const points = (list, unknown) => (list??[]).flatMap(row=>{
    const t=at(row[0]);if(t!==null)return [[t,...row.slice(1)]];
    // An unprojectable state change must not leave an earlier known state active.
    const next=unknown&&segments.find(s=>s.remoteFrom>row[0]);
    return next ? [[next.from,...unknown]] : [];
  }).sort((a,b)=>a[0]-b[0]);
  const merge = ranges => {
    const merged=[];
    for(const row of ranges.sort((a,b)=>a[0]-b[0])) {
      const last=merged.at(-1);
      if(last&&row[0]<=last[1])last[1]=Math.max(last[1],row[1]);else merged.push([...row]);
    }
    return merged;
  };
  const coverage=merge(segments.map(s=>[s.from,s.to]));
  return { stream: { ...raw, frames:points(raw?.frames),states:points(raw?.states,[null,'unknown',null]),
      playback:points(raw?.playback,[null,null,null,null]),spans:merge(intervals(raw?.spans)),losses:intervals(raw?.losses) },
    segments, coverage,
    uncertainty(from,to) {
      if(!coverage.some(([a,b])=>a<=from&&b>=to))return null;
      return Math.max(...segments.filter(s=>s.from<=to&&s.to>=from).map(s=>s.uncertaintyMs));
    }
  };
}
