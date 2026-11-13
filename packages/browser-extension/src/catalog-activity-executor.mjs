// Native restoration completes before the privileged lease owner can discard
// an active action. No key, lease or media handle crosses this private relay.
// 0.65.9 (onEvent, developer-mode engine event export): when each catalog-activity round trip
// starts and ends, while enabled() (developer mode). The same promise is awaited either way;
// without onEvent nothing changes.
export function withCatalogActivity(base, overlay, { onEvent = null, enabled = () => true } = {}) {
  const active = new Set(); let generation = 0;
  const activity = typeof onEvent !== 'function' ? (id, on) => overlay.catalogActivity(id, on) : (id, on) => {
    if (!enabled()) return overlay.catalogActivity(id, on);
    const note = (name, detail) => { try { onEvent(name, detail); } catch {} };
    note('catalog-activity-start', { actionId: id, active: on });
    const trip = Promise.resolve(overlay.catalogActivity(id, on));
    trip.then(() => note('catalog-activity-end', { actionId: id, active: on, result: 'ok' }), () => note('catalog-activity-end', { actionId: id, active: on, result: 'failed' }));
    return trip;
  };
  const begin = async action => {
    const captured = generation; await activity(action.id, true);
    if (captured !== generation) { await activity(action.id, false); throw Error('catalog-action-cancelled'); }
    active.add(action.id);
  };
  const end = async id => { active.delete(id); await activity(id, false); };
  const run = method => async (action, ...args) => {
    await begin(action);
    try { return await base[method](action, ...args); } finally { await end(action.id); }
  };
  // Every scene played inside one chained cover holds its own activity, so a
  // revocation or expiry waits for native restoration of the whole chain.
  const runLocal = async (action, observedTimeMs, options = {}) => {
    const members = [action, ...(options.chain ?? [])], begun = [];
    const beginAll = async () => { for (const member of members) { await begin(member); begun.push(member.id); } };
    try {
      // A seek entry holds native at once; its activity registration gates the
      // moment the clip is shown instead of delaying the hold.
      if (options.entryFraction !== undefined) {
        const registered = beginAll(); registered.catch(() => {});
        return await base.executeLocal(action, observedTimeMs, { ...options, entryGate: options.entryGate ? Promise.all([options.entryGate, registered]) : registered });
      }
      await beginAll();
      return await base.executeLocal(action, observedTimeMs, options);
    } finally { for (const id of begun) await end(id); }
  };
  return {
    preloadLocal: (...args) => base.preloadLocal(...args),
    ...(typeof base.stageLocal === 'function' ? { stageLocal: (...args) => base.stageLocal(...args) } : {}),
    ...(typeof base.preloadNextLocal === 'function' ? { preloadNextLocal: (...args) => base.preloadNextLocal(...args) } : {}),
    executeLocal: runLocal, executeSkip: run('executeSkip'),
    async startMute(action, ...args) {
      await begin(action);
      try { return await base.startMute(action, ...args); } catch (e) { await end(action.id); throw e; }
    },
    async finishMute(action, ...args) { try { return await base.finishMute(action, ...args); } finally { await end(action.id); } },
    honorNativeSeek: (...args) => base.honorNativeSeek(...args),
    invalidate: reason => { generation++; base.invalidate?.(reason); },
    async cancel(reason) {
      generation++;
      await base.cancel(reason);
      // Wait for the scene to settle. Its own failure belongs to whoever ran it (and is in the
      // engine's state and metrics); a cancel answers only for the restoration, checked next.
      await Promise.resolve(base.transitionEngine?.running).catch(() => {});
      if (base.transitionEngine?.lastRecoveryFailures?.length) throw Error('catalog-native-restoration-failed');
      await Promise.all([...active].map(end));
    },
    cancelPreload: reason => { generation++; return base.cancelPreload(reason); },
  };
}
