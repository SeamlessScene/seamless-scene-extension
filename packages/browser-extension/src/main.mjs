import {connectViewerController,viewerRequest} from './viewer-client.mjs';
import { sourceMismatchCode, sameEpisodeOtherTitleId } from './viewer-model.mjs';
import { supersededByEntry } from './jump-target.mjs';
import {waitForWatchIntent} from './watch-intent-wait.mjs';
import { viewerLoadMessage } from './viewer-load-error.mjs';
import {mountViewerOverlay} from './viewer-overlay.mjs';
import {saveTimingReport} from './timing-report-save.mjs';
import {createLoadedEditDisplayReader} from './loaded-edit-display.mjs';
import {sourceKey,editProgress,viewerPaused} from './viewer-model.mjs';
import {observePlayerIdentity} from './player-identity-observation.mjs';
import {createPassiveProbeMessageHandler} from './passive-probe-message.mjs';
import {editedTimeline,editedPosition} from './viewer-timeline.mjs';
import { withCatalogActivity } from './catalog-activity-executor.mjs';
import { BUILD_ID, EXTENSION_VERSION, EXECUTING_BUILD } from "./build-info.mjs";
import { sameExecutingBuild } from './build-identity.mjs';
import { assertLocalPacketService, compileLocalUserEditActions, validateLocalUserEditPacket } from "./local-edit-packet.mjs";
import { isPreviewPacket, previewSceneName } from "./preview-packet.mjs";
import { assessLocalQualityContinuity } from "./local-quality-continuity.mjs";
import { LocalOverlay } from "./local-overlay.mjs";
import { PrivateLocalOverlay } from "./private-local-overlay.mjs";
import { disconnectSummary } from "./connection-diagnostics.mjs";
import { ManifestActionExecutor } from "./manifest-action-executor.mjs";
import { compileManifestActions, ManifestActionScheduler } from "./manifest-action-scheduler.mjs";
import { ManifestActivationStore } from "./manifest-activation-store.mjs";
import { MetricsRecorder } from "./metrics.mjs";
import { EngineEventLog, engineEventExport } from "./engine-event-log.mjs";
import { installPageLifecycleRecovery } from "./page-lifecycle.mjs";
import { createPassiveServiceAdapter } from "./passive-service-adapter.mjs";
import { ReadOnlyIdentityBridgeClient } from "./read-only-identity-bridge.mjs";
import { buildReplacementNavigationItems, normalizePrerollMs, navigateReplacement } from "./replacement-navigator.mjs";
import { assessSourceFingerprintCoverage, evaluateSourceCompatibility } from "./source-identity.mjs";
import { evaluateAdapterCompatibility, validateManifestSchema } from "./manifest-security.mjs";
import { catalogObservedSource } from "./catalog-runtime-service.mjs";
import { StandardMediaCommandAdapter } from "./standard-media-command-adapter.mjs";
import { StandardPlayerCover } from "./standard-player-cover.mjs";
import { StandardTransitionAdapter } from "./standard-transition-adapter.mjs";
import { TrialEvidenceRecorder } from "./trial-evidence.mjs";
import { PacketPlaybackJournal } from './packet-playback-journal.mjs';
import { TransitionEngine } from "./transition-engine.mjs";
import { installViewerKeys } from "./viewer-keys.mjs";
import { createTransitionTiming, watchTransitions, timingEnvironment } from "./transition-timing.mjs";
import { OperationContext, assertActive } from "./operation-context.mjs";
import { initializeFixture } from "./edition-page.mjs";
import { createPacketSessionController } from "./packet-session-controller.mjs";
import { installEvidenceExport } from "./playback-evidence-export.mjs";
import { createPlaybackObserver, createGuardedExecutor, playbackSourceKey, installNativeSeekObserver } from "./playback-session.mjs";
import { DEVELOPER_PANEL_HTML, DEVELOPER_LAUNCHER_HTML, developerSceneRow, developerSummary } from "./developer-panel.mjs";
import { sceneJump, leadInMs } from "./viewer-display.mjs";


const spikeBuild = BUILD_ID ?? `unbuilt-source:${EXTENSION_VERSION}`;

export async function initializeSceneSubstitutionSpike({ replacePassivePanel = false } = {}) {
  if (document.querySelector("#local-native-review-player") && ["127.0.0.1", "localhost"].includes(location.hostname)) {
    const host = document.querySelector('#local-native-review-controls');
    host.replaceChildren();
    const notice = document.createElement('p');
    notice.textContent = 'Private native-file review has moved into the extension. Open it from the authoring panel; do not select private files on this localhost page.';
    host.append(notice);
    return;
  }
  if (location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname) && document.querySelector("#spike-native-player")) {
    // The explicit standalone fixture owns its own controller. An installed
    // content script must not create a second plan in another JS world.
    if (globalThis.chrome?.runtime?.id && new URLSearchParams(location.search).has('standalone')) return;
    if (globalThis.__sceneSubstitutionFixtureBuild === spikeBuild) return;
    if (globalThis.__sceneSubstitutionFixtureBuild) throw Error('Fixture build changed; refresh the tab before reconnecting');
    globalThis.__sceneSubstitutionFixtureBuild = spikeBuild;
    try { await initializeFixture({ document, window, location }); }
    catch (error) { if (globalThis.__sceneSubstitutionFixtureBuild === spikeBuild) delete globalThis.__sceneSubstitutionFixtureBuild; throw error; }
    return;
  }

  const existingPanel = document.querySelector("#scene-substitution-passive-probe");
  if (existingPanel && !replacePassivePanel) return;
  existingPanel?.remove();
  // Nothing runs on Amazon pages without a video player (search, cart, product pages):
  // wait, with one cheap observer, until the service's player container appears.
  const scope = createPassiveServiceAdapter({ document, location })?.playerScopeSelector;
  // ...unless the viewer chose an edit on the website ("Watch this edit"): then start
  // on the title page, so its download runs before they press play.
  if (scope) await Promise.race([waitForElement(document, scope), editWaiting()]);
  await initializePassiveProbe();
}

async function editWaiting() {
  if (await waitForWatchIntent(() => viewerRequest('pending-watch', {}))) return;
  return new Promise(() => {});
}

function waitForElement(document, selector) {
  if (document.querySelector(selector)) return Promise.resolve();
  return new Promise(resolve => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector(selector)) return;
      observer.disconnect(); resolve();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

if (!globalThis.chrome?.runtime?.id) await initializeSceneSubstitutionSpike();

async function initializePassiveProbe() {
  const adapter = createPassiveServiceAdapter({ document, location });
  if (!adapter) return;
  globalThis.__sceneSubstitutionPassiveMonitorAbort?.abort();
  const lifecycleAbort = new AbortController();
  let identityObservationEpoch = 0;
  for (const eventName of ['loadstart', 'emptied']) document.addEventListener(eventName, () => { identityObservationEpoch++; }, {capture:true,signal:lifecycleAbort.signal});
  globalThis.__sceneSubstitutionPassiveMonitorAbort = lifecycleAbort;
  const commandAdapter = adapter.serviceId === "prime-video"
    ? new StandardMediaCommandAdapter({ passiveAdapter: adapter })
    : null;
  const playerCover = commandAdapter
    ? new StandardPlayerCover({ document, passiveAdapter: adapter })
    : null;
  const primeTransitionMetrics = commandAdapter ? new MetricsRecorder() : null;
  const primeTransitionOverlay = commandAdapter ? new PrivateLocalOverlay({ document }) : null;
  const primeTransitionAdapter = commandAdapter
    ? new StandardTransitionAdapter({ document, passiveAdapter: adapter, commandAdapter,
      beforeHostTeardown: () => primeTransitionOverlay.returnHome(),
      onPresentationError: () => { void primeTransitionEngine.cancel('presentation-context-changed'); } })
    : null;
  const primeTransitionEngine = commandAdapter
    ? new TransitionEngine({
      adapter: primeTransitionAdapter,
      overlay: primeTransitionOverlay,
      metrics: primeTransitionMetrics
    })
    : null;
  // 0.65.9: the developer-mode engine event log (records only while Advanced mode is on).
  const engineEventLog = commandAdapter ? new EngineEventLog() : null;
  if (engineEventLog) { primeTransitionAdapter.eventLog = engineEventLog; primeTransitionEngine.eventLog = engineEventLog; }
  const primeTrialRecorder = commandAdapter
    ? globalThis.__sceneSubstitutionPrimeTrialRecorder?.extensionVersion === spikeBuild
      ? globalThis.__sceneSubstitutionPrimeTrialRecorder
      : new TrialEvidenceRecorder({ serviceId: adapter.serviceId, extensionVersion: spikeBuild })
    : null;
  if (primeTrialRecorder) globalThis.__sceneSubstitutionPrimeTrialRecorder = primeTrialRecorder;

  const panelHost = document.createElement("aside");
  panelHost.id = "scene-substitution-passive-probe";
  panelHost.dataset.service = adapter.serviceId;
  panelHost.dataset.integrationDepth = "0";
  panelHost.dataset.probeVersion = spikeBuild;
  panelHost.dataset.probeStatus = "initializing";
  const shadow = panelHost.attachShadow({ mode: "open" });
  shadow.innerHTML = DEVELOPER_PANEL_HTML;
  document.documentElement.append(panelHost);

  const setField = (name, value) => {
    shadow.querySelector(`[data-field="${name}"]`).textContent = value ?? "unknown";
  };

  // The developer panel and its "Developer" launcher exist for Advanced mode only
  // (Settings → Advanced). Viewers use the player menu and the toolbar popup.
  let playbackLauncher = null, launcherHost = null;
  const setPlaybackControlsVisible = visible => {
    panelHost.dataset.playbackControls = visible ? "visible" : "hidden";
    playbackLauncher?.setAttribute("aria-expanded", String(visible));
  };
  // 0.65.9: the engine event log and its native media-event marks exist in Advanced mode only.
  let nativeEventMarks = null;
  const setEngineEventLog = on => {
    if (!engineEventLog) return;
    engineEventLog.setEnabled(on);
    if (!on) { nativeEventMarks?.abort(); nativeEventMarks = null; return; }
    if (nativeEventMarks) return;
    nativeEventMarks = new AbortController();
    const signal = AbortSignal.any([nativeEventMarks.signal, lifecycleAbort.signal]);
    for (const type of ['pause', 'play', 'playing', 'seeked']) document.addEventListener(type, event => {
      let player = null; try { player = adapter.activePlayer?.(); } catch {}
      if (!player || event.target !== player) return;
      const ms = player.currentTime * 1000;
      engineEventLog.record('sync', `native-${type}-observed`, { mediaMs: Number.isFinite(ms) ? ms : null });
    }, { capture: true, signal });
  };
  const setAdvancedMode = advanced => {
    setEngineEventLog(advanced === true);
    panelHost.dataset.advanced = String(advanced === true);
    if (advanced !== true || !commandAdapter) {
      launcherHost?.remove(); launcherHost = null; playbackLauncher = null;
      setPlaybackControlsVisible(false);
      return;
    }
    if (launcherHost) return;
    launcherHost = document.createElement("aside");
    launcherHost.id = "scene-substitution-playback-launcher";
    const launcherRoot = launcherHost.attachShadow({ mode: "open" });
    launcherRoot.innerHTML = DEVELOPER_LAUNCHER_HTML;
    const launcher = launcherRoot.querySelector("button");
    playbackLauncher = launcher;
    launcher.addEventListener("click", () => {
      setPlaybackControlsVisible(panelHost.dataset.playbackControls !== "visible");
    }, { signal: lifecycleAbort.signal });
    document.documentElement.append(launcherHost);
  };
  lifecycleAbort.signal.addEventListener("abort", () => launcherHost?.remove(), { once: true });
  setAdvancedMode(false);

  // Why the edit stopped by itself, as a code the viewer surfaces map to plain
  // words (never the developer output). It expires after two minutes, and a
  // viewer action (turn on, stop, a new load) clears it.
  let viewerNotice = null;
  const NOTICE_LIFETIME_MS = 120_000;
  const setNotice = code => { viewerNotice = code ? { code, at: Date.now() } : null; };
  const currentNotice = () => viewerNotice && Date.now() - viewerNotice.at < NOTICE_LIFETIME_MS ? viewerNotice.code : '';
  let viewerPreferences = {};

  let primeIdentityClient = null;
  let unsubscribePrimeIdentity = null;
  // The loaded packet, its armed scheduler and an arm in progress (see packet-session-controller.mjs).
  // Setting a scheduler starts per-frame playback observation; clearing it stops it,
  // so an unarmed player page runs no frame loop.
  let packetScheduler = null, stopPacketObservation = null;
  const packetState = { session: null, arming: null,
    get scheduler() { return packetScheduler; },
    set scheduler(value) {
      packetScheduler = value;
      if (value && !stopPacketObservation && primeTransitionAdapter) stopPacketObservation = primeTransitionAdapter.subscribe(state => observeLocalPacket(state));
      if (!value && stopPacketObservation) { stopPacketObservation(); stopPacketObservation = null; }
    } };
  let sceneTiming = null;
  let armViewerEdit = async()=>{throw Error("viewer-not-ready");};
  let enableViewerIdentity = async()=>{throw Error("viewer-source-unavailable");};
  const packetPlaybackJournal = new PacketPlaybackJournal();
  const packetOperations = new OperationContext();
  const navigationOperations = new OperationContext();
  const privateIdentityOutput = shadow.querySelector("[data-identity-output]");
  const armLocalPacketButton = shadow.querySelector('[data-action="arm-local-packet"]');
  const cancelLocalPacketButton = shadow.querySelector('[data-action="cancel-local-packet"]');
  const packetOutput = shadow.querySelector("[data-packet-output]");
  const packetNavigation = shadow.querySelector("[data-packet-navigation]");
  const navigationList = shadow.querySelector("[data-navigation-list]");
  const navigationOutput = shadow.querySelector("[data-navigation-output]");
  const prerollSecondsInput = shadow.querySelector("[data-preroll-seconds]");
  const scenesEmpty = shadow.querySelector("[data-scenes-empty]");

  const qualitySummary = (assessment) => {
    if (assessment.status === "unknown") return "native resolution unavailable; quality comparison pending";
    if (assessment.status !== "warning") {
      return `resolution matches the native quality range (${assessment.native.width}×${assessment.native.height})`;
    }
    const warning = assessment.warnings[0];
    if (warning.code === "materially-lower-resolution") {
      return `quality warning: local ${warning.localWidth}×${warning.localHeight} vs native ${warning.nativeWidth}×${warning.nativeHeight}`;
    }
    if (warning.code === "aspect-ratio-mismatch") return "quality warning: local and native aspect ratios differ";
    return "quality warning: local resolution could not be assessed";
  };

  const clearLocalPacketSession = reason => packetSessionController.clear(reason);

  const expectedPacketSource = (packet) => ({
    serviceId: packet.manifest.source.service,
    serviceContentId: packet.manifest.source.service_content_id,
    mediaType: packet.manifest.source.episode === null ? "movie" : "episode",
    season: packet.manifest.source.season,
    episode: packet.manifest.source.episode,
    runtimeMs: packet.manifest.source.expected_runtime_ms,
    runtimeToleranceMs: packet.manifest.source.runtime_tolerance_ms
  });

  // A failed source check says which kind of mismatch it was, as a code the viewer surfaces map to
  // a sentence; the comparison's own reason travels as the cause for diagnostics.
  let lastSourceCheck = null;
  const sourceMismatch = (reason, titleIdChanged = false) => Object.assign(Error(sourceMismatchCode(reason, { titleIdChanged })), { detail: reason });
  const assertLocalPacketSource = async (packet, operation = packetOperations.capture()) => {
    operation.assertCurrent();
    assertActive(lifecycleAbort.signal);
    if (!primeIdentityClient) throw new Error("viewer-source-unavailable");
    const observed = await primeIdentityClient.readIdentity();
    operation.assertCurrent();
    assertActive(lifecycleAbort.signal);
    const expected = expectedPacketSource(packet);
    const comparison = evaluateSourceCompatibility(
      { ...observed, serviceId: adapter.serviceId },
      expected
    );
    lastSourceCheck = comparison.status === "compatible" ? "compatible" : comparison.reason;
    if (comparison.status !== "compatible") throw sourceMismatch(comparison.reason, sameEpisodeOtherTitleId(observed, expected));
    let catalogActions = null;
    if (packetState.session?.trust === 'catalog') {
      catalogActions = await primeTransitionOverlay.catalogActions(catalogObservedSource({ ...observed, serviceId: adapter.serviceId }), operation.signal);
      operation.assertCurrent();
      assertActive(lifecycleAbort.signal);
    }
    if (packetState.session) {
      if (packetState.scheduler && (packetState.session.sourceKey !== playbackSourceKey(observed) || packetState.session.player !== adapter.activePlayer())) {
        primeTransitionAdapter.invalidateContext();
        throw new DOMException('Source session changed; re-arm required', 'AbortError');
      }
      packetState.session.sourceKey = playbackSourceKey(observed);
      packetState.session.player = adapter.activePlayer();
    }
    return { ...comparison, catalogActions };
  };
  const packetSessionController = createPacketSessionController({ state: packetState, operations: packetOperations, journal: packetPlaybackJournal,
    ui: { armButton: armLocalPacketButton, cancelButton: cancelLocalPacketButton, navigation: packetNavigation, navigationList, navigationOutput, packetOutput, panelHost },
    engine: primeTransitionEngine, adapter: primeTransitionAdapter, overlay: primeTransitionOverlay, commandAdapter, assertSource: assertLocalPacketSource, eventLog: engineEventLog });


  const packetAssetExpectation = (asset) => ({
    sha256: asset.sha256,
    durationMs: asset.expected_duration_ms,
    durationToleranceMs: 100,
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: asset.width,
    height: asset.height,
    dynamicRange: asset.dynamic_range
  });

  // One path for every scene jump (the player menu, the popup and this panel):
  // check the source, then seek through the navigator, which finishes any running
  // scene's restoration first. The scheduler's own timing is untouched.
  const seekBeforeScene = async (targetMs, navigationContext) => {
    const context = packetOperations.capture(), session = packetState.session;
    if (!session) throw Error("viewer-not-ready");
    const signal = AbortSignal.any([context.signal, navigationContext.signal, lifecycleAbort.signal]);
    const assertCurrent = () => {
      context.assertCurrent(); navigationContext.assertCurrent(); assertActive(signal);
      if (packetState.session !== session) throw new DOMException('Edit changed during navigation', 'AbortError');
    };
    await assertLocalPacketSource(session.packet);
    assertCurrent();
    return navigateReplacement({ targetMs, commandAdapter,
      engine: primeTransitionEngine, scheduler: packetState.scheduler, signal, assertCurrent });
  };

  const renderReplacementNavigator = () => {
    navigationList.replaceChildren();
    if (!packetState.session) {
      packetNavigation.hidden = true;
      scenesEmpty.hidden = false;
      return;
    }
    const prerollMs = normalizePrerollMs(Number(prerollSecondsInput.value) * 1000);
    prerollSecondsInput.value = String(prerollMs / 1000);
    const items = buildReplacementNavigationItems(packetState.session.packet, prerollMs);
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = !primeIdentityClient;
      button.dataset.segmentId = item.id;
      const row = developerSceneRow(item);
      for (const [className, text] of [["n", row.number], ["t", row.text], ["j", row.jump]]) {
        const span = document.createElement("span"); span.className = className; span.textContent = text; button.append(span);
      }
      button.addEventListener("click", async () => {
        navigationOperations.invalidate('New scene navigation');
        const navigationContext = navigationOperations.capture();
        button.disabled = true;
        navigationOutput.textContent = `Checking source and seeking to ${item.targetLabel}…`;
        try {
          const result = await seekBeforeScene(item.targetMs, navigationContext);
          navigationOutput.textContent = `Ready ${prerollMs / 1000}s before ${item.triggerLabel} · seek error ${result.errorMs} ms`;
        } catch (error) {
          if (!navigationContext.signal.aborted) navigationOutput.textContent = `Navigation failed: ${error.message}`;
        } finally {
          button.disabled = !primeIdentityClient || !packetState.session;
        }
      });
      navigationList.append(button);
    }
    packetNavigation.hidden = false;
    scenesEmpty.hidden = true;
  };

  prerollSecondsInput.addEventListener("change", renderReplacementNavigator);

  let adBreakStopping = false;
  const observePacketTimeline = createPlaybackObserver({
    getScheduler: () => packetState.scheduler,
    onSnapshot: snapshot => {
      const outcomes = Object.values(snapshot.statuses);
      const completed = outcomes.filter(value => value === "completed").length;
      const skipped = outcomes.filter(value => value === "skipped").length;
      packetOutput.textContent = `Local edit armed · ${completed}/${outcomes.length} completed · ${skipped} skipped`;
    },
    onError: error => { setNotice("viewer-playback-error"); packetOutput.textContent = `Local edit stopped: ${error.message}`; }
  });
  // 0.65.9 (developer mode): when the scheduler is busy, and each planned-cut wake-up it is sent
  // (once per trigger and busy state; the cut's hold re-delivers it on every sample).
  let schedulerBusy = null, lastWake = null;
  const noteSchedulerObservation = state => {
    const busy = Boolean(packetState.scheduler?.running);
    if (busy !== schedulerBusy) { schedulerBusy = busy; engineEventLog.record('scheduler', 'scheduler-busy', { busy, mediaMs: state?.currentTimeMs }); }
    if (state?.event === 'planned-cut') {
      const key = `${state.currentTimeMs}|${busy}`;
      if (key !== lastWake) { lastWake = key; engineEventLog.record('scheduler', 'planned-cut-wake', { triggerMs: state.currentTimeMs, busy }); }
    }
  };
  const observeLocalPacket = (state, event) => {
    if (engineEventLog?.enabled && packetState.scheduler) noteSchedulerObservation(state);
    if (packetState.scheduler && !adBreakStopping && adapter.adBreakVisible?.()) {
      // Ads shift the element clock away from programme time; never cut on it.
      adBreakStopping = true;
      void clearLocalPacketSession("ad-break-detected").finally(() => {
        adBreakStopping = false;
        setNotice("viewer-ads-detected");
        packetOutput.textContent = "Ads detected, so the edit stopped: its timings only match ad-free playback.";
      });
      return null;
    }
    return observePacketTimeline(state, event);
  };

  let lastIdentityKey = null;
  const applyPrimeIdentity = (identity) => {
    const identityKey = playbackSourceKey(identity);
    if (identityKey !== lastIdentityKey) identityObservationEpoch++;
    if (packetState.scheduler && packetState.session?.sourceKey !== identityKey) {
      primeTransitionAdapter.invalidateContext();
      void clearLocalPacketSession("source-identity-changed");
      setNotice("viewer-episode-changed");
      packetOutput.textContent = "Source changed. Select and enable the matching packet again.";
    } else if (!packetState.scheduler && packetState.session && lastIdentityKey !== null && identityKey !== lastIdentityKey) {
      // A loaded but not yet enabled edit belongs to the previous episode.
      void clearLocalPacketSession("source-identity-changed");
    }
    lastIdentityKey = identityKey;
    const fingerprint = assessSourceFingerprintCoverage(identity);
    panelHost.dataset.integrationDepth = "1-bounded-read-only";
    panelHost.dataset.privateIdentityEnabled = "true";
    panelHost.dataset.activeItemId = identity.activeItemId ?? "";
    panelHost.dataset.privateMediaType = identity.mediaType;
    panelHost.dataset.privateSeason = identity.season === null ? "" : String(identity.season);
    panelHost.dataset.privateEpisode = identity.episode === null ? "" : String(identity.episode);
    panelHost.dataset.privateLifecycleGeneration = String(identity.lifecycleGeneration);
    panelHost.dataset.privateCanonicalTimeAvailable = String(identity.canonicalTimeMs !== null);
    panelHost.dataset.privateCanonicalTimeMs = identity.canonicalTimeMs === null ? "" : String(identity.canonicalTimeMs);
    panelHost.dataset.privateCanonicalTimeProvenance = identity.provenance.canonicalTimeMs;
    panelHost.dataset.privateVersionAvailable = String(identity.versionTag !== null);
    panelHost.dataset.fingerprintStatus = fingerprint.status;
    panelHost.dataset.fingerprintReason = fingerprint.reason;
    panelHost.dataset.fingerprintMissing = fingerprint.missingFields.join(",");
    setField("activeItemId", identity.activeItemId);
    setField("privateMediaType", identity.mediaType);
    setField("privateEpisode", identity.mediaType === "episode" ? `S${identity.season} E${identity.episode}` : null);
    setField(
      "versionEvidence",
      fingerprint.status === "spike-ready"
        ? "internal check ready: active item + episode + runtime"
        : `incomplete; ${fingerprint.reason}`
    );
    setField("lifecycle", `private generation ${identity.lifecycleGeneration}`);
    if (identity.runtimeMs !== null) setField("runtime", `${(identity.runtimeMs / 1000).toFixed(3)} s`);
    if (identity.canonicalTimeMs !== null) setField("time", `${(identity.canonicalTimeMs / 1000).toFixed(3)} s`);
    setField("clock", identity.provenance.canonicalTimeMs);
    const observation = fingerprint.status === "unknown"
      ? `unknown: source-check-${fingerprint.reason}`
      : "observed: internal source check ready";
    setField("confidence", observation);
    privateIdentityOutput.textContent = `Prime identity: ${observation}`;
  };

  // Fullscreen toggles and player re-renders can briefly leave no qualifying video.
  // Only a different element, or an absence that outlasts the grace period, ends the
  // armed edit; a replaced element is never commanded.
  const PLAYER_ABSENCE_GRACE_MS = 500;
  let playerMissingSince = null;
  const refresh = async () => {
    const currentPlayer = adapter.activePlayer();
    if (packetState.scheduler && packetState.session?.player !== currentPlayer) {
      const now = performance.now();
      if (!currentPlayer) playerMissingSince ??= now;
      if (currentPlayer || now - playerMissingSince >= PLAYER_ABSENCE_GRACE_MS) {
        playerMissingSince = null;
        primeTransitionAdapter.invalidateContext();
        await clearLocalPacketSession("native-player-changed");
        setNotice("viewer-player-changed");
      } else {
        scheduleRefresh(PLAYER_ABSENCE_GRACE_MS - (now - playerMissingSince) + 10);
      }
    } else {
      playerMissingSince = null;
    }
    const evidence = await adapter.probe();
    panelHost.dataset.probeStatus = evidence.playerFound ? "player-observed" : "no-player";
    panelHost.dataset.routeCandidateId = evidence.routeCandidateId ?? "";
    panelHost.dataset.playerFound = String(evidence.playerFound);
    panelHost.dataset.playerLifecycleStatus = evidence.playerLifecycleStatus;
    panelHost.dataset.runtimeMs = evidence.runtimeMs === null ? "" : String(evidence.runtimeMs);
    panelHost.dataset.paused = evidence.paused === null ? "" : String(evidence.paused);
    panelHost.dataset.buffering = evidence.buffering === null ? "" : String(evidence.buffering);
    panelHost.dataset.fullscreen = String(evidence.fullscreen);
    setField("service", evidence.serviceId);
    setField("routeCandidateId", evidence.routeCandidateId);
    setField("activeItemId", evidence.activeItemId);
    setField("title", evidence.title);
    setField(
      "player",
      evidence.playerFound
        ? `active candidate (${evidence.videoElementCount} video element${evidence.videoElementCount === 1 ? "" : "s"})`
        : evidence.visibleLoadingVideoCount
          ? `loading candidate (${evidence.videoElementCount} video element${evidence.videoElementCount === 1 ? "" : "s"})`
          : "not open yet — press Play, then Refresh (details appear once the player opens)"
    );
    setField("lifecycle", evidence.playerLifecycleStatus);
    setField("runtime", evidence.runtimeMs === null ? null : `${(evidence.runtimeMs / 1000).toFixed(3)} s`);
    setField("time", evidence.currentTimeMs === null ? null : `${(evidence.currentTimeMs / 1000).toFixed(3)} s`);
    setField("paused", evidence.paused === null ? null : String(evidence.paused));
    setField("buffering", evidence.buffering === null ? null : String(evidence.buffering));
    setField("audio", evidence.muted === null ? null : `${evidence.muted ? "muted" : "unmuted"} / ${evidence.volume.toFixed(2)}`);
    setField("readyState", evidence.readyState === null ? null : String(evidence.readyState));
    setField("fullscreen", String(evidence.fullscreen));
    setField("clock", evidence.canonicalClock);
    setField("confidence", `${evidence.sourceIdentityStatus}: ${evidence.sourceIdentityReason}`);
    if (primeIdentityClient) {
      try {
        applyPrimeIdentity(await primeIdentityClient.readIdentity());
      } catch {
        if (packetState.scheduler) {
          primeTransitionAdapter.invalidateContext();
          await clearLocalPacketSession("source-identity-unavailable");
          setNotice("viewer-identity-lost");
        }
        privateIdentityOutput.textContent = "Read-only identity unavailable; the probe remains fail-closed.";
      }
    }
    return evidence;
  };

  const serializePassiveProbe = () => ({
    serviceId: adapter.serviceId,
    integrationDepth: panelHost.dataset.integrationDepth,
    probeVersion: panelHost.dataset.probeVersion,
    probeStatus: panelHost.dataset.probeStatus,
    // Structured title identity for Creator tools (project key and capture manifest).
    identity: {
      activeItemId: panelHost.dataset.activeItemId || null,
      mediaType: panelHost.dataset.privateMediaType || null,
      season: /^\d{1,4}$/.test(panelHost.dataset.privateSeason ?? '') ? Number(panelHost.dataset.privateSeason) : null,
      episode: /^\d{1,5}$/.test(panelHost.dataset.privateEpisode ?? '') ? Number(panelHost.dataset.privateEpisode) : null
    },
    fields: Object.fromEntries([...shadow.querySelectorAll("[data-field]")].map((element) => [
      element.dataset.field,
      element.textContent
    ])),
    outputs: {
      identity: privateIdentityOutput.textContent,
      packet: packetOutput.textContent,
      command: shadow.querySelector("[data-command-output]").textContent
    }
  });

  const onPassiveProbeMessage = createPassiveProbeMessageHandler({ refresh, serialize: serializePassiveProbe });
  globalThis.chrome?.runtime?.onMessage?.addListener(onPassiveProbeMessage);

  const scheduledRefreshes = new Set();
  const scheduleRefresh = (delayMs = 0) => {
    if (scheduledRefreshes.size > 0) return;
    const timeout = setTimeout(async () => {
      scheduledRefreshes.delete(timeout);
      if (panelHost.isConnected && !lifecycleAbort.signal.aborted) await refresh();
    }, delayMs);
    scheduledRefreshes.add(timeout);
  };
  const scheduleFullscreenRecoverySamples = () => {
    for (const delayMs of [0, 250, 1000, 2500, 5000]) scheduleRefresh(delayMs);
  };

  shadow.querySelector('[data-action="refresh"]').addEventListener("click", refresh);
  shadow.querySelector('[data-action="close"]').addEventListener("click", () => {
    setPlaybackControlsVisible(false);
  });
  document.addEventListener("fullscreenchange", scheduleFullscreenRecoverySamples, { signal: lifecycleAbort.signal });
  for (const eventName of ["loadedmetadata", "durationchange", "emptied", "playing", "pause", "seeked"]) {
    document.addEventListener(eventName, () => scheduleRefresh(0), {
      capture: true,
      signal: lifecycleAbort.signal
    });
  }
  const playerLifecycleObserver = new MutationObserver(() => scheduleRefresh(100));
  playerLifecycleObserver.observe(document.documentElement, { childList: true, subtree: true });
  lifecycleAbort.signal.addEventListener("abort", () => {
    unsubscribePrimeIdentity?.();
    void primeIdentityClient?.close();
    globalThis.chrome?.runtime?.onMessage?.removeListener(onPassiveProbeMessage);
    playerLifecycleObserver.disconnect();
    for (const timeout of scheduledRefreshes) clearTimeout(timeout);
    scheduledRefreshes.clear();
    void clearLocalPacketSession("page-lifecycle-ended");
  }, { once: true });
  installPageLifecycleRecovery({
    window,
    cancel: reason => { primeTransitionAdapter?.invalidateContext(); return clearLocalPacketSession(reason); },
    restore: () => { setNotice("viewer-page-restored"); packetOutput.textContent = "Page restored. Select your packet and enable edits again."; },
    dispose: () => lifecycleAbort.abort()
  });

  const enableCommands = shadow.querySelector('[data-action="enable-commands"]');
  const commandControls = shadow.querySelector("[data-command-controls]");
  const commandOutput = shadow.querySelector("[data-command-output]");
  const trialControls = shadow.querySelector("[data-trial-controls]");
  const trialSummary = shadow.querySelector("[data-trial-summary]");
  if (!commandAdapter) {
    privateIdentityOutput.hidden = true;
    enableCommands.hidden = true;
    commandOutput.hidden = true;
  } else {
    lifecycleAbort.signal.addEventListener("abort", () => { stopPacketObservation?.(); stopPacketObservation = null; }, { once: true });
    installNativeSeekObserver({ document, getPlayer: () => adapter.activePlayer(),
      getScheduler: () => packetState.scheduler, readState: () => commandAdapter.readState(),
      isOwnedSeek: timeMs => primeTransitionAdapter.isOwnedSeekEvent(timeMs), observe: observeLocalPacket,
      onError: () => {
        setNotice("viewer-playback-error");
        packetOutput.textContent = "Local edit stopped: active Prime player unavailable";
      }, signal: lifecycleAbort.signal });

    enableViewerIdentity = async () => {
      if(primeIdentityClient)return;
      privateIdentityOutput.textContent = "Reading the Prime identity…";
      try {
        const response = await chrome.runtime.sendMessage({ kind: "enable-prime-identity-bridge", build: EXECUTING_BUILD });
        if (!response?.ok) throw new Error(response?.errorCode ?? "prime-identity-injection-failed");
        if (!sameExecutingBuild(response.build)) throw Error('prime-identity-build-mismatch-refresh-required');
        primeIdentityClient = new ReadOnlyIdentityBridgeClient({
          window,
          origin: location.origin,
          timeoutMs: 1500
        });
        await primeIdentityClient.connect();
        unsubscribePrimeIdentity = primeIdentityClient.subscribe(applyPrimeIdentity);
        applyPrimeIdentity(await primeIdentityClient.readIdentity());
        if (packetState.session) {
          armLocalPacketButton.disabled = false;
          renderReplacementNavigator();
        }
      } catch {
        panelHost.dataset.privateIdentityEnabled = "false";
        privateIdentityOutput.textContent = "Prime identity accessor unavailable; no private state was accepted.";
        throw Error('viewer-source-unavailable');
      }
    };

    let importCleanup = Promise.resolve();
    const acceptRendererPacket = async (packet, trust = 'local-user', preview = null) => {
        const operation = packetOperations.capture();
        try {
          await importCleanup;
          operation.assertCurrent();
          assertActive(lifecycleAbort.signal);
          if (trust === 'catalog') {
            if (!packet || Object.keys(packet).sort().join(',') !== 'manifest,packet_id' ||
              !/^[a-f0-9-]{36}$/.test(packet.packet_id) || !validateManifestSchema(packet.manifest, { profileClass: 'catalog-v2' }).ok) throw Error('Invalid catalog renderer description');
          } else if (!validateLocalUserEditPacket(packet).ok) throw Error('Invalid renderer packet');
          assertLocalPacketService(packet, adapter.serviceId);
          // Compatibility ranges are semantic versions; the build id is a content hash.
          if (!evaluateAdapterCompatibility(EXECUTING_BUILD.adapterVersion, packet.manifest.compatibility).ok) throw Error('Adapter mismatch');
          const assets = new Map(packet.manifest.segments.filter(segment => segment.asset).map(segment => [segment.asset.sha256, segment.asset]));
          const quality = assessLocalQualityContinuity([...assets].map(([hash, asset]) => ({
            assetId: hash, width: asset.width, height: asset.height
          })), commandAdapter.readVideoProfile());
          const assetUrls = new Map([...assets.keys()].map(hash => [hash, `asset:${hash}`]));
          // A creator preview (E57 C4): only a one-scene preview packet from the renderer may say so.
          const previewOf = trust === 'local-user' && preview && isPreviewPacket(packet) ? { name: previewSceneName(preview.name) } : null;
          packetState.session = { packet, assetUrls, quality, trust, preview: previewOf };
          panelHost.dataset.localPacketStatus = trust === 'catalog' ? 'validated-catalog' : 'validated-local-user';
          panelHost.dataset.localPacketId = packet.packet_id;
          panelHost.dataset.localPacketSegmentCount = String(packet.manifest.segments.length);
          panelHost.dataset.localPacketQualityStatus = quality.status;
          armLocalPacketButton.disabled = !primeIdentityClient;
          cancelLocalPacketButton.disabled = false;
          renderReplacementNavigator();
          packetOutput.textContent = `${packet.manifest.segments.length} ${trust === 'catalog' ? 'catalog actions' : 'private replacements'} validated · ${qualitySummary(quality)}`;
        } catch (error) {
          if (operation.signal.aborted) return;
          await clearLocalPacketSession('packet-rejected');
          setNotice('viewer-edit-rejected');
          packetOutput.textContent = `Packet not loaded: ${error.message}`;
        }
    };
    primeTransitionOverlay.attach(shadow.querySelector('[data-private-picker]'), {
      onImportStart() {
        importCleanup = clearLocalPacketSession('new-folder-selected');
        setNotice(null);
        packetOutput.textContent = 'Validating privately inside the extension…';
        return importCleanup;
      },
      onPacket: (packet, preview) => acceptRendererPacket(packet, 'local-user', preview),
      onCatalogPacket: packet => acceptRendererPacket(packet, 'catalog'),
      onCatalogInvalidated: context => { if (packetState.session) setNotice('viewer-edit-changed'); return packetSessionController.invalidateCatalog(context); },
      onError(code) { const message = viewerLoadMessage(code); setNotice(message ? code : 'viewer-edit-rejected'); packetOutput.textContent = message ? `${message} (${code})` : 'Packet not loaded. See the private picker for validation details.'; },
      onDisconnect() {
        // A service-worker restart drops the relay. Native is restored by the
        // session clear; a fresh renderer then pairs and the viewer service
        // re-loads and re-arms a remembered protected edit (auto-arm). Folder
        // imports must be chosen again. An extension update stays fatal.
        primeTransitionAdapter.invalidateContext();
        const trust = packetState.session?.trust ?? null;
        // 0.65.4: the close that started this (recorded just before onDisconnect), shown if the renderer is lost.
        const cause = primeTransitionOverlay.diagnostics?.()?.events?.at(-1) ?? null;
        panelHost.dataset.rendererConnection = 'reconnecting';
        if (trust) setNotice('viewer-renderer-reconnecting');
        packetOutput.textContent = 'Private renderer disconnected; edits stopped. Reconnecting…';
        void clearLocalPacketSession('renderer-disconnected').catch(() => {})
          .then(() => primeTransitionOverlay.reconnect({ signal: lifecycleAbort.signal }))
          .then(() => {
            if (sceneTiming?.enabled) void primeTransitionOverlay.setTiming(true).catch(() => {});
            panelHost.dataset.rendererConnection = 'reconnected';
            delete panelHost.dataset.rendererReason;
            if (currentNotice() === 'viewer-renderer-reconnecting') setNotice(trust === 'local-user' ? 'viewer-folder-reselect' : null);
            packetOutput.textContent = trust === 'local-user'
              ? 'Reconnected. Choose Watch with edit to turn your local edit on again.'
              : 'Reconnected. If the edit stays off, choose Watch with edit.';
          }, () => {
            if (lifecycleAbort.signal.aborted) return;
            panelHost.dataset.rendererConnection = 'lost';
            const reason = disconnectSummary(cause, primeTransitionOverlay.diagnostics?.()?.events?.at(-1) ?? null);
            if (reason) panelHost.dataset.rendererReason = reason;
            setNotice('viewer-renderer-lost');
            packetOutput.textContent = `Private renderer disconnected; edits stopped. Refresh this tab.${reason ? ` (Reason: ${reason}.)` : ''}`;
          });
      }
    });
    lifecycleAbort.signal.addEventListener('abort', () => primeTransitionOverlay.dispose(), { once: true });
    sceneTiming = createTransitionTiming({ window, getPlayer: () => adapter.activePlayer?.(), getHost: () => primeTransitionAdapter.overlayHost ?? primeTransitionAdapter.stagedHost });
    watchTransitions(sceneTiming, { engine: primeTransitionEngine, document, getPlayer: () => adapter.activePlayer?.(), signal: lifecycleAbort.signal });
    lifecycleAbort.signal.addEventListener('abort', () => sceneTiming.setEnabled(false), { once: true });
    installViewerKeys({ window, document, engine: primeTransitionEngine, isNativePlayer: node => node === adapter.activePlayer?.(),
      ownsNativePlay: () => primeTransitionAdapter.ownedSeekDepth > 0 || primeTransitionAdapter.nativePreroll?.started === true, signal: lifecycleAbort.signal });

    // A viewer's Watch with edit clears an older notice; a failed turn-on leaves its own.
    const ARM_NOTICES = new Set(['viewer-source-unavailable', 'viewer-episode-mismatch', 'viewer-title-id-changed', 'viewer-runtime-mismatch', 'viewer-source-check-failed']);
    armViewerEdit = async () => {
      try { await packetSessionController.arm(); setNotice(null); }
      catch (error) {
        // A specific reason (another episode, another length, no identity yet) is the notice; anything else is the general one.
        if (error?.name !== 'AbortError' && error?.message !== 'viewer-not-ready') setNotice(ARM_NOTICES.has(error?.message) ? error.message : 'viewer-arm-failed');
        throw error;
      }
    };
    armLocalPacketButton.addEventListener('click',()=>void armViewerEdit().catch(()=>{}));

    cancelLocalPacketButton.addEventListener("click", async () => {
      await clearLocalPacketSession("user-cancelled-local-packet");
      setNotice(null);
      packetOutput.textContent = "Edit stopped and local clip URLs released.";
    });

    const readTrialScenario = (command) => ({
      titleSlot: shadow.querySelector('[data-trial-field="title-slot"]').value,
      contentKind: shadow.querySelector('[data-trial-field="content-kind"]').value,
      networkProfile: shadow.querySelector('[data-trial-field="network-profile"]').value,
      presentationMode: document.fullscreenElement ? "fullscreen" : "windowed",
      clipDurationMs: command === "local-replacement"
        ? Number(shadow.querySelector('[data-trial-field="clip-duration"]').value)
        : null,
      triggerMode: "manual-spike"
    });
    const collectTeardownEvidence = () => ({
      overlayAbsent: !document.querySelector("#scene-substitution-local-overlay-host"),
      localVideoAbsent: !document.querySelector('video[data-scene-substitution-overlay="true"]')
    });
    const safeReadCommandState = () => {
      try {
        return commandAdapter.readState();
      } catch {
        return null;
      }
    };
    const updateTrialSummary = () => {
      const summary = primeTrialRecorder.summary();
      const successes = summary.outcomes.success ?? 0;
      const cancelled = summary.outcomes.cancelled ?? 0;
      const failed = (summary.outcomes.failed ?? 0) + (summary.outcomes["not-confirmed"] ?? 0);
      panelHost.dataset.trialRecordCount = String(summary.total);
      panelHost.dataset.trialCommandSuccessRate = summary.commandSuccessRate === null ? "" : String(summary.commandSuccessRate);
      panelHost.dataset.trialRestorationSuccessRate = summary.restorationSuccessRate === null ? "" : String(summary.restorationSuccessRate);
      trialSummary.textContent = `${summary.total} local record${summary.total === 1 ? "" : "s"} · ${successes} success · ${cancelled} cancelled · ${failed} failed`;
    };

    enableCommands.addEventListener("click", () => {
      panelHost.dataset.commandMode = "enabled-standard-surface";
      enableCommands.disabled = true;
      commandControls.hidden = false;
      trialControls.hidden = false;
      commandOutput.textContent = "Standard media commands enabled. No private Prime API is in use.";
    });

    installEvidenceExport({ shadow, panelHost, commandOutput, updateTrialSummary, trials: primeTrialRecorder, metrics: primeTransitionMetrics,
      getScheduler: () => packetState.scheduler, journal: packetPlaybackJournal, spikeBuild, document,
      readTimingReport: () => viewerCommand('timing-report'),
      readEngineEvents: () => engineEventExport({ log: engineEventLog, metrics: primeTransitionMetrics }) });

    const commands = {
      pause: () => commandAdapter.pause(),
      play: () => commandAdapter.play(),
      "seek-backward": () => commandAdapter.seekBy(-10000),
      "seek-forward": () => commandAdapter.seekBy(10000),
      "warm-seek-backward": () => commandAdapter.seekByWithPlaybackWarmup(-10000),
      "warm-seek-forward": () => commandAdapter.seekByWithPlaybackWarmup(10000),
      "nudge-forward-1ms": () => commandAdapter.nudgeForward(1),
      "nudge-forward-10ms": () => commandAdapter.nudgeForward(10),
      "nudge-forward-100ms": () => commandAdapter.nudgeForward(100),
      // 0.65.6: an exact position, seeked like the slider (also inside a replacement).
      "seek-position": () => {
        const value = shadow.querySelector("[data-seek-position]")?.value ?? "";
        return commandAdapter.seekToPosition(/^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : NaN);
      },
      "toggle-muted": () => commandAdapter.setMuted(!commandAdapter.readState().muted),
      "windowed-cover": async () => {
        const before = commandAdapter.readState();
        const result = await playerCover.showFor(3000);
        return { ...result, before, after: commandAdapter.readState() };
      },
      "fullscreen-cover": async () => {
        const before = commandAdapter.readState();
        if (!document.fullscreenElement) {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => finish(new Error("Timed out waiting for standard fullscreen entry")), 15000);
            const onFullscreenChange = () => {
              if (document.fullscreenElement) finish();
            };
            const finish = (error) => {
              clearTimeout(timeout);
              document.removeEventListener("fullscreenchange", onFullscreenChange);
              if (error) reject(error);
              else resolve();
            };
            document.addEventListener("fullscreenchange", onFullscreenChange);
          });
        }
        const result = await playerCover.showFor(3000);
        return { ...result, before, after: commandAdapter.readState() };
      },
      "local-replacement": async () => {
        const before = commandAdapter.readState();
        if (before.currentTimeMs + 10000 >= before.runtimeMs) throw new Error("Not enough runtime remains for the 10-second replacement test");
        const startedAt = performance.now();
        primeTransitionEngine.arm({
          id: `prime-local-replacement-${Date.now()}`,
          triggerMs: before.currentTimeMs,
          resumeMs: before.currentTimeMs + 10000,
          clipUrl: chrome.runtime.getURL("media/replacement.mp4")
        });
        const transition = await primeTransitionEngine.execute(before.currentTimeMs);
        const after = commandAdapter.readState();
        const metrics = primeTransitionMetrics.snapshot().cycles.at(-1);
        return {
          command: "local-replacement",
          confirmed: transition.status === "success",
          durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
          before,
          after,
          transition: { ...transition, metrics }
        };
      }
    };

    shadow.querySelector('[data-action="cancel-transition"]').addEventListener("click", () => {
      const cancelled = primeTransitionEngine.cancel("user-cancelled-from-panel");
      commandOutput.textContent = cancelled ? "Cancelling local replacement…" : "No local replacement is active.";
    });

    const commandButtons = [...shadow.querySelectorAll("[data-command]")];
    let commandRunning = false;
    for (const button of commandButtons) {
      button.addEventListener("click", async () => {
        if (commandRunning) return;
        commandRunning = true;
        const command = button.dataset.command;
        const trialScenario = readTrialScenario(command);
        const trialBefore = safeReadCommandState();
        panelHost.dataset.commandBusy = "true";
        commandOutput.textContent = `Running ${command}…`;
        delete panelHost.dataset.lastCommand;
        delete panelHost.dataset.lastCommandOk;
        delete panelHost.dataset.lastCommandDurationMs;
        delete panelHost.dataset.lastSeekErrorMs;
        delete panelHost.dataset.lastCommandBeforeMs;
        delete panelHost.dataset.lastCommandAfterMs;
        delete panelHost.dataset.lastOverlayMode;
        delete panelHost.dataset.lastOverlayCoverageRatio;
        delete panelHost.dataset.lastOverlayPointerEvents;
        delete panelHost.dataset.lastTransitionStatus;
        delete panelHost.dataset.lastTransitionCycleId;
        delete panelHost.dataset.lastTransitionMetrics;
        for (const commandButton of commandButtons) commandButton.disabled = true;
        try {
          const result = await commands[command]();
          const trialRecord = primeTrialRecorder.recordResult({
            command: result.command,
            result,
            scenario: trialScenario,
            teardown: collectTeardownEvidence()
          });
          panelHost.dataset.lastTrialSequence = String(trialRecord.sequence);
          panelHost.dataset.lastTrialOutcome = trialRecord.outcome;
          delete panelHost.dataset.lastTrialErrorCode;
          updateTrialSummary();
          panelHost.dataset.lastCommand = result.command;
          panelHost.dataset.lastCommandOk = String(result.confirmed);
          panelHost.dataset.lastCommandDurationMs = String(result.durationMs);
          panelHost.dataset.lastCommandBeforeMs = String(result.before.currentTimeMs);
          panelHost.dataset.lastCommandAfterMs = String(result.after.currentTimeMs);
          if (Number.isFinite(result.errorMs)) panelHost.dataset.lastSeekErrorMs = String(result.errorMs);
          if (result.evidence) {
            panelHost.dataset.lastOverlayMode = result.evidence.mode;
            panelHost.dataset.lastOverlayCoverageRatio = String(result.evidence.coverageRatio);
            panelHost.dataset.lastOverlayPointerEvents = result.evidence.pointerEvents;
          }
          if (result.transition) {
            panelHost.dataset.lastTransitionStatus = result.transition.status;
            panelHost.dataset.lastTransitionCycleId = result.transition.cycleId;
            panelHost.dataset.lastTransitionMetrics = JSON.stringify(result.transition.metrics?.timings ?? {});
          }
          const outcome = result.transition?.status === "cancelled"
            ? "cancelled"
            : result.confirmed
              ? "confirmed"
              : "not confirmed";
          commandOutput.textContent = Number.isFinite(result.requestedDeltaMs)
            ? `${result.command} ${outcome}: requested +${result.requestedDeltaMs} ms, applied ${result.appliedDeltaMs} ms, now ${(result.after.currentTimeMs / 1000).toFixed(3)} s, target error ${result.errorMs} ms`
            : `${result.command} ${outcome} in ${result.durationMs.toFixed(1)} ms`;
        } catch (error) {
          const trialRecord = primeTrialRecorder.recordFailure({
            command,
            error,
            before: trialBefore,
            after: safeReadCommandState(),
            scenario: trialScenario,
            teardown: collectTeardownEvidence()
          });
          panelHost.dataset.lastTrialSequence = String(trialRecord.sequence);
          panelHost.dataset.lastTrialOutcome = trialRecord.outcome;
          panelHost.dataset.lastTrialErrorCode = trialRecord.errorCode;
          updateTrialSummary();
          panelHost.dataset.lastCommand = command;
          panelHost.dataset.lastCommandOk = "false";
          // 0.65.2: a scene that starts while a developer command waits takes native
          // ownership (a new snapshot), which supersedes the command. That is a hand-over, not a failure.
          commandOutput.textContent = /^Native (snapshot|command) superseded$/.test(error?.message ?? '') && (primeTransitionEngine?.running || packetState.scheduler?.runningAction)
            ? `${command}: an edit scene took over playback (the command was superseded, not failed)`
            : `${command} failed: ${error.message}`;
        } finally {
          await refresh();
          commandRunning = false;
          panelHost.dataset.commandBusy = "false";
          for (const commandButton of commandButtons) commandButton.disabled = false;
        }
      });
    }
  }

  // The loaded edit's scenes in source order with their play status, for the player
  // menu and the popup. The jump index of every surface is an index into this list.
  const SCENE_STATUS = { completed: 'played', running: 'playing', active: 'playing', skipped: 'skipped', failed: 'failed', cancelled: 'failed', pending: 'pending' };
  const viewerScenes = statuses => [...(packetState.session?.packet.manifest.segments ?? [])]
    .sort((a, b) => a.trigger_time_ms - b.trigger_time_ms)
    .map(segment => ({ type: segment.action, startMs: segment.trigger_time_ms, resumeMs: segment.resume_time_ms, status: SCENE_STATUS[statuses?.[segment.segment_id]] ?? 'pending',
      ...(Number.isSafeInteger(segment.asset?.expected_duration_ms) ? { lengthMs: segment.asset.expected_duration_ms } : {}) }));
  // Show and episode: the loaded edit's own source, else Prime's identity (the page
  // title is only the surfaces' cleaned fallback).
  const viewerShow = observed => {
    const source = packetState.session?.packet.manifest.source;
    // A preview's source title is the creator's project name, not the show's: use Prime's identity.
    if (source && !packetState.session.preview) return { title: source.title, season: source.season, episode: source.episode };
    return observed?.mediaType === 'episode' ? { title: '', season: observed.season, episode: observed.episode } : null;
  };
  const viewerSnapshot = async () => {
    let state; try { state=commandAdapter?.readState();if(!commandAdapter){const p=await adapter.probe();if(p.playerFound)state=p;} } catch {}
    const {identity,observation:identityObservation}=await observePlayerIdentity({
      getPlayer:()=>adapter.identityObservationPlayer(),getSource:()=>JSON.stringify([identityObservationEpoch,location.pathname]),
      readIdentity:()=>{if(!primeIdentityClient)throw Error('identity-unavailable');return primeIdentityClient.readIdentity();},
      usableIdentity:value=>Boolean(sourceKey(value?{...value,serviceId:adapter.serviceId}:null)),isClosed:()=>lifecycleAbort.signal.aborted});
    const observed=identity?{...identity,serviceId:adapter.serviceId}:null;
    const key=sourceKey(observed),active=Boolean(packetState.scheduler?.runningAction||packetState.scheduler?.activeMute);
    const paused=viewerPaused({nativePaused:state?.paused,actionType:packetState.scheduler?.runningAction?.type,
      localControllable:primeTransitionEngine?.localControllable,localPaused:primeTransitionEngine?.localPaused});
    let timeline=null,sceneTimeMs=null;
    if(packetState.scheduler&&state){try{timeline=editedTimeline(observed.runtimeMs,packetState.scheduler.actions);const clock=await primeTransitionOverlay.viewerClock();if(['REPLACE','INSERT'].includes(packetState.scheduler.runningAction?.type)&&Number.isFinite(clock?.currentTimeMs))sceneTimeMs=clock.currentTimeMs;timeline={...timeline,positionMs:editedPosition(timeline,{sourceTimeMs:state.currentTimeMs,actionId:packetState.scheduler.runningAction?.id??null,localTimeMs:clock.currentTimeMs})};}catch{}}
    const schedulerSnapshot=packetState.scheduler?.snapshot()??null;
    const progress=packetState.scheduler&&state?editProgress(schedulerSnapshot,packetState.scheduler.actions,state.currentTimeMs):{skippedCount:0,finished:false};
    // Structured fields only: the developer panel's output text stays on this page.
    return {state:!state?'unavailable':packetState.scheduler?(active?'active':progress.finished?'finished':'armed'):packetState.session?'loaded':'idle',skippedCount:progress.skippedCount,title:shadow.querySelector('[data-field=title]')?.textContent??'',
      notice:packetState.scheduler?'':currentNotice(),show:viewerShow(observed),scenes:viewerScenes(schedulerSnapshot?.statuses),
      sourceKey:key,editId:packetState.session?.packet.packet_id??'',version:String(packetState.session?.packet.manifest.manifest_version??''),currentTimeMs:state?.currentTimeMs,durationMs:observed?.runtimeMs,...(sceneTimeMs!==null?{sceneTimeMs}:{}),
      ...(packetState.session?.preview?{preview:true,previewName:packetState.session.preview.name}:{}),
      paused,canArm:Boolean(packetState.session&&!packetState.scheduler&&!packetState.arming&&key),canStop:Boolean(packetState.session||packetState.scheduler),generation:JSON.stringify([key,packetState.session?.packet.packet_id??null]),timeline,identityObservation};
  };
  const viewerCommand=async(method,args={})=>{
    if(method==='connection-report')return primeTransitionOverlay?.diagnostics?.()??{schema:1,state:'unavailable',dropped:0,events:[]};
    if(method==='timing-report'){
      if(!sceneTiming)throw Error('timing-unavailable');
      const clip=await primeTransitionOverlay.timingLog().catch(()=>[]);
      let player=null;try{player=adapter.activePlayer?.();}catch{}
      return sceneTiming.report({clip,metrics:{cycles:primeTransitionMetrics.snapshot().cycles.slice(-60)},environment:timingEnvironment({navigator,document,player,version:EXTENSION_VERSION})});
    }
    const before=await viewerSnapshot();if(args.generation&&before.generation!==args.generation)throw Error('viewer-source-changed');
    if(method==='recheck'){await enableViewerIdentity();await refresh();if(packetState.session)await assertLocalPacketSource(packetState.session.packet);}
    else if(method==='arm')await armViewerEdit();
    else if(method==='stop'||method==='authoring'){await clearLocalPacketSession('viewer-user-stopped');setNotice(null);}
    else if(method==='jump-scene'){
      // Previous / Next / a numbered scene: land the viewer's lead-in before it (never before 0).
      if(!packetState.session||!commandAdapter)throw Error('viewer-not-ready');
      const scenes=viewerScenes(packetState.scheduler?.snapshot().statuses);
      const target=sceneJump(scenes,{currentMs:commandAdapter.readState()?.currentTimeMs,leadInMs:leadInMs(viewerPreferences)},args.which);
      if(!target)throw Error('viewer-scene-unavailable');
      navigationOperations.invalidate('Viewer scene jump');
      const scheduler=packetState.scheduler;
      try{await seekBeforeScene(target.targetMs,navigationOperations.capture());}
      catch(error){
        // The landing point can sit inside a replacement (a seek there enters it part-way): the
        // scheduler's entry supersedes this seek's settling. Playback went where it was sent, so
        // that is a jump, not a failure. Any other abort or error still fails.
        if(packetState.scheduler===scheduler&&supersededByEntry(error,scheduler,primeTransitionEngine))return {entered:true};
        throw error;
      }
    }
    else if(method==='restart'){
      // Scenes behind the playhead were skipped; a seek before them re-arms them.
      if(!packetState.scheduler)throw Error('viewer-not-armed');
      await commandAdapter.seekToWithPlaybackWarmup(0,'restart-edit');
    }
    else if(method==='preview-seek'){
      // A creator's clip preview: start playback shortly before its one scene.
      const scene=packetState.session?.packet.manifest.segments[0];
      if(!packetState.scheduler||!scene||packetState.session.packet.manifest.segments.length!==1)throw Error('preview-not-armed');
      await assertLocalPacketSource(packetState.session.packet);
      await commandAdapter.seekToWithPlaybackWarmup(Math.max(0,scene.trigger_time_ms-3000),'preview-seek');
      await commandAdapter.play();
    }
    return viewerSnapshot();
  };
  let loadedLabel='';
  const summaryField=shadow.querySelector('[data-summary]');
  const readLoadedPlayback=createLoadedEditDisplayReader({read:viewerSnapshot,request:()=>viewerRequest('snapshot'),show:label=>{loadedLabel=label;}});
  const readDisplayedPlayback=async()=>{
    const playback=await readLoadedPlayback();
    const label=loadedLabel||(packetState.session?`Edit ${packetState.session.packet.packet_id.slice(0,8)}`:'');
    summaryField.textContent=developerSummary({label,state:playback.state,scenes:playback.scenes,sourceReady:panelHost.dataset.fingerprintStatus==='spike-ready',sourceCheck:lastSourceCheck});
    return playback;
  };
  // Where edits cannot play (no command adapter, e.g. Netflix) the badge appears only in Advanced mode.
  const viewerOverlay=mountViewerOverlay({document,read:readDisplayedPlayback,command:async (command,args={})=>{const s=await viewerSnapshot();return viewerRequest('command',{...args,command,generation:s.generation});},
    openSettings:section=>void viewerRequest('open-settings',section?{section}:{}).catch(()=>{}),
    // 0.62.21: this tab's own report, read here (never another Prime tab's).
    saveTiming:()=>saveTimingReport({read:()=>viewerCommand('timing-report'),document}),canPlayEdits:Boolean(commandAdapter),version:EXTENSION_VERSION,signal:lifecycleAbort.signal});
  connectViewerController({read:viewerSnapshot,execute:viewerCommand,signal:lifecycleAbort.signal,onPreferences:p=>{viewerPreferences=p;primeTransitionAdapter?.setCrossfadeEnabled(p.smoothAudio!==false);primeTransitionAdapter?.setExitRevealPolicy(p.exitReveal);primeTransitionEngine?.setShortGapPriming?.(p.shortGapPriming!==false);primeTransitionAdapter?.setSyncPatch(p.timing===true);viewerOverlay.preferences(p);panelHost.dataset.viewerMode=p.mode;setAdvancedMode(p.advanced===true);sceneTiming?.setEnabled(p.timing===true);if(primeTransitionOverlay)void primeTransitionOverlay.setTiming(p.timing===true).catch(()=>{});}});
  await refresh();
  if(primeIdentityClient===null)void enableViewerIdentity().catch(()=>{});
}
