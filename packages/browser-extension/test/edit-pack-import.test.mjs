import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { importLocalEdit, localRows } from '../src/local-library.mjs';
import { mountLocalTab } from '../src/local-tab.mjs';
import { zipStored } from '../src/ss-archive.mjs';
import { memoryStage } from '../src/ss-normalize.mjs';
import { createViewerStore } from '../src/viewer-store.mjs';
import { preferences } from '../src/viewer-model.mjs';
import { episodeDetails, episodeDetailsText, viewerView, chooserItems } from '../src/viewer-display.mjs';
import { menuMarkup } from '../src/viewer-overlay.mjs';
import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';
import { memoryRoot } from './helpers/ss-fixture.mjs';
import { withMvhdDurationMs } from './helpers/mp4-duration.mjs';

// E70 (0.64.0): edit packs through the Local tab import, plain errors, the folder cache,
// the poster and description, and Copy episode details.
const vectors = new URL('./fixtures/edit-pack-vectors/', import.meta.url);
const source = async name => new Uint8Array(await readFile(new URL(`_source/${name}`, vectors)));
const hash = async blob => createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
const vector = async (name, file) => new File([await readFile(new URL(`${name}/${file}`, vectors))], file, { lastModified: 1 });
const EPISODE = { service: 'prime-video', gti: 'amzn1.dv.gti.e68bf607-fa00-4db4-8f9e-3aa6d04a27f9', show: 'Synthetic Show', season: 1, episode: 2, runtime_ms: 1_800_000 };
const pack = async (edit, extra = []) => new File([await zipStored([['edit.json', new Blob([JSON.stringify(edit)])],
  ['clips/a.mp4', new Blob([await source('clip-a.mp4')])], ['clips/short.mp4', new Blob([await source('clip-short.mp4')])], ...extra])], 'pack.zip');
async function setup() {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() }), root = memoryRoot(), stages = [];
  let checks = 0;
  const add = (file, extra = {}) => importLocalEdit(file, { store, root, preferences: preferences(), hash, validate: async () => { checks += 1; return { ok: true }; },
    stage: (() => { const s = memoryStage(); stages.push(s); return s; })(), ...extra });
  return { store, root, add, stages, checks: () => checks };
}

test('a zip edit pack is converted ("Converting…"), checked and added; adding it again is "already added" with no second check', async () => {
  const h = await setup(), phases = [];
  const first = await h.add(await vector('01-deflate', 'edit-pack.zip'), { onProgress: p => phases.push(p.phase) });
  assert.equal(first.status, 'added', JSON.stringify(first));
  assert.equal(first.row.archiveId, '32a8bf7e46da05306bc4d78bc525cbbe7b6e513c821fa8fda914d4cb2012f691');
  assert.ok(phases.includes('converting') && phases.indexOf('converting') < phases.indexOf('copying'));
  assert.equal(h.checks(), 1);
  // Any container of the same edit: "already added", without another clip check.
  for (const [name, file] of [['01-deflate', 'edit-pack.zip'], ['04-macos-junk', 'Archive.zip']]) {
    const again = await h.add(await vector(name, file));
    assert.equal(again.status, 'already', name);
  }
  assert.equal(h.checks(), 1, 'byte-identical conversions need no second check');
  // 07: friendly names, the removed R3 keys (ignored) and no poster (R1: never stored) give the very
  // same normalised bytes, so it is "already added" without a check too.
  assert.equal((await h.add(await vector('07-friendly-names', 'Synthetic pack.ss'))).status, 'already');
  assert.equal(h.checks(), 1);
  // The description reaches the row; R1: no poster anywhere; R2: the listing is complete.
  const [row] = localRows(await h.store.localEdits());
  assert.equal(row.poster, undefined);
  assert.equal(row.readiness, undefined);
  assert.equal(row.description, 'Two synthetic test-pattern scenes for the edit pack vectors.');
  assert.equal(row.name, 'Synthetic pack');
});

test('refusals name the clip or the field in plain words', async () => {
  const h = await setup();
  const deflate64 = await h.add(await vector('10-deflate64', 'explorer-large.zip'));
  assert.deepEqual([deflate64.status, deflate64.code], ['refused', 'pack-deflate64']);
  assert.match(deflate64.message, /Re-zip with 7-Zip \(Deflate or Store\)/);
  const missing = await h.add(await vector('09-missing-clip', 'missing-clip.zip'));
  assert.equal(missing.code, 'pack-clip-missing');
  assert.equal(missing.message, 'scene 1: clips/clip-b.mp4 is not in the pack.');
  // 0.64.2 (E71): local clips may be 1.5–120 s; the 3 s clip is now accepted (see short-clip-minimum.test.mjs).
  const short = await h.add(await pack({ id: 'short', title: 'Short', episode: EPISODE, scenes: [{ action: 'INSERT', at: 1000, clip: 'clips/tiny.mp4' }] },
    [['clips/tiny.mp4', new Blob([withMvhdDurationMs(await source('clip-short.mp4'), 1499)])]]));
  assert.equal(short.code, 'pack-clip-duration');
  assert.equal(short.message, 'clips/tiny.mp4: 1.499 s; clips must be 1.5–120 s.');
  const fields = await h.add(await pack({ id: 'Bad Id', episode: { ...EPISODE, gti: '' }, scenes: [
    { action: 'REPLACE', start: '10:00.000', end: '10:05.500', clip: 'clips/a.mp4' },
    { action: 'REPLACE', start: '10:03.000', end: '10:08.000', clip: 'clips/a.mp4' }] }));
  assert.equal(fields.code, 'pack-field');
  assert.deepEqual(fields.errors, ['id missing or invalid (lowercase letters, digits, . _ -; at most 128)', 'episode.gti missing']);
  const overlap = await h.add(await pack({ id: 'overlap', episode: EPISODE, scenes: [
    { action: 'REPLACE', start: '10:00.000', end: '10:05.500', clip: 'clips/a.mp4' },
    { action: 'REPLACE', start: '10:03.000', end: '10:08.500', clip: 'clips/a.mp4' },
    { action: 'REPLACE', start: '29:58', end: '30:30', clip: 'clips/a.mp4' }] }));
  assert.deepEqual(overlap.errors, ['scene 3: 30:30.000 is past the episode’s end (30:00.000)']);
  const overlap2 = await h.add(await pack({ id: 'overlap', episode: EPISODE, scenes: [
    { action: 'REPLACE', start: '10:03.000', end: '10:08.500', clip: 'clips/a.mp4' },
    { action: 'REPLACE', start: '10:00.000', end: '10:05.500', clip: 'clips/a.mp4' }] }));
  assert.deepEqual(overlap2.errors, ['scene 1 overlaps scene 2']);
  const codec = await h.add(await pack({ id: 'codec', episode: EPISODE, scenes: [{ action: 'INSERT', at: 1000, clip: 'clips/a.mp4' }] }), { inspectFormat: async () => ({ videoCodec: 'hevc', audioCodec: 'aac' }) });
  assert.equal(codec.message, 'clips/a.mp4: not H.264 + AAC in an MP4 (one video and one audio stream).');
  const notZip = await h.add(new File(['hello'], 'notes.zip'));
  assert.equal(notZip.code, 'pack-not-zip');
  assert.deepEqual(await h.store.localEdits(), [], 'nothing stored after refusals');
});

test('the default folder converts a zip once: an unchanged zip (name, size, date) is not converted again', async () => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() }), root = memoryRoot(), notices = [];
  const zip = await vector('02-stored', 'edit-pack.zip');
  const folders = new Map();
  const wrapped = Object.assign(Object.create(null), store, { folder: async (key, handle) => handle === undefined ? folders.get(key) ?? null : (folders.set(key, handle), handle) });
  const handle = { name: 'Seamless Scene', queryPermission: async () => 'granted', async *entries() { yield ['edit-pack.zip', { kind: 'file', getFile: async () => zip }]; yield ['notes.txt', { kind: 'file' }]; } };
  await wrapped.folder('local', handle);
  const node = () => ({ hidden: false, textContent: '', children: [], classList: { add() {}, remove() {} }, append(...c) { this.children.push(...c); }, replaceChildren() {}, addEventListener() {}, removeAttribute() {} });
  const nodes = new Map(), document = { querySelector: q => { if (!nodes.has(q)) nodes.set(q, node()); return nodes.get(q); }, createElement: () => node() };
  let checks = 0;
  const tab = mountLocalTab({ document, store: wrapped, viewerRequest: async () => ({}), notice: t => notices.push(t), cell: () => ({}), button: () => ({}), titleLink: () => '', showText: () => '', watchedText: () => null,
    createRenderer: () => () => {}, getRoot: async () => root, validate: async () => { checks += 1; return { ok: true }; }, importOptions: { hash, stage: memoryStage() } });
  await tab.refreshFolder();
  assert.equal((await store.localEdits()).length, 1);
  assert.match(notices.at(-1), /1 new · 0 unchanged · 0 skipped/);
  assert.equal(Object.values(await store.localPackCache())[0], '32a8bf7e46da05306bc4d78bc525cbbe7b6e513c821fa8fda914d4cb2012f691');
  await tab.refreshFolder();
  assert.match(notices.at(-1), /0 new · 1 unchanged · 0 skipped/);
  assert.equal(checks, 1, 'the cached zip was not converted or checked again');
});

test('Copy episode details: the live player\'s key as an edit.json "episode" block, in the player menu', () => {
  const playback = { state: 'idle', title: 'Watch Deep Current | Prime Video', show: { title: 'Deep Current - Season 1', season: 1, episode: 2 }, generation: '1', scenes: [],
    sourceKey: JSON.stringify(['prime-video', 'amzn1.dv.gti.4a8535a2-1dac-42fe-8783-3101673b0f08', 'episode', 1, 2, 2966400.4, null, null, null]) };
  const block = episodeDetails(playback);
  assert.deepEqual(block, { service: 'prime-video', gti: 'amzn1.dv.gti.4a8535a2-1dac-42fe-8783-3101673b0f08', show: 'Deep Current', season: 1, episode: 2, runtime_ms: 2966400 });
  assert.equal(episodeDetailsText(block), '"episode": {"service": "prime-video", "gti": "amzn1.dv.gti.4a8535a2-1dac-42fe-8783-3101673b0f08", "show": "Deep Current", "season": 1, "episode": 2, "runtime_ms": 2966400}');
  assert.deepEqual(JSON.parse(`{${episodeDetailsText(block)}}`).episode, block, 'pastes as valid JSON');
  assert.equal(episodeDetails({ sourceKey: '' }), null);
  const view = viewerView({ playback });
  assert.match(menuMarkup(view, { episode: true }).body, /data-act="copy-episode"[^>]*>Copy episode details</);
  assert.doesNotMatch(menuMarkup(view, { episode: false }).body, /copy-episode/);
});

test('R1: no poster in the choosers, even when a match carries one', () => {
  const items = chooserItems([{ id: 'local:' + 'a'.repeat(64), name: 'Local: Synthetic pack', poster: 'data:image/jpeg;base64,AAAA' }]);
  assert.equal(items[0].poster, undefined);
  const view = viewerView({ playback: { state: 'idle', sourceKey: 'k', generation: '1', scenes: [] }, matches: [{ id: 'a', name: 'Local: A', poster: 'data:image/jpeg;base64,AAAA' }, { id: 'b', name: 'B' }] });
  assert.doesNotMatch(menuMarkup(view, { matches: [{ id: 'a', name: 'Local: A', poster: 'data:image/jpeg;base64,AAAA' }, { id: 'b', name: 'B' }] }).body, /<img/);
});
