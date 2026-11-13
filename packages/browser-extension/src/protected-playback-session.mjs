import { CatalogPlaybackSession } from './catalog-playback-session.mjs';
import { ManifestActionScheduler } from './manifest-action-scheduler.mjs';
import { createGuardedExecutor } from './playback-session.mjs';
import { createDiskStaging, createDiskQuarantine } from '../../protected-packet-core/client/disk-staging.mjs';
import { importProtectedCatalog } from '../../protected-packet-core/src/catalog.mjs';
import { requireDescriptor, insist } from '../../protected-packet-core/src/contract.mjs';
import { loadCatalogPacket } from './catalog-file-import.mjs';

/** Privileged extension owner. No page RPC, credentials, keys or file handles are
 * returned. Native executor/observations and catalog policy are trusted adapters.
 * Legacy local-user imports never enter this signed-catalog-only class. */
// Load phases for status displays, in order: requesting (account check and the
// signed descriptor), downloading (ciphertext bytes), saving (to the local
// vault), licensing (challenge and licence), verifying (decrypt, hashes and
// signatures). A throwing observer never affects the load.
function reportPhase(onPhase) {
  let last = null;
  return name => { if (name === last) return; last = name; try { onPhase?.(name); } catch {} };
}
function downloadProgress(onProgress, phase) {
  return (bytes, total) => { phase('downloading'); try { onProgress?.(bytes, total); } catch {} };
}
export class ProtectedPlaybackSession {
  constructor({ client, manager, vault, root, account, catalogOptions, executor, readSource,
    refreshControl, estimate, storagePolicy = null, external = false, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
    insist(typeof account === 'string' && typeof readSource === 'function' && typeof refreshControl === 'function' &&
      typeof executor?.cancel === 'function', 'protected-owner-policy');
    this.catalog = new CatalogPlaybackSession(catalogOptions);
    Object.assign(this, { client, manager, vault, root, account, executor, readSource, refreshControl, estimate, storagePolicy, external, now, setTimer, clearTimer });
    this.externalActions = new Map(); this.externalActive = new Set();
    this.generation = 0; this.closed = false; this.controller = new AbortController(); this.state = 'empty'; this.retryAt = 0;
  }
  // The viewer's storage budget (Edits tab): make room for `bytes` more, evicting the
  // least recently used kept releases when allowed. Never the one being opened or
  // played, or `keep`.
  async makeRoom(bytes, keep) {
    const policy = await this.storagePolicy?.();
    if (!policy || !Number.isSafeInteger(policy.budgetBytes) || policy.budgetBytes <= 0) return;
    const kept = await this.vault.list(), open = new Set([keep, this.openingRelease, this.descriptor && requireDescriptor(this.descriptor).release_id].filter(Boolean));
    let used = kept.filter(entry => entry.releaseId !== keep).reduce((n, entry) => n + entry.bytes, 0);
    if (used + bytes <= policy.budgetBytes) return;
    insist(policy.autoEvict !== false, 'vault-budget-exceeded');
    for (const entry of [...kept].sort((a, b) => a.lastUsedAt - b.lastUsedAt)) {
      if (open.has(entry.releaseId)) continue;
      await this.vault.remove(entry.releaseId); used -= entry.bytes;
      if (used + bytes <= policy.budgetBytes) return;
    }
    insist(used + bytes <= policy.budgetBytes, 'vault-budget-exceeded');
  }
  // Download and keep a release, and obtain its license, without decrypting or
  // playing it: "Watch this edit" and next-episode preparation. Returns sizes only.
  // onRetry (E61, 0.62.20): telemetry for each per-object download retry (see website-client).
  async acquireOnly(releaseId, { combined = false, onProgress, onPhase, onRetry, pause, signal: callerSignal } = {}) {
    this.check();
    const phase = reportPhase(onPhase);
    const signal = callerSignal ? AbortSignal.any([callerSignal, this.controller.signal]) : this.controller.signal;
    let ciphertext;
    try {
      if (!await this.vault.has(releaseId)) {
        const staging = async total => {
          insist(Number.isSafeInteger(total) && total > 0 && total <= 2_005_000_000, 'protected-release-size');
          this.check(); await this.makeRoom(total, releaseId); this.check();
          ciphertext = await createDiskStaging({ root: this.root, budgetBytes: total, signal, estimate: this.estimate });
          return ciphertext;
        };
        phase('requesting');
        const acquired = await this.client.acquire(releaseId, { combined, signal, staging, onProgress: downloadProgress(onProgress, phase), onRetry, pause });
        phase('saving');
        this.check(); await this.vault.save(acquired); this.check();
        if (ciphertext) { await ciphertext.abort(); ciphertext = null; }
      }
      const kept = await this.vault.load(releaseId); this.check();
      phase('licensing');
      await this.manager.obtain(kept.descriptor, this.account, { online: true, signal }); this.check();
      return Object.freeze({ releaseId, bytes: kept.entries.reduce((n, [, blob]) => n + blob.size, 0) });
    } catch (e) { if (ciphertext) await ciphertext.abort().catch(() => {}); throw e; }
  }
  /**
   * 0.63.3: after a download, the same checks a first Watch runs (licence from the cache,
   * decrypt, signatures, then every clip's hash, probe and decode through catalogOptions.
   * validateAsset), so the validated cache is warm and the first Watch is fast. Nothing is
   * loaded for playback; the plaintext is removed at the end. Only on an idle owner.
   */
  async prepareOnly(releaseId, { onPhase, onCheck, signal: callerSignal } = {}) {
    this.check(); insist(!this.pending && this.state === 'empty', 'protected-owner-busy');
    const phase = reportPhase(onPhase), check = step => (done, total) => { try { onCheck?.(step, done, total); } catch {} };
    const signal = callerSignal ? AbortSignal.any([callerSignal, this.controller.signal]) : this.controller.signal;
    let plaintext = null, license = null;
    const task = (async () => {
      const acquired = await this.vault.load(releaseId); this.check();
      phase('licensing');
      let issued;
      try { issued = await this.manager.obtain(acquired.descriptor, this.account, { online: false, signal }); }
      catch { issued = await this.manager.obtain(acquired.descriptor, this.account, { online: true, signal }); }
      license = issued.license; this.check();
      phase('verifying');
      const d = requireDescriptor(acquired.descriptor);
      plaintext = await createDiskStaging({ root: this.root, budgetBytes: d.objects.reduce((n, o) => n + o.plaintext_bytes, 0), signal, estimate: this.estimate });
      const quarantine = createDiskQuarantine(acquired.descriptor, plaintext);
      const policy = await this.catalog.readPolicy({ signal }); this.check();
      const result = await importProtectedCatalog({ ...acquired, license, store: quarantine,
        catalogTrust: policy.trustedKeys, capabilities: policy.capabilities, signal, onObject: check('verifying') });
      const packetObject = d.objects.find(o => o.kind === 'packet');
      const packetFile = await quarantine.read(packetObject.object_id);
      const packet = JSON.parse(await packetFile.text());
      insist(packet.packet_id === releaseId, 'protected-inner-release');
      const files = [new File([packetFile], 'edit-packet.json', { type: 'application/json' })];
      for (const binding of packet.asset_bindings) {
        const object = result.media.find(o => o.sha256 === binding.sha256);
        insist(object, 'protected-media-binding');
        files.push(new File([await quarantine.read(object.object_id)], binding.relative_path, { type: 'video/mp4' }));
      }
      phase('checking');
      await loadCatalogPacket(files, policy.trustedKeys, { capabilities: policy.capabilities, expectedService: this.catalog.expectedService,
        signal, validateAsset: this.catalog.validateAsset, onAssetChecked: check('checking') });
      this.check();
      return Object.freeze({ releaseId, clips: packet.asset_bindings.length });
    })();
    this.pending = task;
    try { return await task; }
    finally {
      if (this.pending === task) this.pending = null;
      if (plaintext) await plaintext.abort().catch(() => {});
      if (license) { try { this.manager.release?.(license); } catch {} }
    }
  }
  async library() { this.check(); return this.vault.list(); }
  async removeRelease(releaseId) {
    this.check();
    insist(![this.openingRelease, this.descriptor && requireDescriptor(this.descriptor).release_id].includes(releaseId), 'vault-release-open');
    await this.vault.remove(releaseId);
  }
  check(generation = this.generation) {
    insist(!this.closed && generation === this.generation && !this.controller.signal.aborted, 'protected-owner-cancelled');
  }
  async guard(generation = this.generation) {
    this.check(generation); insist(this.license && this.state !== 'expired', 'protected-license-required');
    const result = await this.manager.guard(this.license); this.check(generation); return result;
  }
  // onCheck(step, done, total), optional (E60): 'verifying' per decrypted object, then
  // 'checking' per clip. Status only; a throwing observer never affects the load.
  async open(releaseId, { online = true, combined = false, onProgress, onPhase, onCheck, onRetry } = {}) {
    this.check(); insist(!this.pending && this.state === 'empty', 'protected-owner-busy');
    const g = this.generation, signal = this.controller.signal;
    const task = this.load(releaseId, { online, combined, onProgress, onPhase, onCheck, onRetry, g, signal });
    this.pending = task;
    try { return await task; } finally { if (this.pending === task) this.pending = null; }
  }
  async load(releaseId, { online, combined, onProgress, onPhase, onCheck, onRetry, pause, g, signal }) {
    let ciphertext; const phase = reportPhase(onPhase);
    const check = step => (done, total) => { try { onCheck?.(step, done, total); } catch {} };
    try {
      this.state = 'loading'; this.openingRelease = releaseId;
      let acquired;
      // A kept release is not downloaded again; its license is still checked online.
      if (online && await this.vault.has(releaseId)) { acquired = await this.vault.load(releaseId); this.check(g); }
      else if (online) {
        // Reserve disk for the footprint the verified descriptor declares, not the
        // 2 GB format maximum: a small release must load on a small quota.
        const staging = async total => {
          insist(Number.isSafeInteger(total) && total > 0 && total <= 2_005_000_000, 'protected-release-size');
          this.check(g); await this.makeRoom(total, releaseId); this.check(g);
          ciphertext = await createDiskStaging({ root: this.root, budgetBytes: total, signal, estimate: this.estimate });
          return ciphertext;
        };
        phase('requesting');
        this.check(g); acquired = await this.client.acquire(releaseId, { combined, signal, staging, onProgress: downloadProgress(onProgress, phase), onRetry, pause });
        phase('saving');
        this.check(g); await this.vault.save(acquired); this.check(g);
        if (ciphertext) { await ciphertext.abort(); ciphertext = null; }
        acquired = await this.vault.load(releaseId); this.check(g);
      } else { acquired = await this.vault.load(releaseId); this.check(g); }
      this.descriptor = acquired.descriptor;
      phase('licensing');
      const issued = await this.manager.obtain(this.descriptor, this.account, { online, signal });
      this.license = issued.license; this.check(g); await this.guard(g);
      phase('verifying');
      const d = requireDescriptor(this.descriptor);
      this.plaintext = await createDiskStaging({ root: this.root, budgetBytes: d.objects.reduce((n, o) => n + o.plaintext_bytes, 0), signal, estimate: this.estimate });
      this.check(g); const quarantine = createDiskQuarantine(this.descriptor, this.plaintext);
      const policy = await this.catalog.readPolicy({ signal }); this.check(g);
      const result = await importProtectedCatalog({ ...acquired, license: this.license, store: quarantine,
        catalogTrust: policy.trustedKeys, capabilities: policy.capabilities, signal, onObject: check('verifying') });
      await this.guard(g);
      const packetObject = d.objects.find(o => o.kind === 'packet');
      const packetFile = await quarantine.read(packetObject.object_id);
      const packet = JSON.parse(await packetFile.text());
      insist(packet.packet_id === releaseId, 'protected-inner-release');
      const files = [new File([packetFile], 'edit-packet.json', { type: 'application/json' })];
      for (const binding of packet.asset_bindings) {
        const object = result.media.find(o => o.sha256 === binding.sha256);
        insist(object, 'protected-media-binding');
        files.push(new File([await quarantine.read(object.object_id)], binding.relative_path, { type: 'video/mp4' }));
      }
      await this.guard(g);
      phase('checking');
      const summary = await this.catalog.importFiles(files, { signal, onProgress: check('checking') }); await this.guard(g);
      this.state = 'ready'; this.schedule(); return summary;
    } catch (e) {
      if (ciphertext) await ciphertext.abort();
      this.openingRelease = null; await this.releasePlaintext(); this.state = 'failed'; throw e;
    }
  }
  // Private renderer adapter for the existing native scheduler. The only data
  // returned to its controller is the existing bounded hash-only action list.
  async actions(source, { signal } = {}) {
    insist(this.external, 'protected-external-owner-required');
    const g = this.generation; await this.guard(g);
    const actions = await this.catalog.actions(source, { signal }); await this.guard(g);
    this.externalActions = new Map(actions.map(action => [action.id, action]));
    return actions;
  }
  async activity(id, active) {
    insist(this.external, 'protected-external-owner-required');
    if (active) {
      await this.guard();
      insist(this.externalActions.has(id) && !this.externalActive.has(id), 'protected-action-identity');
      this.externalActive.add(id);
    } else {
      // Native restoration/finish is permitted after expiry and cancellation.
      this.externalActive.delete(id);
    }
  }
  async resolveAsset(reference) { await this.guard(); return this.catalog.resolveAsset(reference); }
  async beginLocal() { await this.guard(); insist(this.externalActive.size > 0, 'protected-action-required'); }
  async arm() {
    const g = this.generation; await this.guard(g); insist(!this.scheduler, 'protected-already-armed');
    const source = await this.readSource(); this.check(g);
    const actions = await this.catalog.actions(source, { signal: this.controller.signal }); await this.guard(g);
    const valid = new Set(actions);
    const dispatch = method => async (action, ...args) => {
      insist(valid.has(action), 'protected-action-identity'); await this.guard(g);
      // Recompile through current source/signature/activation policy at each start.
      await this.catalog.actions(await this.readSource(), { signal: this.controller.signal }); await this.guard(g);
      const actual = action.clipUrl ? { ...action, clipUrl: this.catalog.resolveAsset(action.clipUrl) } : action;
      return this.executor[method](actual, ...args);
    };
    const base = {
      preloadLocal: dispatch('preloadLocal'), executeLocal: dispatch('executeLocal'),
      executeSkip: dispatch('executeSkip'), startMute: dispatch('startMute'),
      // Completion/restoration intentionally do not require an unexpired lease.
      finishMute: (...args) => this.executor.finishMute(...args),
      honorNativeSeek: (...args) => this.executor.honorNativeSeek(...args),
      invalidate: reason => this.executor.invalidate?.(reason),
      cancel: reason => this.executor.cancel(reason), cancelPreload: reason => this.executor.cancelPreload?.(reason),
    };
    this.scheduler = new ManifestActionScheduler({ actions, executor: createGuardedExecutor(base, () => this.guard(g)) });
    this.state = 'armed'; return Object.freeze({ actionCount: actions.length });
  }
  observe(state) { this.check(); insist(this.scheduler, 'protected-not-armed'); return this.scheduler.observe(state); }
  schedule() {
    if (this.closed || this.timer !== undefined) return;
    this.timer = this.setTimer(() => { this.timer = undefined; void this.tick().catch(() => {}).finally(() => this.schedule()); }, 1000);
  }
  async tick() {
    if (this.ticking || this.closed || !this.license) return;
    this.ticking = true; const g = this.generation;
    try {
      if (this.now() >= (this.controlAt ?? 0) && this.catalog.current) {
        this.controlAt = this.now() + 30000;
        try {
          const result = await this.refreshControl(this.catalog.description().manifest.edit_id, { signal: this.controller.signal });
          this.check(g); if (result.status === 'disabled') { await this.stop('catalog-playback-disabled'); return; }
        } catch (e) { this.check(g); /* Endpoint outage is not a signed disable. */ }
      }
      if (this.scheduler) {
        try {
          await this.catalog.actions(await this.readSource(), { signal: this.controller.signal }); this.check(g);
        } catch (e) { await this.stop('protected-source-or-catalog-authority-lost'); throw e; }
      }
      let decision;
      try { decision = await this.guard(g); }
      catch (e) {
        if (e.message !== 'license-expired' && this.state !== 'expired') { await this.stop('protected-authority-lost'); throw e; }
        this.state = 'expired';
        // A current action owns its existing duration-aware watchdog. Do not
        // revoke its URL before it restores. Every following dispatch is fenced.
        if (!this.scheduler?.running && !this.scheduler?.activeMute && !this.externalActive.size) await this.stop('protected-expired');
        return;
      }
      if (decision.renewalDue && this.now() >= this.retryAt && !this.scheduler?.running && !this.scheduler?.preloadRunning && !this.externalActive.size) {
        const result = await this.manager.obtain(this.descriptor, this.account, { signal: this.controller.signal });
        this.check(g); const previous = this.license; this.license = result.license;
        if (previous !== this.license) this.manager.release(previous);
        this.retryAt = this.now() + (result.status === 'renewal-deferred' ? 60000 : 1000);
      }

    } catch (e) {
      if (!this.closed && /generation|clock|account-changed|paired-session-changed|cache/.test(e.message)) await this.stop('protected-authority-lost');
      this.retryAt = this.now() + 60000; throw e;
    } finally { this.ticking = false; }
  }
  async storageChanged(record) {
    if (await this.catalog.storageChangeRequiresInvalidation(record)) await this.stop('catalog-storage-changed');
  }
  async releasePlaintext() {
    this.catalog.clear();
    if (this.license) { this.manager.release(this.license); this.license = null; }
    if (this.plaintext) { await this.plaintext.abort(); this.plaintext = null; }
  }
  stop(reason = 'protected-stopped', { signOut = false } = {}) {
    if (this.stopping) return this.stopping;
    this.closed = true; this.generation++; this.controller.abort();
    if (this.timer !== undefined) { this.clearTimer(this.timer); this.timer = undefined; }
    this.executor.invalidate?.(reason);
    this.stopping = (async () => {
      const results = await Promise.allSettled([
        this.scheduler ? this.scheduler.cancelAll(reason) : this.executor.cancel(reason),
        ...(signOut ? [this.manager.signOut(), this.vault.clear()] : []),
      ]);
      // A late acquisition must settle before disk/key disposal can complete.
      if (this.pending) await this.pending.catch(() => {});
      try { await this.releasePlaintext(); } finally { this.manager.close(); this.state = 'closed'; }
      if (results.some(r => r.status === 'rejected')) throw Error('protected-restoration-or-cleanup-failed');
    })();
    return this.stopping;
  }
  async signOut() {
    const results = await Promise.allSettled([this.stop('protected-signout'), this.manager.signOut()]);
    await this.vault.clear();
    if (results.some(r => r.status === 'rejected')) throw Error('protected-signout-cleanup-failed');
  }
}
