import test from 'node:test';
import assert from 'node:assert/strict';
import { saveTimingReport, timingFailureMessage } from '../src/timing-report-save.mjs';
import { menuMarkup, mountViewerOverlay } from '../src/viewer-overlay.mjs';
import { viewerView } from '../src/viewer-display.mjs';
import { registerViewerService } from '../src/viewer-service.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';

// 0.62.21: with several Prime windows open, "Save scene timing report"
// silently saved nothing. The player menu now saves its own tab's report, and every
// failure says why.
const report = { transitionCount: 2, recordedAt: '2026-10-11T04:24:21.551Z', cycles: [] };
function page() {
  const clicks = [], urls = [];
  return { clicks, urls, document: { createElement: () => ({ click() { clicks.push({ href: this.href, download: this.download }); } }) },
    URL: { createObjectURL: () => { urls.push('blob:1'); return 'blob:1'; }, revokeObjectURL() {} }, Blob, setTimeout: () => 0 };
}

test('0.62.21: saving names what was saved, and the reason when nothing was', async () => {
  const p = page();
  const saved = await saveTimingReport({ read: async () => report, ...p, where: 'Homeland' });
  assert.deepEqual(saved, { saved: true, count: 2, message: '2 scenes recorded. Report saved to Downloads (Homeland).' });
  assert.deepEqual(p.clicks, [{ href: 'blob:1', download: 'scene-timing-2026-10-11T04-24-21-551Z.json' }]);
  const empty = await saveTimingReport({ read: async () => ({ transitionCount: 0 }), ...page() });
  assert.equal(empty.saved, false);
  assert.match(empty.message, /^No scene recorded yet/);
  const ambiguous = await saveTimingReport({ read: async () => { throw Error('viewer-player-ambiguous'); }, ...page() });
  assert.deepEqual(ambiguous, { saved: false, message: 'Several Prime Video tabs are open. Choose the player above, or use Save timing report in that tab’s player menu.' });
  assert.match(timingFailureMessage(Error('viewer-timing-unanswered')), /did not answer/);
  assert.match(timingFailureMessage(Error('timing-unavailable')), /Record scene timing/);
  assert.match(timingFailureMessage(Error('something-else')), /could not be saved/);
  const refused = page(); refused.document = { createElement: () => ({ click() { throw Error('blocked'); } }) };
  assert.equal((await saveTimingReport({ read: async () => report, ...refused })).saved, false);
});

test('0.62.21: the player menu offers Save scene timing report with Record scene timing on, and saves its own tab', async t => {
  const playback = { state: 'armed', sourceKey: JSON.stringify(['prime-video', 'amzn1.dv.gti.abc', 'episode', 1, 2, 2_701_032, null, null, null]), generation: '1', scenes: [] };
  const view = viewerView({ playback });
  assert.match(menuMarkup(view, { timing: true }).body, /data-act="save-timing"/);
  assert.doesNotMatch(menuMarkup(view, { timing: false }).body, /save-timing/);
  const turn = () => new Promise(resolve => setImmediate(resolve));
  const listeners = {}, nodes = new Map(['chip', 'menu', 'rail', 'live', 'head', 'body'].map(n => [n, { id: n, dataset: {}, style: {}, hidden: n === 'menu', attrs: {}, innerHTML: '', textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, focus() {}, contains: () => false, querySelector: () => null, querySelectorAll: () => [], replaceChildren() {}, append() {}, remove() {} }]));
  const root = { activeElement: null, set innerHTML(v) {}, querySelector: q => nodes.get(q.slice(1)) ?? null, addEventListener: (k, f) => { listeners[k] = f; } };
  const host = { style: {}, classList: { add() {}, remove() {} }, attachShadow: () => root, remove() {} };
  const document = { body: { append() {} }, fullscreenElement: null, createElement: () => host, addEventListener() {}, removeEventListener() {} };
  let saves = 0, result = { saved: false, message: 'Several Prime Video tabs are open. Choose the player above, or use Save timing report in that tab’s player menu.' };
  const commands = [];
  const overlay = mountViewerOverlay({ document, read: async () => playback, command: async (...a) => { commands.push(a); return {}; }, openSettings() {}, saveTiming: async () => { saves += 1; return result; }, version: '0.62.21' });
  t.after(() => overlay.close());
  overlay.preferences({ overlay: 'minimal', corner: 'left', timing: true }); await turn(); await turn();
  nodes.get('chip').onclick(); await turn(); await turn();
  assert.match(nodes.get('body').innerHTML, /Save scene timing report/);
  listeners.click({ target: { closest: () => ({ dataset: { act: 'save-timing' }, disabled: false }) } });
  for (let i = 0; i < 6; i += 1) await turn();
  assert.equal(saves, 1);
  assert.deepEqual(commands, [], 'no other tab or service command is involved');
  assert.match(nodes.get('body').innerHTML, /class="feedback bad"[^>]*>Several Prime Video tabs are open/, 'a failure is shown, never silent');
  result = { saved: true, message: '2 scenes recorded. Report saved to Downloads.' };
  listeners.click({ target: { closest: () => ({ dataset: { act: 'save-timing' }, disabled: false }) } });
  for (let i = 0; i < 6; i += 1) await turn();
  assert.match(nodes.get('body').innerHTML, /class="feedback"[^>]*>2 scenes recorded\. Report saved to Downloads\./);
  assert.equal(nodes.get('live').textContent, '2 scenes recorded. Report saved to Downloads.');
});

test('0.62.21: Settings with several players and none chosen is told so; a chosen player is the only one asked', async () => {
  const id = 'a'.repeat(32), origin = `chrome-extension://${id}`;
  const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...a) { for (const fn of this.listeners) fn(...a); } });
  const runtime = { id, getURL: p => `${origin}/${p}`, onConnect: event(), onMessage: event() };
  const store = { read: async () => ({ preferences: {}, selections: {}, library: [] }), intents: async () => [] };
  registerViewerService(runtime, {}, { store, deviceJournal: {}, authorizeRenderer: () => false, tabs: { update: async () => {}, create: async () => ({ id: 9 }) } });
  const asked = [];
  for (const tabId of [1, 2]) {
    const url = 'https://www.amazon.com/gp/video/detail/x';
    const port = { name: 'viewer-controller-v1', sender: { id, origin: 'https://www.amazon.com', url, tab: { id: tabId, url }, frameId: 0, documentId: `${tabId}`.repeat(32), documentLifecycle: 'active' },
      onMessage: event(), onDisconnect: event(), disconnect() {},
      postMessage(m) {
        if (!m.id) return;
        if (m.method === 'timing-report') asked.push(tabId);
        queueMicrotask(() => port.onMessage.emit({ id: m.id, ok: true, value: m.method === 'timing-report' ? { ...report, tab: tabId } : { state: 'idle' }, build: EXECUTING_BUILD }));
      } };
    runtime.onConnect.emit(port);
    port.onMessage.emit({ hello: true, build: EXECUTING_BUILD });
  }
  const settings = { id, origin, url: `${origin}/viewer-settings.html`, tab: { id: 90 }, frameId: 0 };
  const send = args => new Promise(resolve => runtime.onMessage.listeners[0]({ kind: 'viewer-v1', method: 'timing-report', args, build: EXECUTING_BUILD }, settings, resolve));
  assert.deepEqual(await send({ tabId: 90 }), { ok: false, code: 'viewer-player-ambiguous', build: EXECUTING_BUILD });
  assert.deepEqual(asked, []);
  const chosen = await send({ tabId: 2 });
  assert.equal(chosen.ok, true);
  assert.equal(chosen.value.tab, 2);
  assert.deepEqual(asked, [2]);
});
