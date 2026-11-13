import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isSystemFilePath, withoutSystemFiles } from '../src/system-files.mjs';
import { readEditDirectory } from '../src/viewer-folder.mjs';
import { loadFixturePacket } from '../src/fixture-local-packet.mjs';

test('macOS, Windows and network-drive system files are recognised; edit files are not', () => {
  for (const path of ['.DS_Store', 'edit/.DS_Store', 'edit/._replacement.mp4', 'Thumbs.db', 'edit/desktop.ini', 'edit/__MACOSX/replacement.mp4', 'edit/.Spotlight-V100/x', 'edit\\Thumbs.db']) {
    assert.equal(isSystemFilePath(path), true, path);
  }
  for (const path of ['edit-packet.json', 'edit/replacement.mp4', 'edit/clips/scene_01.mp4', 'ds_store.mp4']) {
    assert.equal(isSystemFilePath(path), false, path);
  }
  assert.deepEqual(withoutSystemFiles([{ name: '.DS_Store' }, { name: 'a.mp4' }, { webkitRelativePath: 'e/._a.mp4', name: '._a.mp4' }]).map(f => f.name), ['a.mp4']);
});

function directory(entries) {
  return { kind: 'directory', async *entries() { for (const [name, value] of Object.entries(entries)) {
    yield [name, value && value.kind === 'directory' ? value : { kind: 'file', getFile: async () => new File([value], name) }];
  } } };
}

test('folder reads skip system files and unbindable names instead of refusing the folder', async () => {
  const files = await readEditDirectory(directory({
    '.DS_Store': 'x', '._replacement.mp4': 'x', 'Thumbs.db': 'x', 'odd\\name.mp4': 'x',
    '__MACOSX': directory({ 'replacement.mp4': 'x' }),
    'edit-packet.json': '{}', 'clips': directory({ 'replacement.mp4': 'abc', '.DS_Store': 'x' })
  }));
  assert.deepEqual(files.map(file => file.webkitRelativePath).sort(), ['clips/replacement.mp4', 'edit-packet.json']);
  await assert.rejects(readEditDirectory(directory({ 'a/b': 'x' })), /Unsafe edit path/);
});

async function localExample() {
  const packet = JSON.parse(await readFile(new URL('../media/edit-packet.json', import.meta.url), 'utf8'));
  packet.purpose = 'local-user-edit'; packet.manifest.status = 'local-only';
  packet.manifest.segments = packet.manifest.segments.filter(s => ['REPLACE', 'INSERT'].includes(s.action));
  packet.manifest.feature_flags.skip_enabled = false; packet.manifest.feature_flags.mute_enabled = false;
  packet.manifest.signature = null; packet.manifest.rights.classification = 'user-supplied';
  return { packet, manifest: { name: 'edit-packet.json', size: 1000, text: async () => JSON.stringify(packet) } };
}

test('local packet import ignores .DS_Store and accepts a unique case-only name difference', async () => {
  const { packet, manifest } = await localExample();
  const clip = { name: 'REPLACEMENT.MP4', size: 100 }, seen = [];
  const loaded = await loadFixturePacket([manifest, clip, { name: '.DS_Store', size: 6148 }, { name: '._REPLACEMENT.MP4', size: 4096 }], packet.manifest.source,
    { validateAsset: async file => { seen.push(file); return { ok: true }; } });
  assert.equal(loaded.files.size, 1);
  assert.deepEqual(seen, [clip]);
  await assert.rejects(loadFixturePacket([manifest, clip, { name: 'Replacement.mp4', size: 100 }], packet.manifest.source,
    { validateAsset: async () => ({ ok: true }) }), /Missing bound local clip/);
});
