// The download-queue harness (E61, 0.62.20+): a real service and store with scriptable
// renderer acquisitions. Shared by viewer-download-queue and download-hygiene tests.
import assert from 'node:assert/strict';
import { registerViewerService } from '../../src/viewer-service.mjs';
import { EXECUTING_BUILD } from '../../src/build-info.mjs';
import { createViewerStore } from '../../src/viewer-store.mjs';
import { sourceKey } from '../../src/viewer-model.mjs';
import { fakeIndexedDB } from './viewer-indexeddb.mjs';
export const A = '61616161-0000-4000-8000-00000000000a';
export const B = '61616161-0000-4000-8000-00000000000b';
export const gti = n => `amzn1.dv.gti.6161616${n}-0000-4000-8000-000000000000`;
export const source = n => ({ serviceId: 'prime-video', activeItemId: gti(n), mediaType: 'episode', season: 1, episode: n, runtimeMs: 2_701_032 });
export const url = n => `https://www.amazon.com/gp/video/detail/${gti(n)}`;
export const display = (n, name) => ({ editId: '9a7c2e41-3b5d-4f60-8e12-6d4b0c9f1a23', name, titleName: 'Homeland', episodeName: `Episode ${n}`, releaseVersion: 1,
  sourceKey: sourceKey(source(n)), streamingUrl: url(n) });
export const names = { [A]: display(1, 'Avery Cut'), [B]: display(2, 'Jordan Cut') };
export const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { for (const fn of this.listeners) fn(...args); } });
export async function until(check, label, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); }
  assert.fail(`timed out: ${label}`);
}

export async function harness(t, { downloadTiming = {}, windows, store: given = null, runtimeExtra = {}, discovery: customDiscovery = null } = {}) {
  const id = 'a'.repeat(32), origin = `chrome-extension://${id}`;
  const store = given ?? createViewerStore({ indexedDB: fakeIndexedDB() });
  const runtime = { id, getURL: p => `${origin}/${p}`, onConnect: event(), onMessage: event(), onMessageExternal: event(), ...runtimeExtra };
  const calls = [], updates = [], created = [], acquires = new Map(), ports = [], tabUrls = new Map();
  const discovery = { discover: async () => ({ items: [] }), checkReleases: async ids => ids.filter(x => names[x]).map(releaseId => ({ releaseId, availability: 'available', display: names[releaseId] })) };
  const service = registerViewerService(runtime, { pairingOrigin: 'https://preview.seamlessscene.com', deviceLinkLifetimeSeconds: 1 }, {
    store, deviceJournal: { read: async () => ({ active: null, revocations: [] }) }, discovery: customDiscovery ?? discovery, downloadTiming, windows,
    updates: { check: async () => null, forget() {} }, authorizeRenderer: sender => sender.renderer === true,
    tabs: { update: async (tabId, args) => { updates.push([tabId, args]); }, create: async args => { created.push(args); return { id: 99 }; }, get: async tabId => ({ id: tabId, windowId: 7, url: tabUrls.get(tabId) }) }
  });
  t.after(() => { for (const port of ports) port.onDisconnect.emit(); });
  const send = (method, args, sender) => new Promise(resolve =>
    runtime.onMessage.listeners[0]({ kind: 'viewer-v1', method, args, build: EXECUTING_BUILD }, sender, resolve));
  const settings = { id, origin, url: `${origin}/viewer-settings.html`, tab: { id: 90 }, frameId: 0 };
  function connect(tabId, name, handle, pageUrl) {
    const sender = { id, origin: 'https://www.amazon.com', url: pageUrl, tab: { id: tabId, url: pageUrl }, frameId: 0,
      documentId: `${tabId}`.repeat(32), documentLifecycle: 'active', renderer: name === 'viewer-renderer-v1' };
    tabUrls.set(tabId, pageUrl);
    const port = { name, sender, onMessage: event(), onDisconnect: event(), disconnect() { this.onDisconnect.emit(); },
      postMessage(m) {
        if (!m.id) return;
        calls.push({ tabId, port: name, method: m.method, args: m.args });
        queueMicrotask(async () => {
          try { port.onMessage.emit({ id: m.id, ok: true, value: await handle(m, port), build: EXECUTING_BUILD }); }
          catch (error) { port.onMessage.emit({ id: m.id, ok: false, code: error.message, build: EXECUTING_BUILD }); }
        });
      } };
    ports.push(port);
    runtime.onConnect.emit(port);
    port.onMessage.emit({ hello: true, build: EXECUTING_BUILD });
    return port;
  }
  // A renderer whose acquisitions the test finishes (finish) or leaves hanging; cancel rejects.
  // holds: the renderer supports Pause/Resume of a running acquisition (0.62.21).
  function renderer(tabId, pageUrl = url(9), { holds = false } = {}) {
    const port = connect(tabId, 'viewer-renderer-v1', (m, p) => {
      if (holds && (m.method === 'pause' || m.method === 'resume')) {
        const held = acquires.get(`${tabId}|${m.args.releaseId}`);
        if (!held) throw Error('viewer-download-unavailable');
        held.paused = m.method === 'pause';
        return { paused: held.paused };
      }
      if (m.method === 'cancel') { acquires.get(`${tabId}|${m.args.releaseId}`)?.reject(Error('viewer-download-cancelled')); return { cancelled: true }; }
      if (m.method === 'acquire') return new Promise((resolve, reject) => {
        acquires.set(`${tabId}|${m.args.releaseId}`, { resolve, reject, port: p });
      });
      if (m.method === 'load') return { state: 'checked' };
      throw Error('viewer-method-denied');
    }, pageUrl);
    return port;
  }
  function controller(tabId, player, pageUrl = url(9), { armGate } = {}) {
    return connect(tabId, 'viewer-controller-v1', async m => {
      if (m.method === 'arm') { await armGate?.promise; Object.assign(player, { state: 'armed', canArm: false }); }
      if (m.method === 'load') Object.assign(player, { state: 'loaded', canArm: true });
      return { ...player };
    }, pageUrl);
  }
  const progress = (tabId, releaseId, p) => acquires.get(`${tabId}|${releaseId}`).port.onMessage.emit({ progress: { releaseId, operation: 'acquire', ...p }, build: EXECUTING_BUILD });
  const finish = (tabId, releaseId) => { progress(tabId, releaseId, { state: 'ready', bytes: 10, total: 10 }); acquires.get(`${tabId}|${releaseId}`).resolve({ state: 'ready', bytes: 10 }); };
  const snapshot = async () => (await send('snapshot', {}, settings)).value;
  const job = async releaseId => (await snapshot()).jobs.find(x => x.releaseId === releaseId);
  const acquireCalls = () => calls.filter(c => c.method === 'acquire').map(c => [c.tabId, c.args.releaseId]);
  return { service, store, runtime, send, settings, renderer, controller, progress, finish, snapshot, job, calls, acquireCalls, updates, created, acquires };
}

