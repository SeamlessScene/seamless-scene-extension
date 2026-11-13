import test from 'node:test';
import assert from 'node:assert/strict';
import { readSsArchive, writeSsArchive, zipStored, ssArchiveId, canonicalJson, signSsArchiveId, crc32, safeEntryPath, versionAtLeast, ssArchiveMessage, SS_LIMITS } from '../src/ss-archive.mjs';
import { loadFixturePacket } from '../src/fixture-local-packet.mjs';
import { localPacket, ssFile } from './helpers/ss-fixture.mjs';

// .ss v1 (docs/technical/SS_ARCHIVE_V1.md): reader, writer and every refusal.
const enc = new TextEncoder();
const bytes = async blob => new Uint8Array(await blob.arrayBuffer());
const refuses = (promise, code) => assert.rejects(promise, error => error?.code === code || assert.fail(`expected ${code}, got ${error?.code ?? error?.message}`));

// A raw ZIP builder for refused files: every field can be set or broken.
async function rawZip(entries, { eocd = {}, locator = false } = {}) {
  const parts = [], central = []; let offset = 0; const offsets = [];
  for (const e of entries) {
    if (e.centralOnly) continue;
    const name = enc.encode(e.localName ?? e.name), data = e.data instanceof Uint8Array ? e.data : enc.encode(e.data ?? '');
    const crc = e.crc ?? await crc32(new Blob([data])), extra = e.localExtra ?? new Uint8Array(0);
    const h = new Uint8Array(30), v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, e.localFlags ?? e.flags ?? 0x800, true); v.setUint16(8, e.localMethod ?? e.method ?? 0, true);
    v.setUint32(14, e.localCrc ?? crc, true); v.setUint32(18, e.localSize ?? data.length, true); v.setUint32(22, e.localSize ?? data.length, true);
    v.setUint16(26, name.length, true); v.setUint16(28, extra.length, true);
    offsets.push(offset); e._offset = offset; e._crc = crc; e._size = data.length;
    parts.push(h, name, extra, data); offset += 30 + name.length + extra.length + data.length;
  }
  for (const e of entries) {
    const name = enc.encode(e.name), extra = e.extra ?? new Uint8Array(0), at = e.centralOnly ? e.at : e._offset;
    const c = new Uint8Array(46 + name.length + extra.length), v = new DataView(c.buffer);
    v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, e.flags ?? 0x800, true); v.setUint16(10, e.method ?? 0, true);
    v.setUint32(16, e.centralOnly ? e.crc : e._crc, true); v.setUint32(20, e.packed ?? e.size ?? e._size, true); v.setUint32(24, e.size ?? e._size, true);
    v.setUint16(28, name.length, true); v.setUint16(30, extra.length, true); v.setUint32(38, e.external ?? 0, true); v.setUint32(42, at, true);
    c.set(name, 46); c.set(extra, 46 + name.length); central.push(c);
  }
  const size = central.reduce((n, c) => n + c.length, 0), end = new Uint8Array(22), v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, eocd.count ?? entries.length, true); v.setUint16(10, eocd.count ?? entries.length, true);
  v.setUint32(12, eocd.size ?? size, true); v.setUint32(16, eocd.offset ?? offset, true);
  const loc = new Uint8Array(20); new DataView(loc.buffer).setUint32(0, 0x07064b50, true);
  return new File([...parts, ...central, ...(locator ? [loc] : []), end], 'x.ss');
}
// A valid entry list from a real fixture, to break one thing at a time.
async function validEntries(options = {}) {
  const { packet, clips } = localPacket(options);
  const archiveId = await ssArchiveId(packet);
  const header = { format: 'seamless-scene-edit', version: 1, archive_id: archiveId, created_at: '2026-10-11T12:00:00.000Z', generator: 'test', min_extension: '0.63.0' };
  const list = [{ name: 'seamless-edit.json', data: JSON.stringify(header) }, { name: 'edit-packet.json', data: JSON.stringify(packet) }];
  for (const b of packet.asset_bindings) list.push({ name: b.relative_path, data: await bytes(clips.get(b.sha256)) });
  return { list, packet, clips, archiveId, header };
}

test('.ss round trip: the reader returns the header, packet, details and zero-copy clip slices that the local import accepts', async () => {
  const { file, archiveId, packet, clips } = await ssFile({ count: 3 });
  const a = await readSsArchive(file, { extensionVersion: '0.63.0' });
  assert.equal(a.archiveId, archiveId);
  assert.equal(a.header.archive_id, archiveId);
  assert.equal(a.clipCount, 3);
  assert.deepEqual({ ...a.details, listing: undefined, listingMissing: undefined }, { title: 'Tilly, the Tin Courier', creator_name: 'Test Creator', show_title: 'Orbit Station', listing: undefined, listingMissing: undefined });
  assert.deepEqual(a.details.listingMissing.map(m => m.key), ['title', 'description', 'category', 'tags', 'mature', 'revision'], 'details.json without a listing: not ready to submit');
  assert.deepEqual(a.signature, { status: 'unsigned' });
  for (const [hash, blob] of clips) assert.deepEqual(await bytes(a.clipBlob(hash)), await bytes(blob));
  const files = a.files();
  assert.deepEqual(files.map(f => f.webkitRelativePath), ['edit/edit-packet.json', ...packet.asset_bindings.map(b => `edit/${b.relative_path}`)]);
  // The slices go through the same local import as a folder did (here with a stub media check).
  const seen = [];
  const loaded = await loadFixturePacket(files, null, { expectedService: 'prime-video', validateAsset: async (f, expected) => { seen.push(expected.sha256); assert.equal(f.size, clips.get(expected.sha256).size); return { ok: true }; } });
  assert.equal(loaded.files.size, 3);
  assert.deepEqual(seen.sort(), [...clips.keys()].sort());
});

test('archive_id ignores packet formatting and clip order, and changes with any clip or packet change', async () => {
  const { packet } = localPacket({ count: 3 });
  const id = await ssArchiveId(packet);
  const reordered = structuredClone(packet); reordered.asset_bindings.reverse();
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  const pretty = await writeSsArchive({ packet, clips: localPacket({ count: 3 }).clips, packetText: JSON.stringify(packet, null, 4) });
  assert.equal(pretty.archiveId, id);
  assert.notEqual(await ssArchiveId(reordered), id, 'binding order is part of the packet');
  const moved = structuredClone(packet); moved.manifest.segments[0].trigger_time_ms += 1;
  assert.notEqual(await ssArchiveId(moved), id);
  assert.notEqual(await ssArchiveId(localPacket({ count: 3, seed: 'b' }).packet), id);
});

test('refuses traversal, absolute paths, backslashes and drive letters', async () => {
  for (const name of ['../evil.mp4', '/etc/passwd', 'clips\\x.mp4', 'C:/x.mp4', 'clips/../edit-packet.json', 'clips/./x.mp4', 'aux.json']) {
    const { list } = await validEntries(); list.push({ name, data: 'x' });
    await refuses(readSsArchive(await rawZip(list)), 'ss-entry-path');
  }
  assert.equal(safeEntryPath('clips/' + 'a'.repeat(64) + '.mp4'), true);
});

test('refuses duplicates (also by case), unexpected entries, directories, symlinks and unbound clips', async () => {
  let v = await validEntries(); v.list.push({ name: 'Edit-Packet.json', data: '{}' });
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-duplicate');
  v = await validEntries(); v.list.push({ name: 'notes.txt', data: 'hi' });
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-unexpected-entry');
  v = await validEntries(); v.list.push({ name: 'clips/', data: '' });
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-unexpected-entry');
  v = await validEntries(); v.list.push({ name: 'details.json', data: '{}', external: (0xa1ff << 16) >>> 0 });
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-unexpected-entry');
  v = await validEntries(); v.list.push({ name: `clips/${'f'.repeat(64)}.mp4`, data: 'extra clip' });
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-unexpected-entry');
});

test('refuses compressed entries, encryption flags, data descriptors and ZIP64', async () => {
  let v = await validEntries(); v.list[2].method = 8;
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-compressed');
  v = await validEntries(); v.list[1].flags = 0x801;
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-encrypted');
  v = await validEntries(); v.list[1].flags = 0x808;
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-flags');
  v = await validEntries();
  await refuses(readSsArchive(await rawZip(v.list, { eocd: { count: 0xffff } })), 'ss-zip64');
  v = await validEntries(); v.list[2].extra = Uint8Array.from([1, 0, 0, 0]);
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-zip64');
  v = await validEntries(); v.list[2].localExtra = Uint8Array.from([1, 0, 0, 0]);
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-zip64');
  v = await validEntries();
  await refuses(readSsArchive(await rawZip(v.list, { locator: true })), 'ss-zip64');
});

test('refuses local/central header mismatches, overlapping entries and size lies', async () => {
  let v = await validEntries(); v.list[2].localCrc = 1;
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-header-mismatch');
  v = await validEntries(); v.list[2].localName = `clips/${'e'.repeat(64)}.mp4`;
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-header-mismatch');
  v = await validEntries(); v.list[2].localMethod = 8;
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-header-mismatch');
  // Size lies: central size differs from the stored data, or from the packed size.
  v = await validEntries(); v.list[2].size = 10_000; v.list[2].packed = 10_000;
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-header-mismatch');
  v = await validEntries(); v.list[2].packed = 5;
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-size');
  v = await validEntries(); v.list[3].size = SS_LIMITS.clipBytes + 1; v.list[3].packed = SS_LIMITS.clipBytes + 1;
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-limits');
  // A directory that does not end where the end record says.
  v = await validEntries();
  await refuses(readSsArchive(await rawZip(v.list, { eocd: { offset: 3 } })), 'ss-directory');
  // Overlap (a zip-bomb shape): a second central record whose local header lies inside another entry's data.
  v = await validEntries();
  const inner = await rawZip([{ name: 'poster.jpg', data: Uint8Array.from([0xff, 0xd8, 0xff, 1]) }]);
  const innerBytes = (await bytes(inner)).subarray(0, 30 + 'poster.jpg'.length + 4);
  v.list.splice(2, 0, { name: 'details.json', data: innerBytes });
  const built = await rawZip(v.list);
  const detailsOffset = v.list[2]._offset + 30 + 'details.json'.length;
  const withOverlap = await rawZip([...v.list.map(e => ({ ...e })), { name: 'poster.jpg', centralOnly: true, at: detailsOffset, crc: await crc32(new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 1])])), size: 4 }]);
  assert.ok(built.size > 0);
  await refuses(readSsArchive(withOverlap), 'ss-overlap');
  // An oversized file is refused before any parsing.
  await refuses(readSsArchive({ size: SS_LIMITS.totalBytes + 1, slice: () => new Blob([]) }), 'ss-limits');
  await refuses(readSsArchive(new File(['not a zip at all, just text'], 'x.ss')), 'ss-not-archive');
});

test('refuses a damaged entry (CRC), a lying header, a header not first, and clip/binding mismatches', async () => {
  let v = await validEntries(); v.list[1].crc = 12345; v.list[1].localCrc = 12345;
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-crc');
  v = await validEntries(); v.list[0].data = JSON.stringify({ ...v.header, archive_id: 'b'.repeat(64) });
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-archive-id');
  v = await validEntries(); [v.list[0], v.list[1]] = [v.list[1], v.list[0]];
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-header-invalid');
  v = await validEntries(); v.list[0].data = JSON.stringify({ ...v.header, extra: 1 });
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-header-invalid');
  v = await validEntries(); v.list.pop();
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-clips-mismatch');
  v = await validEntries(); const p = structuredClone(v.packet); p.asset_bindings[0].relative_path = 'clip-1.mp4'; v.list[1].data = JSON.stringify(p);
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-clips-mismatch');
  v = await validEntries(); v.list[1].data = JSON.stringify({ ...v.packet, purpose: 'catalog' });
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-packet-invalid');
  v = await validEntries(); v.list.push({ name: 'poster.jpg', data: 'not a jpeg' });
  await refuses(readSsArchive(await rawZip(v.list)), 'ss-poster-invalid');
  v = await validEntries(); v.list[0].data = JSON.stringify({ ...v.header, min_extension: '0.70.0' });
  await refuses(readSsArchive(await rawZip(v.list), { extensionVersion: '0.63.0' }), 'ss-newer-extension');
  assert.equal(versionAtLeast('0.63.0', '0.63.0'), true);
  assert.equal(versionAtLeast('0.62.21', '0.63.0'), false);
  assert.equal(versionAtLeast('1.0', '0.63.0'), true);
});

test('a signature is optional; when present it must verify against a trusted site key (fail closed)', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const trustedKeys = [{ kid: 'site-1', jwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x } }];
  const signed = await ssFile({}, { signature: id => signSsArchiveId(id, keys.privateKey, 'site-1') });
  assert.deepEqual((await readSsArchive(signed.file, { trustedKeys })).signature, { status: 'verified', signer: 'site', keyId: 'site-1' });
  await refuses(readSsArchive(signed.file), 'ss-signature-invalid'); // key not trusted here
  const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const forged = await ssFile({}, { signature: id => signSsArchiveId(id, other.privateKey, 'site-1') });
  await refuses(readSsArchive(forged.file, { trustedKeys }), 'ss-signature-invalid');
  const creator = await ssFile({}, { signature: async id => ({ ...(await signSsArchiveId(id, keys.privateKey, 'site-1')), signer: 'creator' }) });
  await refuses(readSsArchive(creator.file, { trustedKeys }), 'ss-signature-invalid');
  // A signature over another identity (moved onto a different file) fails.
  const moved = await ssFile({ seed: 'z' }, { signature: async () => signSsArchiveId('c'.repeat(64), keys.privateKey, 'site-1') });
  await refuses(readSsArchive(moved.file, { trustedKeys }), 'ss-signature-invalid');
  assert.match(ssArchiveMessage('ss-signature-invalid'), /signature/);
  assert.match(ssArchiveMessage('anything-else'), /not a valid Seamless Scene edit file/);
});

test('the writer refuses packets whose bindings are not clips/<sha256>.mp4 or whose clips are missing', async () => {
  const { packet, clips } = localPacket();
  const wrong = structuredClone(packet); wrong.asset_bindings[0].relative_path = 'scene-1.mp4';
  await refuses(writeSsArchive({ packet: wrong, clips }), 'ss-clips-mismatch');
  await refuses(writeSsArchive({ packet, clips: new Map() }), 'ss-clips-mismatch');
  const zip = await zipStored([['a.txt', new Blob(['x'])]]);
  assert.equal(zip.size, 30 + 5 + 1 + 46 + 5 + 22);
});
