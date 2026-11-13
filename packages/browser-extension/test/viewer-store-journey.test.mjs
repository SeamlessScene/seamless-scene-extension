import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewerStore } from '../src/viewer-store.mjs';
import { matchingEdits } from '../src/viewer-candidates.mjs';

import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';

const id = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('repeated authoring stops retain the stopped edit as an explicit downloaded choice after reopening', async () => {
  const indexedDB = fakeIndexedDB(), store = createViewerStore({ indexedDB });
  const source = 'observed-live-source';
  await store.upsert({ id: id(1), origin: 'website', title: 'Kept edit', version: '1', sourceKey: 'manifest-source', transport: 'protected', availability: 'downloaded' });
  await store.remember(source, id(1), false, '1');
  await store.remember(source, id(1), true, '1'); // First authoring action stops the loaded edit.
  await store.remember(source, '', true, ''); // Later seeks/captures see no loaded edit.
  await store.remember(source, '', true, '');
  const data = await createViewerStore({ indexedDB }).read();
  assert.deepEqual(data.selections[source], { id: id(1), disabled: true, version: '1' });
  assert.deepEqual(matchingEdits({ state: 'idle', sourceKey: source }, data.library, null, data.selections[source]).map(x => x.id), [id(1)]);
  assert.deepEqual(matchingEdits({ state: 'idle', sourceKey: 'another-source' }, data.library), []);
});

test('an empty stop still disables auto-arm, and a later explicit choice replaces the remembered edit', async () => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  await store.remember('new-source', '', true, '');
  assert.deepEqual((await store.read()).selections['new-source'], { id: '', disabled: true, version: '' });
  await store.remember('new-source', id(1), false, '1');
  await store.remember('new-source', '', true, '');
  await store.remember('new-source', id(2), false, '2');
  assert.deepEqual((await store.read()).selections['new-source'], { id: id(2), disabled: false, version: '2' });
});

test('library entries keep website metadata across updates, and several stay downloaded', async () => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  await store.upsert({ id: id(1), origin: 'website', title: 'A', transport: 'protected', availability: 'downloaded' });
  await store.annotate(id(1), 'website', { editId: id(11), name: 'Bar fight', creatorName: 'Maker', streamingUrl: 'https://www.amazon.com/gp/video/detail/B04A826A41', lastWatchedAt: 5 });
  await store.annotate(id(1), 'website', { streamingUrl: 'https://evil.example/x' });
  await store.upsert({ id: id(1), origin: 'website', title: 'A', transport: 'protected', availability: 'downloaded' });
  await store.upsert({ id: id(2), origin: 'website', title: 'B', transport: 'protected', availability: 'downloaded' });
  const { library } = await store.read();
  const a = library.find(x => x.id === id(1));
  assert.equal(a.name, 'Bar fight'); assert.equal(a.creatorName, 'Maker'); assert.equal(a.streamingUrl, 'https://www.amazon.com/gp/video/detail/B04A826A41', 'an invalid link never replaces a valid one');
  assert.deepEqual(library.map(x => x.availability), ['downloaded', 'downloaded'], 'a second download no longer marks the first missing');
});

test('watch intents last a day, one per release, and an update repoints remembered choices', async () => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  await store.addIntent(id(1), 1000); await store.addIntent(id(1), 2000); await store.addIntent(id(2), 2000, id(1));
  assert.deepEqual((await store.intents(3000)).map(x => [x.releaseId, x.replaces ?? null]), [[id(1), null], [id(2), id(1)]]);
  assert.deepEqual(await store.intents(2000 + 86_400_001), [], 'expired');
  await assert.rejects(store.addIntent('nope'), /release-invalid/);
  await store.consumeIntent(id(1)); assert.deepEqual((await store.intents(3000)).map(x => x.releaseId), [id(2)]);
  await store.remember('source-a', id(1), false, '1'); await store.repoint(id(1), id(2));
  assert.equal((await store.read()).selections['source-a'].id, id(2));
});

test('local edits: an index row per stored copy, updated and removed by archive_id; the folder check is remembered', async () => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  const row = { archiveId: 'a'.repeat(64), packetId: 'riley', revision: 1, name: 'Tilly', sourceKey: 'k', addedAt: 1 };
  await store.saveLocalEdit(row);
  assert.deepEqual((await store.localEdits()).map(x => [x.archiveId.slice(0, 4), x.name]), [['aaaa', 'Tilly']]);
  await store.updateLocalEdit(row.archiveId, { lastWatchedAt: 5 });
  assert.equal((await store.localEdits())[0].lastWatchedAt, 5);
  await store.removeLocalEdit(row.archiveId); assert.deepEqual(await store.localEdits(), []);
  await assert.rejects(store.saveLocalEdit({ archiveId: '../x', packetId: 'p', revision: 1 }), /local-invalid/);
  assert.equal(await store.localFolderCheck(), null);
  await store.localFolderCheck({ at: 9, files: 3, added: 1 });
  assert.deepEqual(await store.localFolderCheck(), { at: 9, files: 3, added: 1 });
});

test('update completion rejects stale attempts and publishes the new version once without deleting either release', async () => {
  const indexedDB = fakeIndexedDB(), store = createViewerStore({ indexedDB });
  const row = { origin: 'website', title: 'Complete', transport: 'protected', availability: 'downloaded', sourceKey: 'source' };
  await store.upsert({ ...row, id: id(1), version: '1', name: 'Old name' });
  await store.upsert({ ...row, id: id(2), version: '2', name: 'New name' });
  await store.remember('source', id(1), true, '1');
  await store.addIntent(id(2), Date.now(), id(1));
  const first = (await store.intents())[0];
  await store.addIntent(id(2), Date.now(), id(1));
  const next = (await store.intents())[0];
  assert.equal(await store.completeUpdate(id(2), first.attemptId), false);
  assert.equal((await store.read()).selections.source.id, id(1));
  assert.equal(await store.completeUpdate(id(2), next.attemptId), true);
  assert.equal(await store.completeUpdate(id(2), next.attemptId), false);
  const reopened = await createViewerStore({ indexedDB }).read();
  assert.deepEqual(reopened.selections.source, { id: id(2), version: '2', disabled: true });
  assert.deepEqual(reopened.library.map(x => [x.id, x.name]), [[id(1), 'Old name'], [id(2), 'New name']]);
  assert.deepEqual(await store.intents(), []);
});

test('refused Watch persists without deleting library data and an equal-time new Watch has independent ownership', async () => {
  const indexedDB = fakeIndexedDB(), store = createViewerStore({ indexedDB });
  await store.upsert({ id: id(1), origin: 'website', title: 'Kept edit', transport: 'protected', availability: 'downloaded' });
  await store.addIntent(id(1), 2000); const first = (await store.intents(2000))[0];
  assert.equal(await store.failIntent(id(1), first.attemptId), true);
  const reopened = createViewerStore({ indexedDB });
  assert.equal((await reopened.intents(2000))[0].failureCode, 'viewer-release-unavailable');
  assert.equal((await reopened.read()).library[0].title, 'Kept edit');
  await reopened.addIntent(id(1), 2000); const next = (await reopened.intents(2000))[0];
  assert.notEqual(first.attemptId, next.attemptId); assert.equal(next.failureCode, undefined);
  assert.equal(await store.failIntent(id(1), first.attemptId), false);
  await store.consumeIntent(id(1), first.attemptId);
  assert.equal((await store.intents(2000))[0].attemptId, next.attemptId);
  await store.consumeIntent(id(1), next.attemptId); assert.deepEqual(await store.intents(2000), []);
});

test('an existing stored Watch without an attempt ID can be refused by its original creation time', async () => {
  const indexedDB = fakeIndexedDB();
  indexedDB.data.set('model', { version: 1, library: [], selections: {}, preferences: {}, intents: [{ releaseId: id(1), createdAt: 2000, expiresAt: 86402000 }] });
  const store = createViewerStore({ indexedDB });
  assert.equal(await store.failIntent(id(1), 1999), false);
  assert.equal(await store.failIntent(id(1), 2000), true);
  assert.equal((await store.intents(3000))[0].failureCode, 'viewer-release-unavailable');
});
