import test from 'node:test';
import assert from 'node:assert/strict';
import { importLocalEdit, removeLocalEdit, localRows, localSpaceSummary, openLocalCopy, editSignature } from '../src/local-library.mjs';
import { createViewerStore } from '../src/viewer-store.mjs';
import { preferences, preferenceChange } from '../src/viewer-model.mjs';
import { signSsArchiveId } from '../src/ss-archive.mjs';
import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';
import { ssFile, localPacket, memoryRoot } from './helpers/ss-fixture.mjs';

// P1 (0.63.0): Add a local edit, its checks, the copy into extension storage and every row
// of the plan's collision table.
async function setup(prefs = {}) {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() }), root = memoryRoot(), checked = [];
  const validate = async (files, { onProgress }) => { checked.push(files.length - 1); onProgress?.(files.length - 1, files.length - 1); return { ok: true }; };
  const add = (file, extra = {}) => importLocalEdit(file, { store, root, validate, preferences: { ...preferences(), ...prefs }, now: 1_000, ...extra });
  return { store, root, checked, add };
}

test('Add a local edit: checked once, copied into extension storage, indexed, and listed like a Library row', async () => {
  const h = await setup(), { file, archiveId } = await ssFile({ count: 3 }), phases = [];
  const result = await h.add(file, { onProgress: p => phases.push(p.phase) });
  assert.equal(result.status, 'added');
  assert.match(result.message, /^Added “Tilly, the Tin Courier”\. It shows as “Local: Tilly, the Tin Courier” when you watch Orbit Station S1 E4\.$/);
  assert.deepEqual(h.checked, [3], 'every clip checked once');
  assert.deepEqual([...new Set(phases)], ['reading', 'checking', 'copying', 'done']);
  const copy = await openLocalCopy(h.root, archiveId);
  assert.equal(copy.size, file.size, 'the stored copy is the whole file');
  const [row] = await h.store.localEdits();
  assert.equal(row.archiveId, archiveId);
  assert.equal(row.packetId, 'tilly-tin-courier');
  assert.equal(row.revision, 1);
  assert.equal(row.signature.status, 'unsigned');
  assert.match(row.sourceKey, /amzn1\.dv\.gti/);
  assert.equal(row.streamingUrl, 'https://www.amazon.com/gp/video/detail/amzn1.dv.gti.642b66cd-63e6-4cd1-8c97-8e8ba3e95185');
  const [shown] = localRows(await h.store.localEdits());
  assert.deepEqual(shown, { archiveId, name: 'Tilly, the Tin Courier', titleName: 'Orbit Station', episodeName: 'S1 E4', streamingUrl: row.streamingUrl,
    bytes: file.size, lastWatchedAt: null, status: { kind: 'unsigned', label: 'Unsigned' }, actions: ['watch', 'export', 'remove'],
    readiness: 'Not ready to submit: title (missing from edit.json), description (missing from edit.json), category (missing from edit.json), tags (missing from edit.json), mature (missing from edit.json), revision (missing from edit.json)' });
  await removeLocalEdit(archiveId, { store: h.store, root: h.root });
  assert.deepEqual(await h.store.localEdits(), []);
  await assert.rejects(openLocalCopy(h.root, archiveId), /viewer-local-missing/);
});

test('collision: the same file twice is "already added" and nothing is copied again', async () => {
  const h = await setup(), { file } = await ssFile();
  await h.add(file);
  const again = await h.add(new File([file], 'renamed copy.ss'));
  assert.equal(again.status, 'already');
  assert.equal(again.message, '“Tilly, the Tin Courier” is already added.');
  assert.equal(h.checked.length, 1, 'no second check');
  assert.equal((await h.store.localEdits()).length, 1);
});

test('collision: a newer revision replaces the older one (or keeps both when chosen); an older one is refused', async () => {
  const h = await setup(), r1 = await ssFile({ revision: 1 }), r2 = await ssFile({ revision: 2, seed: 'b' }), r3 = await ssFile({ revision: 3, seed: 'c' });
  await h.add(r1.file);
  const updated = await h.add(r2.file);
  assert.equal(updated.status, 'updated');
  assert.equal(updated.message, 'Updated “Tilly, the Tin Courier” to revision 2.');
  const rows = await h.store.localEdits();
  assert.deepEqual(rows.map(r => r.revision), [2]);
  assert.equal(localRows(rows)[0].status.label, 'Updated to revision 2');
  assert.equal(h.root.dirs.has(r1.archiveId), false, 'the older copy is deleted');
  const older = await h.add(r1.file);
  assert.equal(older.status, 'older');
  assert.equal(older.message, 'You already have a newer revision of “Tilly, the Tin Courier” (revision 2).');
  const keep = await setup({ keepBothRevisions: true });
  await keep.add(r2.file); await keep.add(r3.file);
  const both = localRows(await keep.store.localEdits());
  assert.deepEqual(both.map(r => r.status.label).sort(), ['Newer revision available', 'Updated to revision 3']);
});

test('collision: same edit and revision with different content keeps both, marks the newcomer and names it', async () => {
  const h = await setup(), mine = await ssFile({ seed: 'a' }), theirs = await ssFile({ seed: 'x', creator: 'Dana' }), third = await ssFile({ seed: 'y', creator: 'Dana', fileName: 'riley-from-sam.ss' });
  await h.add(mine.file);
  const conflict = await h.add(theirs.file);
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.row.name, 'Tilly, the Tin Courier · Dana');
  assert.match(conflict.message, /conflicting copy/);
  const again = await h.add(third.file);
  assert.equal(again.row.name, 'Tilly, the Tin Courier · riley-from-sam', 'a creator already used names the file instead');
  const rows = localRows(await h.store.localEdits());
  assert.deepEqual(rows.map(r => r.status.label).sort(), ['Conflicting copy', 'Conflicting copy', 'Unsigned']);
  assert.equal(new Set(rows.map(r => r.archiveId)).size, 3, 'distinct choices');
});

test('collision: an edit identical to a catalog edit says "Also in the catalog"; different edits reusing clips stay separate copies', async () => {
  const h = await setup(), { file, packet } = await ssFile();
  const catalog = [{ id: '11111111-1111-4111-8111-111111111111', editSignature: await editSignature(packet) }];
  const result = await h.add(file, { catalog });
  assert.equal(result.row.alsoInCatalog, catalog[0].id);
  assert.equal(localRows(await h.store.localEdits())[0].status.label, 'Also in the catalog');
  // Same clips, different edit (another packet id): its own copy; removing one keeps the other.
  const other = localPacket({ packetId: 'riley-alt' });
  const reuse = await ssFile({ packetId: 'riley-alt' });
  assert.deepEqual([...other.clips.keys()], [...localPacket().clips.keys()], 'precondition: the same clips');
  const added = await h.add(reuse.file);
  assert.equal(added.status, 'added');
  await removeLocalEdit(result.row.archiveId, { store: h.store, root: h.root });
  assert.equal((await openLocalCopy(h.root, reuse.archiveId)).size, reuse.file.size);
});

test('refusals: a broken or tampered file, clips that fail the check, the space limit, and unverified-file settings', async () => {
  const h = await setup(), { file } = await ssFile();
  const tampered = new Uint8Array(await file.arrayBuffer()); tampered[tampered.length - 200] ^= 1;
  const bad = await h.add(new File([tampered], 'x.ss'));
  assert.equal(bad.status, 'refused');
  const notZip = await h.add(new File(['hello'], 'x.ss'));
  assert.deepEqual([notZip.status, notZip.code], ['refused', 'ss-not-archive']);
  const failing = await h.add(file, { validate: async () => { throw Error('Local clip rejected: hash-mismatch'); } });
  assert.equal(failing.status, 'refused');
  assert.match(failing.message, /did not pass the check.*hash-mismatch/);
  assert.deepEqual(await h.store.localEdits(), [], 'nothing stored after a refusal');
  const tight = await setup({ localBudgetBytes: 1_000_000_000 });
  const huge = await tight.add(file, { preferences: { ...preferences(), localBudgetBytes: 1000 } });
  assert.deepEqual([huge.status, huge.code], ['refused', 'viewer-local-space']);
  const block = await setup({ unverifiedFiles: 'block' });
  assert.equal((await block.add(file)).code, 'viewer-local-unverified');
  const ask = await setup({ unverifiedFiles: 'ask' });
  assert.equal((await ask.add(file, { confirmUnverified: async () => false })).status, 'skipped');
  assert.equal((await ask.add(file, { confirmUnverified: async () => true })).status, 'added');
  // A verified (site-signed) file is never asked about and reads "Signed".
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const signed = await ssFile({ packetId: 'signed-edit' }, { signature: id => signSsArchiveId(id, keys.privateKey, 'site-1') });
  const verified = await block.add(signed.file, { trustedKeys: [{ kid: 'site-1', jwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x } }] });
  assert.equal(verified.status, 'added');
  assert.equal(localRows([verified.row])[0].status.label, 'Signed');
});

test('local settings: show the Local tab (on), 5 GB space, keep both revisions (off), unverified files (allow)', () => {
  const p = preferences();
  assert.deepEqual([p.showLocal, p.localBudgetBytes, p.keepBothRevisions, p.unverifiedFiles, p.localAutoCheck], [true, 5_000_000_000, false, 'allow', true]);
  assert.equal(preferenceChange(p, { showLocal: false }).showLocal, false);
  assert.equal(preferenceChange(p, { localBudgetBytes: 10_000_000_000 }).localBudgetBytes, 10_000_000_000);
  assert.throws(() => preferenceChange(p, { localBudgetBytes: 7 }), /preference-invalid/);
  assert.throws(() => preferenceChange(p, { unverifiedFiles: 'maybe' }), /preference-invalid/);
  assert.equal(localSpaceSummary([{ bytes: 1_200_000_000 }], 5_000_000_000).label, 'Using 1.2 GB of 5.0 GB for local edits');
});
