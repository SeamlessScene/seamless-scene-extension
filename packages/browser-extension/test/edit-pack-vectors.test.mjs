import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeEditPack, readEditPack, packTimeMs, measureMp4, PackError } from '../src/ss-normalize.mjs';
import { readSsArchive } from '../src/ss-archive.mjs';
import { loadFixturePacket } from '../src/fixture-local-packet.mjs';

// E70 (0.64.0): every conformance vector (test/fixtures/edit-pack-vectors/) normalises to its
// expected archive_id, or is refused with its code. The ids come from make_vectors.py's own
// Python normalisation; the website pins the same vectors.
const root = new URL('./fixtures/edit-pack-vectors/', import.meta.url);
const hash = async blob => createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
const cases = (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory() && /^\d\d-/.test(d.name)).map(d => d.name).sort();
const load = async name => {
  const expected = JSON.parse(await readFile(new URL(`${name}/expected.json`, root), 'utf8'));
  return { expected, file: new File([await readFile(new URL(`${name}/${expected.file}`, root))], expected.file) };
};

test('the vector set is complete', () => {
  assert.deepEqual(cases, ['01-deflate', '02-stored', '03-wrapper-folder', '04-macos-junk', '05-data-descriptors', '06-zip64-extras',
    '07-friendly-names', '08-full-packet-friendly-paths', '09-missing-clip', '10-deflate64', '11-listing-missing']);
});

for (const name of cases) test(`vector ${name}`, async () => {
  const { expected, file } = await load(name);
  if (expected.refusal) {
    await assert.rejects(normalizeEditPack(file, { hash }), error => {
      assert.ok(error instanceof PackError, String(error));
      assert.equal(error.code, expected.refusal);
      assert.ok(error.message.includes(expected.message_contains), error.message);
      return true;
    });
    return;
  }
  const result = await normalizeEditPack(file, { hash });
  assert.equal(result.archiveId, expected.archive_id);
  // The result is a strict .ss the extension reads, and its clips pass the local packet load.
  const archive = await readSsArchive(result.file, { extensionVersion: '0.64.0' });
  assert.equal(archive.archiveId, expected.archive_id);
  assert.equal(archive.clipCount, expected.clips);
  assert.equal(archive.details.title ?? null, expected.title);
  // R2: what a pack lacks for submission (it still plays); R1: a poster is never stored.
  if (expected.missing) assert.deepEqual(archive.details.listingMissing.map(m => m.key), expected.missing);
  else if (name !== '08-full-packet-friendly-paths') assert.deepEqual(archive.details.listingMissing, [], 'complete listing');
  assert.equal(archive.poster, null);
  assert.ok(!archive.entries.some(e => e.path === 'poster.jpg'));
  const loaded = await loadFixturePacket(archive.files(), null, { expectedService: 'prime-video', validateAsset: async () => ({ ok: true }) });
  assert.equal(loaded.files.size, expected.clips);
});

test('determinism: the same pack gives byte-identical .ss files; every container of the same edit gives one id', async () => {
  const a = await normalizeEditPack((await load('01-deflate')).file, { hash });
  const b = await normalizeEditPack((await load('01-deflate')).file, { hash });
  assert.deepEqual(new Uint8Array(await a.file.arrayBuffer()), new Uint8Array(await b.file.arrayBuffer()));
  const ids = new Set();
  for (const name of cases.slice(0, 7)) ids.add((await normalizeEditPack((await load(name)).file, { hash })).archiveId);
  assert.equal(ids.size, 1);
});

test('the lenient reader: junk and directories skipped, the wrapper folder removed, data descriptors and ZIP64 read', async () => {
  for (const name of ['03-wrapper-folder', '04-macos-junk', '05-data-descriptors', '06-zip64-extras']) {
    const { entries } = await readEditPack((await load(name)).file);
    assert.deepEqual([...entries.keys()].sort(), ['clips/clip-a.mp4', 'clips/clip-b.mp4', 'edit.json', 'poster.jpg'], name);
  }
});

test('times and measurements', async () => {
  assert.equal(packTimeMs('10:05.500'), 605_500);
  assert.equal(packTimeMs('1:02:03.4'), 3_723_400);
  assert.equal(packTimeMs('0:10:00'), 600_000);
  assert.equal(packTimeMs(1234), 1234);
  for (const bad of ['10:61.000', '1:61:00', 'soon', -5, 1.5, null]) assert.equal(packTimeMs(bad), null, String(bad));
  const clip = new Blob([await readFile(new URL('_source/clip-a.mp4', root))]);
  assert.deepEqual(await measureMp4(clip), { durationMs: 5500, width: 640, height: 360 });
});
