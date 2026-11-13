import { StandardMediaCommandAdapter } from '/extension/src/standard-media-command-adapter.mjs';
import { StandardTransitionAdapter } from '/extension/src/standard-transition-adapter.mjs';
import { EXECUTING_BUILD } from '/extension/src/build-info.mjs';

const player = document.querySelector('#native'), status = document.querySelector('#status'), results = document.querySelector('#results');
const run = document.querySelector('#run'), reverse = document.querySelector('#reverse'), stop = document.querySelector('#stop');
const passive = { activePlayer: () => player }, commands = new StandardMediaCommandAdapter({ passiveAdapter: passive });
const adapter = new StandardTransitionAdapter({ document, passiveAdapter: passive, commandAdapter: commands });
let active = null, closed = false;
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(), ms), abort = () => finish(signal.reason);
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
}
// Fixture-only observers. They add no native frame requests: the wrapper records
// callbacks requested by the actual adapter, preserving its demand and barrier.
function observeCadence() {
  const started = performance.now(), phases = [], visibilityEvents = [];
  let phase = null, animation = null, previousAnimation = null, previousTimer = null, stopped = false;
  let previousVisibility = null, droppedVisibilityEvents = 0;
  const visibility = () => ({ visibility: document.visibilityState, focused: document.hasFocus() });
  const sampleVisibility = (cause, force = false) => {
    if (stopped) return;
    const state = visibility(), key = `${state.visibility}:${state.focused}`;
    if (!force && key === previousVisibility) return;
    previousVisibility = key;
    if (visibilityEvents.length === 128) { visibilityEvents.shift(); droppedVisibilityEvents++; }
    visibilityEvents.push({ cause, afterStartMs: performance.now() - started, phase: phase?.name ?? null, ...state });
  };
  const onVisibility = () => sampleVisibility('visibilitychange', true);
  const onFocus = () => sampleVisibility('focus', true), onBlur = () => sampleVisibility('blur', true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus); window.addEventListener('blur', onBlur);
  const originalRequest = player.requestVideoFrameCallback;
  const enter = name => {
    const now = performance.now(); if (phase) phase.durationMs = now - started - phase.startMs;
    phase = { name, startMs: now - started, durationMs: null, animationCallbacks: 0, timerCallbacks: 0,
      firstAnimationAfterMs: null, maximumAnimationGapMs: null, maximumTimerGapMs: null, nativeCallbacks: [] };
    phases.push(phase); previousAnimation = previousTimer = null;
    phase.visibilityAtStart = visibility(); sampleVisibility(`phase:${name}`, true);
  };
  enter('setup');
  const animate = () => {
    const now = performance.now(); phase.animationCallbacks++;
    sampleVisibility('animation-state-change');
    phase.firstAnimationAfterMs ??= now - started - phase.startMs;
    if (previousAnimation !== null) phase.maximumAnimationGapMs = Math.max(phase.maximumAnimationGapMs ?? 0, now - previousAnimation);
    previousAnimation = now; animation = requestAnimationFrame(animate);
  };
  animation = requestAnimationFrame(animate);
  const timer = setInterval(() => {
    const now = performance.now(); phase.timerCallbacks++;
    sampleVisibility('timer-state-change');
    if (previousTimer !== null) phase.maximumTimerGapMs = Math.max(phase.maximumTimerGapMs ?? 0, now - previousTimer);
    previousTimer = now;
  }, 250);
  player.requestVideoFrameCallback = callback => originalRequest.call(player, (time, metadata) => {
    if (!stopped) {
      phase.nativeCallbacks.push({ afterPhaseMs: performance.now() - started - phase.startMs, mediaTimeMs: metadata.mediaTime * 1000,
        presentedFrames: metadata.presentedFrames, paused: player.paused, expectedDisplayTimeMs: metadata.expectedDisplayTime });
      if (phase.nativeCallbacks.length > 8) phase.nativeCallbacks.shift();
    }
    callback(time, metadata);
  });
  return { enter, visibilityEvents, get droppedVisibilityEvents() { return droppedVisibilityEvents; }, finish() {
    if (!stopped) {
      sampleVisibility('finish', true);
      stopped = true; clearInterval(timer); cancelAnimationFrame(animation); delete player.requestVideoFrameCallback;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur);
      phase.durationMs = performance.now() - started - phase.startMs;
      phase.visibilityAtFinish = visibility();
    }
    return phases;
  } };
}
async function compare(coveredFirst) {
  if (active || closed) return;
  const controller = new AbortController(), signal = controller.signal; active = controller;
  run.disabled = reverse.disabled = true; stop.disabled = false;
  const record = { kind: 'cleared-native-frame-cadence', startedAt: new Date().toISOString(), executingBuild: EXECUTING_BUILD,
    installedExtension: false, coveredFirst, dwellMs: 5000, resumeTargetMs: 8000, muted: true, cases: [],
    limitations: ['Cleared shared-source modules, not installed runtime or Prime.',
      'Animation observation itself requests rendering callbacks; no additional native frame requests are added.',
      'DOM visibility/focus do not prove native-window visibility. No pixel or audio inspection.'] };
  const paint = () => { results.textContent = JSON.stringify(record, null, 2); };
  paint();
  const deadline = setTimeout(() => controller.abort(new DOMException('Comparison deadline', 'TimeoutError')), 45000);
  let snapshot = null, cadence = null;
  try {
    for (const covered of (coveredFirst ? [true, false, false, true] : [false, true, true, false])) {
      signal.throwIfAborted(); status.textContent = `Measuring ${covered ? 'covered' : 'visible'} native resume`;
      // Preserve this case before any await. A failed restore previously lost
      // both its coverage identity and the immediately preceding visibility.
      const currentCase = { covered, status: 'running' }; record.pendingCase = currentCase;
      cadence = observeCadence();
      currentCase.visibilityEvents = cadence.visibilityEvents;
      player.muted = true; player.currentTime = 1;
      // The command adapter owns cancellation/late play settlement for this
      // fixture source too. No raw late play promise may restart Stop.
      await commands.play(signal, player);
      snapshot = await adapter.snapshot(); signal.throwIfAborted();
      await adapter.pause(signal); await adapter.setMuted(true, signal);
      if (covered) await adapter.mountOverlayHost();
      await adapter.seek(8000, signal);
      cadence.enter('paused-dwell'); await delay(5000, signal);
      const beforeResume = { visibility: document.visibilityState, focused: document.hasFocus(),
        paused: player.paused, nativeTimeMs: player.currentTime * 1000, covered: adapter.overlayHost?.isConnected === true };
      currentCase.beforeResume = beforeResume;
      cadence.enter('restore');
      const receipt = await adapter.restore(snapshot, { targetTimeMs: 8000, resumePlayback: true, awaitPresentedFrame: true, signal });
      const phases = cadence.finish(); currentCase.droppedVisibilityEvents = cadence.droppedVisibilityEvents;
      cadence = null; snapshot = null;
      Object.assign(currentCase, { status: 'complete', receipt, phases, nativePausedAfterRestore: player.paused,
        mutedAfterRestore: player.muted, overlayRemoved: adapter.overlayHost === null });
      record.cases.push(currentCase); delete record.pendingCase;
      player.pause(); paint();
    }
    record.completed = true;
  } catch (error) {
    record.completed = false; record.failure = signal.aborted ? 'cancelled-or-deadline' : 'native-barrier-failed';
    record.failureName = error.name;
    record.failureCode = signal.aborted ? 'cancelled-or-deadline' :
      error.message === 'Timed out waiting for a presented native frame' ? 'presented-native-frame-timeout' : 'native-operation-failed';
    record.failureStateBeforeFixtureCleanup = { visibility: document.visibilityState, focused: document.hasFocus(), nativePaused: player.paused, nativeMuted: player.muted,
      nativeTimeMs: player.currentTime * 1000, overlayRemoved: adapter.overlayHost === null };
    if (cadence) {
      record.failedPhaseObservations = cadence.finish();
      if (record.pendingCase) Object.assign(record.pendingCase, { status: 'failed', phases: record.failedPhaseObservations, droppedVisibilityEvents: cadence.droppedVisibilityEvents });
      cadence = null;
    }
  } finally {
    clearTimeout(deadline); controller.abort(); cadence?.finish();
    if (snapshot) await adapter.forceSafeNativeState(snapshot).catch(() => {});
    adapter.teardownOverlayHost(); player.pause();
    record.finishedAt = new Date().toISOString(); record.nativePaused = player.paused; record.overlayRemoved = adapter.overlayHost === null;
    record.timingWithin250Ms = record.completed === true && record.cases.every(item => Number.isFinite(item.receipt.errorMs) && Math.abs(item.receipt.errorMs) <= 250);
    record.acceptance = 'Diagnostic only; no release, installed, audible or blackout gate passed.';
    status.textContent = record.completed ? 'Comparison complete — inspect timing evidence' : 'Comparison stopped or failed'; paint();
    active = null; run.disabled = reverse.disabled = false; stop.disabled = true;
  }
}
run.addEventListener('click', () => compare(false)); reverse.addEventListener('click', () => compare(true));
stop.addEventListener('click', () => active?.abort(new DOMException('Stopped comparison', 'AbortError')));
addEventListener('pagehide', () => { closed = true; active?.abort(new DOMException('Closed fixture', 'AbortError')); player.pause(); adapter.teardownOverlayHost(); });
