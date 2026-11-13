import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importLocalEdit, exportLocalEdit, localExportName, localRows } from '../src/local-library.mjs';
import { saveFile, mountLocalTab } from '../src/local-tab.mjs';
import { downloadedRows } from '../src/edits-model.mjs';
import { readSsArchive } from '../src/ss-archive.mjs';
import { createViewerStore } from '../src/viewer-store.mjs';
import { preferences } from '../src/viewer-model.mjs';
import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';
import { ssFile, memoryRoot } from './helpers/ss-fixture.mjs';

// 0.63.1: Export as .ss. Only local edits (the stored copy of a file the viewer added) can be
// exported; catalog, protected and cloud edits never can, and no export path reaches them.
async function withEdit(options = {}) {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() }), root = memoryRoot();
  const made = await ssFile(options);
  const added = await importLocalEdit(made.file, { store, root, preferences: preferences(), validate: async () => ({ ok: true }) });
  assert.equal(added.status, 'added');
  return { store, root, ...made };
}

test('Export saves the stored copy unchanged, named "<show> S01E04 - <edit>.ss"', async () => {
  const { store, root, file, archiveId } = await withEdit();
  const saved = [];
  const result = await exportLocalEdit(archiveId, { store, root, save: async (f, name) => saved.push([f, name]) });
  assert.equal(result.name, 'Orbit Station S01E04 - Tilly, the Tin Courier.ss');
  assert.equal(result.message, 'Saved “Orbit Station S01E04 - Tilly, the Tin Courier.ss”.');
  assert.deepEqual(new Uint8Array(await saved[0][0].arrayBuffer()), new Uint8Array(await file.arrayBuffer()), 'byte-for-byte');
  assert.equal((await readSsArchive(saved[0][0])).archiveId, archiveId);
  assert.equal(localExportName({ titleName: 'Show: A/B', season: 2, episode: 11, name: 'Cut?' }), 'Show A B S02E11 - Cut.ss');
  assert.equal(localExportName({ name: 'Movie cut' }), 'Movie cut.ss');
  assert.deepEqual(localRows(await store.localEdits())[0].actions, ['watch', 'export', 'remove']);
});

test('Export never reaches catalog, protected or cloud edits', async () => {
  const { store, root, archiveId } = await withEdit();
  let touched = 0;
  const watched = { ...root, getDirectoryHandle: (...a) => { touched += 1; return root.getDirectoryHandle(...a); } };
  const save = async () => assert.fail('nothing may be saved');
  // A website release id (the vault's directory names), any non-local id, or a local id not in
  // the local index is refused before any storage is opened.
  for (const id of ['11111111-1111-4111-8111-111111111111', 'library', '../library', `local:${archiveId}`, 'b'.repeat(64)])
    await assert.rejects(exportLocalEdit(id, { store, root: watched, save }), /viewer-local-(invalid|missing)/, id);
  assert.equal(touched, 0, 'no directory was opened for a refused id');
  // A stored copy whose identity is not its index row's is not exported.
  const other = await ssFile({ packetId: 'other', seed: 'q' });
  (await root.getDirectoryHandle(archiveId)); root.dirs.get(archiveId).set('edit.ss', other.file);
  await assert.rejects(exportLocalEdit(archiveId, { store, root, save }), /viewer-local-invalid/);
  // The Library (catalog and protected edits) offers no export at all.
  const library = [{ id: '11111111-1111-4111-8111-111111111111', origin: 'website', transport: 'protected', availability: 'downloaded', downloadedAt: 1, streamingUrl: 'https://www.amazon.com/gp/video/detail/x', name: 'Catalog cut' }];
  for (const row of downloadedRows({ library, vault: [{ releaseId: library[0].id, bytes: 5 }] })) assert.ok(!row.actions.includes('export'));
  // The export code imports nothing that can open the encrypted vault or protected packets.
  const seen = new Set(), forbidden = /vendor\/protected|protected-playback-session|protected-packet-core|disk-vault|vault-manager|catalog-playback-session|catalog-file-import/;
  async function walk(url) {
    if (seen.has(url.href)) return; seen.add(url.href);
    const text = await readFile(url, 'utf8');
    for (const [, spec] of text.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      assert.doesNotMatch(spec, forbidden, `${url.pathname} imports ${spec}`);
      if (spec.startsWith('.')) await walk(new URL(spec, url));
    }
  }
  await walk(new URL('../src/local-library.mjs', import.meta.url));
  await walk(new URL('../src/local-tab.mjs', import.meta.url));
  assert.ok(seen.size > 3);
});

test('saveFile uses the save picker (streamed) and falls back to a download link; a cancelled picker says so', async () => {
  const file = new File(['ss bytes'], 'x.ss'), written = [];
  const picker = async options => { assert.equal(options.suggestedName, 'A - B.ss'); assert.deepEqual(options.types[0].accept, { 'application/octet-stream': ['.ss'] });
    return { createWritable: async () => new WritableStream({ write(chunk) { written.push(chunk); } }) }; };
  await saveFile(file, 'A - B.ss', { showSaveFilePicker: picker });
  assert.equal(new TextDecoder().decode(written[0]), 'ss bytes');
  await assert.rejects(saveFile(file, 'x.ss', { showSaveFilePicker: async () => { throw Object.assign(Error('no'), { name: 'AbortError' }); } }), /viewer-export-cancelled/);
  const clicks = [];
  await saveFile(file, 'A - B.ss', { showSaveFilePicker: undefined, URL: { createObjectURL: () => 'blob:1', revokeObjectURL() {} }, document: { createElement: () => ({ click() { clicks.push([this.href, this.download]); } }) } });
  assert.deepEqual(clicks, [['blob:1', 'A - B.ss']]);
});

test('the Local row has an Export button; the Creator tab points to the website builder for making a .ss', async () => {
  const { store, root, archiveId } = await withEdit();
  const made = [], saved = [], notices = [];
  const node = () => ({ hidden: false, textContent: '', children: [], classList: { add() {}, remove() {} }, append(...c) { this.children.push(...c); }, replaceChildren() {}, addEventListener() {}, removeAttribute() {} });
  const nodes = new Map();
  const document = { querySelector: q => { if (!nodes.has(q)) nodes.set(q, node()); return nodes.get(q); }, createElement: () => node() };
  const tab = mountLocalTab({ document, store, viewerRequest: async () => ({}), notice: t => notices.push(t), cell: (tr, c) => { made.push(c); return {}; }, button: (label, fn) => ({ label, fn }),
    titleLink: () => '', showText: () => '', watchedText: () => null, createRenderer: (_b, make) => list => { for (const r of list) make(r); }, getRoot: async () => root,
    save: async (f, name) => saved.push(name) });
  await tab.render();
  const actions = made.find(c => c?.children?.some?.(b => b.label === 'Export'));
  assert.deepEqual(actions.children.map(b => b.label), ['Watch', 'Export', 'Remove']);
  await actions.children.find(b => b.label === 'Export').fn();
  assert.deepEqual(saved, ['Orbit Station S01E04 - Tilly, the Tin Courier.ss']);
  assert.equal(notices.at(-1), 'Saved “Orbit Station S01E04 - Tilly, the Tin Courier.ss”.');
  void archiveId;
  const html = await readFile(new URL('../viewer-settings.html', import.meta.url), 'utf8');
  const creator = html.slice(html.indexOf('data-tab-panel="creator"'), html.indexOf('data-tab-panel="local"'));
  assert.match(creator, /<h2>Make a \.ss file<\/h2>/);
  assert.match(creator, /use <strong>Private playback preview<\/strong>: it saves a <code>\.ss<\/code> file/);
  assert.match(creator, /id="creator-projects"/);
});
