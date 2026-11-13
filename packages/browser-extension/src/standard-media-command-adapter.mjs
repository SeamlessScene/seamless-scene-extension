import { abortError, assertActive, boundedOperation } from "./operation-context.mjs";

function waitForMediaCondition(player, eventNames, predicate, { timeoutMs = 3000, signal, assertCurrent = () => {} } = {}) {
  assertActive(signal);
  assertCurrent();
  if (predicate()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const interval = setInterval(check, 25);
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for ${eventNames.join("/")}`)), timeoutMs);

    function check() {
      try { assertActive(signal); assertCurrent(); if (predicate()) finish(); } catch (error) { finish(error); }
    }

    function finish(error) {
      clearInterval(interval);
      clearTimeout(timeout);
      for (const eventName of eventNames) player.removeEventListener(eventName, check);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    }

    for (const eventName of eventNames) player.addEventListener(eventName, check);
    const onAbort = () => finish(signal.reason ?? abortError());
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function stateOf(player) {
  return {
    currentTimeMs: Math.round(player.currentTime * 1000),
    runtimeMs: Number.isFinite(player.duration) ? Math.round(player.duration * 1000) : null,
    paused: player.paused,
    muted: player.muted,
    volume: player.volume,
    readyState: player.readyState,
    seeking: player.seeking
  };
}

const FINE_NUDGE_DELTAS_MS = new Set([1, 10, 100]);
// A media element's play() rejected because pause() was called before it started.
const interruptedPlay = error => error?.name === "AbortError" && /interrupted/i.test(String(error?.message ?? ""));

export class StandardMediaCommandAdapter {
  constructor({ passiveAdapter, timeoutMs = 3000, seekToleranceMs = 250, now = () => performance.now() }) {
    this.passiveAdapter = passiveAdapter;
    this.timeoutMs = timeoutMs;
    this.seekToleranceMs = seekToleranceMs;
    this.now = now;
    this.pendingCommand = null;
  }

  player() {
    const player = this.passiveAdapter.activePlayer();
    if (!player) throw new Error("No active long-form player candidate is available");
    return player;
  }

  assertPlayer(player, signal) {
    assertActive(signal);
    if (this.passiveAdapter.activePlayer() !== player) throw abortError("Native player changed");
  }

  invalidateContext(reason = "Native source context changed", { sourceChanged = true } = {}) {
    if (this.pendingCommand?.active) {
      this.pendingCommand.sourceChanged ||= sourceChanged;
      this.pendingCommand.controller.abort(abortError(reason));
    }
  }

  // One native command owns its temporary effects at a time. Source reloads
  // use media lifecycle events and the reviewed provider-item invalidation;
  // the command surface never reads media URLs.
  async runCommand(player, signal, guard, work) {
    this.assertPlayer(player, signal); guard();
    this.invalidateContext("Native command superseded", { sourceChanged: false });
    const controller = new AbortController();
    const command = { controller, active: true, failed: false, sourceChanged: false, cleanup: () => {} };
    this.pendingCommand = command;
    const operationSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const owns = () => this.pendingCommand === command && !command.sourceChanged;
    const assertCurrent = () => {
      this.assertPlayer(player, operationSignal); guard();
      if (!owns()) throw abortError("Native command source or ownership changed");
    };
    const onAbort = () => { command.failed = true; command.cleanup(); };
    const onSourceChange = () => {
      command.sourceChanged = true;
      controller.abort(abortError("Native media source reloaded"));
    };
    operationSignal.addEventListener("abort", onAbort, { once: true });
    player.addEventListener?.("emptied", onSourceChange);
    player.addEventListener?.("loadstart", onSourceChange);
    const play = async label => {
      for (let attempt = 0; ; attempt += 1) {
        assertCurrent();
        // Observe late settlement independently of the bounded caller. A failed
        // request may stop only its own unchanged player, never a later command.
        const pending = player.play();
        Promise.resolve(pending).then(() => { if (command.failed) command.cleanup(); }, () => {});
        try {
          await boundedOperation(() => pending, { signal: operationSignal, timeoutMs: this.timeoutMs, label });
          break;
        } catch (error) {
          // Prime's own player can pause a play request it did not expect, e.g.
          // right after a creator seek ("The play request was interrupted by a
          // call to pause()", E52). That is not this command being cancelled:
          // ask again, a bounded number of times.
          if (attempt >= 2 || operationSignal.aborted || !interruptedPlay(error)) throw error;
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      }
      assertCurrent();
    };
    try {
      assertCurrent();
      const result = await work({ signal: operationSignal, assertCurrent, owns, play,
        ownsElement: () => this.pendingCommand === command,
        setCleanup: cleanup => { command.cleanup = cleanup; } });
      assertCurrent();
      return result;
    } catch (error) {
      command.failed = true;
      controller.abort(error);
      command.cleanup();
      throw error;
    } finally {
      command.active = false;
      operationSignal.removeEventListener("abort", onAbort);
      player.removeEventListener?.("emptied", onSourceChange);
      player.removeEventListener?.("loadstart", onSourceChange);
    }
  }

  readState() { return stateOf(this.player()); }

  readVideoProfile() {
    const player = this.player();
    const width = Number.isSafeInteger(player.videoWidth) && player.videoWidth > 0 ? player.videoWidth : null;
    const height = Number.isSafeInteger(player.videoHeight) && player.videoHeight > 0 ? player.videoHeight : null;
    return Object.freeze({ width, height });
  }

  async pause(signal, expectedPlayer, { assertCurrent = () => {} } = {}) {
    const player = expectedPlayer ?? this.player();
    return this.runCommand(player, signal, assertCurrent, async operation => {
      const before = stateOf(player), startedAt = this.now();
      player.pause();
      await waitForMediaCondition(player, ["pause"], () => player.paused, {
        timeoutMs: this.timeoutMs, signal: operation.signal, assertCurrent: operation.assertCurrent
      });
      return this.result("pause", before, stateOf(player), startedAt, true);
    });
  }

  async play(signal, expectedPlayer, { assertCurrent = () => {} } = {}) {
    const player = expectedPlayer ?? this.player();
    return this.runCommand(player, signal, assertCurrent, async operation => {
      const before = stateOf(player), startedAt = this.now();
      operation.setCleanup(() => { if (operation.owns() && before.paused && !player.paused) player.pause(); });
      await operation.play("native-play");
      await waitForMediaCondition(player, ["play", "playing"], () => !player.paused, {
        timeoutMs: this.timeoutMs, signal: operation.signal, assertCurrent: operation.assertCurrent
      });
      return this.result("play", before, stateOf(player), startedAt, true);
    });
  }

  async seekBy(deltaMs, signal) {
    if (!Number.isFinite(deltaMs)) throw new TypeError("Finite seek delta required");
    const player = this.player();
    return this.runCommand(player, signal, () => {}, async operation => {
      const before = stateOf(player);
      if (!Number.isFinite(before.runtimeMs)) throw new Error("Finite runtime is required for a seek test");
      const targetMs = Math.min(Math.max(0, before.currentTimeMs + deltaMs), Math.max(0, before.runtimeMs - 250));
      const startedAt = this.now();
      player.currentTime = targetMs / 1000;
      await waitForMediaCondition(player, ["seeked", "timeupdate", "loadeddata", "canplay"],
        () => !player.seeking && player.readyState >= 2 && Math.abs(player.currentTime * 1000 - targetMs) <= this.seekToleranceMs,
        { timeoutMs: this.timeoutMs, signal: operation.signal, assertCurrent: operation.assertCurrent });
      return { ...this.result(deltaMs < 0 ? "seek-backward" : "seek-forward", before, stateOf(player), startedAt, true),
        targetMs, errorMs: player.currentTime * 1000 - targetMs, toleranceMs: this.seekToleranceMs };
    });
  }

  // Viewer navigation must reach the seek before requesting any playback. In
  // particular, a replacement intentionally blocks native play until its
  // cancellation observes this seek; warming native first deadlocks that path.
  async seekTo(requestedTargetMs, { signal, assertCurrent = () => {} } = {}) {
    if (!Number.isFinite(requestedTargetMs)) throw new TypeError("Finite seek target required");
    const player = this.player();
    return this.runCommand(player, signal, assertCurrent, async operation => {
      const before = stateOf(player), startedAt = this.now();
      if (!Number.isFinite(before.runtimeMs)) throw new Error("Finite runtime is required for a seek");
      const targetMs = Math.min(Math.max(0, requestedTargetMs), Math.max(0, before.runtimeMs - 250));
      player.currentTime = targetMs / 1000;
      await waitForMediaCondition(player, ["seeked", "timeupdate", "loadeddata", "canplay"],
        () => !player.seeking && player.readyState >= 2 && Math.abs(player.currentTime * 1000 - targetMs) <= this.seekToleranceMs,
        { timeoutMs: this.timeoutMs, signal: operation.signal, assertCurrent: operation.assertCurrent });
      const after = stateOf(player);
      return { ...this.result("seek-absolute", before, after, startedAt, true),
        targetMs, errorMs: after.currentTimeMs - targetMs, toleranceMs: this.seekToleranceMs };
    });
  }

  // 0.65.6 (Developer mode only): an absolute episode-position seek
  // written the way the player's own slider writes it: one currentTime write on the active
  // element, with no pause, play or mute, and without superseding the extension's own native
  // commands (no runCommand), so an active or paused replacement handles it as a viewer seek.
  // Whole milliseconds up to the runtime less 250 ms; a seek that has not landed within the
  // timeout is reported as settling, not failed (Prime may defer a paused seek, E52).
  async seekToPosition(requestedTargetMs, { signal } = {}) {
    if (!Number.isSafeInteger(requestedTargetMs) || requestedTargetMs < 0) throw new TypeError("Enter the position in whole milliseconds");
    const player = this.player();
    this.assertPlayer(player, signal);
    const before = stateOf(player), startedAt = this.now();
    if (!Number.isFinite(before.runtimeMs)) throw new Error("Finite runtime is required for a seek");
    const maxMs = Math.max(0, before.runtimeMs - 250);
    if (requestedTargetMs > maxMs) throw new RangeError(`Position must be at most ${maxMs} ms`);
    player.currentTime = requestedTargetMs / 1000;
    let landed = true;
    try {
      await waitForMediaCondition(player, ["seeked", "timeupdate", "loadeddata", "canplay"],
        () => !player.seeking && player.readyState >= 2 && Math.abs(player.currentTime * 1000 - requestedTargetMs) <= this.seekToleranceMs,
        { timeoutMs: this.timeoutMs, signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      landed = false;
    }
    const after = stateOf(player);
    return { ...this.result("seek-position", before, after, startedAt, landed),
      targetMs: requestedTargetMs, errorMs: after.currentTimeMs - requestedTargetMs, toleranceMs: this.seekToleranceMs, ...(landed ? {} : { settling: true }) };
  }

  async nudgeForward(deltaMs, signal) {
    if (!FINE_NUDGE_DELTAS_MS.has(deltaMs)) throw new TypeError("Unsupported fine-seek increment");
    const player = this.player();
    return this.runCommand(player, signal, () => {}, async operation => {
      const before = stateOf(player);
      if (!before.paused) throw new Error("Pause playback before using fine seek");
      if (!Number.isFinite(before.runtimeMs)) throw new Error("Finite runtime is required for a fine seek");
      const targetMs = Math.min(before.currentTimeMs + deltaMs, Math.max(0, before.runtimeMs - 250));
      const startedAt = this.now();
      player.currentTime = targetMs / 1000;
      await waitForMediaCondition(player, ["seeked", "timeupdate", "loadeddata", "canplay"],
        () => !player.seeking && player.readyState >= 2,
        { timeoutMs: this.timeoutMs, signal: operation.signal, assertCurrent: operation.assertCurrent });
      const after = stateOf(player);
      return { ...this.result(`nudge-forward-${deltaMs}ms`, before, after, startedAt, true),
        requestedDeltaMs: deltaMs, appliedDeltaMs: after.currentTimeMs - before.currentTimeMs,
        targetMs, errorMs: after.currentTimeMs - targetMs };
    });
  }

  async seekByWithPlaybackWarmup(deltaMs, signal) {
    if (!Number.isFinite(deltaMs)) throw new TypeError("Finite seek delta required");
    const player = this.player(), before = stateOf(player);
    if (!Number.isFinite(before.runtimeMs)) throw new Error("Finite runtime is required for a warm seek test");
    const targetMs = Math.min(Math.max(0, before.currentTimeMs + deltaMs), Math.max(0, before.runtimeMs - 250));
    return this.seekToWithPlaybackWarmup(targetMs, deltaMs < 0 ? "warm-seek-backward" : "warm-seek-forward", { signal, player });
  }

  async seekToWithPlaybackWarmup(requestedTargetMs, command = "warm-seek-absolute", { signal, player: expectedPlayer, assertCurrent = () => {}, settlePaused = false } = {}) {
    if (!Number.isFinite(requestedTargetMs)) throw new TypeError("Finite seek target required");
    const player = expectedPlayer ?? this.player();
    return this.runCommand(player, signal, assertCurrent, async operation => {
      const before = stateOf(player);
      if (!Number.isFinite(before.runtimeMs)) throw new Error("Finite runtime is required for a warm seek test");
      const targetMs = Math.min(Math.max(0, requestedTargetMs), Math.max(0, before.runtimeMs - 250));
      const startedAt = this.now(), ownsMute = !before.muted;
      let muteWritten = false;
      const cleanup = () => {
        if (operation.owns() && before.paused && !player.paused) player.pause();
        // Release this exact temporary element-property write once, even when
        // the source reloads. Late play settlement cannot unmute it again.
        if (operation.ownsElement() && muteWritten) {
          muteWritten = false;
          if (player.muted) player.muted = false;
        }
      };
      operation.setCleanup(cleanup);
      try {
        if (ownsMute) { player.muted = true; muteWritten = true; }
        if (player.paused) {
          await operation.play("warmup-play");
          await waitForMediaCondition(player, ["play", "playing"], () => !player.paused,
            { timeoutMs: this.timeoutMs, signal: operation.signal, assertCurrent: operation.assertCurrent });
        }
        operation.assertCurrent();
        player.currentTime = targetMs / 1000;
        await waitForMediaCondition(player, ["seeked", "timeupdate", "loadeddata", "canplay"],
          () => !player.seeking && player.readyState >= 2 && Math.abs(player.currentTime * 1000 - targetMs) <= this.seekToleranceMs,
          { timeoutMs: this.timeoutMs, signal: operation.signal, assertCurrent: operation.assertCurrent });
        operation.assertCurrent();
        if (before.paused && settlePaused) {
          // Prime can emit an early seek completion and resume after a later
          // seeked event (340 ms afterward in the retained action-62 trace).
          // Navigation is not ready until pause remains settled for 500 ms.
          // This bounded guard belongs to this command only; replacement joins
          // do not opt in, and cancellation/new commands remove its listeners.
          let settledAt = null;
          await waitForMediaCondition(player, ["seeking", "seeked", "play", "playing", "pause", "canplay"], () => {
            if (!player.paused) { settledAt = null; player.pause(); }
            if (player.seeking || player.readyState < 2) { settledAt = null; return false; }
            settledAt ??= performance.now();
            return performance.now() - settledAt >= 500;
          }, { timeoutMs: this.timeoutMs, signal: operation.signal, assertCurrent: operation.assertCurrent });
        }
      } finally { cleanup(); }
      const after = stateOf(player);
      return { ...this.result(command, before, after, startedAt, true), targetMs,
        errorMs: after.currentTimeMs - targetMs, toleranceMs: this.seekToleranceMs };
    });
  }

  async setMuted(muted, signal) {
    if (typeof muted !== "boolean") throw new TypeError("Boolean mute state required");
    const player = this.player();
    return this.runCommand(player, signal, () => {}, async operation => {
      const before = stateOf(player), startedAt = this.now();
      player.muted = muted;
      await waitForMediaCondition(player, ["volumechange"], () => player.muted === muted,
        { timeoutMs: this.timeoutMs, signal: operation.signal, assertCurrent: operation.assertCurrent });
      return this.result(muted ? "mute" : "unmute", before, stateOf(player), startedAt, true);
    });
  }

  result(command, before, after, startedAt, confirmed) {
    return { command, confirmed, durationMs: Math.round((this.now() - startedAt) * 1000) / 1000, before, after };
  }
}
