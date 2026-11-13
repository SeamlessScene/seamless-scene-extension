// The local-edit service harness (0.63.0+): the real viewer-service and store, with player
// tabs whose renderer loads local edits. Shared by the local playback tests.
import assert from 'node:assert/strict';
import { registerViewerService } from '../../src/viewer-service.mjs';
import { EXECUTING_BUILD } from '../../src/build-info.mjs';
import { createViewerStore } from '../../src/viewer-store.mjs';
import { sourceKey } from '../../src/viewer-model.mjs';
import { fakeIndexedDB } from './viewer-indexeddb.mjs';
export const GTI = 'amzn1.dv.gti.642b66cd-63e6-4cd1-8c97-8e8ba3e95185';
export const key = (episode, runtimeMs = 2_701_032, q = {}) => sourceKey({ serviceId: 'prime-video', activeItemId: GTI, mediaType: 'episode', season: 1, episode, runtimeMs, versionTag: null, territory: null, plan: null, ...q });
export const packetKey = episode => sourceKey({ serviceId: 'prime-video', activeItemId: GTI, mediaType: 'episode', season: 1, episode, runtimeMs: 2_701_032, versionTag: null, territory: 'US', plan: 'ad-free' });
export const row = (n, patch = {}) => ({ archiveId: String(n).repeat(64).slice(0, 64), packetId: `edit-${n}`, revision: 1, name: 'Tilly', sourceKey: packetKey(4), runtimeToleranceMs: 3000,
  creatorName: null, bytes: 1000, scenes: 2, streamingUrl: `https://www.amazon.com/gp/video/detail/${GTI}`, addedAt: n, editSignature: String(n).repeat(64).slice(0, 64), ...patch });
export const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...a) { for (const fn of this.listeners) fn(...a); } });
export const until = async (check, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('timed out'); };

export async function harness(t, { rows = [], library = [], prefs = {}, store: given = null, discovery } = {}) {
  const id = 'a'.repeat(32), origin = `chrome-extension://${id}`;
  const store = given ?? createViewerStore({ indexedDB: fakeIndexedDB() });
  for (const r of rows) await store.saveLocalEdit(r);
  for (const item of library) await store.upsert(item);
  if (Object.keys(prefs).length) await store.preferences(prefs);
  const runtime = { id, getURL: p => `${origin}/${p}`, onConnect: event(), onMessage: event() };
  const calls = [], created = [], updates = [], ports = [];
  registerViewerService(runtime, {}, { store, deviceJournal: {}, discovery, authorizeRenderer: s => s.renderer === true,
    tabs: { update: async (tabId, a) => { updates.push([tabId, a]); }, create: async a => { created.push(a); return { id: 99 }; }, get: async tabId => ({ id: tabId, windowId: 3, url: `https://www.amazon.com/gp/video/detail/${GTI}` }) } });
  t.after(() => { for (const p of ports) p.onDisconnect.emit(); });
  const players = new Map();
  function connect(tabId, name, handle) {
    const url = `https://www.amazon.com/gp/video/detail/${GTI}`;
    const sender = { id, origin: 'https://www.amazon.com', url, tab: { id: tabId, url }, frameId: 0, documentId: `${tabId}`.repeat(32), documentLifecycle: 'active', renderer: name === 'viewer-renderer-v1' };
    const port = { name, sender, onMessage: event(), onDisconnect: event(), disconnect() {},
      postMessage(m) { if (!m.id) return; calls.push({ tabId, method: m.method, args: m.args });
        queueMicrotask(async () => { try { port.onMessage.emit({ id: m.id, ok: true, value: await handle(m), build: EXECUTING_BUILD }); } catch (e) { port.onMessage.emit({ id: m.id, ok: false, code: e.message, build: EXECUTING_BUILD }); } }); } };
    ports.push(port); runtime.onConnect.emit(port); port.onMessage.emit({ hello: true, build: EXECUTING_BUILD });
    return port;
  }
  function player(tabId, sourceKeyValue) {
    const p = { state: 'idle', sourceKey: sourceKeyValue, generation: '1', canStop: false };
    players.set(tabId, p);
    const controller = connect(tabId, 'viewer-controller-v1', async m => { if (m.method === 'arm') Object.assign(p, { state: 'armed', canArm: false }); if (m.method === 'stop') Object.assign(p, { state: 'idle', editId: null, canStop: false }); return { ...p }; });
    connect(tabId, 'viewer-renderer-v1', async m => {
      if (m.method === 'load-local') { Object.assign(p, { state: 'loaded', editId: `edit-${m.args.archiveId[0]}`, canArm: true, canStop: true }); return { state: 'checked' }; }
      throw Error('viewer-method-denied');
    });
    return { p, controller };
  }
  const top = tabId => ({ id, origin: 'https://www.amazon.com', url: `https://www.amazon.com/gp/video/detail/${GTI}`, tab: { id: tabId, url: `https://www.amazon.com/gp/video/detail/${GTI}` }, frameId: 0, documentId: `${tabId}`.repeat(32), documentLifecycle: 'active' });
  const settings = { id, origin, url: `${origin}/viewer-settings.html`, tab: { id: 90 }, frameId: 0 };
  const send = (method, args, sender) => new Promise(resolve => runtime.onMessage.listeners[0]({ kind: 'viewer-v1', method, args, build: EXECUTING_BUILD }, sender, resolve));
  return { store, calls, created, updates, player, top, settings, send, players };
}

