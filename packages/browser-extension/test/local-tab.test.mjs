import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountLocalTab, folderHint, checkLine, importAll, localVisible, folderFiles } from '../src/local-tab.mjs';
import { createViewerStore } from '../src/viewer-store.mjs';
import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';
import { ssFile, memoryRoot } from './helpers/ss-fixture.mjs';

// P1/P2 (0.63.0): the Local tab, its place and words, Add (picker and drop), the rows,
// Watch and Remove, the Advanced switch, and the default folder with Refresh.
const html = await readFile(new URL('../viewer-settings.html', import.meta.url), 'utf8');

test('the Local tab sits below Creator and above Advanced, with its explanation, and Advanced can hide it (on by default)', () => {
  const tabs = [...html.matchAll(/data-tab="([a-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(tabs, ['library', 'playback', 'account', 'creator', 'local', 'advanced']);
  assert.match(html, /<strong>Local edits\.<\/strong> Watch edits saved as single <code>\.ss<\/code> files or edit packs \(<code>\.zip<\/code>\), from your own computer or shared with you by someone else\. They play exactly like edits from the Seamless Scene catalog\. Each file is checked once and kept in the extension’s storage, so you can move or delete the original\. Edits you add here show as “Local: …” when you watch the matching episode\./);
  assert.match(html, /<h2 id="local-edits-heading">Your own edits<\/h2>/);
  assert.match(html, /<button id="add-local">Add a local edit<\/button><input id="local-file" type="file" accept="\.ss,\.zip" multiple hidden>/);
  assert.match(html, /<th>Edit<\/th><th>Show<\/th><th>Size<\/th><th>Last watched<\/th><th>Status<\/th>/, 'the same columns as the Library');
  const advanced = html.slice(html.indexOf('data-tab-panel="advanced"'));
  assert.match(advanced, /Show the Local tab[^<]*<input type="checkbox" data-preference="showLocal">/);
  assert.doesNotMatch(html, /add-manual|Add edit folder|manual-edits/, 'the old folder path is gone');
  const library = html.slice(html.indexOf('data-tab-panel="library"'), html.indexOf('data-tab-panel="playback"'));
  assert.doesNotMatch(library, /Your own edits/, 'moved out of the Library tab');
  assert.equal(localVisible({}), true);
  assert.equal(localVisible({ showLocal: false }), false);
});

test('folder hint, the check line and the import tallies', async () => {
  assert.equal(folderHint('Win32'), '(e.g. Documents\\Seamless Scene)');
  assert.equal(folderHint('MacIntel'), '(e.g. ~/Documents/Seamless Scene)');
  assert.equal(checkLine({ at: 0, files: 3, added: 1, skipped: 0 }, 120_000), 'Checked 2 min ago · 3 edits · 1 new');
  assert.equal(checkLine({ at: 0, files: 1, added: 0, skipped: 1 }, 10_000), 'Checked just now · 1 edit · 1 skipped');
  assert.equal(checkLine(null), '');
  const outcomes = { a: { status: 'added' }, b: { status: 'already' }, c: { status: 'older', message: 'You already have a newer revision.' }, d: { status: 'refused', message: 'Bad file.' } };
  const { tally, report } = await importAll(['a', 'b', 'c', 'd'].map(name => ({ name })), async f => outcomes[f.name]);
  assert.deepEqual(tally, { files: 4, added: 1, unchanged: 1, skipped: 2 });
  assert.deepEqual(report.map(r => [r.name, r.message]), [['c', 'You already have a newer revision.'], ['d', 'Bad file.']]);
  const folder = { async *entries() { yield ['b.ss', { kind: 'file', getFile: async () => ({ name: 'b.ss' }) }]; yield ['notes.txt', { kind: 'file' }]; yield ['A.SS', { kind: 'file', getFile: async () => ({ name: 'A.SS' }) }]; yield ['sub', { kind: 'directory' }]; } };
  assert.deepEqual((await folderFiles(folder)).map(f => f.name), ['A.SS', 'b.ss']);
});

// A small stand-in for the Settings page's nodes.
function page() {
  const nodes = new Map(), listeners = new Map();
  const element = (id = '') => ({ id, hidden: false, textContent: '', value: '', className: '', dataset: {}, children: [], attrs: {}, max: 0, files: [],
    classList: { add() {}, remove() {} }, append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; },
    removeAttribute(k) { delete this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { listeners.set(`${id}:${type}`, fn); }, click() { this.onclick?.(); } });
  const document = { querySelector: q => { const id = q.replace(/^#/, '').split(' ')[0]; if (!nodes.has(id)) nodes.set(id, element(id)); return nodes.get(id); }, createElement: () => element() };
  return { document, nodes, listeners };
}
const okCheck = async (files, { onProgress }) => { onProgress?.(files.length - 1, files.length - 1); return { ok: true }; };
// The fake IndexedDB cannot clone a folder handle (a real one can): keep it in memory.
const withFolders = store => { const folders = new Map(); return Object.assign(Object.create(null), store, { folder: async (key, handle) => handle === undefined ? folders.get(key) ?? null : (folders.set(key, handle), handle) }); };
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
const until = async (check, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('timed out'); };

test('the import journey: Add (picker or drop) checks with progress, lists the row, and Watch and Remove work', async () => {
  const p = page(), store = createViewerStore({ indexedDB: fakeIndexedDB() }), root = memoryRoot(), notices = [], requests = [];
  let rows = [];
  const cell = (tr, content) => { const td = { content }; tr.append?.(td); return td; };
  const buttons = new Map();
  const tab = mountLocalTab({ document: p.document, store, notice: t => notices.push(t), viewerRequest: async (method, args) => { requests.push([method, args]); return { message: 'Opening the episode.' }; },
    cell, button: (label, fn) => { const b = { label, fn }; buttons.set(label + rows.length, fn); return b; }, titleLink: row => row.name, showText: () => '', watchedText: () => null,
    createRenderer: (_body, make) => list => { rows = list; for (const row of list) make(row); }, getRoot: async () => root, confirm: () => true, validate: okCheck });
  const { file, archiveId } = await ssFile({ count: 2 });
  // Picker: the hidden input's files.
  p.nodes.get('local-file').files = [file];
  p.nodes.get('local-file').onchange();
  await until(() => notices.length > 0 && rows.length === 1);
  assert.match(notices.at(-1), /^Added “Tilly, the Tin Courier”/);
  assert.deepEqual(rows.map(r => [r.archiveId, r.status.label]), [[archiveId, 'Unsigned']]);
  assert.equal(p.nodes.get('local-empty').hidden, true);
  assert.match(p.nodes.get('local-space').textContent, /^Using 0\.0 GB of 5\.0 GB for local edits$/);
  assert.equal(p.nodes.get('local-progress').hidden, true, 'progress hides when done');
  // Drop: a second, different edit; a non-.ss file is ignored with a sentence.
  const other = await ssFile({ packetId: 'second-edit', episode: 5 });
  p.listeners.get('local-panel:drop')({ preventDefault() {}, dataTransfer: { files: [other.file, new File(['x'], 'notes.txt')] } });
  await until(() => rows.length === 2);
  assert.equal(rows.length, 2);
  p.listeners.get('local-panel:drop')({ preventDefault() {}, dataTransfer: { files: [new File(['x'], 'notes.txt')] } });
  assert.equal(notices.at(-1), 'Only .ss and .zip edit files can be added here.');
  // Watch asks the service to turn it on (or open the episode); Remove deletes the copy.
  const row = rows.find(r => r.archiveId === archiveId);
  const actions = [];
  const tr = { append(td) { actions.push(td); } };
  rows = []; // capture the buttons for this row
  const made = [];
  const tab2 = mountLocalTab({ document: page().document, store, notice: t => notices.push(t), viewerRequest: async (method, args) => { requests.push([method, args]); return { message: 'Opening the episode.' }; },
    cell: (t, c) => { made.push(c); return {}; }, button: (label, fn) => ({ label, fn }), titleLink: r => r.name, showText: () => '', watchedText: () => null,
    createRenderer: (_b, make) => list => { for (const r of list) make(r); }, getRoot: async () => root, validate: okCheck });
  await tab2.render();
  const actionsCell = made.filter(c => c?.children).find(c => c.children.some(b => b.label === 'Watch'));
  const watch = actionsCell.children.find(b => b.label === 'Watch'), remove = actionsCell.children.find(b => b.label === 'Remove');
  await watch.fn();
  assert.deepEqual(requests.at(-1)[0], 'local-watch');
  assert.ok([archiveId, other.archiveId].includes(requests.at(-1)[1].archiveId));
  await remove.fn();
  assert.equal((await store.localEdits()).length, 1);
  assert.match(notices.at(-1), /^Removed .*The original file was not changed\.$/);
  void tr; void row; void tab; void actions;
});

test('the default folder: Refresh imports new .ss files and reports skipped ones; the automatic check needs granted access', async () => {
  const p = page(), store = withFolders(createViewerStore({ indexedDB: fakeIndexedDB() })), root = memoryRoot(), notices = [];
  const a = await ssFile({ packetId: 'folder-a' }), b = await ssFile({ packetId: 'folder-b', episode: 6 });
  let permission = 'prompt';
  const files = [new File([a.file], 'a.ss'), new File([b.file], 'b.ss'), new File(['junk'], 'broken.ss')];
  const handle = { name: 'Seamless Scene', queryPermission: async () => permission, requestPermission: async () => { permission = 'granted'; return 'granted'; },
    async *entries() { for (const f of files) yield [f.name, { kind: 'file', getFile: async () => f }]; } };
  const tab = mountLocalTab({ document: p.document, store, notice: t => notices.push(t), viewerRequest: async () => ({}), cell: () => ({}), button: () => ({}),
    titleLink: () => '', showText: () => '', watchedText: () => null, createRenderer: () => () => {}, getRoot: async () => root,
    showDirectoryPicker: async () => handle, now: () => 1_000_000, validate: okCheck });
  await tab.opened();
  assert.equal(p.nodes.get('local-folder-name').textContent, 'None chosen');
  await store.folder('local', handle);
  await tab.opened();
  assert.deepEqual(await store.localEdits(), [], 'no automatic check without granted access');
  assert.equal(p.nodes.get('local-folder-allow').hidden, false);
  p.nodes.get('local-folder-allow').onclick();
  await until(async () => p.nodes.get('local-check').textContent !== '');
  assert.equal((await store.localEdits()).length, 2);
  assert.match(notices.at(-1), /^Checked the default folder: 2 new · 0 unchanged · 1 skipped\.$/);
  assert.equal(p.nodes.get('local-folder-name').textContent, 'Seamless Scene');
  assert.equal(p.nodes.get('local-check').textContent, 'Checked just now · 3 edits · 2 new · 1 skipped');
  assert.equal(p.nodes.get('local-report').hidden, false);
  assert.match(p.nodes.get('local-report').children[0].textContent, /^broken\.ss: This is not a Seamless Scene edit file\.$/);
  // Opening the tab again checks automatically: the same files count as unchanged and say nothing.
  const before = notices.length;
  await tab.opened();
  assert.equal(notices.length, before + 1, 'a skipped file is still reported');
  assert.match(notices.at(-1), /0 new · 2 unchanged · 1 skipped/);
});
