import { matchingEdits, localEditMatches } from './viewer-candidates.mjs';
import { createCatalogDiscovery, mergeMatches, sourceIdentity } from './catalog-discovery.mjs';
import { createUpdateCheck } from './update-notice.mjs';
import { toolbarBadge, toolbarTone } from './viewer-icons.mjs';
import { toolbarState, findEditUrl, downloadName } from './viewer-display.mjs';
import { createDeviceJournal } from './device-link-store.mjs';
import { EXECUTING_BUILD } from './build-info.mjs';
import { sameExecutingBuild } from './build-identity.mjs';
import { runtimeDocument } from './runtime-document.mjs';
import { createViewerStore } from './viewer-store.mjs';
import { publicPlayback, chooseContinuation, primeTitleId, STREAMING_ORIGINS } from './viewer-model.mjs';
import { loadedEditMetadata } from './loaded-edit-display.mjs';
import { safeConnectionReport } from './connection-diagnostics.mjs';
import { isViewerLoadCode } from './viewer-load-error.mjs';
import { LOAD_PHASES, isActiveLoadPhase, loadStalled } from './viewer-load-status.mjs';
import { freshPlayerIdentityObservation } from './player-identity-observation.mjs';
import {
  batches,
  distinctIds,
  keptIds,
  needsMetadata,
  recoveryEntries,
  RECOVERY_LIMIT
} from './library-recovery.mjs';
// Download jobs, plus a bounded history of their phase changes for Copy
// diagnostics: release id prefix, phase, fixed failure code and elapsed time
// only (no names, URLs or tokens). It lives as long as the service worker.
class DownloadJobs extends Map {
  constructor(onHistory = () => {}) {
    super();
    this.history = [];
    this.started = Date.now();
    this.onHistory = onHistory;
  }
  set(releaseId, job) {
    const previous = this.get(releaseId);
    if (!previous || previous.state !== job?.state || previous.error !== job?.error) {
      this.history.push({
        atMs: Date.now() - this.started,
        release: String(releaseId).slice(0, 8),
        state: job?.state ?? null,
        error: job?.error ?? null,
        ...(job?.cause ? { cause: job.cause } : {}),
        ...(job?.state === 'downloading' && Number.isSafeInteger(job.total) && job.total > 0
          ? { percent: Math.floor((job.bytes / job.total) * 100) }
          : {})
      });
      if (this.history.length > 60) this.history.shift();
      // 0.63.3: kept across service restarts (with the wall-clock time).
      try { this.onHistory({ ...this.history.at(-1), at: Date.now() }); } catch {}
    }
    return super.set(releaseId, job);
  }
}
const VIEWER_PAGES = [
  '/viewer-popup.html',
  '/viewer-settings.html',
  '/authoring-sidepanel.html',
  '/welcome.html'
];
const LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/;
// Controller requests wait this long before failing with viewer-action-timeout.
const LONG_REQUEST_MS = {
  load: 1_800_000,
  acquire: 1_800_000,
  preview: 125_000,
  'timing-report': 20_000,
  // A jump may wait for a running command, finish a scene's restoration, then seek and warm playback.
  'jump-scene': 30_000
};
// Command failures kept for Copy diagnostics: method, command, code and a safe cause token.
const FAILURE_HISTORY = 20;
const safeToken = value => (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(value) ? value : null);
const quietly = value => void Promise.resolve(value).catch(() => {});
/** An extension page of this build: the popup, settings (optionally on one of its tabs), side panel or welcome page. */
export function viewerSurface(sender, id) {
  if (sender?.id !== id) return false;
  try {
    const u = new URL(sender.url);
    const settingsTab =
      u.pathname === '/viewer-settings.html' &&
      /^#(library|playback|account|creator|local|advanced|edits|settings)$/.test(u.hash);
    return (
      u.protocol === 'chrome-extension:' &&
      u.hostname === id &&
      (!u.hash || settingsTab) &&
      !u.search &&
      VIEWER_PAGES.includes(u.pathname) &&
      (!sender.tab || sender.frameId === 0) &&
      sender.origin === `chrome-extension://${id}`
    );
  } catch {
    return false;
  }
}
export function registerViewerService(
  runtime,
  config,
  {
    store = createViewerStore(),
    deviceJournal = createDeviceJournal(),
    tabs = chrome.tabs,
    authorizeRenderer = () => false,
    action = globalThis.chrome?.action,
    configuredEdit = null,
    timeoutMs = 8000,
    discovery,
    updates,
    onPreferences = () => {},
    windows = globalThis.chrome?.windows,
    // E61: the download queue's stall detection and automatic retry (tests shorten these).
    downloadTiming = {}
  } = {}
) {
  updates ??=
    config.deviceLinkLifetimeSeconds && config.fixtureOnly !== true
      ? createUpdateCheck(config, { installed: EXECUTING_BUILD.version })
      : { check: async () => null, forget() {} };
  discovery ??= config.deviceLinkLifetimeSeconds
    ? createCatalogDiscovery(runtime, config, { journal: deviceJournal })
    : null;
  // Online discovery is reserved for explicit website intents and continuation.
  const allMatches = async (playback, library) => {
    const local = [
      ...matchingEdits(playback, library, configuredEdit),
      ...(await localMatches(playback, library))
    ];
    if (!discovery || !playback.sourceKey || playback.state === 'unavailable') return local;
    const remote = await discovery.discover(playback).catch(() => ({ items: [] }));
    return withoutCatalogTwins(mergeMatches(local, remote.items));
  };
  // Playback choices must not implicitly acquire catalog releases. Website Watch
  // intents and the explicitly enabled next-episode feature retain online discovery.
  const keptMatches = async (playback, library, selections = {}) => [
    ...matchingEdits(
      playback,
      library,
      config.fixtureOnly ? configuredEdit : null,
      selections[playback.sourceKey]
    ).filter(item => item.downloaded || (config.fixtureOnly && item.id === configuredEdit?.id)),
    ...(await localMatches(playback, library))
  ];
  // Local edits (.ss, 0.63.0) for the episode being played, as "Local: <name>". Hidden with
  // Advanced → "Show the Local tab" off. Two local edits with the same name are told apart by
  // creator, else by number; a local edit identical to a catalog edit in the list is offered once,
  // as the catalog edit (collision table).
  const loadedLocal = new Map();
  // 0.63.4: a local edit that is on is named as in the chooser ("Local: <name>"),
  // never "Your edit". Only when the tab's loaded local edit is the one playing.
  async function localEditName(tabId, playback, library) {
    const id = loadedLocal.get(tabId);
    if (!id || !playback?.editId) return {};
    const row = (await store.localEdits?.().catch(() => []) ?? []).find(r => `local:${r.archiveId}` === id);
    if (!row || (row.editId ?? row.packetId) !== playback.editId) return {};
    const offered = (await localMatches(playback, library).catch(() => [])).find(m => m.id === id);
    return { editName: offered?.name ?? `Local: ${row.name}` };
  }
  const localKey = id => typeof id === 'string' && /^local:[a-f0-9]{64}$/.test(id) ? id.slice(6) : null;
  async function localMatches(playback, library = []) {
    if (!playback.sourceKey || playback.state === 'unavailable' || !store.localEdits) return [];
    const data = await Promise.resolve(store.read()).catch(() => null);
    if (data?.preferences?.showLocal === false) return [];
    const rows = (await store.localEdits().catch(() => [])).filter(row => localEditMatches(playback.sourceKey, row));
    const catalogSignatures = new Map((library ?? []).filter(item => item.origin === 'website' && item.editSignature && item.availability === 'downloaded').map(item => [item.editSignature, item.id]));
    const shown = rows.filter(row => !catalogSignatures.has(row.editSignature));
    const counts = new Map();
    for (const row of shown) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
    const seen = new Map();
    return shown.map(row => {
      let name = row.name;
      if (counts.get(row.name) > 1) {
        const creators = shown.filter(r => r.name === row.name).map(r => r.creatorName);
        const n = (seen.get(row.name) ?? 0) + 1; seen.set(row.name, n);
        name = row.creatorName && creators.filter(c => c === row.creatorName).length === 1 ? `${row.name} · ${row.creatorName}` : `${row.name} · ${n}`;
      }
      return { id: 'local:' + row.archiveId, title: `Local: ${name}`, name: `Local: ${name}`, downloaded: true, local: true, archiveId: row.archiveId,
        creatorName: row.creatorName ?? null, alsoInCatalog: row.alsoInCatalog ?? null, ...(Number.isFinite(row.bytes) ? { bytes: row.bytes } : {}),
        ...(Number.isSafeInteger(row.scenes) ? { scenes: row.scenes } : {}) };
    });
  }
  // A local edit recorded as identical to a catalog edit already in the list is not offered twice.
  const withoutCatalogTwins = matches => matches.filter(m => !(m.local && m.alsoInCatalog && matches.some(x => x.id === m.alsoInCatalog)));
  // The toolbar badge and title follow each tab's playback: "ON" while an edit is on,
  // with the edit's name in the tooltip. Unchanged states are not repainted.
  const tones = new Map();
  const editNameFor = async (editId, version, tabId) => {
    if (!editId || !version) return '';
    if (tabId !== undefined && loadedLocal.has(tabId)) {
      const named = await localEditName(tabId, { editId, sourceKey: null }, []).catch(() => ({}));
      if (named.editName) return named.editName;
    }
    const library = (await Promise.resolve(store.read()).catch(() => null))?.library ?? [];
    return loadedEditMetadata({ state: 'armed', editId, version }, library).editName ?? '';
  };
  const paint = (id, value) => {
    const playback = publicPlayback(value), tone = toolbarTone(playback);
    const key = JSON.stringify([tone, tone === 'on' ? playback.editId : '', tone === 'on' ? playback.version : '']);
    if (tones.get(id) === key) return;
    tones.set(id, key);
    const badge = toolbarBadge(tone);
    quietly(action?.setBadgeBackgroundColor({ tabId: id, color: badge.color }));
    quietly(action?.setBadgeText({ tabId: id, text: badge.text }));
    quietly(
      (tone === 'on' ? editNameFor(playback.editId, playback.version, id) : Promise.resolve('')).then(name =>
        tones.get(id) === key ? action?.setTitle({ tabId: id, title: toolbarState(playback, name).title }) : null
      )
    );
  };
  const controllers = new Map(),
    renderers = new Map(),
    matching = new Set(),
    rematch = new Set(),
    lastSource = new Map(),
    jobs = new DownloadJobs(entry => void Promise.resolve(store.downloadLog?.({ history: [entry] })).catch(() => {})),
    loads = new Map(),
    lastEdit = new Map(),
    prefetched = new Set();
  let pending = 0;
  const settingsTargets = new Map();
  // The last command failures, so Copy diagnostics still shows a jump that failed minutes ago.
  const commandFailures = [], serviceStarted = Date.now();
  function recordFailure(message, code, error) {
    // The Edits page polls the vault every 3 s; no player tab holding it is a
    // normal answer there ("in use" / sizes later), not a failed command (E51).
    // 0.63.2: likewise for edits-remove: with no player tab the Settings page removes the files itself.
    if (['edits-library', 'edits-remove'].includes(message.method) && code === 'viewer-no-owner') return;
    const command = typeof message.args?.command === 'string' && /^[a-z-]{1,40}$/.test(message.args.command) ? message.args.command : null;
    commandFailures.push({ atMs: Date.now() - serviceStarted, at: new Date().toISOString(), method: safeToken(message.method), command, code,
      cause: safeToken(error?.cause) ?? (error?.message === code ? null : safeToken(error?.message) ?? safeToken(error?.name)) });
    if (commandFailures.length > FAILURE_HISTORY) commandFailures.shift();
  }
  // A chooser or a fresh answer replaces an older failed load: its Problem view
  // must not hide the choices for two minutes (E50).
  function clearFailedLoad(tabId) {
    const load = loads.get(tabId);
    if (load && !load.busy && load.state === 'failed') loads.delete(tabId);
  }
  function finishMatching(tabId) {
    matching.delete(tabId);
    if (rematch.delete(tabId)) void matchRemembered(tabId);
  }
  // A top-level controller: the fixture page in fixture builds, otherwise a streaming site or a loopback test page.
  const validTop = sender => {
    const d = runtimeDocument(sender, runtime.id);
    if (!d || d.frameId !== 0) return false;
    return config.fixtureOnly === true
      ? sender.url === runtime.getURL('catalog-fixture.html')
      : STREAMING_ORIGINS.includes(d.origin) || LOOPBACK_ORIGIN.test(d.origin);
  };
  function attach(port, map, admit) {
    if (!admit(port.sender)) {
      port.disconnect();
      return;
    }
    const tabId = port.sender.tab.id;
    let ready = false;
    const waiting = new Map();
    const entry = {
      port,
      request(method, args = {}) {
        if (!ready || !admit(port.sender))
          return Promise.reject(Error('viewer-controller-unavailable'));
        const load =
          map === renderers && method === 'load'
            ? {
                releaseId: args.releaseId,
                state: 'restoring',
                bytes: 0,
                total: 0,
                error: null,
                busy: true
              }
            : null;
        if (load) {
          loads.set(tabId, load);
          if (loads.size > 64) loads.delete(loads.keys().next().value);
        }
        const work = new Promise((resolve, reject) => {
          const id = crypto.randomUUID(),
            timer = setTimeout(
              () => {
                waiting.delete(id);
                reject(Error('viewer-action-timeout'));
              },
              Object.hasOwn(LONG_REQUEST_MS, method) ? LONG_REQUEST_MS[method] : timeoutMs
            );
          waiting.set(id, { resolve, reject, timer });
          try {
            port.postMessage({ id, method, args, build: EXECUTING_BUILD });
          } catch {
            clearTimeout(timer);
            waiting.delete(id);
            reject(Error('viewer-controller-unavailable'));
          }
        });
        return work.then(
          value => {
            // E61: a finished load stays busy ("Turning the edit on…") until the caller
            // arms it or settles it, so the panel never flashes "Off · Watch with edit".
            if (load && loads.get(tabId) === load) {
              load.state = 'arming';
              load.armingSince = Date.now();
            }
            return value;
          },
          error => {
            if (load && loads.get(tabId) === load) {
              load.state = 'failed';
              load.busy = false;
              load.failedAt = Date.now();
              load.error = isViewerLoadCode(error?.message)
                ? error.message
                : 'viewer-renderer-unavailable';
            }
            throw error;
          }
        );
      }
    };
    port.onMessage.addListener(message => {
      if (!sameExecutingBuild(message?.build)) return;
      if (message.hello === true && !ready) {
        ready = true;
        map.get(tabId)?.port.disconnect();
        map.set(tabId, entry);
        void matchRemembered(tabId);
        if (map === renderers) void startIntents(tabId);
        void store
          .read()
          .then(s =>
            port.postMessage({
              method: 'preferences',
              value: s.preferences,
              build: EXECUTING_BUILD
            })
          )
          .catch(() => {});
        return;
      }
      // Download progress from a renderer (bytes only; the release id is already public to the viewer).
      if (map === renderers && map.get(tabId) === entry && ready && message.progress) {
        const p = message.progress;
        if (
          /^[a-f0-9-]{36}$/.test(p.releaseId ?? '') &&
          Number.isSafeInteger(p.bytes) &&
          p.bytes >= 0 &&
          Number.isSafeInteger(p.total) &&
          p.total >= p.bytes &&
          (LOAD_PHASES.includes(p.state) ||
            (typeof p.state === 'string' &&
              p.state.startsWith('failed:') &&
              isViewerLoadCode(p.state.slice(7))))
        ) {
          // E61: an acquisition the queue stopped (paused, cancelled or stalled and
          // retried elsewhere) no longer reports for its release.
          if (p.operation === 'acquire' && !currentAcquisition(p.releaseId, tabId)) return;
          // E60: per-step timing for an estimate ("about 12 s left") and the stall hint.
          const now = Date.now(), state = p.state.startsWith('failed:') ? 'failed' : p.state, prior = jobs.get(p.releaseId);
          const stepStartedAt = prior?.state === state && Number.isFinite(prior.stepStartedAt) ? prior.stepStartedAt : now;
          const etaMs = ['verifying', 'checking'].includes(state) && p.bytes > 0 && p.total > p.bytes
            ? Math.round((now - stepStartedAt) / p.bytes * (p.total - p.bytes)) : null;
          // A held (paused) download stays Paused while its client settles its last bytes.
          const held = prior?.state === 'paused' && activeDownload?.releaseId === p.releaseId && activeDownload.paused && !['ready', 'failed'].includes(state);
          // E91: when a download refused by the per-edit limit can be fetched again (the server's wait, bounded).
          const limitUntil = p.state === 'failed:viewer-download-limit' && Number.isSafeInteger(p.retryAfterSeconds) && p.retryAfterSeconds > 0 &&
            p.retryAfterSeconds <= 7 * 86_400 ? now + p.retryAfterSeconds * 1000 : null;
          jobs.set(p.releaseId, {
            ...downloadTelemetry(prior, p, state, now),
            ...(held ? { pausedFrom: prior.pausedFrom } : {}),
            releaseId: p.releaseId,
            bytes: p.bytes,
            total: p.total,
            state: held ? 'paused' : state,
            error: p.state.startsWith('failed:') ? p.state.slice(7) : null,
            ...(p.state.startsWith('failed:') && safeToken(p.cause) ? { cause: safeToken(p.cause) } : {}),
            ...(limitUntil !== null ? { limitUntil } : {}),
            stepStartedAt, ...(etaMs !== null ? { etaMs } : {}),
            updatedAt: now
          });
          // E93: a load that had to download the edit again (it was removed) is logged like a download.
          if (state === 'ready' && (p.operation === 'acquire' || jobs.get(p.releaseId)?.acquiredBytes > 0)) finishDownload(p.releaseId, now);
          const load = loads.get(tabId);
          if (p.operation === 'load' && load?.busy && load.releaseId === p.releaseId)
            Object.assign(load, {
              state,
              bytes: p.bytes,
              total: p.total,
              error: p.state.startsWith('failed:') ? p.state.slice(7) : null,
              limitUntil: limitUntil ?? undefined,
              etaMs, updatedAt: now
            });
          // This authenticated ready receipt is the evidence that lets an
          // exact-release status hint describe a release no packet has opened.
          if (p.state === 'ready')
            void Promise.resolve(
              store.annotate?.(p.releaseId, 'website', { downloadedAt: Date.now() })
            )
              .then(() => finishUpdate(p.releaseId))
              .catch(() => {})
              .then(() => recoverAfterReady(p.releaseId))
              .catch(() => {})
              // The finished download may be what a waiting Watch on an open
              // player needed (its library row and title link now exist).
              .then(() => {
                for (const id of controllers.keys()) void resolveIntents(id).catch(() => {});
              });
          if (jobs.size > 32) jobs.delete(jobs.keys().next().value);
        }
        return;
      }
      if (map === controllers && map.get(tabId) === entry && ready && message.status) {
        entry.identityObservation = validTop(port.sender)
          ? freshPlayerIdentityObservation(message.status.identityObservation) : null;
        paint(tabId, message.status);
        // Identity can arrive before the active player. Recheck on availability's
        // rising edge, not on every status heartbeat or on identity alone.
        const key =
          typeof message.status.sourceKey === 'string' && message.status.sourceKey.length <= 2048
            ? message.status.sourceKey
            : null;
        // A local edit reports its packet's own edit ID; the tab's loaded local edit stands for it.
        const editId =
          typeof message.status.editId === 'string' && /^[a-f0-9-]{36}$/.test(message.status.editId)
            ? message.status.editId
            : typeof message.status.editId === 'string' && message.status.editId && loadedLocal.has(tabId)
              ? loadedLocal.get(tabId)
              : null;
        const available = publicPlayback(message.status).state !== 'unavailable',
          becameAvailable = available && entry.available === false;
        entry.available = available;
        if (key && available && (lastSource.get(tabId) !== key || becameAvailable)) {
          const changed = lastSource.get(tabId) !== key,
            previous = changed ? lastEdit.get(tabId) : null;
          lastSource.set(tabId, key);
          if (changed) {
            lastEdit.delete(tabId);
            loads.delete(tabId);
          }
          void resolveIntents(tabId)
            .then(used => used || resolveLocalIntents(tabId))
            .then(used => {
              if (!used) return matchRemembered(tabId).then(() => continueEdits(tabId, previous));
            })
            .catch(() => {});
        } else if (key && editId) {
          lastEdit.set(tabId, { releaseId: editId, sourceKey: key });
          if (message.status.nearEnd === true && !prefetched.has(tabId + '|' + key)) {
            prefetched.add(tabId + '|' + key);
            if (prefetched.size > 64) prefetched.delete(prefetched.values().next().value);
            void prefetchNext(tabId).catch(() => {});
          }
        }
        return;
      }
      const w = waiting.get(message.id);
      if (!w) return;
      clearTimeout(w.timer);
      waiting.delete(message.id);
      message.ok
        ? w.resolve(message.value)
        : w.reject(
            Error(
              typeof message.code === 'string' && /^viewer-[a-z-]{1,60}$/.test(message.code)
                ? message.code
                : 'viewer-action-failed',
              { cause: safeToken(message.cause) }
            )
          );
    });
    port.onDisconnect.addListener(() => {
      if (map.get(tabId) === entry) {
        map.delete(tabId);
        if (map === controllers) paint(tabId, { state: 'unavailable' });
      }
      for (const w of waiting.values()) {
        clearTimeout(w.timer);
        w.reject(Error('viewer-controller-disconnected'));
      }
      waiting.clear();
    });
  }
  runtime.onConnect.addListener(port => {
    if (port.name === 'viewer-controller-v1') attach(port, controllers, validTop);
    if (port.name === 'viewer-renderer-v1') attach(port, renderers, authorizeRenderer);
  });

  // "Continue with edits" (off by default): on the next episode in the same tab, turn
  // on the same creator's edit, or the only one; near the end of an edited episode,
  // download that next edit so it is ready when Prime autoplays.
  const creatorOf = async releaseId => localKey(releaseId)
    ? (await store.localEdits?.().catch(() => []) ?? []).find(row => row.archiveId === localKey(releaseId))?.creatorName ?? null
    : (await store.read()).library.find(item => item.id === releaseId)?.creatorName ?? null;
  async function continueEdits(tabId, previous) {
    const c = controllers.get(tabId);
    if (!c || !previous) return;
    const data = await store.read();
    if (!data.preferences.continueEdits) return;
    const current = publicPlayback(await c.request('read'));
    if (
      current.state === 'unavailable' ||
      !current.sourceKey ||
      current.canStop ||
      data.selections[current.sourceKey]
    )
      return;
    const chosen = chooseContinuation(
      await creatorOf(previous.releaseId),
      // Local edits continue too (0.63.0): the same creator's edit of the next episode.
      await allMatches(current, data.library)
    );
    if (chosen)
      await watch(
        tabId,
        c,
        { releaseId: chosen.id, generation: current.generation },
        { allowOnline: true }
      );
  }
  async function prefetchNext(tabId) {
    const c = controllers.get(tabId),
      renderer = renderers.get(tabId);
    if (!c || !renderer || !discovery) return;
    const data = await store.read();
    if (!data.preferences.continueEdits) return;
    const current = publicPlayback(await c.request('read'));
    if (!current.editId) return;
    const next = (await discovery.discover(current)).next ?? [];
    const chosen = chooseContinuation(await creatorOf(current.editId), next);
    if (!chosen) return;
    const kept = data.library.find(item => item.id === chosen.releaseId && item.downloadedAt);
    const chosenState = jobs.get(chosen.releaseId)?.state;
    if (kept || isActiveLoadPhase(chosenState) || chosenState === 'ready' || chosenState === 'paused') return;
    // E61: the next episode waits in the same queue as every other download.
    if (chosen.name) learnRelease(chosen.releaseId, { name: chosen.name, titleName: chosen.titleName, episodeName: chosen.episodeName, sourceKey: chosen.sourceKey, streamingUrl: chosen.streamingUrl });
    enqueue(chosen.releaseId, { tabId });
    pump();
  }
  async function matchRemembered(tabId) {
    if (matching.has(tabId)) {
      rematch.add(tabId);
      return;
    }
    const c = controllers.get(tabId),
      renderer = renderers.get(tabId);
    if (!c || !renderer) return;
    matching.add(tabId);
    let ownsMatch = true;
    try {
      const s = publicPlayback(await c.request('read')),
        data = await store.read(),
        selection = data.selections[s.sourceKey];
      if (
        s.state === 'unavailable' ||
        !s.sourceKey ||
        !data.preferences.autoArm ||
        !selection ||
        selection.disabled ||
        (s.canStop && !s.canArm)
      )
        return;
      const fresh = publicPlayback(await c.request('read'));
      if (
        fresh.state === 'unavailable' ||
        fresh.sourceKey !== s.sourceKey ||
        fresh.generation !== s.generation ||
        controllers.get(tabId) !== c ||
        renderers.get(tabId) !== renderer
      )
        return;
      if (selection.id.startsWith('local:')) {
        matching.delete(tabId);
        ownsMatch = false;
        await watch(tabId, c, { releaseId: selection.id, generation: s.generation }).catch(
          () => {}
        );
        return;
      }
      const item = data.library.find(
        x => x.id === selection.id && x.version === selection.version && x.transport === 'protected'
      );
      if (!item) return;
      let current = fresh;
      if (!fresh.editId) {
        await renderer.request('load', { releaseId: item.id, online: false, combined: false });
        current = publicPlayback(await c.request('read'));
      }
      const latest = await store.read();
      if (
        !latest.preferences.autoArm ||
        latest.selections[s.sourceKey]?.disabled ||
        JSON.stringify(latest.selections[s.sourceKey]) !== JSON.stringify(selection) ||
        controllers.get(tabId) !== c
      )
        return;
      current = publicPlayback(await c.request('read'));
      if (
        current.state === 'unavailable' ||
        current.sourceKey !== s.sourceKey ||
        current.editId !== selection.id ||
        current.version !== selection.version ||
        !current.canArm ||
        controllers.get(tabId) !== c ||
        renderers.get(tabId) !== renderer
      )
        return;
      await c.request('arm', { generation: current.generation });
    } catch {
      /* Normal surface retains actionable state; a remembered choice grants no authority. */
    } finally {
      settleLoad(tabId);
      if (ownsMatch) finishMatching(tabId);
    }
  }

  // One step from "which edit" to "enabled": choose (the only match, or the one asked
  // for), stop a different loaded edit first (native is restored), load, then arm.
  async function watch(target, controller, a, { allowOnline = false } = {}) {
    // The automatic remembered-edit check may be running for this tab; let it finish.
    for (let i = 0; i < 40 && matching.has(target); i += 1)
      await new Promise(r => setTimeout(r, 50));
    if (matching.has(target)) throw Error('viewer-busy');
    matching.add(target);
    try {
      await controller.request('recheck', { generation: a.generation });
      let current = publicPlayback(await controller.request('read'));
      const data = await store.read(),
        matches = await (allowOnline ? allMatches : keptMatches)(
          current,
          data.library,
          data.selections
        );
      const chosen = a.releaseId
        ? matches.find(x => x.id === a.releaseId)
        : matches.length === 1
          ? matches[0]
          : null;
      if (!chosen) {
        if (a.releaseId) throw Error('viewer-edit-not-matched');
        clearFailedLoad(target);
        return {
          matches,
          message: matches.length
            ? 'Choose a downloaded edit to watch.'
            : 'No downloaded edit for this episode. Find one on the website to download it.'
        };
      }
      if (
        chosen.transport &&
        chosen.transport !== 'protected' &&
        chosen.availability === 'reimport-required'
      )
        throw Error('viewer-reimport-required');
      if (current.editId && current.editId !== chosen.id && current.canStop) {
        await controller.request('stop', { generation: current.generation });
        current = publicPlayback(await controller.request('read'));
      }
      if (chosen.local || current.editId !== chosen.id) {
        const privateRenderer = renderers.get(target);
        if (!privateRenderer) throw Error('viewer-load-unavailable');
        await tabs.update(target, { active: true });
        if (chosen.local) {
          await privateRenderer.request('load-local', { archiveId: chosen.archiveId });
          loadedLocal.set(target, chosen.id);
        } else {
          loadedLocal.delete(target);
          await privateRenderer.request('load', {
            releaseId: chosen.id,
            online: !chosen.downloaded,
            combined: false
          });
        }
      }
      let ready = null;
      for (let i = 0; i < 30 && !ready; i += 1) {
        const s = publicPlayback(await controller.request('read'));
        if (
          s.canArm ||
          (s.editId &&
            (s.editId === chosen.id || chosen.local) &&
            s.canStop &&
            !s.canArm &&
            ['armed', 'active', 'finished'].includes(s.state))
        )
          ready = s;
        else await new Promise(r => setTimeout(r, 100));
      }
      if (!ready) throw Error('viewer-action-failed');
      if (ready.canArm) await controller.request('arm', { generation: ready.generation });
      if (ready.sourceKey)
        await store.remember(ready.sourceKey, chosen.id, false, chosen.version ?? ready.version);
      if (chosen.local) {
        await store.updateLocalEdit?.(chosen.archiveId, { lastWatchedAt: Date.now() }).catch(() => {});
        return { matches, message: 'Edit on. Scenes switch as you watch.' };
      }
      // Keep the website's description of this edit for the Edits page.
      await store
        .annotate?.(chosen.id, 'website', {
          editId: chosen.editId,
          name: chosen.name,
          creatorName: chosen.creatorName,
          streamingUrl: chosen.streamingUrl,
          titleName: chosen.titleName,
          lastWatchedAt: Date.now()
        })
        .catch(() => {});
      return { matches, message: 'Edit on. Scenes switch as you watch.' };
    } finally {
      settleLoad(target);
      finishMatching(target);
    }
  }
  // "Watch this edit": fetch every pending intent as soon as any player tab's
  // renderer exists (before play), and enable one when its episode is open.
  const intentKey = intent => intent.attemptId ?? intent.createdAt;
  // A website Watch also resolves against already-open players. Keep that
  // switch behind its acquisition: Stop/load closes the current protected owner,
  // which may be the same owner performing this download.
  const acquisitions = new Map();
  // An intent chooses one matching player, including when several tabs resolve
  // it together. Keep a failed attempt on that player until it disconnects or
  // the user creates a new intent; another tab must not steal the same attempt.
  const intentClaims = new Map();
  // Definitive server refusals end an attempt; a new explicit Watch may retry.
  const refusalCodes = new Set(['viewer-release-unavailable', 'viewer-access-refused']);
  const refusedAttempts = new Set();
  const refusalKey = intent => `${intent.releaseId}|${intentKey(intent)}`;
  // 0.63.2: a paused Watch waits for Resume and a failed one for Retry; neither starts by itself.
  const pendingIntent = intent =>
    intent.failureCode !== 'viewer-release-unavailable' && !refusedAttempts.has(refusalKey(intent)) && !intent.paused && !Number.isSafeInteger(intent.failedAt);
  const readIntents = () => Promise.resolve(store.intents?.() ?? []).catch(() => []);
  const currentIntent = async intent =>
    (await readIntents()).some(
      x =>
        x.releaseId === intent.releaseId && intentKey(x) === intentKey(intent) && pendingIntent(x)
    );
  async function recordIntentFailure(intent, error, { preserveReady = false } = {}) {
    const job = jobs.get(intent.releaseId);
    // A refusal recorded on the job only counts when that job belongs to this
    // attempt or a later one: an older refused job must not fence a new Watch
    // that failed for a transient reason before its own download started.
    const jobRefused =
      refusalCodes.has(job?.error) &&
      Number.isFinite(job?.updatedAt) &&
      Number.isFinite(intent.createdAt) &&
      job.updatedAt >= intent.createdAt;
    if (
      (preserveReady && job?.state === 'ready') ||
      (!refusalCodes.has(error?.message) && !jobRefused)
    )
      return;
    // Only the fixed descriptor-refusal code is terminal. Connectivity, timeouts,
    // pairing failures and owner contention retain their existing retry behavior.
    refusedAttempts.add(refusalKey(intent));
    if (refusedAttempts.size > 32) refusedAttempts.delete(refusedAttempts.values().next().value);
    // If persistence is unavailable, retain a session-local fence. It cannot
    // promise restart persistence, but it must not create an unhandled rejection.
    const saved = await Promise.resolve()
      .then(() => store.failIntent?.(intent.releaseId, intentKey(intent)))
      .catch(() => undefined);
    if (saved === false) return;
    if (jobs.get(intent.releaseId) !== job) return;
    jobs.set(intent.releaseId, {
      releaseId: intent.releaseId,
      bytes: job?.bytes ?? 0,
      total: job?.total ?? 0,
      state: 'failed',
      error: refusalCodes.has(error?.message)
        ? error.message
        : jobRefused
          ? job.error
          : 'viewer-release-unavailable',
      updatedAt: Date.now()
    });
  }
  // E61 (0.62.20): one explicit download queue. The protected owner is a single lock,
  // so downloads run one at a time in the order they were asked for; the others wait
  // with their position ("Waiting for <name> to finish (1 ahead)"). Running two at
  // once would only make them contend for that lock ("opening" for minutes).
  const DOWNLOAD = Object.freeze({ stallMs: 20_000, tickMs: 2_000, retryBaseMs: 2_000, retryLimit: 3, staleMs: 12 * 3_600_000, ...downloadTiming });
  // 0.63.2 (seen in testing: a queued download waited overnight and restarted the next day): a Watch that is not
  // downloading leaves the queue after 12 hours, and queued or failed ones also at a browser
  // restart. A Watch the user paused survives a restart within the 12 hours (Resume only).
  // Dropped ones are listed as "Previously queued: <name> · Download again", never resumed.
  async function expireStale({ restart = false } = {}) {
    if (!store.expireIntents) return [];
    const now = Date.now(), active = activeDownload?.releaseId;
    const moved = await Promise.resolve(store.expireIntents(x => x.releaseId !== active &&
      (now - (x.createdAt ?? now) >= DOWNLOAD.staleMs || (restart && !x.paused)), now)).catch(() => []);
    for (const releaseId of moved ?? []) {
      if (activeDownload?.releaseId === releaseId) continue;
      jobs.delete(releaseId);
      for (let i = downloadQueue.length - 1; i >= 0; i -= 1) if (downloadQueue[i].releaseId === releaseId) downloadQueue.splice(i, 1);
    }
    return moved ?? [];
  }
  runtime.onStartup?.addListener(() => void expireStale({ restart: true }));
  const downloadQueue = []; // { releaseId, tabId, intent, avoidTab, notBefore }
  let activeDownload = null, watchdog = null, pumpTimer = null;
  const releaseInfo = new Map(), downloadLog = [];
  const text = (value, max = 200) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
  /** Names for a release before its library row exists: the website's exact-release hint. */
  function learnRelease(releaseId, hint) {
    if (hint) {
      const info = { name: text(hint.name), titleName: text(hint.titleName), episodeName: text(hint.episodeName),
        sourceKey: text(hint.sourceKey, 2048), streamingUrl: text(hint.streamingUrl, 2048) };
      if (Object.values(info).some(Boolean)) {
        releaseInfo.set(releaseId, { ...releaseInfo.get(releaseId), ...Object.fromEntries(Object.entries(info).filter(([, v]) => v)), failed: false });
        if (releaseInfo.size > 64) releaseInfo.delete(releaseInfo.keys().next().value);
        if (info.name) void Promise.resolve(store.rememberRelease?.(releaseId, releaseInfo.get(releaseId))).catch(() => {});
      }
      return Promise.resolve(releaseInfo.get(releaseId) ?? null);
    }
    // At most one status request per release a minute (a failed one is asked again later).
    const known = releaseInfo.get(releaseId);
    // A failed request (offline) is asked again after 10 s, an answer without a name after a minute.
    if (known?.name || Date.now() - (known?.askedAt ?? -Infinity) < (known?.failed ? 10_000 : 60_000) || !discovery?.checkReleases) return Promise.resolve(known ?? null);
    releaseInfo.set(releaseId, { ...known, askedAt: Date.now() });
    if (releaseInfo.size > 64) releaseInfo.delete(releaseInfo.keys().next().value);
    return Promise.resolve()
      .then(() => discovery.checkReleases([releaseId]))
      .then(items => {
        const item = (items ?? []).find(x => x.releaseId === releaseId);
        return learnRelease(releaseId, item?.display ? item.display : item?.streamingUrl ? { streamingUrl: item.streamingUrl } : null);
      })
      .catch(() => { releaseInfo.set(releaseId, { ...releaseInfo.get(releaseId), failed: true }); return null; });
  }
  function infoFor(releaseId, library = []) {
    const item = library.find(x => x.id === releaseId && x.origin === 'website') ?? {}, hint = releaseInfo.get(releaseId) ?? {};
    const pick = key => text(item[key], key.endsWith('Url') || key === 'sourceKey' ? 2048 : 200) ?? hint[key] ?? null;
    return { name: pick('name') ?? text(item.title), titleName: pick('titleName'), episodeName: pick('episodeName'), sourceKey: pick('sourceKey'), streamingUrl: pick('streamingUrl') };
  }
  // Whether progress from this renderer belongs to the release's current acquisition.
  function currentAcquisition(releaseId, tabId) {
    if (activeDownload?.releaseId === releaseId) return activeDownload.tabId === tabId;
    const state = jobs.get(releaseId)?.state;
    return !(state === 'paused' || state === 'queued' || jobs.get(releaseId)?.error === 'viewer-download-cancelled');
  }
  // Throughput, retries and stalls per download (Copy diagnostics, the Library's rate).
  // E93 (0.66.1): progress that starts after the release's last acquisition ended (no job, or one
  // that was ready or failed, as when a removed edit is loaded and so downloaded again) is a new
  // acquisition: its rate, start and transfer counts begin again. Keeping the first download's
  // rateFrom divided the new bytes by the time since that first download (253 B/s for ~48 KB/s).
  const ACQUISITION_KEYS = ['startedAt', 'rateFrom', 'bytesPerSecond', 'transferRetries', 'lastRetryCode', 'acquiredBytes'];
  function downloadTelemetry(prior, p, state, now) {
    const fresh = isActiveLoadPhase(state) && (!prior || (!isActiveLoadPhase(prior.state) && prior.state !== 'paused'));
    const keep = prior ? Object.fromEntries(Object.entries(prior).filter(([key]) =>
      ['attempts', 'autoRetries', 'stalls', 'stall', 'queuedAt', ...ACQUISITION_KEYS].includes(key) && !(fresh && ACQUISITION_KEYS.includes(key)))) : {};
    const moved = !prior || prior.state !== state || prior.bytes !== p.bytes;
    const out = { ...keep, lastProgressAt: moved || !Number.isFinite(prior?.lastProgressAt) ? now : prior.lastProgressAt };
    if (fresh) out.startedAt = now;
    if (state === 'downloading') {
      // The bytes this acquisition actually fetched (a load of a kept edit fetches none).
      if (p.total > 0 && p.bytes > 0) out.acquiredBytes = p.total;
      out.rateFrom ??= { at: now, bytes: p.bytes };
      const seconds = (now - out.rateFrom.at) / 1000;
      if (seconds >= 1 && p.bytes > out.rateFrom.bytes) out.bytesPerSecond = Math.round((p.bytes - out.rateFrom.bytes) / seconds);
    }
    const r = p.retry;
    if (r && Number.isSafeInteger(r.attempt) && r.attempt > 0 && r.attempt <= 16 && Number.isSafeInteger(r.delayMs) && r.delayMs >= 0 && r.delayMs <= 60_000) {
      out.transferRetries = (keep.transferRetries ?? 0) + 1;
      out.lastRetryCode = safeToken(r.code) ?? 'unknown';
      // A reported reconnect wait is not a stall.
      out.lastProgressAt = now + r.delayMs;
    }
    return out;
  }
  function finishDownload(releaseId, now = Date.now()) {
    const job = jobs.get(releaseId);
    if (!job) return;
    const ms = Number.isFinite(job.startedAt) ? now - job.startedAt : null;
    downloadLog.push({ at: now, release: String(releaseId).slice(0, 8), bytes: job.total || job.acquiredBytes || null, ms,
      bytesPerSecond: job.bytesPerSecond ?? null, attempts: job.attempts ?? 1, stalls: job.stalls ?? 0,
      autoRetries: job.autoRetries ?? 0, transferRetries: job.transferRetries ?? 0 });
    if (downloadLog.length > 20) downloadLog.shift();
    void Promise.resolve(store.downloadLog?.({ stats: [downloadLog.at(-1)] })).catch(() => {});
  }
  const counts = job => Object.fromEntries(Object.entries(job ?? {}).filter(([key]) =>
    ['attempts', 'autoRetries', 'stalls', 'stall', 'transferRetries', 'lastRetryCode', 'queuedAt'].includes(key)));
  /** Puts a release in the queue (once). False when it is already queued, running, paused or ready. */
  function enqueue(releaseId, { tabId = null, intent = null } = {}) {
    const prior = jobs.get(releaseId), state = prior?.state;
    if (state === 'ready' || state === 'paused' || isActiveLoadPhase(state) || activeDownload?.releaseId === releaseId) return false;
    const now = Date.now();
    jobs.set(releaseId, { ...counts(prior), releaseId, bytes: 0, total: 0, state: 'queued', error: null, queuedAt: now, updatedAt: now });
    if (!downloadQueue.some(entry => entry.releaseId === releaseId)) downloadQueue.push({ releaseId, tabId, intent });
    return true;
  }
  function pickRenderer(entry) {
    const usable = [...renderers].filter(([id]) => id !== entry.avoidTab);
    return usable.find(([id]) => id === entry.tabId) ?? usable[0] ?? (renderers.has(entry.tabId) ? [entry.tabId, renderers.get(entry.tabId)] : [...renderers][0]) ?? null;
  }
  function pump() {
    if (activeDownload) return;
    for (let i = downloadQueue.length - 1; i >= 0; i -= 1)
      if (!['queued', 'paused'].includes(jobs.get(downloadQueue[i].releaseId)?.state)) downloadQueue.splice(i, 1);
    const now = Date.now(), waiting = downloadQueue.filter(entry => jobs.get(entry.releaseId)?.state === 'queued');
    const entry = waiting.find(x => !(x.notBefore > now));
    if (!entry) {
      const next = Math.min(...waiting.map(x => x.notBefore).filter(Number.isFinite));
      if (Number.isFinite(next) && !pumpTimer) pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, Math.max(0, next - now));
      return;
    }
    const chosen = pickRenderer(entry);
    if (!chosen) return;
    downloadQueue.splice(downloadQueue.indexOf(entry), 1);
    runDownload(entry, ...chosen);
  }
  function runDownload(entry, tabId, renderer) {
    const { releaseId, intent } = entry, prior = jobs.get(releaseId), now = Date.now();
    jobs.set(releaseId, { ...counts(prior), releaseId, bytes: 0, total: 0, state: 'requesting', error: null,
      attempts: (prior?.attempts ?? 0) + 1, startedAt: now, lastProgressAt: now, updatedAt: now,
      ...(intent ? { intentAttempt: intentKey(intent) } : {}) });
    const acquisition = renderer.request('acquire', { releaseId });
    const run = { releaseId, tabId, renderer, acquisition, intent, entry, stopped: null };
    activeDownload = run;
    acquisitions.set(releaseId, acquisition);
    watchdog ??= setInterval(checkStall, DOWNLOAD.tickMs);
    acquisition
      .catch(async error => {
        if (run.stopped) return;
        if (activeDownload === run) activeDownload = null;
        const job = jobs.get(releaseId);
        // A closed tab or another tab's owner: try again on another player, a few times.
        if (job && isActiveLoadPhase(job.state) && ['viewer-controller-disconnected', 'viewer-owner-busy'].includes(error?.message) &&
            (job.autoRetries ?? 0) < DOWNLOAD.retryLimit && [...renderers.keys()].some(id => id !== tabId)) {
          jobs.set(releaseId, { ...job, state: 'queued', autoRetries: (job.autoRetries ?? 0) + 1, lastRetryCode: error.message, updatedAt: Date.now() });
          downloadQueue.unshift({ ...entry, avoidTab: tabId, notBefore: 0 });
          return;
        }
        // A renderer can reject before it emits progress (or disconnect). End that
        // job so the website reports failure and a later Watch can retry it. Keep
        // a more specific progress failure, or a ready receipt, if one arrived first.
        if (job && isActiveLoadPhase(job.state))
          jobs.set(releaseId, {
            ...job,
            state: 'failed',
            error: /^viewer-[a-z-]{1,60}$/.test(error?.message ?? '')
              ? error.message
              : 'viewer-action-failed',
            ...(safeToken(error?.cause) ? { cause: safeToken(error.cause) } : {}),
            updatedAt: Date.now()
          });
        // A failed download waits for Retry or a new Watch; it never restarts by itself.
        if (jobs.get(releaseId)?.state === 'failed')
          await Promise.resolve(store.markIntent?.(releaseId, { failedAt: Date.now(), failedCode: jobs.get(releaseId).error })).catch(() => {});
        if (!intent) return;
        await recordIntentFailure(intent, error, { preserveReady: true });
        // A fresh Watch may have arrived while this release's request was in flight.
        // It was coalesced then; after failure it gets a distinct attempt now.
        const newer = (await readIntents()).find(
          x => x.releaseId === releaseId && intentKey(x) !== intentKey(intent) && pendingIntent(x)
        );
        if (newer && jobs.get(releaseId)?.state === 'failed' && renderers.has(tabId)) void startIntents(tabId);
      })
      .finally(() => {
        if (acquisitions.get(releaseId) === acquisition) acquisitions.delete(releaseId);
        if (activeDownload === run) activeDownload = null;
        pump();
      });
  }
  // No progress for stallMs (a frozen background tab, a dead connection): stop it and
  // retry with backoff, preferring another player tab, then report "Download stalled".
  function checkStall(now = Date.now()) {
    const run = activeDownload;
    if (!run) { clearInterval(watchdog); watchdog = null; return; }
    const job = jobs.get(run.releaseId);
    if (!job || !isActiveLoadPhase(job.state)) return;
    // 0.63.3: the after-download clip checks are local work (a large clip can take a while), not a stalled transfer.
    if (['verifying', 'checking'].includes(job.state)) return;
    if (now - (job.lastProgressAt ?? now) < DOWNLOAD.stallMs) return;
    stopActive('stall', now);
  }
  function stopActive(reason, now = Date.now()) {
    const run = activeDownload;
    if (!run) return;
    run.stopped = reason;
    activeDownload = null;
    void Promise.resolve().then(() => run.renderer.request('cancel', { releaseId: run.releaseId })).catch(() => {});
    if (acquisitions.get(run.releaseId) === run.acquisition) acquisitions.delete(run.releaseId);
    const job = jobs.get(run.releaseId);
    if (reason === 'stall' && job) {
      logStall(job, 'download-stalled');
      const stalls = (job.stalls ?? 0) + 1, autoRetries = job.autoRetries ?? 0;
      if (autoRetries < DOWNLOAD.retryLimit) {
        const delay = DOWNLOAD.retryBaseMs * 2 ** autoRetries;
        jobs.set(run.releaseId, { ...job, state: 'queued', stalled: true, stalls, autoRetries: autoRetries + 1, retryAt: now + delay, updatedAt: now });
        downloadQueue.unshift({ ...run.entry, avoidTab: run.tabId, notBefore: now + delay });
      } else {
        jobs.set(run.releaseId, { ...job, state: 'failed', error: 'viewer-download-stalled', stalled: true, stalls, updatedAt: now });
        void Promise.resolve(store.markIntent?.(run.releaseId, { failedAt: now, failedCode: 'viewer-download-stalled' })).catch(() => {});
      }
    }
    if (reason === 'pause' && !downloadQueue.some(entry => entry.releaseId === run.releaseId)) downloadQueue.unshift({ ...run.entry, notBefore: 0 });
    pump();
  }
  /** Pause, Resume, Cancel or Retry one download (Library, popup and player menu). */
  async function controlDownload(action, releaseId) {
    // 0.63.2: Clear removes a failed download's row (and its Watch); Clear all, every failed one.
    if (action === 'clear-all') {
      const failed = [...jobs.values()].filter(j => j.state === 'failed').map(j => j.releaseId);
      for (const id of failed) { jobs.delete(id); await Promise.resolve(store.consumeIntent?.(id)).catch(() => {}); }
      return { message: failed.length ? `Cleared ${failed.length} failed download${failed.length === 1 ? '' : 's'}.` : 'Nothing to clear.', cleared: failed.length };
    }
    if (!/^[a-f0-9-]{36}$/.test(releaseId ?? '') || !['pause', 'resume', 'cancel', 'retry', 'clear'].includes(action)) throw Error('viewer-release-invalid');
    if (action === 'clear') {
      if (jobs.get(releaseId)?.state !== 'failed') throw Error('viewer-download-unavailable');
      jobs.delete(releaseId);
      await Promise.resolve(store.consumeIntent?.(releaseId)).catch(() => {});
      return { message: 'Cleared.', cleared: 1 };
    }
    const mark = paused => Promise.resolve(store.markIntent?.(releaseId, { paused })).catch(() => {});
    const job = jobs.get(releaseId), now = Date.now(), active = activeDownload?.releaseId === releaseId;
    if (action === 'pause') {
      if (!job || !(active || job.state === 'queued') || job.state === 'paused') throw Error('viewer-download-unavailable');
      // 0.62.21: the renderer holds a running download (its finished files and its place in
      // the queue) instead of abandoning it; Resume continues it. Restarting from 0
      // re-requested every file and crossed the server's read quota.
      const run = activeDownload;
      if (active) {
        const held = await Promise.resolve().then(() => run.renderer.request('pause', { releaseId })).then(() => true, () => false);
        if (held && activeDownload === run) {
          run.paused = true;
          jobs.set(releaseId, { ...jobs.get(releaseId), state: 'paused', pausedFrom: jobs.get(releaseId)?.state ?? job.state, stalled: false, retryAt: null, updatedAt: now });
          await mark(true);
          return { message: 'Download paused.', job: jobs.get(releaseId) };
        }
      }
      jobs.set(releaseId, { ...job, state: 'paused', stalled: false, retryAt: null, updatedAt: now });
      if (active && activeDownload === run) stopActive('pause', now);
      await mark(true);
      return { message: 'Download paused.', job: jobs.get(releaseId) };
    }
    if (action === 'resume') {
      if (job?.state !== 'paused') throw Error('viewer-download-unavailable');
      const run = activeDownload;
      if (active && run.paused) {
        const resumed = await Promise.resolve().then(() => run.renderer.request('resume', { releaseId })).then(() => true, () => false);
        if (resumed && activeDownload === run) {
          run.paused = false;
          const current = jobs.get(releaseId);
          jobs.set(releaseId, { ...current, state: isActiveLoadPhase(current.pausedFrom) ? current.pausedFrom : 'downloading', pausedFrom: null, lastProgressAt: Date.now(), updatedAt: Date.now() });
          await mark(false);
          return { message: 'Download resumed.', job: jobs.get(releaseId) };
        }
        if (activeDownload === run) stopActive('pause', now);
      }
      // A download that was not held (its tab closed meanwhile) starts again.
      jobs.set(releaseId, { ...jobs.get(releaseId), state: 'queued', autoRetries: 0, updatedAt: now });
      const entry = downloadQueue.find(x => x.releaseId === releaseId);
      if (entry) Object.assign(entry, { notBefore: 0, avoidTab: undefined });
      else downloadQueue.unshift({ releaseId, tabId: null, intent: null });
      await mark(false);
      pump();
      return { message: 'Download resumed.', job: jobs.get(releaseId) };
    }
    if (action === 'cancel') {
      if (!job || job.state === 'ready') throw Error('viewer-download-unavailable');
      jobs.set(releaseId, { ...job, state: 'failed', error: 'viewer-download-cancelled', stalled: false, retryAt: null, updatedAt: now });
      for (let i = downloadQueue.length - 1; i >= 0; i -= 1) if (downloadQueue[i].releaseId === releaseId) downloadQueue.splice(i, 1);
      // The Watch that asked for it is withdrawn too, so no player starts it again.
      await Promise.resolve(store.consumeIntent?.(releaseId)).catch(() => {});
      if (active) stopActive('cancel', now);
      else pump();
      return { message: 'Download cancelled.', job: jobs.get(releaseId) };
    }
    // Retry: now, instead of after the backoff; or a new attempt for a failed one.
    if (job?.state === 'paused') return controlDownload('resume', releaseId);
    if (job?.state === 'queued') {
      const entry = downloadQueue.find(x => x.releaseId === releaseId);
      if (entry) entry.notBefore = 0;
      jobs.set(releaseId, { ...job, retryAt: null, updatedAt: now });
      pump();
      return { message: 'Retrying the download…', job: jobs.get(releaseId) };
    }
    if (job && job.state !== 'failed' && job.state !== 'paused') throw Error('viewer-download-unavailable');
    if (job) jobs.set(releaseId, { ...job, state: 'failed', autoRetries: 0, stalled: false, error: job.error ?? 'viewer-action-failed', updatedAt: now });
    if (job?.state === 'paused') return controlDownload('resume', releaseId);
    await recordIntent(releaseId);
    return { message: 'Retrying the download…', job: jobs.get(releaseId) };
  }
  // A download as surfaces show it: names, and its place in the queue.
  function describeJob(job, library = []) {
    if (!job) return job;
    // Names are asked for (once per release) only while a surface shows an unfinished download.
    if (job.state !== 'ready' && !library.some(x => x.id === job.releaseId && x.origin === 'website' && x.name)) void learnRelease(job.releaseId);
    const info = infoFor(job.releaseId, library), out = { ...job, download: true, name: info.name, titleName: info.titleName, episodeName: info.episodeName };
    delete out.rateFrom;
    if (job.state === 'queued') {
      const waiting = downloadQueue.filter(entry => jobs.get(entry.releaseId)?.state === 'queued');
      const index = waiting.findIndex(entry => entry.releaseId === job.releaseId);
      out.ahead = Math.max(0, index) + (activeDownload ? 1 : 0);
      const running = activeDownload ? activeDownload.releaseId : index > 0 ? waiting[0].releaseId : null;
      if (running) out.waitingFor = `${downloadName(infoFor(running, library)) || 'another edit'}${activeDownload?.paused ? ' (paused)' : ''}`;
    }
    return out;
  }
  // The download for the episode a player shows, so its panel never says "No downloaded
  // edit" while that edit is queued, downloading, paused or has just failed.
  function episodeDownload(playback, library, now = Date.now()) {
    const live = sourceIdentity(playback?.sourceKey ?? '')?.contentId ?? null;
    if (!live) return null;
    const candidates = [...jobs.values()].filter(job => {
      if (job.error === 'viewer-download-cancelled') return false;
      if (!(isActiveLoadPhase(job.state) || job.state === 'paused' || (job.state === 'failed' && now - (job.updatedAt ?? 0) < 120_000))) return false;
      return sourceIdentity(infoFor(job.releaseId, library).sourceKey ?? '')?.contentId === live;
    });
    const job = candidates.find(x => x.state !== 'failed') ?? candidates.at(-1);
    if (!job) return null;
    const described = describeJob(job, library);
    return job.state === 'failed' ? { ...described, busy: false, failedAt: job.updatedAt } : { ...described, busy: true };
  }
  // E61: a load waiting to be armed ends when the edit is on, the caller settles it, or after 5 s.
  function settleLoad(tabId, playback = null) {
    const load = loads.get(tabId);
    if (load?.state !== 'arming') return;
    if (playback && !['armed', 'active', 'paused'].includes(playback.state) && Date.now() - (load.armingSince ?? 0) < 5_000) return;
    load.state = 'ready';
    load.busy = false;
  }
  async function startIntents(tabId) {
    const renderer = renderers.get(tabId);
    if (!renderer) return;
    await expireStale();
    for (const intent of await readIntents()) {
      const { releaseId } = intent;
      // A paused or failed Watch is shown as such (after a service restart too), never started.
      if (intent.paused || Number.isSafeInteger(intent.failedAt)) {
        if (!jobs.has(releaseId))
          jobs.set(releaseId, intent.paused
            ? { releaseId, bytes: 0, total: 0, state: 'paused', error: null, updatedAt: Date.now() }
            : { releaseId, bytes: 0, total: 0, state: 'failed', error: intent.failedCode ?? 'viewer-download-interrupted', updatedAt: intent.failedAt });
        continue;
      }
      if (!pendingIntent(intent)) {
        if (!jobs.has(releaseId))
          jobs.set(releaseId, {
            releaseId,
            bytes: 0,
            total: 0,
            state: 'failed',
            error: 'viewer-release-unavailable',
            updatedAt: Date.now()
          });
        continue;
      }
      if (!(await currentIntent(intent)) || renderers.get(tabId) !== renderer) continue;
      // The Watch whose download just failed is not restarted while its failure is being recorded.
      const prior = jobs.get(releaseId);
      if (prior?.state === 'failed' && prior.intentAttempt !== undefined && prior.intentAttempt === intentKey(intent)) continue;
      enqueue(releaseId, { tabId, intent });
    }
    pump();
  }
  async function resolveIntents(tabId) {
    const controller = controllers.get(tabId);
    if (!controller) return false;
    const pending = (await readIntents()).filter(pendingIntent);
    for (const [key, claim] of intentClaims) {
      if (!claim.busy && !pending.some(intent => refusalKey(intent) === key))
        intentClaims.delete(key);
    }
    if (!pending.length) return false;
    const current = publicPlayback(await controller.request('read').catch(() => ({})));
    if (current.state === 'unavailable' || !current.sourceKey) return false;
    const data = await store.read(),
      matches = await allMatches(current, data.library).catch(() => []);
    let intent = [...pending].reverse().find(x => matches.some(m => m.id === x.releaseId)),
      unmatched = false;
    if (!intent) {
      intent = await unmatchedIntent(tabId, controller, current, pending);
      if (!intent) return false;
      unmatched = true;
    }
    // E61: a Watch whose download is still waiting in the queue turns on when it is
    // ready (the ready receipt resolves intents again), not by a second online load.
    if (['queued', 'paused'].includes(jobs.get(intent.releaseId)?.state)) return false;
    const acquisition = acquisitions.get(intent.releaseId);
    if (acquisition) {
      try {
        await acquisition;
      } catch {
        return false;
      }
    }
    if (controllers.get(tabId) !== controller) return false;
    const key = refusalKey(intent),
      previous = intentClaims.get(key);
    if (
      previous?.busy ||
      (previous &&
        controllers.get(previous.tabId) === previous.controller &&
        previous.controller !== controller)
    )
      return true;
    const claim = { tabId, controller, busy: true };
    intentClaims.set(key, claim);
    try {
      // Claim before this asynchronous recheck. A delayed contender may have
      // read the intent before its winner consumed it; it must not load again.
      if (!(await currentIntent(intent))) return true;
      if (unmatched) {
        unmatchedTried.add(unmatchedKey(intent, tabId, current.sourceKey));
        if (unmatchedTried.size > 64) unmatchedTried.delete(unmatchedTried.values().next().value);
        await openUnmatched(tabId, controller, intent.releaseId, current.generation);
      } else
        await watch(
          tabId,
          controller,
          { releaseId: intent.releaseId, generation: current.generation },
          { allowOnline: true }
        );
      await store.consumeIntent(intent.releaseId, intentKey(intent));
      return true;
    } catch (error) {
      await recordIntentFailure(intent, error);
      return false;
    } finally {
      claim.busy = false;
    }
  }
  // E51: a Watch whose download is kept but matches nothing here. The website
  // opened this page for that edit (the page names the same Prime title as the
  // edit's own link or recorded source), yet the recorded identity and the
  // player's disagree, so "No downloaded edit" would be the only answer. Open
  // the kept edit and let the player's own source check decide: either it turns
  // on, or the Problem view says why (e.g. Prime now uses another title ID).
  // One attempt per Watch, tab and episode; the check itself is never relaxed.
  const unmatchedTried = new Set();
  const unmatchedKey = (intent, tabId, sourceKey) => `${refusalKey(intent)}|${tabId}|${sourceKey}`;
  async function pageTitleId(tabId, controller) {
    const url = await Promise.resolve()
      .then(() => tabs.get?.(tabId))
      .then(tab => tab?.url, () => null);
    return primeTitleId(url) ?? primeTitleId(controller.port.sender?.url);
  }
  async function unmatchedIntent(tabId, controller, current, pending) {
    if (!renderers.get(tabId)) return null;
    const candidates = [...pending]
      .reverse()
      .filter(x => !unmatchedTried.has(unmatchedKey(x, tabId, current.sourceKey)));
    if (!candidates.length) return null;
    const page = await pageTitleId(tabId, controller);
    if (!page) return null;
    for (const intent of candidates) {
      // A download still running is skipped: its ready receipt (after the
      // metadata request that names its title) runs this again.
      const job = jobs.get(intent.releaseId);
      if (isActiveLoadPhase(job?.state)) continue;
      const row = (await store.read()).library.find(
        x => x.id === intent.releaseId && x.origin === 'website' && x.transport === 'protected'
      );
      const kept = job?.state === 'ready' || row?.availability === 'downloaded';
      const named = [primeTitleId(row?.streamingUrl), sourceIdentity(row?.sourceKey ?? '')?.contentId];
      if (kept && row && named.some(id => id && id.toLowerCase() === page.toLowerCase())) return intent;
    }
    return null;
  }
  async function openUnmatched(target, controller, releaseId, generation) {
    for (let i = 0; i < 40 && matching.has(target); i += 1)
      await new Promise(r => setTimeout(r, 50));
    if (matching.has(target)) throw Error('viewer-busy');
    matching.add(target);
    try {
      let current = publicPlayback(await controller.request('read'));
      if (current.generation !== generation) throw Error('viewer-source-changed');
      // Never replace an edit the viewer has on.
      if (current.canStop && current.editId !== releaseId) throw Error('viewer-stop-before-switching');
      if (current.editId !== releaseId) {
        const renderer = renderers.get(target);
        if (!renderer) throw Error('viewer-load-unavailable');
        await renderer.request('load', { releaseId, online: false, combined: false });
      }
      let ready = null;
      for (let i = 0; i < 30 && !ready; i += 1) {
        current = publicPlayback(await controller.request('read'));
        if (current.editId === releaseId && (current.canArm || ['armed', 'active', 'finished'].includes(current.state)))
          ready = current;
        else await new Promise(r => setTimeout(r, 100));
      }
      if (!ready) throw Error('viewer-action-failed');
      // The controller's source check runs here; a refusal leaves its notice.
      if (ready.canArm) await controller.request('arm', { generation: ready.generation });
      if (ready.sourceKey) await store.remember(ready.sourceKey, releaseId, false, ready.version);
      await store.annotate?.(releaseId, 'website', { lastWatchedAt: Date.now() }).catch(() => {});
    } finally {
      settleLoad(target);
      finishMatching(target);
    }
  }
  // A downloaded update needs its own verified library identity before it can
  // replace a remembered choice. Retain the previous download for rollback.
  async function finishUpdate(releaseId) {
    const intent = (await (store.intents?.() ?? Promise.resolve([]))).find(
      x => x.releaseId === releaseId && x.replaces
    );
    if (!intent) return;
    await store.completeUpdate(releaseId, intentKey(intent));
  }
  // Exact-release metadata (library-recovery.mjs). Status hints are joined only
  // to evidence held here: an authenticated renderer's ready receipt, or the
  // vault listing a connected renderer's protected owner returns. Release IDs a
  // caller sends are only asked about, never taken as evidence of a download.
  const readyReceipt = releaseId => jobs.get(releaseId)?.state === 'ready';
  async function releaseStatus(ids) {
    const items = [];
    for (const batch of batches(distinctIds(ids))) items.push(...(await discovery.checkReleases(batch)));
    return items;
  }
  async function rendererKept() {
    if (!renderers.size) return new Set();
    return keptIds((await viaRenderer('library', {}).catch(() => null))?.items);
  }
  async function recoverMetadata(items, isKept) {
    const entries = recoveryEntries(items, isKept);
    if (!entries.length || !store.recoverMetadata) return [];
    const changed = await store.recoverMetadata(entries);
    // A recovered replacement row may be what a deferred update was waiting for.
    for (const releaseId of changed) await finishUpdate(releaseId).catch(() => {});
    return changed;
  }
  // After a ready receipt, one coalesced status request for releases whose row
  // is missing or incomplete. Failure leaves the successful download as it is
  // and is not retried here: Settings → Edits and Check for updates retry.
  const metadataQueue = new Set();
  let metadataFlight = null;
  function recoverAfterReady(releaseId) {
    if (!discovery?.checkReleases || !store.recoverMetadata) return null;
    metadataQueue.add(releaseId);
    metadataFlight ??= (async () => {
      try {
        while (metadataQueue.size) {
          await Promise.resolve();
          const ids = [...metadataQueue].slice(0, RECOVERY_LIMIT);
          for (const id of ids) metadataQueue.delete(id);
          const library = (await store.read().catch(() => null))?.library;
          if (!library) continue;
          const wanted = ids.filter(id =>
            needsMetadata(library.find(x => x.id === id && x.origin === 'website'))
          );
          if (!wanted.length) continue;
          const items = await releaseStatus(wanted).catch(() => []);
          await recoverMetadata(items, readyReceipt).catch(() => {});
        }
      } finally {
        metadataFlight = null;
      }
    })();
    return metadataFlight;
  }
  // The Edits page asks about kept releases with missing details when it
  // renders. Each release is asked about at most once a minute from here, so
  // the page's three-second refresh never becomes a request loop.
  const METADATA_RETRY_MS = 60_000;
  const metadataAsked = new Map();
  function notRecentlyAsked(ids, now = Date.now(), force = false) {
    const out = ids.filter(
      id => force || !(now - (metadataAsked.get(id) ?? -Infinity) < METADATA_RETRY_MS)
    );
    for (const id of out) {
      metadataAsked.delete(id);
      metadataAsked.set(id, now);
    }
    while (metadataAsked.size > RECOVERY_LIMIT) metadataAsked.delete(metadataAsked.keys().next().value);
    return out;
  }
  // Whichever player tab has a protected owner serves the Edits page's library requests.
  async function viaRenderer(method, args) {
    let last = Error('viewer-no-owner');
    for (const renderer of renderers.values()) {
      try {
        return await renderer.request(method, args);
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }
  async function recordIntent(releaseId, { open = false, replaces, focus = false } = {}) {
    await store.addIntent(releaseId, Date.now(), replaces);
    await Promise.resolve(store.clearPrevious?.(releaseId)).catch(() => {});
    const library = (await store.read()).library;
    const item = library.find(x => x.id === releaseId && x.origin === 'website');
    // E61: Watch goes to a Prime tab already open on this title instead of opening another.
    const focusedTab = (open || focus) && !replaces ? await focusExistingTab(releaseId, library).catch(() => null) : null;
    if (open && item?.streamingUrl && focusedTab === null) await tabs.create({ url: item.streamingUrl });
    for (const tabId of renderers.keys()) void startIntents(tabId);
    // A player already showing this title turns the edit on without waiting for a source change.
    if (!replaces) for (const tabId of controllers.keys()) void resolveIntents(tabId);
    return {
      job: websiteJob(jobs.get(releaseId)) ?? {
        releaseId,
        state: 'queued',
        bytes: 0,
        total: 0,
        error: null
      },
      ...(focusedTab !== null ? { focusedTab: true } : {})
    };
  }
  // The Prime tab showing this release's title: its player's source, else the tab's address.
  async function focusExistingTab(releaseId, library) {
    if (!controllers.size) return null;
    await Promise.race([learnRelease(releaseId), new Promise(r => setTimeout(r, 2_000))]);
    const info = infoFor(releaseId, library);
    const wanted = sourceIdentity(info.sourceKey ?? '')?.contentId ?? null, wantedPage = primeTitleId(info.streamingUrl ?? '');
    if (!wanted && !wantedPage) return null;
    for (const [tabId, controller] of controllers) {
      const playing = publicPlayback(await controller.request('read').catch(() => ({})));
      let same = Boolean(wanted && sourceIdentity(playing.sourceKey ?? '')?.contentId === wanted);
      const tab = await Promise.resolve(tabs.get?.(tabId)).catch(() => null);
      if (!same && wantedPage) same = primeTitleId(tab?.url ?? '') === wantedPage;
      if (!same) continue;
      await tabs.update(tabId, { active: true });
      if (Number.isInteger(tab?.windowId)) await Promise.resolve(windows?.update?.(tab.windowId, { focused: true })).catch(() => {});
      return tabId;
    }
    return null;
  }

  // Local tab → Watch (0.63.0): turn the local edit on in a Prime tab already playing its
  // episode; otherwise open the episode and turn it on when it plays (within 15 minutes).
  const pendingLocal = new Map();
  async function localWatch(archiveId) {
    if (!/^[a-f0-9]{64}$/.test(archiveId ?? '')) throw Error('viewer-local-invalid');
    const row = (await store.localEdits?.().catch(() => []) ?? []).find(r => r.archiveId === archiveId);
    if (!row) throw Error('viewer-local-missing');
    for (const [tabId, controller] of controllers) {
      const current = publicPlayback(await controller.request('read').catch(() => ({})));
      if (current.state !== 'unavailable' && current.sourceKey && localEditMatches(current.sourceKey, row)) {
        await tabs.update(tabId, { active: true });
        const tab = await Promise.resolve(tabs.get?.(tabId)).catch(() => null);
        if (Number.isInteger(tab?.windowId)) await Promise.resolve(windows?.update?.(tab.windowId, { focused: true })).catch(() => {});
        return watch(tabId, controller, { releaseId: 'local:' + archiveId, generation: current.generation });
      }
    }
    pendingLocal.set(archiveId, Date.now() + 15 * 60_000);
    if (pendingLocal.size > 8) pendingLocal.delete(pendingLocal.keys().next().value);
    // A Prime tab already on this title (not playing yet) is used instead of a new one.
    const wantedPage = primeTitleId(row.streamingUrl ?? '');
    for (const tabId of controllers.keys()) {
      const tab = await Promise.resolve(tabs.get?.(tabId)).catch(() => null);
      if (wantedPage && primeTitleId(tab?.url ?? '') === wantedPage) {
        await tabs.update(tabId, { active: true });
        if (Number.isInteger(tab?.windowId)) await Promise.resolve(windows?.update?.(tab.windowId, { focused: true })).catch(() => {});
        return { message: 'Press play on the episode. The edit turns on when it starts.' };
      }
    }
    if (!row.streamingUrl) return { message: 'Open the episode on Prime Video and press play. The edit turns on when it starts.' };
    await tabs.create({ url: row.streamingUrl });
    return { message: 'Opening the episode. The edit turns on when you press play.' };
  }
  async function resolveLocalIntents(tabId) {
    if (!pendingLocal.size) return false;
    const controller = controllers.get(tabId);
    if (!controller) return false;
    const current = publicPlayback(await controller.request('read').catch(() => ({})));
    if (current.state === 'unavailable' || !current.sourceKey) return false;
    const rows = await store.localEdits?.().catch(() => []) ?? [];
    for (const [archiveId, until] of pendingLocal) {
      if (until < Date.now()) { pendingLocal.delete(archiveId); continue; }
      const row = rows.find(r => r.archiveId === archiveId);
      if (!row || !localEditMatches(current.sourceKey, row)) continue;
      pendingLocal.delete(archiveId);
      await watch(tabId, controller, { releaseId: 'local:' + archiveId, generation: current.generation }).catch(() => {});
      return true;
    }
    return false;
  }

  // "Find another edit" opens the finished edit's page on the website (other edits of
  // this title and the next episode); "Find an edit" searches the website for this show.
  async function findAnother(target, controller) {
    const current = publicPlayback(await controller.request('read'));
    const data = await store.read();
    const matches = current.sourceKey && current.editId
      ? await allMatches(current, data.library).catch(() => [])
      : [];
    const match = matches.find(x => x.id === current.editId);
    const url = config.pairingOrigin
      ? match?.editId && /^[a-f0-9-]{36}$/.test(match.editId)
        ? `${config.pairingOrigin}/edits/${match.editId}`
        : findEditUrl(config.pairingOrigin, current.show, current.title)
      : null;
    if (!url) throw Error('viewer-website-unconfigured');
    await tabs.create({ url });
    return { message: 'Opened the website.' };
  }
  // Descriptive details for the chooser (name, version, size); never used to select.
  const describeMatches = (matches, library) =>
    matches.map(m => {
      const item = library.find(x => x.id === m.id && x.origin === 'website');
      return {
        ...m,
        ...(item?.name || m.name ? { name: String(item?.name ?? m.name).slice(0, 200) } : {}),
        ...(typeof item?.version === 'string' ? { version: item.version } : {}),
        ...(Number.isSafeInteger(item?.displayVersion) ? { displayVersion: item.displayVersion } : {}),
        ...(Number.isFinite(item?.bytes) ? { bytes: item.bytes } : {})
      };
    });
  // Copy diagnostics (E51): the player's live source key beside each kept
  // website edit's recorded one, and where that record came from. Prime title
  // IDs and episode numbers only; no names, links or tokens.
  const sourceDiagnostics = (playback, library) => {
    const live = typeof playback?.sourceKey === 'string' && playback.sourceKey ? playback.sourceKey : null;
    const liveId = live ? sourceIdentity(live)?.contentId ?? null : null;
    return {
      live,
      stored: library
        .filter(x => x.origin === 'website' && x.transport === 'protected' && x.availability === 'downloaded')
        .slice(-16)
        .map(x => ({
          release: String(x.id).slice(0, 8),
          sourceKey: x.sourceKey || null,
          from: x.metadataSource === 'status-hint' ? 'status-hint' : x.sourceKey ? 'packet' : 'none',
          sameKey: Boolean(live && x.sourceKey === live),
          sameTitleId: Boolean(liveId && sourceIdentity(x.sourceKey ?? '')?.contentId === liveId)
        }))
    };
  };
  const loadName = (load, library) => {
    if (!load?.releaseId) return load;
    const item = library.find(x => x.id === load.releaseId && x.origin === 'website');
    return { ...load, name: item?.name ?? null, version: typeof item?.version === 'string' ? item.version : null,
      ...(Number.isSafeInteger(item?.displayVersion) ? { displayVersion: item.displayVersion } : {}) };
  };

  // E60: stalled loads (no progress for 10 s) are logged for support and diagnostics.
  const stallLog = [];
  function logStall(load, reason = 'no-progress') {
    if (!load?.releaseId) return;
    const entry = { at: Date.now(), releaseId: String(load.releaseId).slice(0, 8), state: load.state, done: load.bytes ?? null, total: load.total ?? null, reason };
    stallLog.push(entry); if (stallLog.length > 20) stallLog.shift();
    const job = jobs.get(load.releaseId); if (job) job.stall = entry;
  }

  const broadcast = p => {
    try {
      onPreferences(p);
    } catch {}
    for (const e of controllers.values())
      try {
        e.port.postMessage({ method: 'preferences', value: p, build: EXECUTING_BUILD });
      } catch {}
  };
  runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.kind !== 'viewer-v1') return;
    const reply = (ok, value) =>
      respond({ ok, ...(ok ? { value } : { code: value }), build: EXECUTING_BUILD });
    if (
      !sameExecutingBuild(message.build) ||
      Object.keys(message).sort().join(',') !== 'args,build,kind,method' ||
      JSON.stringify(message).length > 16384
    ) {
      reply(false, 'viewer-request-denied');
      return;
    }
    const renderer = authorizeRenderer(sender) === true;
    if (
      !viewerSurface(sender, runtime.id) &&
      !(renderer && message.method === 'library-put') &&
      !(
        validTop(sender) &&
        ['open-settings', 'command', 'snapshot', 'pending-watch'].includes(message.method)
      )
    ) {
      reply(false, 'viewer-sender-denied');
      return;
    }
    if (pending >= 8) {
      reply(false, 'viewer-busy');
      return;
    }
    pending++;
    void (async () => {
      if (message.method === 'open-settings') {
        const tabId = validTop(sender) ? sender.tab.id : message.args?.tabId;
        const section = ['library', 'playback', 'account', 'creator', 'local', 'advanced'].includes(message.args?.section)
          ? '#' + message.args.section
          : '';
        const opened = await tabs.create({ url: runtime.getURL('viewer-settings.html' + section) });
        if (Number.isInteger(tabId)) settingsTargets.set(opened.id, tabId);
        return { opened: true };
      }
      const a = message.args;
      if (!a || typeof a !== 'object' || Array.isArray(a)) throw Error();
      // Settings opens bound to its player, but its explicit connected-player
      // choice takes precedence. A streaming page always targets itself.
      const requested = validTop(sender)
        ? sender.tab.id
        : controllers.has(a.tabId)
          ? a.tabId
          : (settingsTargets.get(sender.tab?.id) ?? a.tabId);
      const target = controllers.has(requested)
        ? requested
        : controllers.size === 1
          ? [...controllers.keys()][0]
          : null;
      const controller = controllers.get(target);
      if (message.method === 'snapshot') {
        await expireStale();
        const data = await store.read();
        // Names learned before a service restart (0.63.3).
        for (const [id, info] of Object.entries(data.releaseNames ?? {})) if (!releaseInfo.get(id)?.name) releaseInfo.set(id, { ...releaseInfo.get(id), ...info });
        // 0.63.2: downloads dropped as stale, listed once more with Download again.
        // 0.63.3: never list an edit that is kept or ready (it was downloaded after all).
        const kept = id => jobs.get(id)?.state === 'ready' || data.library.some(item => item.id === id && item.origin === 'website' && (item.availability === 'downloaded' || item.downloadedAt));
        const previousAll = await Promise.resolve(store.previousQueue?.()).catch(() => null) ?? [];
        for (const p of previousAll) if (kept(p.releaseId)) void Promise.resolve(store.clearPrevious?.(p.releaseId)).catch(() => {});
        const previouslyQueued = previousAll
          .filter(p => !jobs.has(p.releaseId) && !kept(p.releaseId))
          .map(p => { const info = infoFor(p.releaseId, data.library); if (!info.name) void learnRelease(p.releaseId);
            return { releaseId: p.releaseId, name: info.name, titleName: info.titleName, episodeName: info.episodeName, expiredAt: p.expiredAt }; });
        let playback = publicPlayback();
        if (controller)
          try {
            playback = publicPlayback(await controller.request('read'));
          } catch {
            playback.notice = 'viewer-controller-disconnected';
          }
        const load = loads.get(target);
        if (load?.state === 'arming') settleLoad(target, playback);
        // E60: a load with no progress for 10 s is logged once per step.
        if (load?.busy && loadStalled(load) && load.loggedStall !== `${load.state}:${load.bytes}`) { load.loggedStall = `${load.state}:${load.bytes}`; logStall(load); }
        playback = { ...playback, ...loadedEditMetadata(playback, data.library), ...(await localEditName(target, playback, data.library)) };
        // E61: with no load of its own, the player shows this episode's queued or running download.
        const episodeJob = load?.busy || (load?.state === 'failed') ? null : episodeDownload(playback, data.library);
        const loadStatus = load && !episodeJob
          ? loadName({ ...load }, data.library)
          : episodeJob ?? (matching.has(target)
            ? { state: 'opening', busy: true, bytes: 0, total: 0, error: null }
            : null);
        // Background downloads (Watch this edit, next episode) with their phase, so
        // the popup shows the same status as the Edits page: running first, then the queue.
        const rank = id => {
          if (activeDownload?.releaseId === id) return 0;
          const index = downloadQueue.findIndex(entry => entry.releaseId === id);
          return index < 0 ? 1_000 : index + 1;
        };
        const downloads = [...jobs.values()]
          .filter(j => isActiveLoadPhase(j.state) || j.state === 'paused' || (j.state === 'failed' && j.error !== 'viewer-download-cancelled'))
          .slice(-5)
          .sort((a, b) => rank(a.releaseId) - rank(b.releaseId))
          .map(j => describeJob(j, data.library));
        if (validTop(sender))
          return {
            playback,
            matches: describeMatches(await keptMatches(playback, data.library, data.selections), data.library),
            load: loadStatus,
            downloads,
            previouslyQueued,
            websiteOrigin: config.pairingOrigin ?? null
          };
        let account = { state: 'unconfigured' };
        if (config.deviceLinkLifetimeSeconds) {
          const d = await deviceJournal.read();
          account = d.active
            ? { state: 'saved', displayName: d.active.displayName, expiresAt: d.active.expiresAt }
            : d.pending
              ? { state: 'pending' }
              : { state: d.revocations.length ? 'revocation-pending' : 'unpaired' };
        }
        const key = playback.sourceKey;
        return {
          preferences: data.preferences,
          library: data.library,
          selections: data.selections,
          playback,
          matches: describeMatches(await keptMatches(playback, data.library, data.selections), data.library),
          load: loadStatus,
          downloads,
          previouslyQueued,
          jobs: [...jobs.values()].map(j => describeJob(j, data.library)),
          // 0.63.3: from their own store (survive restarts; Clear never touches them).
          ...(await Promise.resolve(store.downloadLog?.()).then(log => log ? { downloadHistory: log.history, downloadStats: log.stats } : null).catch(() => null)
            ?? { downloadHistory: jobs.history.slice(), downloadStats: downloadLog.slice() }),
          commandFailures: commandFailures.slice(),
          loadStalls: stallLog.slice(),
          sourceCheck: sourceDiagnostics(playback, data.library),
          account,
          update: await updates.check(),
          target: target ?? (Number.isInteger(requested) ? requested : null),
          targets: [...controllers.keys()],
          websiteOrigin: config.pairingOrigin,
          fixtureOnly: config.fixtureOnly === true,
          build: EXECUTING_BUILD
        };
      }
      if (message.method === 'preferences') {
        const p = await store.preferences(a);
        broadcast(p);
        return p;
      }
      if (message.method === 'reset') {
        const p = await store.reset();
        broadcast(p);
        return p;
      }
      if (message.method === 'library-put') {
        const item = await store.upsert(a);
        // Acquisition can finish before packet opening supplies its library
        // identity. Complete a deferred update once both receipts exist.
        if (item.origin === 'website' && jobs.get(item.id)?.state === 'ready') {
          await store.annotate?.(item.id, 'website', { downloadedAt: Date.now() });
          await finishUpdate(item.id);
        }
        void matchRemembered(sender.tab.id);
        return item;
      }
      if (message.method === 'forget') {
        if (controller) await controller.request('stop');
        // Forget metadata only. File deletion remains a separate private lifecycle command.
        await store.remove(a.id, a.origin);
        jobs.delete(a.id);
        return { forgotten: true };
      }
      if (message.method === 'command') {
        if (
          !controller ||
          ![
            'arm',
            'stop',
            'recheck',
            'authoring',
            'watch',
            'restart',
            'find-another',
            'jump-scene',
            'next-scene',
            'previous-scene',
            'check-again',
            'download'
          ].includes(a.command)
        )
          throw Error('viewer-controller-unavailable');
        if (a.command === 'download') return controlDownload(a.action, a.releaseId);
        if (a.command === 'watch') return watch(target, controller, a);
        if (a.command === 'check-again') {
          // E60: the release's next load re-checks every clip (after Ready); the page reloads.
          const releaseId = /^[a-f0-9-]{36}$/.test(a.releaseId ?? '') ? a.releaseId : loads.get(target)?.releaseId;
          const renderer = renderers.get(target);
          if (!renderer || !/^[a-f0-9-]{36}$/.test(releaseId ?? '')) throw Error('viewer-load-unavailable');
          const stall = loads.get(target);
          if (stall?.busy) logStall(stall, 'check-again');
          await renderer.request('recheck', { releaseId });
          return { message: 'Checking the edit again…' };
        }
        if (a.command === 'find-another') return findAnother(target, controller);
        const before = publicPlayback(await controller.request('read'));
        if (a.generation !== before.generation) throw Error('viewer-source-changed');
        await tabs.update(target, { active: true });
        if (['stop', 'authoring'].includes(a.command) && before.sourceKey)
          await store.remember(before.sourceKey, before.editId, true, before.version);
        if (a.command === 'recheck') {
          if (matching.has(target)) throw Error('viewer-busy');
          matching.add(target);
          try {
            await controller.request('recheck', { generation: before.generation });
            const current = publicPlayback(await controller.request('read'));
            if (current.sourceKey !== before.sourceKey || current.generation !== before.generation)
              throw Error('viewer-source-changed');
            const data = await store.read(),
              matches = await keptMatches(current, data.library, data.selections);
            if (!a.releaseId && current.editId)
              return {
                matches,
                message: current.canArm
                  ? 'Edit ready. Choose Watch with edit to turn it on.'
                  : 'This edit is already on. Stop it before choosing another.'
              };
            if (!a.releaseId && matches.length !== 1) {
              clearFailedLoad(target);
              return {
                matches,
                message: matches.length
                  ? 'Choose which edit to watch.'
                  : discovery
                    ? 'No downloaded edit for this episode. Find one on the website.'
                    : 'No saved edit matches this episode. Add your own edit in Settings → Library, or find one on the website.'
              };
            }
            const chosen = matches.find(x => x.id === (a.releaseId ?? matches[0]?.id));
            if (!chosen) throw Error('viewer-edit-not-matched');
            if (current.canStop) {
              if (current.editId === chosen.id)
                return {
                  matches,
                  message: current.canArm
                    ? 'Edit ready. Choose Watch with edit to turn it on.'
                    : 'This edit is already on.'
                };
              throw Error('viewer-stop-before-switching');
            }
            const privateRenderer = renderers.get(target);
            if (!privateRenderer) throw Error('viewer-load-unavailable');
            const latest = publicPlayback(await controller.request('read'));
            if (latest.generation !== current.generation || controllers.get(target) !== controller)
              throw Error('viewer-source-changed');
            await privateRenderer.request('load', {
              releaseId: chosen.id,
              online: !chosen.downloaded,
              combined: false
            });
            return { matches, message: 'Edit ready. Choose Watch with edit to turn it on.' };
          } finally {
            settleLoad(target);
            finishMatching(target);
          }
        }
        // Scene jumps: the controller checks the source and seeks the lead-in before the scene.
        if (['jump-scene', 'next-scene', 'previous-scene'].includes(a.command)) {
          if (a.command === 'jump-scene' && !(Number.isSafeInteger(a.index) && a.index >= 0 && a.index < 1000))
            throw Error('viewer-scene-unavailable');
          const which = a.command === 'jump-scene' ? a.index : a.command === 'next-scene' ? 'next' : 'previous';
          const jumped = await controller.request('jump-scene', { generation: before.generation, which });
          return { ...jumped, message: 'Jumped to the scene.' };
        }
        const result = await controller.request(a.command, { generation: before.generation });
        if (a.command === 'arm' && before.sourceKey && before.editId)
          await store.remember(before.sourceKey, before.editId, false, before.version);

        return {
          ...result,
          message:
            a.command === 'arm'
              ? 'Edit on. Scenes switch as you watch.'
              : a.command === 'restart'
                ? 'Back to the start: every scene will play.'
                : 'Edit stopped. You are watching the original.'
        };
      }
      if (message.method === 'load') {
        if (
          !controller ||
          !renderers.has(target) ||
          typeof a.releaseId !== 'string' ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(a.releaseId)
        )
          throw Error('viewer-load-unavailable');
        const before = publicPlayback(await controller.request('read'));
        if (before.generation !== a.generation) throw Error('viewer-source-changed');
        await tabs.update(target, { active: true });
        try {
          return await renderers
            .get(target)
            .request('load', { releaseId: a.releaseId, online: a.online !== false, combined: false });
        } finally {
          settleLoad(target);
        }
      }
      // A player page asks whether to start before play (an edit is waiting to be fetched). Yes/no only.
      if (message.method === 'pending-watch')
        return { pending: (await readIntents()).some(pendingIntent) };
      if (message.method === 'jobs') return { jobs: [...jobs.values()] };
      if (message.method === 'download-control') return controlDownload(a.action, a.releaseId);
      if (message.method === 'local-watch') return localWatch(a.archiveId);
      if (message.method === 'local-stop') {
        // 0.63.3: Remove of a local edit that is on in a Prime tab stops it there first.
        if (!/^[a-f0-9]{64}$/.test(a.archiveId ?? '')) throw Error('viewer-local-invalid');
        let stopped = 0;
        for (const [tabId, id] of [...loadedLocal]) {
          if (id !== `local:${a.archiveId}`) continue;
          const c = controllers.get(tabId);
          if (c) {
            const current = publicPlayback(await c.request('read').catch(() => ({})));
            if (current.canStop) { await c.request('stop', { generation: current.generation }).catch(() => {}); stopped += 1; }
          }
          loadedLocal.delete(tabId);
        }
        return { stopped };
      }
      if (message.method === 'previous-clear') {
        if (a.releaseId !== undefined && !/^[a-f0-9-]{36}$/.test(a.releaseId)) throw Error('viewer-release-invalid');
        await store.clearPrevious?.(a.releaseId);
        return { cleared: true };
      }
      if (message.method === 'watch-intent') {
        if (
          !/^[a-f0-9-]{36}$/.test(a.releaseId ?? '') ||
          (a.replaces !== undefined && !/^[a-f0-9-]{36}$/.test(a.replaces))
        )
          throw Error('viewer-release-invalid');
        // Library Watch belongs to the player that opened Settings. Reuse it
        // for a kept matching edit; broadcasting a new intent races other tabs
        // for the protected owner and needlessly opens another title page.
        if (a.open === true && !a.replaces && controller && renderers.has(target)) {
          const current = publicPlayback(await controller.request('read'));
          const data = await store.read();
          const kept = data.library.some(
            item =>
              item.id === a.releaseId &&
              item.origin === 'website' &&
              item.transport === 'protected' &&
              item.availability === 'downloaded'
          );
          if (
            kept &&
            (await allMatches(current, data.library)).some(item => item.id === a.releaseId)
          )
            return watch(
              target,
              controller,
              { releaseId: a.releaseId, generation: current.generation },
              { allowOnline: true }
            );
        }
        const result = await recordIntent(a.releaseId, { open: a.open === true, replaces: a.replaces });
        // Extension UI keeps the precise phase; the website's coarser contract
        // remains in recordIntent/job for existing callers.
        return { ...result, job: jobs.get(a.releaseId) ?? result.job };
      }
      if (message.method === 'check-updates' || message.method === 'release-metadata') {
        if (a.releaseIds !== undefined && !Array.isArray(a.releaseIds))
          throw Error('viewer-release-invalid');
        // Explicit Check for updates covers the library, the renderer's vault
        // listing (orphan downloads) and the kept IDs the Edits page reports.
        // Automatic recovery asks only about the page's missing details.
        const explicit = message.method === 'check-updates';
        if (!discovery?.checkReleases) return { items: [] };
        const requested = distinctIds(a.releaseIds ?? []);
        let kept = new Set(),
          ids;
        if (explicit) {
          kept = await rendererKept();
          ids = distinctIds([
            ...(await store.read()).library
              .filter(x => x.origin === 'website' && x.transport === 'protected')
              .map(x => x.id),
            ...kept,
            ...requested
          ]);
          // The explicit check is the retry; it also answers the page's next render.
          notRecentlyAsked(ids, Date.now(), true);
        } else {
          ids = notRecentlyAsked(requested);
          if (ids.length) kept = await rendererKept();
        }
        if (!ids.length) return { items: [] };
        const items = await releaseStatus(ids);
        await recoverMetadata(items, id => kept.has(id) || readyReceipt(id));
        // Servers without exact-release hints describe only the latest release.
        for (const item of items)
          if (item.streamingUrl && !item.display)
            await store.annotate?.(item.releaseId, 'website', { streamingUrl: item.streamingUrl });
        return { items };
      }
      if (message.method === 'edits-library') return viaRenderer('library', {});
      if (message.method === 'edits-remove') {
        if (!/^[a-f0-9-]{36}$/.test(a.releaseId ?? '')) throw Error('viewer-release-invalid');
        // E94 (0.66.1): the download's job goes whether a player tab removes the files or not.
        // With no Prime tab open the Library removes them through the vault itself
        // (library-removal.mjs), and a kept 'ready' job made the website's edit page keep
        // saying Ready (and a new Watch skipped the download queue: E93).
        try { return await viaRenderer('remove', { releaseId: a.releaseId }); } finally { jobs.delete(a.releaseId); }
      }
      if (message.method === 'connection-report') {
        if (!controller) throw Error('viewer-controller-unavailable');
        const report = safeConnectionReport(await controller.request('connection-report', {}));
        if (!report) throw Error('viewer-diagnostics-unavailable');
        return report;
      }
      if (message.method === 'timing-report') {
        // Settings → Advanced: the recorded scene timing of the player tab (media times
        // and timings only). Viewer surfaces only.
        // 0.62.21: with several players and none chosen, say so instead of failing quietly.
        if (!controller) throw Error(controllers.size > 1 ? 'viewer-player-ambiguous' : 'viewer-controller-unavailable');
        return controller.request('timing-report', {}).catch(error => {
          throw Error(error?.message === 'viewer-action-timeout' ? 'viewer-timing-unanswered' : error?.message ?? 'viewer-operation-failed');
        });
      }
      if (message.method === 'preview') {
        // Creator panel only (viewer surfaces): the renderer imports the panel's pending
        // one-scene packet with the usual checks, then the controller arms it and seeks
        // to just before the scene. Any later panel seek or capture stops it (authoring).
        if (!controller || !renderers.has(target)) throw Error('viewer-load-unavailable');
        await tabs.update(target, { active: true });
        await renderers.get(target).request('preview', {});
        let ready = null;
        for (let i = 0; i < 30 && !ready; i += 1) {
          const s = publicPlayback(await controller.request('read'));
          if (s.canArm) ready = s;
          else await new Promise(r => setTimeout(r, 100));
        }
        if (!ready) throw Error('viewer-preview-not-ready');
        await controller.request('arm', { generation: ready.generation });
        await controller.request('preview-seek', { generation: ready.generation });
        return { message: 'Preview started 3 s before the scene. The player menu shows its status.' };
      }
      throw Error('viewer-method-denied');
    })()
      .then(
        v => reply(true, v),
        e => {
          const code = /^viewer-[a-z-]+$/.test(e.message) ? e.message : 'viewer-operation-failed';
          recordFailure(message, code, e);
          reply(false, code);
        }
      )
      .finally(() => pending--);
    return true;
  });
  // Keep the existing website job-state contract while extension surfaces show finer phases.
  const websiteJob = job =>
    job
      ? {
          ...job,
          state: job.state === 'paused' ? 'queued' : isActiveLoadPhase(job.state) && job.state !== 'queued' ? 'downloading' : job.state
        }
      : null;
  return {
    store,
    // Absence of a controller is not evidence of absence of a player. A unique
    // positive observation is usable only when every other admitted streaming
    // controller freshly reports no player; two positive owners are ambiguous.
    playerIdentityState: () => {
      const states = [];
      for (const entry of controllers.values()) {
        if (!validTop(entry.port.sender)) return 'unknown';
        const document = runtimeDocument(entry.port.sender, runtime.id);
        if (!STREAMING_ORIGINS.includes(document?.origin)) continue;
        const state = freshPlayerIdentityObservation(entry.identityObservation)?.state;
        if (!state || state === 'unknown') return 'unknown';
        states.push(state);
      }
      if (!states.length) return 'unknown';
      const players = states.filter(state => state !== 'no-player');
      return players.length === 0 ? 'no-player' : players.length === 1 ? players[0] : 'unknown';
    },
    recordIntent,
    job: releaseId => websiteJob(jobs.get(releaseId)),
    account: async () => {
      if (!config.deviceLinkLifetimeSeconds) return 'unconfigured';
      const d = await deviceJournal.read();
      return d.active ? 'linked' : d.pending ? 'pending' : 'unlinked';
    }
  };
}
