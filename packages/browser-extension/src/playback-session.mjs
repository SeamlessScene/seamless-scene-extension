import { OperationContext } from "./operation-context.mjs";

// Keep native event routing separate from asynchronous timeline observation:
// a genuine new seek must reach the scheduler even while an entry is running.
export function installNativeSeekObserver({ document, getPlayer, getScheduler, readState, isOwnedSeek,
  observe, onError = () => {}, signal }) {
  const seeking = event => {
    if (!getScheduler()) return;
    try {
      // A document capture listener also sees trailers, background media and
      // old player elements. Their seeks do not move the selected programme.
      const player = getPlayer();
      if (!player || event.target !== player) return;
      const state = readState();
      if (!isOwnedSeek(state.currentTimeMs)) observe(state, 'seek');
    } catch (error) { onError(error); }
  };
  document.addEventListener('seeking', seeking, { capture: true, signal });
  return () => document.removeEventListener('seeking', seeking, { capture: true });
}

// Never serialize event observation behind preload or a whole clip. The
// scheduler owns command ordering; seeks must be delivered while it is busy.
export function createPlaybackObserver({ getScheduler, onSnapshot = () => {}, onError = () => {} }) {
  const observedPromises = new WeakSet();
  return (state, event = "tick") => {
    const scheduler = getScheduler();
    if (!scheduler) return null;
    try {
      const work = scheduler.observe({ currentTimeMs: state.currentTimeMs, paused: state.paused, event });
      if (!work?.then || observedPromises.has(work)) return work;
      observedPromises.add(work);
      void work.then(snapshot => {
        if (getScheduler() === scheduler && snapshot) onSnapshot(snapshot);
      }, error => { if (getScheduler() === scheduler) onError(error); });
      return work;
    } catch (error) { onError(error); return null; }
  };
}

// Source checks are async too: cancellation must invalidate their continuation,
// even when the transition engine has not been armed yet.
export function createGuardedExecutor(base, checkSource) {
  const context = new OperationContext();
  const guarded = method => async (...args) => {
    const operation = context.capture();
    await checkSource(operation);
    operation.assertCurrent();
    return base[method](...args);
  };
  // A seek into a replaced scene must hold and cover native at once. Its source
  // check runs alongside and gates the moment the clip is shown: nothing from the
  // edit appears before it passes, and a failure restores native.
  const executeLocal = async (action, observedTimeMs, options = {}) => {
    if (options.entryFraction === undefined) return guarded("executeLocal")(action, observedTimeMs, options);
    const operation = context.capture();
    const check = Promise.resolve().then(() => checkSource(operation)).then(() => operation.assertCurrent());
    check.catch(() => {});
    return base.executeLocal(action, observedTimeMs, { ...options, entryGate: options.entryGate ? Promise.all([options.entryGate, check]) : check });
  };
  return {
    preloadLocal: guarded("preloadLocal"), executeLocal,
    ...(typeof base.stageLocal === "function" ? { stageLocal: guarded("stageLocal") } : {}),
    ...(typeof base.preloadNextLocal === "function" ? { preloadNextLocal: guarded("preloadNextLocal") } : {}),
    executeSkip: guarded("executeSkip"), startMute: guarded("startMute"),
    finishMute: (...args) => base.finishMute(...args),
    honorNativeSeek: (...args) => base.honorNativeSeek(...args),
    invalidate(reason) { context.invalidate(reason); base.invalidate?.(reason); },
    cancel(reason) { this.invalidate(reason); return base.cancel(reason); },
    cancelPreload(reason) { context.invalidate(reason); return base.cancelPreload(reason); }
  };
}

export function playbackSourceKey(identity) {
  return JSON.stringify([identity?.lifecycleGeneration, identity?.activeItemId, identity?.mediaType, identity?.season, identity?.episode]);
}
