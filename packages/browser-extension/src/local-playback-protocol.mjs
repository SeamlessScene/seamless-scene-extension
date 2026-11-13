// This channel carries a finite command vocabulary and packet metadata, never File,
// Blob, ArrayBuffer, file-system handles, paths or media object URLs.
import { catalogRendererService } from './catalog-runtime-service.mjs';
import { validLocalMessage, validLocalResult, LOCAL_LIMITS, LOCAL_CONTROL_COMMANDS } from './local-message-schema.mjs';
export { validLocalMessage, LOCAL_COMMANDS } from './local-message-schema.mjs';
import { EXECUTING_BUILD } from './build-info.mjs';
import { sameExecutingBuild } from './build-identity.mjs';
import { runtimeDocument } from './runtime-document.mjs';
import { bindingMessage } from './private-frame-binding.mjs';
import { pausableDeadline } from './pausable-deadline.mjs';
import { disconnectNotice } from './connection-diagnostics.mjs';
export const LOCAL_CHANNEL_PREFIX = 'scene-local-v1:';
export function localPortIdentity(port, extensionId, { fixtureOnly = false } = {}) {
  const match = /^scene-local-v1:(controller|renderer):([a-f0-9-]{36})$/.exec(port.name ?? '');
  const sender = port.sender;
  const document = runtimeDocument(sender, extensionId);
  if (!match || !document) return null;
  let url;
  try { url = new URL(sender.url); } catch { return null; }
  const [, role, session] = match;
  if (role === 'renderer') {
    if (url.protocol !== 'chrome-extension:' || url.hostname !== extensionId || url.pathname !== '/local-playback-frame.html' || url.hash !== `#${session}` || sender.frameId <= 0) return null;
    if (catalogRendererService(sender, extensionId, { fixtureOnly }) !== (fixtureOnly ? 'cleared-fixture' : 'prime-video')) return null;
  } else {
    const supported = fixtureOnly
      ? url.protocol === 'chrome-extension:' && url.hostname === extensionId && url.pathname === '/catalog-fixture.html' && sender.tab.url === sender.url
      : ['https://www.amazon.com', 'https://www.primevideo.com'].includes(url.origin);
    if (!supported || sender.frameId !== 0 || document.origin !== document.topOrigin) return null;
  }
  return { ...document, role, key: `${sender.tab.id}:${session}` };
}
export function registerLocalPlaybackRelay(runtime, options = {}) {
  const sessions = new Map();
  runtime.onConnect.addListener(port => {
    const identity = localPortIdentity(port, runtime.id, options);
    if (!identity) { if (port.name?.startsWith(LOCAL_CHANNEL_PREFIX)) port.disconnect(); return; }
    let pair = sessions.get(identity.key);
    if (!pair) {
      if (sessions.size >= LOCAL_LIMITS.sessions || [...sessions.values()].filter(value => value.tabId === identity.tabId).length >= LOCAL_LIMITS.sessionsPerTab) { port.disconnect(); return; }
      pair = { tabId: identity.tabId, topOrigin: identity.topOrigin, documents: new Map(), pending: new Map(), sequence: 0 };
    }
    if (pair[identity.role] || pair.topOrigin !== identity.topOrigin || [...pair.documents.values()].includes(identity.documentId)) { port.disconnect(); return; }
    pair[identity.role] = port;
    pair.documents.set(identity.role, identity.documentId);
    pair.verified ??= new Set();
    sessions.set(identity.key, pair);
    const otherRole = identity.role === 'controller' ? 'renderer' : 'controller';
    // Chrome does not fire onDisconnect on the port that calls disconnect(), so
    // every close the relay makes itself runs the same cleanup.
    function release() {
      clearTimeout(timer);
      if (sessions.get(identity.key) !== pair) return;
      sessions.delete(identity.key);
      pair.challenge = null;
      for (const request of pair.pending.values()) request.timer.clear();
      pair.pending.clear();
      try { pair[otherRole]?.disconnect(); } catch {}
    }
    function close(reason) {
      // Preserve the immediate fail-closed path even if the notice cannot arrive.
      try { pair.controller?.postMessage(disconnectNotice('relay', reason)); } catch {}
      try { port.disconnect(); } catch {} release();
    }
    const timer = setTimeout(() => { if (!pair.ready) close('handshake-timeout'); }, 5000);
    timer.unref?.();
    port.onMessage.addListener(message => {
      if (sessions.get(identity.key) !== pair) return;
      if (!pair.verified.has(identity.role)) {
        if (message?.type !== 'hello' || Object.keys(message).length !== 2 || !sameExecutingBuild(message.build)) { close('handshake-rejected'); return; }
        pair.verified.add(identity.role);
        if (pair.verified.size === 2) {
          pair.challenge = crypto.randomUUID();
          // Send only to the isolated top controller. Giving the renderer the
          // answer here would prove runtime access, not ownership of its iframe.
          try { pair.controller.postMessage({ type: 'bind-frame', challenge: pair.challenge }); }
          catch { close('send-failed'); }
        }
        return;
      }
      if (pair.verified.size !== 2) { close('handshake-rejected'); return; }
      if (!pair.ready) {
        if (identity.role !== 'renderer' || !bindingMessage(message, 'frame-bound') || message.challenge !== pair.challenge) { close('handshake-rejected'); return; }
        pair.ready = true; pair.challenge = null;
        try { for (const role of ['controller', 'renderer']) pair[role].postMessage({ type: 'ready', build: EXECUTING_BUILD }); }
        catch { close('send-failed'); }
        return;
      }
      if (!validLocalMessage(message, identity.role)) { close('message-rejected'); return; }
      if (identity.role === 'controller') {
        if (message.id <= pair.sequence) { close('sequence-rejected'); return; }
        pair.sequence = message.id;
        if (message.command === 'abort') {
          const pending = pair.pending.get(message.args[0]);
          pending?.timer.clear(); pair.pending.delete(message.args[0]);
        } else if (message.command !== 'lease') {
          // A viewer's pause, or a seek back, holds the pending play deadline.
          if (['localPause', 'localResume', 'localSeek'].includes(message.command)) for (const request of pair.pending.values()) {
            if (request.command !== 'play') continue;
            if (message.command === 'localPause') request.timer.pause();
            else if (message.command === 'localResume') request.timer.resume();
            else if (message.args[0] < 0) request.timer.extend(-message.args[0]);
          }
          const maximum = LOCAL_LIMITS.pending + (LOCAL_CONTROL_COMMANDS.has(message.command) ? LOCAL_LIMITS.controlReserve : 0);
          if (pair.pending.size >= maximum) { close('request-budget'); return; }
          const deadline = pausableDeadline(message.command === 'play' ? 140000 : 15000, () => close('request-timeout'), { unref: true });
          pair.pending.set(message.id, { command: message.command, timer: deadline });
        }
      } else if (message.type === 'result') {
        const pending = pair.pending.get(message.id);
        if (!pending) { if (message.id > pair.sequence) close('result-rejected'); return; }
        if (!validLocalResult(message, pending.command)) { close('result-rejected'); return; }
        pending.timer.clear(); pair.pending.delete(message.id);
      }
      try { pair[otherRole]?.postMessage(message); } catch { close('send-failed'); }
    });
    port.onDisconnect.addListener(() => release());
  });
  return {
    authorizeRenderer(sender) {
      try {
        const session = new URL(sender.url).hash.slice(1);
        const identity = localPortIdentity({ name: `${LOCAL_CHANNEL_PREFIX}renderer:${session}`, sender }, runtime.id, options);
        if (!identity) return false;
        const pair = sessions.get(identity.key);
        return pair?.ready === true && pair.documents.get('renderer') === identity.documentId &&
          pair.renderer.sender.frameId === identity.frameId && pair.topOrigin === identity.topOrigin;
      } catch { return false; }
    }
  };
}
