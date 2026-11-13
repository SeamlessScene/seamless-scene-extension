// A playback deadline that a viewer's pause suspends. Every layer that times a
// local clip (overlay, engine, controller request, relay, renderer) keeps one,
// so a paused replacement is not failed as hung. Paused time and seek-back
// extensions share one budget; past it the deadline runs again regardless.
export const LOCAL_PAUSE_BUDGET_MS = 10 * 60 * 1000;

export function pausableDeadline(timeoutMs, onExpire, { budgetMs = LOCAL_PAUSE_BUDGET_MS, now = () => performance.now(), timers = globalThis, unref = false } = {}) {
  let remaining = timeoutMs, since = now(), pausedAt = null, used = 0, done = false, timer = null;
  const fire = () => { if (done) return; done = true; onExpire(); };
  const run = ms => { timers.clearTimeout(timer); timer = timers.setTimeout(fire, Math.max(0, ms)); if (unref) timer?.unref?.(); };
  run(remaining);
  return {
    get paused() { return pausedAt !== null; },
    pause() {
      if (done || pausedAt !== null) return;
      const t = now(); remaining -= t - since; pausedAt = t;
      // While paused only the shared budget runs.
      run(budgetMs - used);
    },
    resume() {
      if (done || pausedAt === null) return;
      const t = now(); used += t - pausedAt; pausedAt = null; since = t;
      run(remaining);
    },
    // A seek back replays part of the clip; grant that time from the budget.
    extend(ms) {
      if (done || !(ms > 0)) return;
      const granted = Math.min(ms, Math.max(0, budgetMs - used)); used += granted; remaining += granted;
      if (pausedAt === null) { const t = now(); remaining -= t - since; since = t; run(remaining); }
    },
    clear() { done = true; timers.clearTimeout(timer); }
  };
}
