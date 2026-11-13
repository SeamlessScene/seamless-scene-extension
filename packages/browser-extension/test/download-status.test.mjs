import test from 'node:test';
import assert from 'node:assert/strict';
import { LOAD_PHASES, isActiveLoadPhase, loadStatusMessage, loadStatusShort, queuedMessage, downloadStalledMessage, rateText } from '../src/viewer-load-status.mjs';
import { viewerView, downloadName, popupPlan } from '../src/viewer-display.mjs';
import { downloadRows, downloadedRows, downloadActions } from '../src/edits-model.mjs';
import { menuMarkup, mountViewerOverlay } from '../src/viewer-overlay.mjs';
import { viewerLoadCode, viewerLoadMessage } from '../src/viewer-load-error.mjs';

// E61 (0.62.20): truthful download status, names, controls.
const id = '61616161-0000-4000-8000-000000000001';
const playback = { state: 'idle', sourceKey: JSON.stringify(['prime-video', 'amzn1.dv.gti.abc', 'episode', 1, 2, 2_701_032, null, null, null]), generation: '1' };

test('E61: phases add arming and paused; paused is not active', () => {
  assert.ok(LOAD_PHASES.includes('arming') && LOAD_PHASES.includes('paused'));
  assert.equal(isActiveLoadPhase('arming'), true);
  assert.equal(isActiveLoadPhase('paused'), false);
  assert.equal(isActiveLoadPhase('queued'), true);
});

test('E61: queued says what it waits for and how many are ahead', () => {
  assert.equal(queuedMessage({ state: 'queued', ahead: 2, waitingFor: 'Lighthouse 1x01' }), 'Waiting for Lighthouse 1x01 to finish (2 ahead)');
  assert.equal(loadStatusMessage({ state: 'queued', ahead: 1, waitingFor: 'Avery' }), 'Waiting for Avery to finish (1 ahead)');
  assert.equal(loadStatusMessage({ state: 'queued', ahead: 1 }), 'Waiting for another download to finish (1 ahead)');
  assert.equal(loadStatusMessage({ state: 'queued' }), 'Waiting to start…');
  assert.equal(loadStatusShort({ state: 'queued', ahead: 3 }), 'Waiting (3 ahead)');
});

test('E61: downloading shows MB, the measured rate and reconnects; stalled and paused say so', () => {
  assert.equal(rateText(85_000), '85.0 KB/s');
  assert.equal(rateText(4_700_000), '4.7 MB/s');
  assert.equal(rateText(0), '');
  assert.equal(loadStatusMessage({ state: 'downloading', bytes: 9_600_000, total: 13_200_000, bytesPerSecond: 83_000, transferRetries: 1 }),
    'Downloading · 72% · 9.6 of 13.2 MB · 83.0 KB/s · reconnected 1×');
  assert.equal(loadStatusMessage({ state: 'downloading', bytes: 1, total: 0 }), 'Downloading…');
  const now = 1_000_000;
  assert.equal(downloadStalledMessage({ retryAt: now + 3_200 }, now), 'Download stalled · retrying in 4 s');
  assert.equal(downloadStalledMessage({}, now), 'Download stalled');
  assert.match(loadStatusMessage({ state: 'queued', stalled: true, retryAt: Date.now() + 10_000 }), /^Download stalled · retrying in \d+ s$/);
  assert.equal(loadStatusShort({ state: 'downloading', stalled: true }), 'Download stalled');
  assert.equal(loadStatusMessage({ state: 'paused', bytes: 5_000_000, total: 10_000_000 }), 'Paused · 50% · 5.0 of 10.0 MB');
  assert.equal(loadStatusMessage({ state: 'paused', bytes: 0, total: 0 }), 'Paused');
  assert.equal(loadStatusMessage({ state: 'failed', error: 'viewer-download-stalled' }), 'The download stopped. Check your connection, then try again.');
  assert.equal(loadStatusMessage({ state: 'failed', error: 'viewer-download-cancelled' }), viewerLoadMessage('viewer-download-cancelled'));
  assert.equal(viewerLoadCode(Error('protected-download-cancelled'), 'protected'), 'viewer-download-cancelled');
});

test('E61: a download is named after its edit, else its title and episode; "New edit" only with nothing known', () => {
  assert.equal(downloadName({ name: 'Avery Cut', titleName: 'Homeland' }), 'Avery Cut');
  assert.equal(downloadName({ titleName: 'Homeland', episodeName: 'Pilot' }), 'Homeland · Pilot');
  assert.equal(downloadName({}), '');
  const view = viewerView({ playback, load: { busy: true, download: true, releaseId: id, state: 'queued', titleName: 'Homeland', episodeName: 'Pilot', ahead: 1, waitingFor: 'Avery Cut' } });
  assert.equal(view.kind, 'downloading');
  assert.equal(view.name, 'Homeland · Pilot');
  assert.equal(view.download.label, 'Waiting for Avery Cut to finish (1 ahead)');
  assert.equal(viewerView({ playback, load: { busy: true, state: 'downloading', bytes: 1, total: 2 } }).name, 'New edit');
  const rows = downloadRows({ jobs: [{ releaseId: id, state: 'downloading', bytes: 1, total: 4, name: 'Avery Cut', titleName: 'Homeland' }] });
  assert.equal(rows[0].name, 'Avery Cut');
  assert.equal(rows[0].titleName, 'Homeland');
  assert.equal(downloadRows({ jobs: [{ releaseId: id, state: 'queued', titleName: 'Homeland', episodeName: 'Pilot' }] })[0].name, 'Homeland · Pilot');
  assert.equal(downloadRows({ jobs: [{ releaseId: id, state: 'queued' }] })[0].name, 'Edit from the website');
  const kept = downloadedRows({ vault: [{ releaseId: id, bytes: 5 }], jobs: [{ releaseId: id, state: 'ready', name: 'Avery Cut' }] });
  assert.equal(kept[0].name, 'Avery Cut', 'a kept download without a library row uses the job name');
});

test('E61: the player menu shows the download, with Pause/Resume/Retry/Cancel, never "No downloaded edit"', () => {
  const load = { busy: true, download: true, releaseId: id, state: 'downloading', bytes: 2_000_000, total: 4_000_000, name: 'Avery Cut' };
  const running = viewerView({ playback, load });
  assert.notEqual(running.kind, 'none');
  assert.deepEqual(running.download.controls, ['pause', 'cancel']);
  assert.equal(running.releaseId, id);
  assert.deepEqual(viewerView({ playback, load: { ...load, state: 'paused' } }).download.controls, ['resume', 'cancel']);
  assert.equal(viewerView({ playback, load: { ...load, state: 'paused' } }).chip.text, 'Paused');
  const stalled = viewerView({ playback, load: { ...load, state: 'queued', stalled: true } });
  assert.deepEqual(stalled.download.controls, ['retry', 'cancel']);
  assert.equal(stalled.download.label, 'Download stalled');
  assert.deepEqual(viewerView({ playback, load: { ...load, download: undefined } }).download.controls, undefined, 'a kept edit loading offers no download controls');
  assert.deepEqual(popupPlan(running), { main: null, row: [] });
  const markup = menuMarkup(running).body;
  assert.match(markup, /data-act="dl-pause"[^>]*data-arg="61616161/);
  assert.match(markup, /data-act="dl-cancel"/);
  assert.match(menuMarkup(stalled).body, /data-act="dl-retry"/);
  assert.doesNotMatch(menuMarkup(stalled).body, /check-again/, 'a download stall retries; it has nothing to re-check');
  assert.doesNotMatch(markup, /No downloaded edit/);
});

test('E61: a finished load waiting to be armed reads "Turning the edit on…", not Off · Watch with edit', () => {
  const loaded = { ...playback, state: 'loaded', editId: id, canArm: true, canStop: true };
  const view = viewerView({ playback: loaded, matches: [{ id, title: 'Avery Cut' }], load: { busy: true, releaseId: id, state: 'arming', name: 'Avery Cut' } });
  assert.equal(view.kind, 'downloading');
  assert.equal(view.download.label, 'Turning the edit on…');
  assert.equal(view.chip.text, 'Getting ready');
  assert.notEqual(viewerView({ playback: loaded, matches: [{ id, title: 'Avery Cut' }], load: { busy: false, state: 'ready' } }).kind, 'downloading');
});

test('E61: Library actions follow the download state', () => {
  assert.deepEqual(downloadActions({ state: 'downloading' }), ['pause', 'cancel']);
  assert.deepEqual(downloadActions({ state: 'queued' }), ['pause', 'cancel']);
  assert.deepEqual(downloadActions({ state: 'queued', stalled: true }), ['retry', 'cancel']);
  assert.deepEqual(downloadActions({ state: 'paused' }), ['resume', 'cancel']);
  assert.deepEqual(downloadActions({ state: 'failed' }), ['retry', 'clear']);
  assert.deepEqual(downloadActions({ state: 'licensing' }), ['cancel']);
  assert.deepEqual(downloadActions({ state: 'ready' }), []);
  const [paused] = downloadRows({ jobs: [{ releaseId: id, state: 'paused', bytes: 1, total: 2 }] });
  assert.equal(paused.status.kind, 'paused');
  assert.deepEqual(paused.actions, ['resume', 'cancel']);
  assert.equal(downloadRows({ jobs: [{ releaseId: id, state: 'queued', stalled: true }] })[0].status.kind, 'stalled');
});

test('E61: the player menu buttons send the download command with the release', async t => {
  const turn = () => new Promise(resolve => setImmediate(resolve));
  const listeners = {}, nodes = new Map(['chip', 'menu', 'rail', 'live', 'head', 'body'].map(n => [n, { id: n, dataset: {}, style: {}, hidden: n === 'menu', attrs: {}, innerHTML: '',
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, focus() {}, contains: () => false, querySelector: () => null, querySelectorAll: () => [], replaceChildren() {}, append() {}, remove() {} }]));
  const root = { activeElement: null, set innerHTML(v) {}, querySelector: q => nodes.get(q.slice(1)) ?? null, addEventListener: (k, f) => { listeners[k] = f; } };
  const host = { style: {}, classList: { add() {}, remove() {} }, attachShadow: () => root, remove() {} };
  const document = { body: { append() {} }, fullscreenElement: null, createElement: () => host, addEventListener() {}, removeEventListener() {} };
  const sent = [];
  const state = { ...playback, load: { busy: true, download: true, releaseId: id, state: 'downloading', bytes: 1, total: 2 } };
  const overlay = mountViewerOverlay({ document, read: async () => state, command: async (name, args) => { sent.push([name, args]); return { message: 'Download paused.' }; }, openSettings() {}, version: '0.62.20' });
  t.after(() => overlay.close());
  overlay.preferences({ overlay: 'minimal', corner: 'left' }); await turn(); await turn();
  listeners.click({ target: { closest: () => ({ dataset: { act: 'dl-pause', arg: id }, disabled: false }) } }); await turn(); await turn();
  listeners.click({ target: { closest: () => ({ dataset: { act: 'dl-cancel', arg: id }, disabled: false }) } }); await turn(); await turn();
  assert.deepEqual(sent, [['download', { action: 'pause', releaseId: id }], ['download', { action: 'cancel', releaseId: id }]]);
});

test('0.62.21: a download that stops part-way says "Download interrupted", never "withdrawn or account link changed"', () => {
  for (const code of ['protected-object-refused', 'request-aborted', 'request-paused', 'response-size', 'response-body', 'protected-range-unsupported', 'client-cancelled', 'staging-cancelled'])
    assert.equal(viewerLoadCode(Error(code), 'protected'), 'viewer-download-interrupted', code);
  assert.equal(viewerLoadMessage('viewer-download-interrupted'), 'Download interrupted. Choose Retry to continue.');
  // Only a refused descriptor (entitlement, withdrawal) keeps the refusal message.
  assert.equal(viewerLoadCode(Error('protected-access-refused'), 'protected'), 'viewer-access-refused');
  assert.equal(viewerLoadCode(Error('protected-release-unavailable'), 'protected'), 'viewer-release-unavailable');
  assert.equal(loadStatusMessage({ state: 'failed', error: 'viewer-download-interrupted' }), 'Download interrupted. Choose Retry to continue.');
  assert.deepEqual(downloadActions({ state: 'failed', error: 'viewer-download-interrupted' }), ['retry', 'clear']);
});
