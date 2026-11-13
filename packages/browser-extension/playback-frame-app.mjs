import { createViewerStore } from './src/viewer-store.mjs';
import { readEditDirectory } from './src/viewer-folder.mjs';
import { viewerRequest } from './src/viewer-client.mjs';
import { sourceKey, defaultStorageBudget } from './src/viewer-model.mjs';
import { startCatalogControlPolling } from './src/catalog-control-updates.mjs';
import { LocalOverlay } from './src/local-overlay.mjs';
import { loadFixturePacket } from './src/fixture-local-packet.mjs';
import { OperationContext, boundedOperation, assertActive } from './src/operation-context.mjs';
import { validLocalMessage } from './src/local-playback-protocol.mjs';
import { CatalogPlaybackSession } from './src/catalog-playback-session.mjs';
import { memoryBackedClips } from './src/memory-clips.mjs';
import { pausableDeadline } from './src/pausable-deadline.mjs';
import { takePreview } from './src/preview-clip-store.mjs';
import { previewSceneName } from './src/preview-packet.mjs';
import { createCatalogRuntimeClient } from './src/catalog-runtime-client.mjs';
import { EXECUTING_BUILD } from './src/build-info.mjs';
import { sameExecutingBuild } from './src/build-identity.mjs';
import {
  validLocalResult,
  LOCAL_LIMITS,
  LOCAL_CONTROL_COMMANDS
} from './src/local-message-schema.mjs';
import { receivedParentBinding } from './src/private-frame-binding.mjs';
import { createFrameTimingStream } from './src/frame-timing-stream.mjs';
import { viewerLoadCode, viewerLoadMessage, failureCause, downloadFailureCode, downloadLimitSeconds } from './src/viewer-load-error.mjs';
import { disconnectNotice } from './src/connection-diagnostics.mjs';
import { createValidatedAssetCache, indexedDbStore, memoryStore } from './src/validated-asset-cache.mjs';
import { readSsArchive } from './src/ss-archive.mjs';
import { localRoot, openLocalCopy, editSignature } from './src/local-library.mjs';

const DEFAULT_DEPS = Object.freeze({
  createViewerStore,
  readEditDirectory,
  readSsArchive,
  localRoot,
  openLocalCopy,
  viewerRequest,
  sourceKey,
  startCatalogControlPolling,
  LocalOverlay,
  loadFixturePacket,
  OperationContext,
  boundedOperation,
  assertActive,
  validLocalMessage,
  CatalogPlaybackSession,
  createCatalogRuntimeClient,
  EXECUTING_BUILD,
  sameExecutingBuild,
  validLocalResult,
  LOCAL_LIMITS,
  LOCAL_CONTROL_COMMANDS,
  receivedParentBinding
});

// The private renderer frame's logic. The page entry passes the real globals, trust
// configuration and protected-owner factory; tests pass doubles and import this module
// directly, so they never load the generated protected bundle.
export function startPlaybackFrame({
  document,
  window,
  chrome,
  location,
  catalogTrustConfig,
  protectedTrustConfig,
  createConfiguredProtectedOwner,
  URL = globalThis.URL,
  performance = globalThis.performance,
  setInterval = globalThis.setInterval.bind(globalThis),
  clearInterval = globalThis.clearInterval.bind(globalThis),
  addEventListener = globalThis.addEventListener.bind(globalThis),
  removeEventListener = globalThis.removeEventListener.bind(globalThis),
  deps = {}
}) {
  const {
    createViewerStore,
    readEditDirectory,
    readSsArchive,
    localRoot,
    openLocalCopy,
    viewerRequest,
    sourceKey,
    startCatalogControlPolling,
    LocalOverlay,
    loadFixturePacket,
    OperationContext,
    boundedOperation,
    assertActive,
    validLocalMessage,
    CatalogPlaybackSession,
    createCatalogRuntimeClient,
    EXECUTING_BUILD,
    sameExecutingBuild,
    validLocalResult,
    LOCAL_LIMITS,
    LOCAL_CONTROL_COMMANDS,
    receivedParentBinding
  } = { ...DEFAULT_DEPS, ...deps };
  const session = location.hash.slice(1);
  const port = chrome.runtime.connect({ name: `scene-local-v1:renderer:${session}` });
  const overlay = new LocalOverlay({ document });
  const operations = new OperationContext(),
    active = new Map(),
    urls = new Map();
  let playDeadline = null;
  // Opt-in scene timing (Settings → Record scene timing): every presented clip frame
  // on the renderer's epoch clock, fetched with separate controller calibration.
  const clipTiming = createFrameTimingStream({
    window,
    getPlayer: () => overlay.video,
    heartbeatTimer: { setInterval, clearInterval },
    getGeneration: () => overlay.generation,
    getPresentation: () => ({
      mode:
        !document.body.classList.contains('playing') || overlay.video?.isConnected === false
          ? 'hidden'
          : overlay.transitionHeldFrame
            ? 'unknown'
            : overlay.heldFrame
              ? 'held'
              : overlay.video?.style.display === 'block'
                ? 'video'
                : 'hidden',
      heldMediaTime: overlay.heldFrame?.sceneTimingMediaTime ?? null
    }),
    clock: () => performance.timeOrigin + performance.now(),
    timeOrigin: performance.timeOrigin
  });
  overlay.onPresentationChange = () => clipTiming.sample();
  // The clip's end time goes to the controller so native can be started early.
  overlay.onLocalEnding = endAtMs => {
    try {
      const sentMonotonicMs = performance.now();
      post({
        type: 'local-ending',
        endAtMs: endAtMs === null ? null : Math.round(endAtMs),
        ...(endAtMs === null
          ? {}
          : { sentEpochMs: performance.timeOrigin + sentMonotonicMs, sentMonotonicMs })
      });
    } catch {}
  };
  const imports = new OperationContext();
  const folder = document.querySelector('#folder'),
    status = document.querySelector('#status');
  const packetKind = document.querySelector('#packet-kind');
  const catalogClient = createCatalogRuntimeClient(chrome.runtime);
  const fixtureOnly = catalogTrustConfig.fixtureOnly === true;
  if (fixtureOnly) {
    packetKind.value = 'catalog';
    packetKind.disabled = !protectedTrustConfig.enabled;
  }
  packetKind.querySelector('[value=protected]').disabled = !protectedTrustConfig.enabled;
  // E60: per-clip check results of protected loads (see validated-asset-cache.mjs). Keyed by
  // the executing build, so an update starts cold; storage clearing does too.
  const assetCache = createValidatedAssetCache({
    // No IndexedDB (tests, or storage unavailable): a session-only cache, i.e. cold each load.
    store: globalThis.indexedDB ? indexedDbStore(globalThis.indexedDB) : memoryStore(),
    buildId: EXECUTING_BUILD.id ?? `unbuilt:${EXECUTING_BUILD.version}`
  });
  let openedRelease = null;
  const catalogSession = new CatalogPlaybackSession({
    activationStore: catalogClient,
    readPolicy: catalogClient.readPolicy,
    expectedService: fixtureOnly
      ? (catalogTrustConfig.fixtureService ?? 'cleared-fixture')
      : 'prime-video',
    prepareFiles: memoryBackedClips
  });
  let protectedOwner = null,
    restoration = null,
    viewerPort = null;
  // Downloads for "Watch this edit" and next-episode preparation run on the playing
  // owner, or on a temporary one (acquireOwner) that a later open adopts.
  let acquireOwner = null;
  const acquiring = new Map();
  // E61: the service's Pause / Cancel / stall retry stops an acquisition here.
  const acquireStops = new Map();
  // 0.62.21: Pause holds an acquisition (its staged objects and its place); Resume continues it.
  const acquirePauses = new Map();
  function pauseGate() {
    let paused = false, controller = new AbortController();
    const waiters = [];
    return {
      get paused() { return paused; },
      signal: () => controller.signal,
      resumed: () => (paused ? new Promise(resolve => waiters.push(resolve)) : Promise.resolve()),
      pause() { if (paused) return; paused = true; controller.abort(Error('request-paused')); },
      resume() { if (!paused) return; paused = false; controller = new AbortController(); for (const wake of waiters.splice(0)) wake(); }
    };
  }
  const storeForPolicy = createViewerStore();
  const storagePolicy = async () => {
    const preferences = (await storeForPolicy.read()).preferences;
    const budgetBytes =
      preferences.storageBudgetBytes ??
      defaultStorageBudget(await navigator.storage.estimate().catch(() => null));
    return { budgetBytes, autoEvict: preferences.autoMakeRoom !== false };
  };
  // E91: retryAfterSeconds is the server's wait for a download-limit refusal (a bounded number, never text).
  const postProgress = (releaseId, bytes, total, state = 'downloading', operation = 'acquire', cause = null, retry = null, retryAfterSeconds = null) => {
    try {
      viewerPort?.postMessage({
        progress: { releaseId, bytes, total, state, operation, ...(cause ? { cause } : {}), ...(retry ? { retry } : {}), ...(retryAfterSeconds ? { retryAfterSeconds } : {}) },
        build: EXECUTING_BUILD
      });
    } catch {}
  };
  function makeProtectedOwner(online) {
    const ref = {};
    return createConfiguredProtectedOwner({
      trust: protectedTrustConfig,
      pairingConfig: catalogTrustConfig,
      online,
      storagePolicy,
      lockWaitMs: 30_000,
      catalogOptions: {
        // Protected loads only: the clips were just decrypted and hash-bound to the signed packet.
        validateAsset: assetCache.validateAsset,
        activationStore: catalogClient,
        readPolicy: catalogClient.readPolicy,
        expectedService: fixtureOnly
          ? (catalogTrustConfig.fixtureService ?? 'cleared-fixture')
          : 'prime-video'
      },
      readSource: () => {
        throw Error('protected-controller-source-required');
      },
      refreshControl: (id, options) => catalogClient.refresh(id, options),
      executor: {
        cancel: async () => {
          if (!ref.owner || protectedOwner !== ref.owner || disconnected) return;
          await boundedOperation(
            () =>
              new Promise((resolve, reject) => {
                restoration = { resolve, reject };
                post({ type: 'catalog-invalidated' });
              }),
            { timeoutMs: 8000, label: 'private-protected-restoration' }
          );
        }
      }
    }).then(owner => {
      ref.owner = owner;
      return owner;
    });
  }
  // Resolves with the task's value, or rejects when it makes no progress for stallMs.
  function progressBound(start, stallMs, signal, onStall, isPaused = () => false) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const rearm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          // A paused acquisition is not stalled.
          if (isPaused()) { rearm(); return; }
          // E61: a stalled acquisition is stopped, not left running behind the failure.
          try { onStall?.(); } catch {}
          reject(Error('protected-download-stalled'));
        }, stallMs);
      };
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? Error('protected-import-cancelled'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      rearm();
      Promise.resolve()
        .then(() => start(rearm))
        .then(resolve, reject)
        .finally(() => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        });
    });
  }
  function acquireRelease(releaseId) {
    if (acquiring.has(releaseId)) return acquiring.get(releaseId);
    const stop = new AbortController(), gate = pauseGate();
    acquireStops.set(releaseId, stop);
    acquirePauses.set(releaseId, gate);
    const task = (async () => {
      postProgress(releaseId, 0, 0, 'opening');
      const owner = protectedOwner ?? (acquireOwner ??= await makeProtectedOwner(true));
      if (stop.signal.aborted) throw Error('protected-download-cancelled');
      let bytes = 0,
        total = 0;
      const result = await progressBound(
        rearm =>
          owner.acquire(releaseId, {
            combined: false,
            signal: stop.signal,
            pause: gate,
            onPhase: phase => {
              rearm();
              postProgress(releaseId, bytes, total, phase);
            },
            onProgress: (received, expected) => {
              rearm();
              bytes = received;
              total = expected;
              postProgress(releaseId, bytes, total);
            },
            // E61: the client reconnects and resumes (HTTP Range); report it for telemetry.
            onRetry: ({ attempt, code, delayMs, written }) => {
              rearm();
              postProgress(releaseId, bytes, total, 'downloading', 'acquire', null, { attempt, code, delayMs, written });
            }
          }),
        // E61: longer than the client's longest wait (Retry-After is capped at 60 s).
        90_000,
        stop.signal,
        () => stop.abort(Error('protected-download-stalled')),
        () => gate.paused
      ).catch(error => {
        throw stop.signal.aborted && stop.signal.reason?.message === 'protected-download-cancelled' ? Error('protected-download-cancelled') : error;
      });
      // 0.63.3: run the first-Watch checks now ("Checking clips n of N"), warming the validated
      // cache so the first Watch is fast. Best effort: a playing owner or any failure skips it.
      if (typeof owner.prepare === 'function' && !stop.signal.aborted) {
        try {
          await progressBound(rearm => owner.prepare(releaseId, {
            signal: stop.signal,
            onPhase: phase => { rearm(); if (phase !== 'checking') postProgress(releaseId, 0, 0, phase); },
            onCheck: (step, done, total) => { rearm(); postProgress(releaseId, done, total, step === 'checking' ? 'checking' : 'verifying'); }
          }), 90_000, stop.signal, () => {}, () => gate.paused);
        } catch {}
      }
      postProgress(releaseId, result.bytes, result.bytes, 'ready');
      return result;
    })();
    acquiring.set(releaseId, task);
    task
      .catch(error => postProgress(releaseId, 0, 0, `failed:${downloadFailureCode(error)}`, 'acquire', failureCause(error), null, downloadLimitSeconds(error)))
      .finally(() => {
        acquiring.delete(releaseId);
        if (acquireStops.get(releaseId) === stop) acquireStops.delete(releaseId);
        if (acquirePauses.get(releaseId) === gate) acquirePauses.delete(releaseId);
        // A temporary owner that nothing adopted releases the lock once idle.
        if (!acquiring.size && acquireOwner && acquireOwner !== protectedOwner) {
          const idle = acquireOwner;
          acquireOwner = null;
          void idle.close().catch(() => {});
        }
      });
    return task;
  }
  const protectedPicker = document.querySelector('#protected-picker'),
    protectedLoad = document.querySelector('#protected-load');
  const legacyOption = packetKind.querySelector('[value=catalog]');
  document.querySelector('#show-legacy').onchange = e => {
    legacyOption.hidden = !e.target.checked;
    if (legacyOption.hidden && packetKind.value === 'catalog')
      packetKind.value = protectedTrustConfig.enabled ? 'protected' : 'private';
    updatePicker();
  };
  const updatePicker = () => {
    const selected = packetKind.value === 'protected';
    protectedPicker.hidden = !selected;
    document.querySelector('#folder-label').hidden = selected;
    folder.hidden = selected;
    document.querySelector('#choose-directory').hidden = selected || fixtureOnly;
  };
  packetKind.addEventListener('change', updatePicker);
  legacyOption.hidden = packetKind.value !== 'catalog';
  document.querySelector('#show-legacy').checked = !legacyOption.hidden;
  updatePicker();
  let importSequence = 0,
    pendingImport = null,
    currentImport = null,
    importedKind = null;
  let disconnected = false,
    lastLease = performance.now(),
    leaseRequested = false;
  let connectedBuild = null,
    lastCommandId = 0,
    parentBound = false;
  folder.disabled = true;
  const post = message => {
    if (!disconnected) {
      if (!validLocalMessage(message, 'renderer')) throw Error('private-response-invalid');
      try {
        port.postMessage(message);
      } catch {
        disconnectRenderer('send-failed');
      }
    }
  };
  async function clear({ keepImport = false, exceptController = null } = {}) {
    if (!keepImport) {
      imports.invalidate('private-import-cancelled');
      pendingImport = null;
    }
    operations.invalidate('private-files-cleared');
    for (const controller of active.values())
      if (controller !== exceptController) controller.abort();
    // LocalOverlay releases its owned decoder synchronously. Release this
    // import's resources in the same turn, before yielding its acknowledgement;
    // an older clear must never revoke a newer import's URLs/session afterward.
    const previousProtected = protectedOwner;
    protectedOwner = null;
    const restoring = restoration;
    restoration = null;
    let teardown;
    try {
      overlay.releaseStandby?.();
      teardown = overlay.teardown();
    } finally {
      catalogSession.clear();
      importedKind = null;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
      document.body.classList.remove('playing');
      if (!keepImport && !disconnected)
        status.textContent = 'Clips cleared. Select an eligible packet to import.';
    }
    let teardownError;
    try {
      await teardown;
      restoring?.resolve();
    } catch (error) {
      teardownError = error;
      restoring?.reject(error);
    }
    if (previousProtected) await previousProtected.close();
    if (teardownError) throw teardownError;
  }
  // local (0.63.0): { archiveId, revision, packetSha256 } of a stored .ss copy; its clip checks use the
  // validated cache keyed by archive_id and build (a first load, or a new build, runs the full check).
  async function importSelection(selectedFiles = null, { preview = false, previewName = '', local = null } = {}) {
    if (disconnected || !connectedBuild) return { ok: false, code: 'viewer-import-cancelled' };
    const files = Array.isArray(selectedFiles) ? selectedFiles : [...folder.files],
      kind = packetKind.value;
    folder.value = '';
    folder.disabled = packetKind.disabled = protectedLoad.disabled = true;
    imports.invalidate('new-import');
    const importOperation = imports.capture();
    const importId = ++importSequence;
    const owner = { importId };
    currentImport = owner;
    const progressRelease =
      kind === 'protected' ? document.querySelector('#protected-release').value.trim() : null;
    const ownsImport = () => !disconnected && currentImport === owner;
    const reportProgress = (state, bytes = 0, total = 0, retryAfterSeconds = null) => {
      if (ownsImport() && /^[a-f0-9-]{36}$/.test(progressRelease ?? ''))
        postProgress(progressRelease, bytes, total, state, 'load', null, null, retryAfterSeconds);
    };
    const assertImport = () => {
      importOperation.assertCurrent();
      if (!ownsImport()) throw Error('private-import-superseded');
    };
    status.textContent = 'Restoring native playback before import…';
    let stage = 'restoration';
    reportProgress('restoring');
    try {
      if (fixtureOnly && !['catalog', 'protected'].includes(kind))
        throw Error('catalog-fixture-only');
      // Let the controller restore native playback before releasing the old
      // decoder or URLs. Import cannot race an old playing/cancelling scheduler.
      await boundedOperation(
        () =>
          new Promise(resolve => {
            pendingImport = { importId, resolve };
            post({ type: 'import-start', importId });
          }),
        { signal: importOperation.signal, timeoutMs: 8000, label: 'private-import-restoration' }
      );
      assertImport();
      stage = 'cleanup';
      await clear({ keepImport: true });
      assertImport();
      const operation = operations.capture();
      const signal = AbortSignal.any([importOperation.signal, operation.signal]);
      status.textContent = 'Checking packet and clips…';
      if (kind === 'protected') {
        stage = 'owner';
        reportProgress('opening');
        if (!protectedTrustConfig.enabled) throw Error('protected-trust-unconfigured');
        const release = document.querySelector('#protected-release').value.trim();
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(release))
          throw Error('protected-release-id');
        const online = !document.querySelector('#protected-offline').checked;
        // A background download of this (or another) edit holds the owner: let it
        // finish, then open with that owner instead of waiting for the lock.
        if (acquiring.size) await Promise.allSettled([...acquiring.values()]);
        const adopted = acquireOwner;
        acquireOwner = null;
        const owner = adopted ?? (await makeProtectedOwner(online));
        // A "Check again" (or a playback failure) recorded for this release decides how its clips
        // are checked this time; the licence, descriptor, decryption and signatures always run.
        await assetCache.prepareLoad(release).catch(() => {});
        if (signal.aborted) {
          await owner.close();
          throw Error('protected-import-cancelled');
        }
        protectedOwner = owner;
        stage = 'protected';
        // Bounded by silence, not size: a large first download on a slow link
        // completes, and each phase change also counts as progress.
        let received = 0,
          expected = 0;
        await progressBound(
          rearm =>
            owner.open(release, {
              online,
              combined: document.querySelector('#protected-combined').checked,
              onPhase: phase => {
                rearm();
                reportProgress(phase, received, expected);
              },
              onProgress: (bytes, total) => {
                rearm();
                received = bytes;
                expected = total;
                reportProgress('downloading', bytes, total);
              },
              // E60: 'verifying' per decrypted file, then 'checking' per clip, with counts.
              onCheck: (step, done, total) => {
                rearm();
                if (['verifying', 'checking'].includes(step)) reportProgress(step, done, total);
              }
            }),
          60_000,
          signal
        );
        assertImport();
        operation.assertCurrent();
        importedKind = 'protected';
        openedRelease = release;
        assetCache.loadFinished(release);
        stage = 'delivery';
        post({ type: 'catalog-packet', packet: owner.description() });
        await recordViewerEdit(owner.description(), 'website').catch(() => {});
        status.textContent = 'Protected catalog edit checked. Arm it to check the open video.';
        reportProgress('ready');
        // "Check again" after cached checks: the full check runs now, after Ready. A failure
        // removes the cached results, reports through the existing failure path and stops the edit.
        void assetCache.runBackground(release, {
          onFailure: () => {
            if (openedRelease !== release) return;
            postProgress(release, 0, 0, 'failed:viewer-media-prepare-failed', 'load', 'background-check');
            post({ type: 'catalog-invalidated' });
          }
        }).catch(() => {});
        return { ok: true };
      }
      if (kind === 'catalog') {
        stage = 'catalog';
        await boundedOperation(() => catalogSession.importFiles(files, { signal }), {
          signal,
          timeoutMs: 120000,
          label: 'private-packet-import'
        });
        assertImport();
        operation.assertCurrent();
        importedKind = 'catalog';
        stage = 'delivery';
        post({ type: 'catalog-packet', packet: catalogSession.description() });
        await recordViewerEdit(catalogSession.description(), 'website').catch(() => {});
        if (ownsImport())
          status.textContent = 'Catalog packet checked. Arm it to check the open video.';
        return { ok: true };
      }
      stage = 'packet';
      const loaded = await boundedOperation(
        () => loadFixturePacket(files, null, { signal, expectedService: 'prime-video',
          ...(local ? { validateAsset: assetCache.validateAsset,
            context: { releaseId: `local:${local.archiveId}`, manifestVersion: local.revision, manifestSha256: local.packetSha256, assetSetSha256: local.archiveId } } : {}) }),
        { signal, timeoutMs: 120000, label: 'private-packet-import' }
      );
      assertImport();
      operation.assertCurrent();
      if (!['prime-video'].includes(loaded.packet.manifest.source.service))
        throw Error('wrong-service');
      stage = 'media';
      const playable = await memoryBackedClips(loaded.files, { signal });
      assertImport();
      operation.assertCurrent();
      for (const [hash, file] of playable) urls.set(`asset:${hash}`, URL.createObjectURL(file));
      const packet = structuredClone(loaded.packet);
      // Binding names are unnecessary to the scheduler and must not cross origins.
      for (const binding of packet.asset_bindings) binding.relative_path = `${binding.sha256}.mp4`;
      importedKind = 'private';
      stage = 'delivery';
      // A creator preview says so, with its scene's name, so the player menu shows preview
      // wording; the player accepts the flag only for a one-scene preview packet (E57 C4).
      post(preview ? { type: 'packet', packet, preview: { name: previewSceneName(previewName) } } : { type: 'packet', packet });
      // A creator's clip preview is a one-off; it does not join the viewer's library.
      if (!preview && !local) await recordViewerEdit(packet, 'local').catch(() => {});
      if (ownsImport())
        status.textContent = `${urls.size} clips checked. Arm the edit in the playback panel.`;
      return { ok: true };
    } catch (error) {
      const code = kind === 'protected' && stage === 'protected' ? downloadFailureCode(error) : viewerLoadCode(error, stage);
      if (ownsImport() && !importOperation.signal.aborted) {
        try {
          await clear({ keepImport: true });
        } catch {
          /* Import remains failed; native controller recovery still runs. */
        }
        if (ownsImport() && !importOperation.signal.aborted) {
          post({ type: 'import-error', code });
          reportProgress(`failed:${code}`, 0, 0, downloadLimitSeconds(error));
          if (ownsImport()) status.textContent = `${viewerLoadMessage(code)} (${code})`;
          return { ok: false, code };
        }
      } else if (ownsImport())
        status.textContent = 'Import cancelled. Select a packet to try again.';
      return { ok: false, code: 'viewer-import-cancelled' };
    } finally {
      if (pendingImport?.importId === importId) pendingImport = null;
      if (currentImport === owner) {
        currentImport = null;
        folder.disabled = disconnected;
        packetKind.disabled = disconnected || (fixtureOnly && !protectedTrustConfig.enabled);
        protectedLoad.disabled = disconnected || !connectedBuild || !protectedTrustConfig.enabled;
      }
    }
  }
  folder.addEventListener('change', () => void importSelection());
  protectedLoad.addEventListener('click', () => void importSelection());
  port.onMessage.addListener(message => {
    if (message?.type === 'ready') {
      if (!parentBound || connectedBuild || !sameExecutingBuild(message.build)) {
        disconnectRenderer('handshake-rejected');
        return;
      }
      connectedBuild = message.build;
      lastLease = performance.now();
      folder.disabled = false;
      protectedLoad.disabled = !protectedTrustConfig.enabled;
      connectViewerRenderer();
      return;
    }
    if (!connectedBuild) {
      disconnectRenderer('handshake-rejected');
      return;
    }
    if (!validLocalMessage(message, 'controller') || message.id <= lastCommandId) {
      disconnectRenderer('command-rejected');
      return;
    }
    const { id, command, args = [] } = message;
    lastCommandId = id;
    if (command === 'abort') {
      active.get(args[0])?.abort();
      return;
    }
    if (command === 'lease') {
      lastLease = performance.now();
      leaseRequested = false;
      return;
    }
    const maximum =
      LOCAL_LIMITS.pending +
      (LOCAL_CONTROL_COMMANDS.has(command) ? LOCAL_LIMITS.controlReserve : 0);
    if (active.size >= maximum) {
      disconnectRenderer('request-budget');
      return;
    }
    const controller = new AbortController();
    active.set(id, controller);
    let restoredImport = null;
    const execute = async () => {
      if (command === 'importReady') {
        if (pendingImport?.importId !== args[0]) throw Error('stale-import');
        // Commit the acknowledgement before releasing import work. Its clear
        // cancels active commands and must not cancel this very acknowledgement.
        restoredImport = pendingImport;
        return;
      }
      assertActive(controller.signal);
      if (command === 'catalogActivity') {
        if (protectedOwner) return protectedOwner.activity(args[0], args[1]);
        if (importedKind !== 'catalog') throw Error('catalog-import-required');
        return;
      }
      if (command === 'catalogActions') {
        if (protectedOwner) return protectedOwner.actions(args[0], { signal: controller.signal });
        if (importedKind !== 'catalog') throw Error('catalog-import-required');
        return catalogSession.actions(args[0], { signal: controller.signal });
      }
      // Viewer keys during a replacement; the pending play deadline follows the pause.
      if (command === 'localPause') {
        overlay.localPause(controller.signal);
        playDeadline?.pause();
        return;
      }
      if (command === 'localResume') {
        overlay.localResume(controller.signal);
        playDeadline?.resume();
        return;
      }
      if (command === 'localSeek') {
        overlay.localSeek(args[0], controller.signal);
        if (args[0] < 0) playDeadline?.extend(-args[0]);
        return;
      }
      if (command === 'localFadeOut') return overlay.localFadeOut(args[0], controller.signal, args.length === 2 ? args[1] : null);
      if (command === 'localMute') {
        overlay.localMute(args[0], controller.signal);
        return;
      }
      if (command === 'clockSample') {
        const monotonicMs = performance.now();
        return { epochMs: performance.timeOrigin + monotonicMs, monotonicMs };
      }
      if (command === 'prerollAt') {
        if (args[0] === null || Math.abs(args[1] - performance.timeOrigin) > 1) {
          overlay.cancelPreroll();
          return;
        }
        return overlay.prerollAt(args[0], controller.signal, args.length >= 3 ? { audioEndAtMs: args[2], ...(args.length === 4 ? { fadeMs: args[3] } : {}) } : {});
      }
      if (command === 'timing') {
        clipTiming.setEnabled(args[0]);
        overlay.stampFirstFrames = args[0] === true;
        return;
      }
      if (command === 'timingLog') return clipTiming.snapshot();
      if (command === 'viewerClock')
        return {
          currentTimeMs:
            overlay.video && Number.isFinite(overlay.video.currentTime)
              ? overlay.video.currentTime * 1000
              : null,
          paused: overlay.video?.paused !== false,
          buffering: Boolean(overlay.video && overlay.video.readyState < 3)
        };
      if (command === 'clear') return clear({ exceptController: controller });
      if (['teardown', 'stop'].includes(command))
        for (const other of active.values()) if (other !== controller) other.abort();
      if (command === 'prepare' || command === 'prepareNext') {
        const source = protectedOwner
          ? await protectedOwner.resolveAsset(args[0])
          : importedKind === 'catalog'
            ? catalogSession.resolveAsset(args[0])
            : (urls.get(args[0]) ??
              (args[0] === 'fixture' ? chrome.runtime.getURL('media/replacement.mp4') : null));
        if (!source) throw Error('unknown-asset');
        return command === 'prepare'
          ? overlay.prepare(source, controller.signal)
          : overlay.prepareNext(source, controller.signal);
      }
      if (command === 'cue') return overlay.cue(args[0], controller.signal);
      if (command === 'cueAt') return overlay.cueAt(args[0], controller.signal);
      if (command === 'advance') {
        if (protectedOwner) await protectedOwner.beginLocal();
        return overlay.advance(controller.signal);
      }
      if (command === 'mount') {
        document.body.classList.add('playing');
        return overlay.mount(document.querySelector('#video-host'), controller.signal);
      }
      if (command === 'unmount') {
        try {
          return await overlay.unmount(controller.signal);
        } finally {
          document.body.classList.remove('playing');
        }
      }
      if (command === 'play') {
        if (protectedOwner) await protectedOwner.beginLocal();
        try {
          return await overlay.play(controller.signal, args[0]);
        } catch (error) {
          // A clip that fails to play: the release's next load runs the full check (E60).
          if (importedKind === 'protected' && openedRelease && !controller.signal.aborted && error?.name !== 'AbortError')
            void assetCache.invalidateRelease(openedRelease).catch(() => {});
          throw error;
        }
      }
      if (command === 'configureAudio')
        return overlay.configureAudio(args[0], args[1], controller.signal);
      if (command === 'teardown') {
        // Teardown releases the decoder synchronously; do not let a delayed
        // acknowledgement remove the playing state of a later mount.
        try {
          return overlay.teardown(controller.signal);
        } finally {
          document.body.classList.remove('playing');
        }
      }
      return overlay[command](controller.signal);
    };
    const running =
      command === 'play'
        ? new Promise((resolve, reject) => {
            const deadline = pausableDeadline(135000, () =>
              reject(Error('private-renderer-timeout'))
            );
            playDeadline = deadline;
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
              once: true
            });
            Promise.resolve()
              .then(execute)
              .then(resolve, reject)
              .finally(() => {
                deadline.clear();
                if (playDeadline === deadline) playDeadline = null;
              });
          })
        : boundedOperation(execute, {
            signal: controller.signal,
            timeoutMs: 8000,
            label: 'private-renderer'
          });
    void running
      .then(value => {
        clipTiming.sample();
        assertActive(controller.signal);
        if (restoredImport && pendingImport !== restoredImport) throw Error('stale-import');
        const result = { type: 'result', id, ok: true, value: value ?? null };
        if (!validLocalResult(result, command)) throw Error('private-response-invalid');
        post(result);
        if (restoredImport && !disconnected && pendingImport === restoredImport) {
          pendingImport = null;
          restoredImport.resolve();
        }
      })
      .catch(error => {
        controller.abort();
        post({
          type: 'result',
          id,
          ok: false,
          error: /^(?:catalog-[a-z0-9-]{1,120}|private-local-stall)$/.test(error.message)
            ? error.message
            : 'private-renderer-operation-failed'
        });
      })
      .finally(() => active.delete(id));
  });
  const onCatalogStorageChange = (changes, area) => {
    if (area !== 'local' || importedKind !== 'catalog') return;
    const editId = catalogSession.description().manifest.edit_id;
    if (!Object.hasOwn(changes, `catalogActivation.v2.${editId}`)) return;
    const importOperation = imports.capture(),
      operation = operations.capture();
    const notifyIfCurrent = () => {
      if (
        !disconnected &&
        !importOperation.signal.aborted &&
        !operation.signal.aborted &&
        importedKind === 'catalog'
      ) {
        post({ type: 'catalog-invalidated' });
      }
    };
    // Controller cancels/restores first, then clear releases the private media.
    void catalogSession
      .storageChangeRequiresInvalidation(changes[`catalogActivation.v2.${editId}`].newValue)
      .then(changed => {
        if (changed) notifyIfCurrent();
      })
      .catch(notifyIfCurrent);
  };
  chrome.storage.onChanged.addListener(onCatalogStorageChange);
  const stopControlPolling = startCatalogControlPolling({
    current: () =>
      !disconnected && importedKind === 'catalog'
        ? catalogSession.description().manifest.edit_id
        : null,
    refresh: (id, { signal }) =>
      catalogClient.refresh(id, { signal: AbortSignal.any([signal, imports.capture().signal]) })
  });
  const bindingOrigins = fixtureOnly
    ? [`chrome-extension://${chrome.runtime.id}`]
    : ['https://www.amazon.com', 'https://www.primevideo.com'];
  const onParentBinding = event => {
    if (disconnected || parentBound) return;
    const challenge = receivedParentBinding(event, window, bindingOrigins);
    if (!challenge) return;
    parentBound = true;
    removeEventListener('message', onParentBinding);
    try {
      port.postMessage({ type: 'frame-bound', challenge });
    } catch {
      disconnectRenderer('send-failed');
    }
  };
  addEventListener('message', onParentBinding);
  function disconnectRenderer(reason = 'port-closed') {
    if (disconnected) return;
    // Best effort before the existing immediate close; delivery is not guaranteed.
    try {
      port.postMessage(
        disconnectNotice('renderer', reason, {
          leaseAgeMs: performance.now() - lastLease,
          visibility: document.visibilityState
        })
      );
    } catch {}
    disconnected = true;
    connectedBuild = null;
    folder.disabled = packetKind.disabled = protectedLoad.disabled = true;
    clipTiming.setEnabled(false);
    clearInterval(leaseTimer);
    stopControlPolling();
    chrome.storage.onChanged.removeListener(onCatalogStorageChange);
    removeEventListener('message', onParentBinding);
    void clear().catch(() => {});
    port.disconnect();
    status.textContent = 'Connection lost. Refresh the streaming tab to reconnect.';
  }
  port.onDisconnect.addListener(() => disconnectRenderer('port-closed'));
  // A stale lease is not yet proof of a dead controller: in a hidden, silent tab Chrome runs the
  // controller's lease interval about once a minute but still delivers messages. Once paired, the
  // renderer asks once and allows one more check (2 s) for the answer before it disconnects.
  const leaseTimer = setInterval(() => {
    if (performance.now() - lastLease <= 6000) return;
    if (!connectedBuild || leaseRequested) {
      disconnectRenderer('lease-expired');
      return;
    }
    leaseRequested = true;
    try {
      port.postMessage({ type: 'lease-request' });
    } catch {
      disconnectRenderer('send-failed');
    }
  }, 2000);
  addEventListener('pagehide', () => disconnectRenderer('pagehide'));
  port.postMessage({ type: 'hello', build: EXECUTING_BUILD });

  async function recordViewerEdit(packet, origin) {
    const source = packet.manifest.source;
    const signature = origin === 'website' && Array.isArray(packet.manifest.segments) && packet.manifest.segments.length
      ? await editSignature(packet).catch(() => null) : null;
    await viewerRequest('library-put', {
      ...(signature ? { editSignature: signature } : {}),
      id: packet.packet_id,
      title: String(
        packet.manifest.title ??
          packet.manifest.name ??
          `${source.title ?? 'Saved edit'} · ${packet.packet_id.slice(0, 8)}`
      ).slice(0, 200),
      origin,
      version: packet.manifest.manifest_version,
      transport:
        importedKind === 'protected' ? 'protected' : origin === 'website' ? 'catalog' : 'local',
      sourceKey: sourceKey({
        serviceId: source.service,
        activeItemId: source.service_content_id,
        mediaType: source.episode === null ? 'movie' : 'episode',
        season: source.season,
        episode: source.episode,
        runtimeMs: source.expected_runtime_ms,
        versionTag: source.version_tag,
        territory: source.territory,
        plan: source.service_tier
      }),
      availability: importedKind === 'protected' ? 'downloaded' : 'reimport-required',
      bytes: null,
      leaseExpiresAt: null
    });
  }
  function connectViewerRenderer() {
    if (viewerPort) return;
    viewerPort = chrome.runtime.connect({ name: 'viewer-renderer-v1' });
    viewerPort.onMessage.addListener(m => {
      if (
        !sameExecutingBuild(m?.build) ||
        !['load', 'preview', 'acquire', 'cancel', 'pause', 'resume', 'library', 'remove', 'load-local', 'recheck'].includes(m.method) ||
        typeof m.id !== 'string'
      )
        return;
      void (async () => {
        if (m.method === 'pause' || m.method === 'resume') {
          const gate = acquirePauses.get(m.args?.releaseId);
          if (!gate) throw Error('viewer-download-unavailable');
          gate[m.method]();
          return { paused: gate.paused };
        }
        if (m.method === 'cancel') {
          // E61: Pause / Cancel / stall retry from the service's download queue.
          const stop = acquireStops.get(m.args?.releaseId);
          stop?.abort(Error('protected-download-cancelled'));
          return { cancelled: Boolean(stop) };
        }
        if (m.method === 'recheck') {
          // "Check again" (E60): the release's next load re-checks every clip after Ready.
          if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(m.args?.releaseId ?? ''))
            throw Error('viewer-release-invalid');
          await assetCache.markRecheck(m.args.releaseId);
          return { state: 'recheck-requested' };
        }
        if (m.method === 'load-local') {
          // A local edit (.ss, 0.63.0): its stored copy in the extension's storage, read again
          // and fed to the same local import as any packet, from zero-copy slices.
          if (disconnected || !connectedBuild || currentImport || fixtureOnly)
            throw Error('viewer-renderer-unavailable');
          const archiveId = m.args?.archiveId;
          if (!/^[a-f0-9]{64}$/.test(archiveId ?? '')) throw Error('viewer-local-invalid');
          const file = await openLocalCopy(await localRoot(), archiveId);
          let archive;
          try {
            archive = await readSsArchive(file, { trustedKeys: protectedTrustConfig.descriptorKeys ?? [], extensionVersion: EXECUTING_BUILD.version });
          } catch {
            throw Error('viewer-local-invalid');
          }
          if (archive.archiveId !== archiveId) throw Error('viewer-local-invalid');
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(archive.packetText));
          const packetSha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
          packetKind.value = 'private';
          updatePicker();
          const imported = await importSelection(archive.files(), { local: { archiveId, revision: archive.packet.manifest.manifest_version, packetSha256 } });
          if (!imported.ok) throw Error(imported.code);
          if (importedKind !== 'private') throw Error('viewer-local-invalid');
          return { state: 'checked' };
        }
        if (['acquire', 'library', 'remove'].includes(m.method)) {
          if (
            disconnected ||
            !connectedBuild ||
            (fixtureOnly && !protectedTrustConfig.enabled) ||
            !protectedTrustConfig.enabled
          )
            throw Error('viewer-renderer-unavailable');
          if (m.method === 'library') {
            const owner = protectedOwner ?? acquireOwner;
            if (!owner) throw Error('viewer-no-owner');
            return { items: await owner.library() };
          }
          if (
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
              m.args?.releaseId ?? ''
            )
          )
            throw Error('viewer-release-invalid');
          if (m.method === 'remove') {
            const owner = protectedOwner ?? acquireOwner;
            if (!owner) throw Error('viewer-no-owner');
            await owner.remove(m.args.releaseId);
            return { removed: true };
          }
          const result = await acquireRelease(m.args.releaseId);
          return { state: 'ready', bytes: result.bytes };
        }
        if (m.method === 'preview') {
          // The panel's packet and clip go through the same checks as a chosen folder.
          if (disconnected || !connectedBuild || currentImport || fixtureOnly)
            throw Error('viewer-renderer-unavailable');
          const pending = await takePreview();
          if (!pending) throw Error('viewer-preview-missing');
          const packet = JSON.parse(pending.packet),
            sha = packet?.asset_bindings?.[0]?.sha256;
          if (!/^[a-f0-9]{64}$/.test(sha ?? '')) throw Error('viewer-preview-invalid');
          packetKind.value = 'private';
          updatePicker();
          const imported = await importSelection(
            [
              new File([pending.packet], 'edit-packet.json', { type: 'application/json' }),
              new File([pending.clip], `${sha}.mp4`, { type: 'video/mp4' })
            ],
            { preview: true, previewName: pending.name }
          );
          if (!imported.ok) throw Error(imported.code);
          if (importedKind !== 'private') throw Error('viewer-preview-rejected');
          return { state: 'checked' };
        }
        if (disconnected || !connectedBuild || currentImport || !protectedTrustConfig.enabled)
          throw Error('viewer-renderer-unavailable');
        if (
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(m.args.releaseId)
        )
          throw Error('viewer-release-invalid');
        packetKind.value = 'protected';
        updatePicker();
        document.querySelector('#protected-release').value = m.args.releaseId;
        document.querySelector('#protected-offline').checked = !m.args.online;
        document.querySelector('#protected-combined').checked = m.args.combined;
        const imported = await importSelection();
        if (!imported.ok) throw Error(imported.code);
        if (importedKind !== 'protected' || !protectedOwner)
          throw Error('viewer-protected-open-failed');
        return { state: 'checked' };
      })().then(
        value => viewerPort?.postMessage({ id: m.id, ok: true, value, build: EXECUTING_BUILD }),
        error =>
          viewerPort?.postMessage({
            id: m.id,
            ok: false,
            cause: failureCause(error),
            ...(m.method === 'acquire'
              ? { code: downloadFailureCode(error) }
              : /^viewer-[a-z-]{1,60}$/.test(error?.message ?? '')
                ? { code: error.message }
                : {}),
            build: EXECUTING_BUILD
          })
      );
    });
    viewerPort.onDisconnect.addListener(() => {
      viewerPort = null;
    });
    viewerPort.postMessage({ hello: true, build: EXECUTING_BUILD });
  }

  const viewerFolders = createViewerStore();
  let rememberedFolder = null;
  void viewerFolders
    .folder('imports')
    .then(h => {
      rememberedFolder = h;
    })
    .catch(() => {});
  document.querySelector('#choose-directory').onclick = () => {
    if (disconnected || currentImport || fixtureOnly || !connectedBuild) return;
    if (!globalThis.showDirectoryPicker) {
      status.textContent = 'Use Choose packet folder in this browser.';
      return;
    }
    // startIn is only a chooser hint. The user still selects and grants access.
    const chosen = showDirectoryPicker({
      id: 'ss-imports',
      mode: 'read',
      ...(rememberedFolder ? { startIn: rememberedFolder } : {})
    });
    void (async () => {
      const handle = await chosen;
      if (disconnected) throw Error('Player disconnected');
      const operation = imports.capture();
      const files = await readEditDirectory(handle, { signal: operation.signal });
      operation.assertCurrent();
      await viewerFolders.folder('imports', handle);
      rememberedFolder = handle;
      await importSelection(files);
    })().catch(e => {
      status.textContent = e.name === 'AbortError' ? 'Folder selection cancelled.' : e.message;
    });
  };

  return {
    // Test-only: adopt a protected owner as if a protected import had completed.
    injectProtected(owner, restoring) {
      protectedOwner = owner;
      restoration = restoring;
      importedKind = 'protected';
    }
  };
}
