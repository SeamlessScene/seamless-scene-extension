// A remote timestamp is sampled between local send and receive. Offset bounds
// therefore include asymmetric relay delay; no equal-path-delay assumption.
export const CLOCK_DOMAIN_LIMITS = Object.freeze({ roundTripMs: 20, ageMs: 5000, toleranceMs: 1, driftPerMs: 0.0001, samples: 512 });
const finite = Number.isFinite;
export class ClockDomain {
  constructor({ clock = () => performance.timeOrigin + performance.now(), now = null } = {}) {
    this.clock = clock; this.now = now; this.samples = []; this.dropped = 0; this.slow = 0; this.reset();
  }
  reset() { this.previous = null; this.mapping = null; }
  record(row) { this.samples.push(row); if (this.samples.length > CLOCK_DOMAIN_LIMITS.samples) { this.samples.shift(); this.dropped++; } }
  invalidate() { this.reset(); this.record(null); }
  accept({ sentMs, receivedMs, remoteMs, elapsedMs, remoteMonotonicMs }) {
    const limits = CLOCK_DOMAIN_LIMITS, rtt = receivedMs - sentMs;
    if (![sentMs, receivedMs, remoteMs, elapsedMs, remoteMonotonicMs].every(finite) ||
      rtt < 0 || elapsedMs < 0 || Math.abs(rtt - elapsedMs) > limits.toleranceMs || remoteMonotonicMs < 0) {
      this.invalidate(); return false;
    }
    // A slow but self-consistent round trip is ordinary on a busy page (a long
    // task on Prime's main thread). It is too imprecise to use, but it says
    // nothing against the current mapping, which keeps its own freshness limit.
    if (rtt > limits.roundTripMs) { this.slow++; return false; }
    const sample = { sentMs, receivedMs, remoteMs, elapsedMs, remoteMonotonicMs,
      low: remoteMs - receivedMs - limits.toleranceMs, high: remoteMs - sentMs + limits.toleranceMs };
    const previous = this.previous;
    this.previous = sample; this.mapping = null;
    this.record([sentMs, receivedMs, remoteMs, elapsedMs, remoteMonotonicMs]);
    if (!previous) return false;
    const age = receivedMs - previous.receivedMs;
    const remoteAge = remoteMs - previous.remoteMs, remoteElapsed = remoteMonotonicMs - previous.remoteMonotonicMs;
    if (sentMs < previous.receivedMs || age <= 0 || age > limits.ageMs || remoteElapsed <= 0 || Math.abs(remoteAge - remoteElapsed) > limits.toleranceMs) return false;
    const drift = age * limits.driftPerMs;
    const low = Math.max(sample.low, previous.low - drift), high = Math.min(sample.high, previous.high + drift);
    if (low > high) return false; // Changed origin: this sample only seeds a new pair.
    this.mapping = { offsetMs: (low + high) / 2, uncertaintyMs: (high - low) / 2, atMs: receivedMs,
      localMonotonicMs: this.now?.() ?? null, remoteOriginMs: remoteMs - remoteMonotonicMs };
    return true;
  }
  current() {
    const mapping = this.mapping, age = mapping ? this.clock() - mapping.atMs : Infinity;
    if (!mapping || !finite(age) || age < 0 || age > CLOCK_DOMAIN_LIMITS.ageMs) return null;
    if (this.now && Math.abs((this.now() - mapping.localMonotonicMs) - age) > CLOCK_DOMAIN_LIMITS.toleranceMs) return null;
    return { ...mapping, uncertaintyMs: mapping.uncertaintyMs + age * CLOCK_DOMAIN_LIMITS.driftPerMs };
  }
  toRemote(localMs) { const m = this.current(); return m && finite(localMs) && localMs - m.atMs <= CLOCK_DOMAIN_LIMITS.ageMs ? localMs + m.offsetMs : null; }
  toLocal(remoteMs) { const m = this.current(); return m && finite(remoteMs) && remoteMs - m.offsetMs - m.atMs <= CLOCK_DOMAIN_LIMITS.ageMs ? remoteMs - m.offsetMs : null; }
  sameRemoteOrigin(epochMs, monotonicMs) { const m = this.current(); return Boolean(m && finite(epochMs) && finite(monotonicMs) && Math.abs(epochMs - monotonicMs - m.remoteOriginMs) <= CLOCK_DOMAIN_LIMITS.toleranceMs); }
  snapshot() { return { status: this.current() ? 'bounded' : 'unavailable', mapping: this.current(), samples: this.samples.map(row => row ? [...row] : null), dropped: this.dropped, slow: this.slow, limits: { ...CLOCK_DOMAIN_LIMITS } }; }
}
