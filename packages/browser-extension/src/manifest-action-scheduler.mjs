import { validateManifestSchema } from "./manifest-security.mjs";
import { stagingFailureFromError } from "./staging-failure.mjs";

const LOCAL_ACTIONS = new Set(["REPLACE", "INSERT"]);
// A seek this close to a replaced interval's end resumes native instead of
// starting the clip for a moment.
const MIN_ENTRY_REMAINING_MS = 1_000;

function boundedPlaybackState(state) {
  if (!Number.isFinite(state?.currentTimeMs) || state.currentTimeMs < 0) {
    throw new TypeError("A non-negative playback time is required");
  }
  if (typeof state.paused !== "boolean") throw new TypeError("A playback pause state is required");
  if (!["tick", "seek"].includes(state.event ?? "tick")) throw new TypeError("Unsupported playback event");
  return { currentTimeMs: state.currentTimeMs, paused: state.paused, event: state.event ?? "tick" };
}

export function compileManifestActions(activation, { resolveAssetUrl = () => null } = {}) {
  if (!["activated", "unchanged", "rolled-back"].includes(activation?.status) || !activation.manifest) {
    throw new TypeError("A verified active manifest is required");
  }
  const manifest = activation.manifest;
  const validation = validateManifestSchema(manifest);
  if (!validation.ok) throw new TypeError("Cannot compile an invalid manifest");
  return Object.freeze(manifest.segments.map((segment) => {
    const clipUrl = LOCAL_ACTIONS.has(segment.action)
      ? resolveAssetUrl(segment.asset.sha256, segment.segment_id)
      : null;
    if (LOCAL_ACTIONS.has(segment.action) && (typeof clipUrl !== "string" || clipUrl.length === 0)) {
      throw new TypeError(`Local asset is unresolved for ${segment.segment_id}`);
    }
    return Object.freeze({
      id: segment.segment_id,
      type: segment.action,
      triggerMs: segment.trigger_time_ms,
      resumeMs: segment.resume_time_ms,
      clipUrl,
      ...(segment.asset ? { expectedDurationMs: segment.asset.expected_duration_ms, profileClass: "mvp" } : {}),
      gainDb: segment.transition.gain_db ?? 0
    });
  }));
}

export class ManifestActionScheduler {
  constructor({ actions, executor, preloadWindowMs = 10_000, stageWindowMs = 1_500, chainGapMs = null, enterReplacedOnSeek = false, onEvent = null }) {
    if (!Array.isArray(actions) || actions.length === 0) throw new TypeError("At least one action is required");
    this.actions = actions;
    this.executor = executor;
    if (!Number.isFinite(preloadWindowMs) || preloadWindowMs < 0 || preloadWindowMs > 60_000) {
      throw new TypeError("preloadWindowMs must be between 0 and 60000");
    }
    this.preloadWindowMs = preloadWindowMs;
    if (!Number.isFinite(stageWindowMs) || stageWindowMs < 0 || stageWindowMs > 60_000) {
      throw new TypeError("stageWindowMs must be between 0 and 60000");
    }
    // Staging needs a prepared clip, so it can never start earlier than preload.
    this.stageWindowMs = Math.min(stageWindowMs, preloadWindowMs);
    this.stagedActionId = null;
    // null disables chaining (the default for compositions that do not opt in).
    if (chainGapMs !== null && (!Number.isFinite(chainGapMs) || chainGapMs < 0 || chainGapMs > 1_000)) {
      throw new TypeError("chainGapMs must be null or between 0 and 1000");
    }
    this.chainGapMs = chainGapMs;
    this.nextPreloadActionId = null;
    this.enterReplacedOnSeek = enterReplacedOnSeek === true;
    this.entryActionId = null;
    this.statuses = new Map(actions.map((action) => [action.id, "pending"]));
    this.preflightStatuses = new Map(actions.filter((action) => LOCAL_ACTIONS.has(action.type)).map((action) => [action.id, "idle"]));
    this.preloadRunning = null;
    this.preloadingAction = null;
    this.previousTimeMs = null;
    this.activeMute = null;
    this.running = null;
    this.runningAction = null;
    this.cancelled = false;
    this.cancellation = null;
    this.events = [];
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    this.droppedEvents = 0;
    this.observerFailures = 0;
    this.generation = 0;
    this.seeking = null;
  }

  snapshot() {
    return Object.freeze({
      statuses: Object.freeze(Object.fromEntries(this.statuses)),
      preflightStatuses: Object.freeze(Object.fromEntries(this.preflightStatuses)),
      activeMuteId: this.activeMute?.id ?? null,
      runningActionId: this.runningAction?.id ?? null,
      retention: Object.freeze({ maximumEvents: 2000, droppedEvents: this.droppedEvents, observerFailures: this.observerFailures }),
      events: Object.freeze(this.events.map((event) => Object.freeze({ ...event })))
    });
  }

  record(action, outcome, reason = null, failure = null) {
    const event = Object.freeze({ actionId: action.id, type: action.type, outcome, reason,
      ...(outcome === 'stage-failed' && failure ? { failure } : {}) });
    this.events.push(event);
    if (this.events.length > 2000) { this.events.shift(); this.droppedEvents++; }
    // Evidence must not take ownership of playback or turn a successful action
    // into a failure. Any broken observer remains explicitly visible.
    try {
      const result = this.onEvent?.(event);
      if (result && typeof result.then === 'function') {
        this.observerFailures++; // This observer contract is synchronous.
        void Promise.resolve(result).catch(() => {});
      }
    } catch { this.observerFailures++; }
  }

  startEligiblePreload(currentTimeMs, { allowAnchor = false } = {}) {
    if (this.cancelled || this.preloadRunning || this.running) return null;
    const action = this.actions.find((candidate) =>
      LOCAL_ACTIONS.has(candidate.type) &&
      this.statuses.get(candidate.id) === "pending"
    );
    if (!action || this.preflightStatuses.get(action.id) !== "idle" ||
        (action.id !== this.entryActionId && (allowAnchor ? currentTimeMs > action.triggerMs : currentTimeMs >= action.triggerMs)) || action.triggerMs - currentTimeMs > this.preloadWindowMs) return null;
    if (typeof this.executor.preloadLocal !== "function") {
      this.preflightStatuses.set(action.id, "failed");
      this.record(action, "preflight-failed", "preload-unavailable");
      return Promise.resolve(this.snapshot());
    }
    this.preloadingAction = action;
    this.preflightStatuses.set(action.id, "preloading");
    this.record(action, "preflight-started");
    const generation = this.generation;
    const task = Promise.resolve()
      .then(() => { if (generation !== this.generation || this.cancelled) return; return this.executor.preloadLocal(action); })
      .then(() => {
        if (generation !== this.generation || this.cancelled) return;
        this.preflightStatuses.set(action.id, "ready");
        this.record(action, "preflight-ready");
      })
      .catch((error) => {
        if (generation !== this.generation || this.cancelled) return;
        const cancelled = error?.name === "AbortError";
        this.preflightStatuses.set(action.id, cancelled ? "idle" : "failed");
        this.record(action, cancelled ? "preflight-cancelled" : "preflight-failed", cancelled ? "cancelled" : "not-ready");
      })
      .finally(() => {
        if (this.preloadRunning === task) {
          this.preloadRunning = null;
          this.preloadingAction = null;
        }
      })
      .then(() => this.snapshot());
    this.preloadRunning = task;
    return task;
  }

  // The pending local actions that follow `action` closely enough to play inside
  // its cover: each must start within chainGapMs of the previous one's join.
  adjacentChain(action) {
    if (this.chainGapMs === null) return [];
    const chain = [];
    let previous = action;
    for (const candidate of this.pendingLocalAfter(action)) {
      const gap = candidate.triggerMs - previous.resumeMs;
      if (gap < 0 || gap > this.chainGapMs || chain.length >= 32) break;
      chain.push(candidate); previous = candidate;
    }
    return chain;
  }

  pendingLocalAfter(action) {
    return this.actions
      .filter(candidate => candidate !== action && LOCAL_ACTIONS.has(candidate.type) && this.statuses.get(candidate.id) === "pending" && candidate.triggerMs >= action.triggerMs)
      .sort((left, right) => left.triggerMs - right.triggerMs);
  }

  // While a clip plays, load the next local clip (after any chain) into the
  // standby decoder so a scene shortly after this one is ready at its trigger.
  startNextPreload() {
    const running = this.runningAction;
    if (!running || !LOCAL_ACTIONS.has(running.type) || typeof this.executor.preloadNextLocal !== "function") return;
    const chain = this.runningChain ?? [];
    // The engine loads each chain member into the overlay's one standby decoder while the
    // previous member plays. Preloading the scene after the chain now would replace it and
    // skip that member (E71 bug D, 0.64.2), so wait until the chain's last member is playing.
    if (chain.length && running !== chain.at(-1)) return;
    const last = chain.at(-1) ?? running;
    const next = this.pendingLocalAfter(last).find(candidate => !chain.includes(candidate));
    if (!next || this.nextPreloadActionId === next.id || this.preflightStatuses.get(next.id) !== "idle") return;
    if (next.triggerMs - last.resumeMs > this.preloadWindowMs) return;
    this.nextPreloadActionId = next.id;
    const generation = this.generation;
    this.preflightStatuses.set(next.id, "preloading");
    this.record(next, "preflight-started", "during-previous");
    void Promise.resolve().then(() => this.executor.preloadNextLocal(next)).then(
      () => { if (generation === this.generation && !this.cancelled && this.preflightStatuses.get(next.id) === "preloading") { this.preflightStatuses.set(next.id, "ready"); this.record(next, "preflight-ready", "during-previous"); } },
      () => { if (generation === this.generation && !this.cancelled && this.preflightStatuses.get(next.id) === "preloading") { this.preflightStatuses.set(next.id, "idle"); this.record(next, "preflight-failed", "during-previous"); } }
    ).finally(() => { if (this.nextPreloadActionId === next.id) this.nextPreloadActionId = null; });
  }

  // Once the next local action is preloaded and its trigger is close, let the
  // executor stage it so the cut itself needs no renderer round trips. Staging
  // is an optimisation: failure is recorded and the action still runs unstaged.
  startEligibleStage(currentTimeMs) {
    if (this.cancelled || this.running || this.preloadRunning || typeof this.executor.stageLocal !== "function") return;
    const action = this.actions.find(candidate => LOCAL_ACTIONS.has(candidate.type) && this.statuses.get(candidate.id) === "pending");
    if (!action || this.stagedActionId === action.id || this.preflightStatuses.get(action.id) !== "ready") return;
    const leadMs = action.triggerMs - currentTimeMs;
    if (leadMs < 0 || leadMs > this.stageWindowMs) return;
    this.stagedActionId = action.id;
    const generation = this.generation;
    this.record(action, "stage-started");
    void Promise.resolve().then(() => {
      if (generation !== this.generation || this.cancelled) return;
      return this.executor.stageLocal(action);
    }).then(
      staged => { if (generation === this.generation && !this.cancelled && staged) this.record(action, "staged"); },
      error => { if (generation === this.generation && !this.cancelled) this.record(action, "stage-failed", "unstaged-fallback", stagingFailureFromError(error)); }
    );
  }

  observe(playbackState) {
    const state = boundedPlaybackState(playbackState);
    if (this.cancelled) return null;
    if (state.event === "seek") return this.handleSeek(state.currentTimeMs, { playing: state.paused === false });
    if (this.seeking) return this.seeking;

    const previousTimeMs = this.previousTimeMs;
    this.previousTimeMs = state.currentTimeMs;
    if (this.running) { this.startNextPreload(); return this.running; }
    if (previousTimeMs === null) {
      for (const action of this.actions) {
        if (action.triggerMs < state.currentTimeMs && this.statuses.get(action.id) === "pending") {
          this.statuses.set(action.id, "skipped");
          this.record(action, "skipped", "armed-after-trigger");
        }
      }
    }
    const preloadWork = this.startEligiblePreload(state.currentTimeMs);
    this.startEligibleStage(state.currentTimeMs);

    const work = [];
    if (this.activeMute && state.currentTimeMs >= this.activeMute.resumeMs) {
      work.push({ kind: "finish-mute", action: this.activeMute });
    }
    if (!state.paused && previousTimeMs !== null) {
      for (const action of this.actions) {
        if (
          this.statuses.get(action.id) === "pending" &&
          state.currentTimeMs >= action.triggerMs
        ) {
          // A seek entry waits for its clip rather than being skipped as not ready.
          if (action.id === this.entryActionId && this.preflightStatuses.get(action.id) !== "ready") {
            if (this.preflightStatuses.get(action.id) === "failed" || state.currentTimeMs >= action.resumeMs - MIN_ENTRY_REMAINING_MS) {
              this.entryActionId = null;
              this.statuses.set(action.id, "skipped");
              this.record(action, "skipped", "seek-entry-not-ready");
            }
            continue;
          }
          work.push({ kind: "start", action });
          break;
        }
      }
    }
    if (work.length === 0) return preloadWork;

    const generation = this.generation;
    const task = Promise.resolve().then(() => this.runWork(work, state.currentTimeMs, generation)).finally(() => {
      if (this.running === task) { this.running = null; this.runningAction = null; this.runningChain = null; }
    });
    this.running = task;
    return task;
  }

  async runWork(work, observedTimeMs, generation = this.generation) {
    for (const item of work) {
      if (this.cancelled || generation !== this.generation) break;
      const action = item.action;
      if (item.kind === "finish-mute") {
        if (this.activeMute?.id !== action.id) continue;
        await this.executor.finishMute(action);
        if (generation !== this.generation) break;
        this.activeMute = null;
        this.statuses.set(action.id, "completed");
        this.record(action, "completed");
        continue;
      }
      if (this.statuses.get(action.id) !== "pending") continue;
      if (LOCAL_ACTIONS.has(action.type) && action.type !== "INSERT" && observedTimeMs >= action.resumeMs) {
        this.statuses.set(action.id, "skipped");
        this.record(action, "skipped", "missed-interval");
        await this.cancelActivePreload("missed-interval");
        continue;
      }
      if (LOCAL_ACTIONS.has(action.type) && this.preflightStatuses.get(action.id) !== "ready" && !item.entry) {
        await this.cancelActivePreload("trigger-before-ready");
        if (generation !== this.generation || this.cancelled) break;
        this.statuses.set(action.id, "skipped");
        this.record(action, "skipped", "preflight-not-ready");
        continue;
      }
      this.runningAction = action;
      this.statuses.set(action.id, "running");
      this.record(action, 'running');
      try {
        if (LOCAL_ACTIONS.has(action.type)) {
          const chain = this.adjacentChain(action);
          this.runningChain = chain;
          const onAdvance = id => {
            const member = chain.find(candidate => candidate.id === id);
            if (!member || generation !== this.generation) return;
            this.statuses.set(this.runningAction.id, "completed");
            this.preflightStatuses.set(this.runningAction.id, "consumed");
            this.record(this.runningAction, "completed", "chained");
            this.runningAction = member;
            this.statuses.set(member.id, "running");
            this.record(member, "running", "chained");
          };
          const options = chain.length ? { chain, onAdvance } : {};
          if (action.id === this.entryActionId) {
            this.entryActionId = null;
            // Native kept playing while the clip loaded; enter where it is now.
            const fraction = (observedTimeMs - action.triggerMs) / (action.resumeMs - action.triggerMs);
            if (fraction > 0) options.entryFraction = Math.min(fraction, 0.99);
          }
          const result = Object.keys(options).length
            ? await this.executor.executeLocal(action, observedTimeMs, options)
            : await this.executor.executeLocal(action, observedTimeMs);
          if (generation !== this.generation || this.cancelled) break;
          const finished = this.runningAction ?? action;
          this.statuses.set(finished.id, "completed");
          this.preflightStatuses.set(finished.id, "consumed");
          this.previousTimeMs = finished.resumeMs;
          this.record(finished, "completed");
          // Chain members the engine did not reach stay pending for their own trigger.
          for (const member of chain) if (!(result?.chained ?? []).includes(member.id) && this.statuses.get(member.id) === "pending") this.preflightStatuses.set(member.id, this.preflightStatuses.get(member.id) === "ready" ? "ready" : "idle");
        } else if (action.type === "SKIP") {
          await this.executor.executeSkip(action);
          if (generation !== this.generation || this.cancelled) break;
          this.statuses.set(action.id, "completed");
          this.previousTimeMs = action.resumeMs;
          this.record(action, "completed");
        } else if (action.type === "MUTE") {
          await this.executor.startMute(action);
          if (generation !== this.generation || this.cancelled) break;
          this.activeMute = action;
          this.statuses.set(action.id, "active");
          this.record(action, "started");
          if (observedTimeMs >= action.resumeMs) {
            await this.executor.finishMute(action);
            this.activeMute = null;
            this.statuses.set(action.id, "completed");
            this.record(action, "completed");
          }
        }
      } catch (error) {
        if (generation !== this.generation || this.cancelled) break;
        const cancelled = error?.name === "AbortError";
        // After a chained advance the failure belongs to the scene then playing.
        const failed = LOCAL_ACTIONS.has(action.type) ? (this.runningAction ?? action) : action;
        this.statuses.set(failed.id, cancelled ? "cancelled" : "failed");
        this.record(failed, cancelled ? "cancelled" : "failed");
      }
    }
    return this.snapshot();
  }

  handleSeek(targetTimeMs, { playing = false } = {}) {
    if (this.cancelled) return Promise.resolve(this.snapshot());
    const generation = ++this.generation;
    // Completion consumes the preload, so cancelActivePreload may have nothing
    // left to cancel. A new traversal must still get its own staging attempt.
    this.stagedActionId = null;
    // Invalidate the executor before waiting for any older operation.
    this.executor.invalidate?.("native-seek");
    const cancellation = this.running || this.seeking ? Promise.resolve(this.executor.cancel?.("native-seek")) : Promise.resolve();
    const previousSeek = this.seeking;
    const task = Promise.resolve().then(async () => {
      await cancellation;
      await previousSeek?.catch(() => {});
      if (generation !== this.generation || this.cancelled) return this.snapshot();
      const snapshot = await this.finishSeek(targetTimeMs, generation, { playing });
      if (this.immediateEntry && generation === this.generation && !this.cancelled) this.startImmediateEntry(generation);
      return snapshot;
    }).finally(() => { if (this.seeking === task) this.seeking = null; });
    this.seeking = task;
    return task;
  }

  // A playing viewer seeked into a replaced interval: enter now. The engine holds
  // and covers native before the clip loads, so waiting for a preload and the next
  // position sample would only leave the removed footage playing meanwhile.
  startImmediateEntry(generation) {
    const { action, targetTimeMs } = this.immediateEntry; this.immediateEntry = null;
    if (this.running || this.statuses.get(action.id) !== "pending") return;
    const task = Promise.resolve().then(() => this.runWork([{ kind: "start", action, entry: true }], targetTimeMs, generation)).finally(() => {
      if (this.running === task) { this.running = null; this.runningAction = null; this.runningChain = null; }
    });
    this.running = task;
    task.catch(() => {});
  }

  async finishSeek(targetTimeMs, generation, { playing = false } = {}) {
    this.immediateEntry = null;
    await this.cancelActivePreload("native-seek");
    if (this.running) {
      await this.executor.cancel?.("native-seek");
      await this.running.catch(() => {});
    }
    if (this.activeMute) {
      const action = this.activeMute;
      await this.executor.finishMute(action);
      this.activeMute = null;
      this.statuses.set(action.id, "cancelled");
      this.record(action, "cancelled-by-seek");
    }
    if (this.cancelled || generation !== this.generation) return this.snapshot();
    await this.executor.honorNativeSeek?.(targetTimeMs);
    if (this.cancelled || generation !== this.generation) return this.snapshot();
    this.entryActionId = null;
    for (const action of this.actions) {
      const beforeTrigger = targetTimeMs <= action.triggerMs;
      // A seek into a replaced interval keeps its scene: it starts part-way in
      // instead of the viewer watching the footage the edit removes.
      const inside = !beforeTrigger && this.enterReplacedOnSeek && this.entryActionId === null && action.type === "REPLACE" &&
        action.resumeMs - targetTimeMs >= MIN_ENTRY_REMAINING_MS;
      if (inside) this.entryActionId = action.id;
      // Prime may emit a seek while resuming ordinary native playback. Keep
      // completed scenes behind the new position completed; a seek did not undo
      // their execution. Seeking back into/before a scene still starts a new
      // traversal below, and genuinely bypassed pending scenes remain skipped.
      if (!beforeTrigger && !inside && targetTimeMs >= action.resumeMs && this.statuses.get(action.id) === "completed") continue;
      this.statuses.set(action.id, beforeTrigger || inside ? "pending" : "skipped");
      this.record(action, beforeTrigger || inside ? 'reset-pending' : 'skipped', beforeTrigger ? 'seek-at-or-before-trigger' : inside ? 'seek-into-replaced' : 'seek-after-trigger');
      if (LOCAL_ACTIONS.has(action.type)) this.preflightStatuses.set(action.id, "idle");
    }
    this.previousTimeMs = targetTimeMs;
    if (playing && this.entryActionId !== null) {
      this.immediateEntry = { action: this.actions.find(action => action.id === this.entryActionId), targetTimeMs };
      return this.snapshot();
    }
    await this.startEligiblePreload(targetTimeMs, { allowAnchor: true });
    return this.snapshot();
  }

  cancelAll(reason = "action-plan-cancelled") {
    if (this.cancellation) return this.cancellation;
    this.cancelled = true;
    this.generation += 1;
    this.executor.invalidate?.(reason);
    if (this.running || this.seeking) void Promise.resolve(this.executor.cancel?.(reason)).catch(() => {});
    for (const action of this.actions) {
      if (["pending", "running", "active"].includes(this.statuses.get(action.id))) {
        this.statuses.set(action.id, "cancelled"); this.record(action, 'cancelled', 'plan-cancelled');
      }
    }
    this.cancellation = this.finishCancellation(reason);
    return this.cancellation;
  }

  async finishCancellation(reason) {
    await this.cancelActivePreload(reason);
    if (this.running) {
      await this.executor.cancel?.(reason);
      await this.running.catch(() => {});
    }
    if (this.activeMute) {
      const action = this.activeMute;
      await this.executor.finishMute(action);
      this.activeMute = null;
      this.statuses.set(action.id, "cancelled");
      this.record(action, "mute-stopped");
    }
    for (const action of this.actions) {
      if (["pending", "running", "active"].includes(this.statuses.get(action.id))) {
        this.statuses.set(action.id, "cancelled");
      }
    }
    this.previousTimeMs = null;
    return this.snapshot();
  }

  async cancelActivePreload(reason) {
    const task = this.preloadRunning;
    const prepared = [...this.preflightStatuses.values()].some(status => status === "ready" || status === "preloading");
    if (!task && !prepared) return;
    await this.executor.cancelPreload?.(reason);
    await task?.catch(() => {});
    for (const [id, status] of this.preflightStatuses) {
      if (status === "ready" || status === "preloading") this.preflightStatuses.set(id, "idle");
    }
    this.stagedActionId = null;
  }
}
