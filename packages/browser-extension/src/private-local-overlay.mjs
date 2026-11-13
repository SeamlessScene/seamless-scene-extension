import { boundedOperation, assertActive, abortError } from './operation-context.mjs';
import { EXECUTING_BUILD } from './build-info.mjs';
import { guardFrameSource } from './frame-source-guard.mjs';
import { sameExecutingBuild } from './build-identity.mjs';
import { validLocalMessage, validLocalResult, LOCAL_LIMITS, LOCAL_CONTROL_COMMANDS } from './local-message-schema.mjs';
import { bindingMessage, sendParentBinding, assertOwnedPrivateFrame } from './private-frame-binding.mjs';
import { pausableDeadline } from './pausable-deadline.mjs';
import { ClockDomain } from './clock-domain.mjs';
import { ConnectionDiagnostics, disconnectNotice, validDisconnectNotice } from './connection-diagnostics.mjs';

export function moveConnectedNode(parent, node) {
  if (node.parentNode === parent) return;
  if (!node.isConnected) parent.append(node);
  else if (typeof parent.moveBefore === 'function') parent.moveBefore(node, null);
  else throw Error('Chrome 133 or newer is required to preserve private playback state');
}

export class PrivateLocalOverlay {
  constructor({ document, runtime = chrome.runtime, timers = globalThis,
    clock = () => performance.timeOrigin + performance.now(), now = () => performance.now() }) {
    this.document = document; this.runtime = runtime; this.timers = timers; this.pending = new Map(); this.sequence = 0;
    this.port = null; this.home = null; this.frame = null; this.callbacks = null; this.disposed = false; this.onLocalEnding = null;
    this.presentationGeneration = 0;
    this.clock = clock; this.now = now;
    this.connectionDiagnostics = new ConnectionDiagnostics({ now });
    this.resetConnection();
  }
  resetConnection() {
    // Everything bound to one renderer document and relay pairing. The relay and
    // the new frame start their own counters, so the import sequence restarts.
    this.session = crypto.randomUUID(); this.closed = false; this.lastImportId = 0;
    this.bindingSent = false; this.connectedBuild = null;
    this.disconnectReason = null;
    this.clockDomain = new ClockDomain({ clock: this.clock, now: this.now }); this.clockRefresh = null;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.ready.catch(() => {});
  }
  attach(home, callbacks = {}) {
    if (this.port || this.closed || this.disposed) throw Error('private-overlay-already-attached');
    this.home = home; this.callbacks = callbacks;
    this.connect();
  }
  /** After the service worker restarts (the relay drops every port), open a fresh
   * renderer frame and pairing for the same controller. The engine and adapter keep
   * this object. An extension update invalidates the runtime, so connect throws
   * and the tab must be refreshed as before; a renderer on another build is refused
   * at 'ready' exactly as on first attach. */
  async reconnect({ signal, attempts = 5, firstDelayMs = 1000 } = {}) {
    if (this.reconnecting) throw Error('private-overlay-reconnecting');
    this.reconnecting = true;
    try { return await this.reconnectAttempts({ signal, attempts, firstDelayMs }); }
    finally { this.reconnecting = false; }
  }
  async reconnectAttempts({ signal, attempts, firstDelayMs }) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      assertActive(signal);
      await new Promise((resolve, reject) => {
        const onAbort = () => {
          this.timers.clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(signal.reason ?? abortError());
        };
        const timer = this.timers.setTimeout(() => {
          // The controller lifetime spans many renderer connections. A settled
          // backoff must not leave its listener attached until page teardown.
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, firstDelayMs * 2 ** attempt);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
      assertActive(signal);
      if (this.disposed || !this.home?.isConnected) throw Error('private-overlay-disposed');
      if (!this.closed) return;
      if (!this.runtime?.id) throw Error('private-overlay-extension-updated');
      this.frame?.remove(); this.frame = null; this.port = null;
      this.resetConnection();
      try { this.connect(); await boundedOperation(() => this.ready, { signal, timeoutMs: 5000, label: 'private renderer reconnection' }); return; }
      catch (error) {
        if (signal?.aborted) throw error;
        try { this.closeWithDiagnostic('reconnect-failed'); } catch {}
        this.closed = true;
      }
    }
    throw Error('private-overlay-reconnect-failed');
  }
  connect() {
    const { onImportStart, onPacket, onCatalogPacket, onCatalogInvalidated, onError, onDisconnect } = this.callbacks;
    const home = this.home;
    this.port = this.runtime.connect({ name: `scene-local-v1:controller:${this.session}` });
    const port = this.port;
    this.port.onMessage.addListener(message => {
      if (this.closed || this.port !== port) return;
      if (message?.type === 'disconnect-notice') {
        if (!validDisconnectNotice(message) || !['renderer', 'relay'].includes(message.component)) this.closeWithDiagnostic('message-rejected');
        else this.disconnectReason = { ...message };
        return;
      }
      if (message?.type === 'bind-frame') {
        try {
          if (this.bindingSent || !bindingMessage(message, 'bind-frame')) throw Error('private-frame-binding-invalid');
          const extension = new URL(this.runtime.getURL('local-playback-frame.html'));
          sendParentBinding({ document: this.document, frame: this.frame, targetOrigin: `chrome-extension://${extension.hostname}`, challenge: message.challenge });
          this.bindingSent = true;
        } catch { this.closeWithDiagnostic('handshake-rejected'); }
        return;
      }
      if (message?.type !== 'ready' && !validLocalMessage(message, 'renderer')) { this.closeWithDiagnostic('message-rejected'); return; }
      if (message.type === 'ready') {
        if (!this.bindingSent || this.connectedBuild || !sameExecutingBuild(message.build)) { this.closeWithDiagnostic('handshake-rejected'); return; }
        this.connectedBuild = message.build; this.resolveReady();
      }
      else if (message.type === 'import-start') {
        if (message.importId <= this.lastImportId) { this.closeWithDiagnostic('import-sequence-rejected'); return; }
        this.lastImportId = message.importId;
        // Import IDs restart in a replacement renderer. A delayed completion
        // from the old port must not acknowledge or fail the new port's import.
        const ownsImport = () => !this.closed && this.port === port && message.importId === this.lastImportId;
        void Promise.resolve().then(() => { if (ownsImport()) return onImportStart?.(); }).then(() => {
          if (ownsImport()) return this.request('importReady', [message.importId]);
        }).catch(() => { if (ownsImport()) onError?.(); });
      }
      else if (message.type === 'lease-request') {
        // A hidden, silent tab runs this controller's lease interval about once a minute
        // (Chrome's intensive wake-up throttling), but still delivers messages at once.
        // The renderer asks when its lease is stale; answering here proves the same
        // liveness and frame ownership as the timer does, and nothing else.
        if (!this.connectedBuild) { this.closeWithDiagnostic('message-rejected'); return; }
        this.sendLease();
      }
      else if (message.type === 'packet') onPacket?.(message.packet, message.preview ?? null);
      else if (message.type === 'catalog-packet') onCatalogPacket?.(message.packet);
      else if (message.type === 'catalog-invalidated') {
        const importId = this.lastImportId;
        const isCurrent = () => !this.closed && this.port === port && this.lastImportId === importId;
        void Promise.resolve().then(() => { if (isCurrent()) return onCatalogInvalidated?.({ isCurrent }); })
          .catch(() => { if (isCurrent()) onError?.(); });
      }
      else if (message.type === 'import-error') onError?.(message.code);
      else if (message.type === 'local-ending') {
        const domainMatches = message.endAtMs !== null && this.clockDomain.sameRemoteOrigin(message.sentEpochMs, message.sentMonotonicMs);
        if (message.endAtMs !== null && !domainMatches) this.clockDomain.invalidate();
        const deadline = domainMatches ? this.clockDomain.toLocal(message.endAtMs) : null;
        const remaining = deadline === null ? null : deadline - this.clock();
        try { this.onLocalEnding?.(remaining > 0 && remaining <= 1000 ? deadline : null); } catch {}
      }
      else if (message.type === 'result') {
        const request = this.pending.get(message.id);
        if (request && !validLocalResult(message, request.command)) { this.closeWithDiagnostic('result-rejected'); return; }
        if (request) message.ok ? request.resolve(message.value) : request.reject(message.error === 'private-local-stall' ? Object.assign(Error(message.error), { code: 'local-stall' }) : Error(message.error));
      }
    });
    const cleanup = () => {
      if (this.closed || this.port !== port) return;
      try { this.connectionDiagnostics.record(this.disconnectReason ?? disconnectNotice('controller', 'port-closed', { visibility: this.document.visibilityState })); } catch {}
      this.closed = true;
      this.frameGuard?.disconnect();
      this.connectedBuild = null;
      this.clockDomain.reset();
      const error = abortError('Private renderer disconnected'); this.rejectReady(error);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      clearInterval(this.lease);
      try { this.returnHome(); } catch { this.frame?.remove(); } finally { if (!this.reconnecting) onDisconnect?.(); }
    };
    this.disconnectCleanup = cleanup;
    port.onDisconnect.addListener(() => cleanup());
    this.port.postMessage({ type: 'hello', build: EXECUTING_BUILD });
    const frame = this.document.createElement('iframe'); this.frame = frame;
    frame.title = 'Extension-owned private local clip picker and player';
    const src = this.runtime.getURL(`local-playback-frame.html#${this.session}`);
    frame.allow = 'autoplay'; frame.src = src;
    Object.assign(frame.style, { width: '100%', height: '320px', border: '0', display: 'block', colorScheme: 'dark' });
    // 0.65.5: an injected srcdoc (or a changed src) is undone before the relay's 5 s handshake runs out.
    this.frameGuard?.disconnect();
    this.frameGuard = guardFrameSource(frame, src, { MutationObserver: this.document.defaultView?.MutationObserver,
      onExhausted: () => { if (this.frame === frame) this.closeWithDiagnostic('frame-source-replaced'); } });
    home.append(frame);
    this.lease = setInterval(() => {
      if (!this.connectedBuild) return;
      this.sendLease();
      void this.refreshClock();
    }, 2000);
  }
  sendLease() {
    try { this.assertFrame(); this.port.postMessage({ type: 'command', id: ++this.sequence, command: 'lease' }); }
    catch { this.closeWithDiagnostic('send-failed'); }
  }
  refreshClock() {
    if (this.clockRefresh) return this.clockRefresh;
    if (this.closed || !this.connectedBuild || this.pending.size >= LOCAL_LIMITS.pending - 1) return Promise.resolve(false);
    const domain = this.clockDomain;
    const current = () => !this.closed && this.clockDomain === domain;
    const work = (async () => {
      try {
        // Two agreeing observations are required after reconnect or a changed origin.
        for (let i = 0; i < 2; i++) {
          if (!current()) return false;
          const sentMs = this.clock(), started = this.now();
          const sample = await this.request('clockSample', [], undefined, 250);
          const receivedMs = this.clock(), elapsedMs = this.now() - started;
          if (!current()) return false;
          if (domain.accept({ sentMs, receivedMs, remoteMs: sample.epochMs, remoteMonotonicMs: sample.monotonicMs, elapsedMs })) return true;
        }
      } catch {}
      // A failed or timed-out refresh keeps a mapping that is still fresh:
      // withdrawing then would cost the viewer a pre-rolled cut or join for a
      // single slow probe. Only a missing or expired mapping withdraws the
      // pending prediction. Ordinary owned restore remains available.
      if (current() && !domain.current()) {
        try { this.onLocalEnding?.(null); } catch {}
        void this.request('prerollAt', [null]).catch(() => {});
      }
      return false;
    })();
    this.clockRefresh = work;
    void work.finally(() => { if (this.clockRefresh === work) this.clockRefresh = null; });
    return work;
  }
  assertFrame() {
    try { assertOwnedPrivateFrame(this.document, this.frame); }
    catch (error) { this.closeWithDiagnostic('frame-owner-lost'); throw error; }
  }
  closeWithDiagnostic(reason) {
    if (this.closed) return;
    this.disconnectReason = disconnectNotice('controller', reason, { visibility: this.document.visibilityState });
    try { this.port?.disconnect(); } finally { this.disconnectCleanup?.(); }
  }
  diagnostics() { return { ...this.connectionDiagnostics.snapshot(), state: this.disposed ? 'disposed' : this.closed ? 'disconnected' : this.connectedBuild ? 'connected' : 'connecting' }; }
  async request(command, args = [], signal, timeoutMs = 8000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 135000) throw Error('private-deadline-invalid');
    if (this.closed) throw abortError('Private renderer disconnected');
    assertActive(signal);
    await boundedOperation(() => this.ready, { signal, timeoutMs: 5000, label: 'private renderer connection' });
    assertActive(signal);
    if (this.closed) throw abortError('Private renderer disconnected');
    this.assertFrame();
    const maximum = LOCAL_LIMITS.pending + (LOCAL_CONTROL_COMMANDS.has(command) ? LOCAL_LIMITS.controlReserve : 0);
    if (this.pending.size >= maximum) throw Error('private-request-budget-exceeded');
    const id = ++this.sequence;
    const message = { type: 'command', id, command, args };
    if (!validLocalMessage(message, 'controller')) throw Error('private-command-invalid');
    const wait = () => new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, command }); this.port.postMessage(message);
    });
    try {
      return await (command === 'play' ? this.pausablePlay(wait, signal, timeoutMs) : boundedOperation(wait, { signal, timeoutMs, label: command }));
    } catch (error) {
      try { this.port.postMessage({ type: 'command', id: ++this.sequence, command: 'abort', args: [id] }); } catch {}
      throw error;
    } finally { this.pending.delete(id); }
  }
  // The play request's deadline is held while the viewer pauses the clip.
  pausablePlay(operation, signal, timeoutMs) {
    return new Promise((resolve, reject) => {
      const deadline = pausableDeadline(timeoutMs, () => reject(Error('play-timeout')), { timers: this.timers });
      this.playDeadline = deadline;
      const onAbort = () => reject(signal.reason ?? abortError());
      signal?.addEventListener('abort', onAbort, { once: true });
      Promise.resolve().then(() => { assertActive(signal); return operation(); }).then(resolve, reject).finally(() => {
        deadline.clear(); signal?.removeEventListener('abort', onAbort);
        if (this.playDeadline === deadline) this.playDeadline = null;
      });
    });
  }
  async localPause(signal) {
    this.playDeadline?.pause();
    try { await this.request('localPause', [], signal); } catch (error) { this.playDeadline?.resume(); throw error; }
  }
  localResume(signal) { this.playDeadline?.resume(); return this.request('localResume', [], signal); }
  localSeek(deltaMs, signal) { if (deltaMs < 0) this.playDeadline?.extend(-deltaMs); return this.request('localSeek', [deltaMs], signal); }
  localMute(muted, signal) { return this.request('localMute', [muted], signal); }
  // E58: fade the playing clip's end out (true) because native fades in, or stop (false).
  // 0.62.11: endInMs finishes a running end fade sooner (native already at full level).
  // 'cut' (0.62.14): the Smooth-off exit, a hard cut EXIT_CLIP_TAIL_MARGIN_MS before the end.
  localFadeOut(on, signal, endInMs = null) { return this.request('localFadeOut', on === true && endInMs === 'cut' ? [true, 'cut'] : on === true && Number.isFinite(endInMs) ? [true, Math.round(endInMs)] : [on === true], signal); }
  prerollAt(epochMs, signal, { audioEndAtMs, fadeMs } = {}) {
    const remote = this.clockDomain.toRemote(epochMs);
    const mapping = this.clockDomain.current();
    if (remote === null || !mapping) return this.request('prerollAt', [null], signal);
    const audioEnd = Number.isFinite(audioEndAtMs) ? this.clockDomain.toRemote(audioEndAtMs) : null;
    return this.request('prerollAt', [Math.round(remote), mapping.remoteOriginMs, ...(audioEnd === null ? [] : [Math.round(audioEnd), ...(fadeMs === 0 ? [0] : [])])], signal);
  }
  setTiming(on) { return this.request('timing', [on === true]); }
  async timingLog() {
    const domain = this.clockDomain;
    const stream = await this.request('timingLog', [], undefined, 8000);
    return { ...stream, clockCalibration: domain === this.clockDomain ? domain.snapshot() : null };
  }
  prepare(source, signal) {
    const fixture = source === this.runtime.getURL('media/replacement.mp4');
    if (!fixture && !/^asset:[a-f0-9]{64}$/.test(source)) throw Error('Private overlay requires an opaque validated asset');
    void this.refreshClock();
    return this.request('prepare', [fixture ? 'fixture' : source], signal);
  }
  prepareNext(source, signal) {
    const fixture = source === this.runtime.getURL('media/replacement.mp4');
    if (!fixture && !/^asset:[a-f0-9]{64}$/.test(source)) throw Error('Private overlay requires an opaque validated asset');
    return this.request('prepareNext', [fixture ? 'fixture' : source], signal);
  }
  advance(signal) { return this.request('advance', [], signal); }
  cue(fraction, signal) { return this.request('cue', [fraction], signal); }
  async mount(host, signal) {
    assertActive(signal); this.assertFrame(); this.presentationGeneration += 1;
    moveConnectedNode(host, this.frame);
    Object.assign(this.frame.style, { height: '100%', position: 'absolute', inset: '0' });
    await this.request('mount', [], signal);
  }
  async unmount(signal) {
    assertActive(signal); const generation = this.presentationGeneration;
    try { await this.request('unmount', [], signal); }
    finally { if (generation === this.presentationGeneration) this.returnHome(); }
  }
  configureAudio(snapshot, gainDb = 0, signal) { return this.request('configureAudio', [{ muted: snapshot.muted === true, volume: snapshot.volume }, gainDb], signal); }
  primeForPlayback(signal) { return this.request('primeForPlayback', [], signal); }
  // 0.65.7 short-gap priming (renderer side in local-overlay.mjs).
  primeStandby(signal) { return this.request('primeStandby', [], signal); }
  promoteStandby(signal) { return this.request('promoteStandby', [], signal); }
  cueAt(positionMs, signal) { return this.request('cueAt', [Math.max(0, Math.round(positionMs))], signal); }
  show(signal) { return this.request('show', [], signal); }
  play(signal, profile = {}) {
    const args = { ...(profile.profileClass === undefined ? {} : { profileClass: profile.profileClass }), ...(profile.chainNext === true ? { chainNext: true } : {}) };
    return this.request('play', [args], signal, 135000);
  }
  stop(signal) { return this.request('stop', [], signal); }
  returnHome() {
    // Do not reinsert a removed frame during cleanup: that creates a new private
    // document/connection after the owning controller has already disconnected.
    if (!this.frame?.isConnected || !this.home?.isConnected || this.frame.ownerDocument !== this.document) return;
    moveConnectedNode(this.home, this.frame);
    Object.assign(this.frame.style, { height: '320px', position: 'static', inset: 'auto' });
  }
  async teardown(signal) {
    assertActive(signal); const generation = this.presentationGeneration;
    try { await this.request('teardown', [], signal); }
    finally { if (generation === this.presentationGeneration) this.returnHome(); }
  }
  forceTeardown(signal) { assertActive(signal); this.returnHome(); return this.request('teardown', [], signal); }
  viewerClock() { return this.request('viewerClock'); }
  clear() { return this.request('clear'); }
  catalogActivity(id, active) { return this.request('catalogActivity', [id, active]); }
  catalogActions(observedSource, signal) { return this.request('catalogActions', [observedSource], signal); }
  dispose() {
    this.disposed = true;
    // An extension reload can invalidate this old controller's port. Local
    // teardown must finish even when Chrome or a disconnect observer throws.
    // closeWithDiagnostic already attempts the disconnect and always runs cleanup.
    try { this.closeWithDiagnostic('disposed'); } catch {}
    finally { clearInterval(this.lease); this.frame?.remove(); }
  }
}
