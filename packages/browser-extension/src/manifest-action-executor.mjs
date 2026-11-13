import { OperationContext } from "./operation-context.mjs";

function abortError(reason) {
  const error = new Error(reason);
  error.name = "AbortError";
  return error;
}

function segmentOf(action) {
  return {
    id: action.id,
    action: action.type,
    triggerMs: action.triggerMs,
    resumeMs: action.resumeMs,
    clipUrl: action.clipUrl,
    ...(action.expectedDurationMs === undefined ? {} : { expectedDurationMs: action.expectedDurationMs, profileClass: action.profileClass }),
    gainDb: action.gainDb ?? 0
  };
}

export class ManifestActionExecutor {
  constructor({ transitionEngine, adapter, evidenceRun = null }) {
    this.transitionEngine = transitionEngine;
    this.adapter = adapter;
    this.evidenceRun = evidenceRun;
    this.context = new OperationContext();
  }

  async executeLocal(action, observedTimeMs, { chain = [], onAdvance, entryFraction, entryGate } = {}) {
    const context = this.context.capture();
    context.assertCurrent();
    const evidence = this.evidenceRun?.context(action);
    this.transitionEngine.arm({
      ...(chain.length ? { chain: chain.map(segmentOf), onAdvance } : {}),
      ...(entryFraction === undefined ? {} : { entryFraction, ...(entryGate ? { entryGate } : {}) }),
      id: action.id,
      action: action.type,
      evidenceOrigin: 'automatic-packet',
      ...(evidence ? { evidenceRunSequence: evidence.runSequence, evidenceActionOrdinal: evidence.actionOrdinal } : {}),
      triggerMs: action.triggerMs,
      resumeMs: action.resumeMs,
      clipUrl: action.clipUrl,
      ...(action.expectedDurationMs === undefined ? {} : { expectedDurationMs: action.expectedDurationMs, profileClass: action.profileClass }),
      gainDb: action.gainDb ?? 0
    });
    const result = await this.transitionEngine.execute(observedTimeMs);
    context.assertCurrent();
    if (result.status === "cancelled") throw abortError("local-action-cancelled");
    return result;
  }

  async preloadLocal(action) {
    return this.transitionEngine.preload({
      id: action.id,
      action: action.type,
      triggerMs: action.triggerMs,
      resumeMs: action.resumeMs,
      clipUrl: action.clipUrl,
      ...(action.expectedDurationMs === undefined ? {} : { expectedDurationMs: action.expectedDurationMs, profileClass: action.profileClass }),
      gainDb: action.gainDb ?? 0
    });
  }

  async preloadNextLocal(action) {
    return this.transitionEngine.preloadNext(segmentOf(action));
  }

  async stageLocal(action) {
    return this.transitionEngine.stage({
      id: action.id,
      action: action.type,
      triggerMs: action.triggerMs,
      resumeMs: action.resumeMs,
      clipUrl: action.clipUrl,
      ...(action.expectedDurationMs === undefined ? {} : { expectedDurationMs: action.expectedDurationMs, profileClass: action.profileClass }),
      gainDb: action.gainDb ?? 0
    });
  }

  async executeSkip(action) {
    const context = this.context.capture();
    const snapshot = await this.adapter.snapshot(context.signal);
    try {
      context.assertCurrent();
      await this.adapter.seek(action.resumeMs, context.signal);
      context.assertCurrent();
      return Object.freeze({ status: "success", actionId: action.id });
    } finally { this.adapter.releaseSnapshot?.(snapshot); }
  }

  async startMute(action) {
    const context = this.context.capture();
    await this.adapter.beginMuteAction(action, context.signal);
    context.assertCurrent();
    return Object.freeze({ status: "active", actionId: action.id });
  }

  async finishMute(action) {
    await this.adapter.finishMuteAction(action);
    return Object.freeze({ status: "success", actionId: action.id });
  }

  async honorNativeSeek(targetTimeMs) {
    const context = this.context.capture();
    // The viewer's own seek has usually already landed, or is still on its way to
    // the target; re-seeking it would only mute and rebuffer native again (and, at
    // the seeking event, repeat the viewer's seek). Re-assert it only if native is elsewhere.
    try {
      const state = await this.adapter.readState?.();
      context.assertCurrent();
      if (state && Number.isFinite(state.currentTimeMs) && Math.abs(state.currentTimeMs - targetTimeMs) <= 250) return;
    } catch (error) { if (error?.name === "AbortError") throw error; }
    await this.adapter.seek(targetTimeMs, context.signal);
    context.assertCurrent();
  }

  async cancel(reason = "action-cancelled") {
    this.invalidate(reason);
    return this.transitionEngine.cancel(reason);
  }

  invalidate(reason) { this.context.invalidate(reason); }

  async cancelPreload(reason = "preload-cancelled") {
    return this.transitionEngine.cancelPreload(reason);
  }
}
