import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogDiscovery, releaseDisplay } from '../src/catalog-discovery.mjs';
import { displayHint, needsMetadata } from '../src/library-recovery.mjs';
import { createViewerStore } from '../src/viewer-store.mjs';
import { loadedEditMetadata, loadedEditLabel, shownVersion } from '../src/loaded-edit-display.mjs';
import { viewerView, chooserItems, popupEditLine } from '../src/viewer-display.mjs';
import { matchingEdits } from '../src/viewer-candidates.mjs';
import { downloadedRows } from '../src/edits-model.mjs';
import { publicPlayback, sourceKey } from '../src/viewer-model.mjs';
import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';

// Website r30 adds displayVersion (the release's 1-based position in its edit) beside
// version/releaseVersion (manifest_version). Deep Current Highlights: manifest 1, shown as v4.
const release = '68683756-0000-4000-8000-000000000001', editId = '0e00235c-0000-4000-8000-000000000002';
const gti = 'amzn1.dv.gti.f03e20de-4d15-400d-8b51-93e0356abc4c';
const source = { serviceId: 'prime-video', activeItemId: gti, mediaType: 'episode', season: 1, episode: 1, runtimeMs: 2886000, versionTag: null, territory: 'US', plan: 'ad-free' };
const display = patch => ({ editId, name: 'Deep Current 1x01 — Pilot Swap: Highlights', creatorName: 'Test Creator', releaseVersion: 1,
  streamingUrl: `https://www.amazon.com/gp/video/detail/${gti}`, source, ...patch });

test('the website display version is copied where present, and ignored when absent or malformed', () => {
  assert.equal(releaseDisplay(display({ displayVersion: 4 })).displayVersion, 4);
  assert.equal(releaseDisplay(display({ displayVersion: 4 })).releaseVersion, 1, 'releaseVersion stays manifest_version');
  for (const bad of [undefined, 0, -1, 1.5, '4', 2 ** 31]) assert.equal('displayVersion' in releaseDisplay(display({ displayVersion: bad })), false, String(bad));
  assert.equal(displayHint(releaseDisplay(display({ displayVersion: 4 }))).displayVersion, 4);
  assert.equal('displayVersion' in displayHint(releaseDisplay(display({}))), false);
});

test('discovery items show "· v4" and carry it as display only; the old reply keeps "v{version}"', async () => {
  const key = JSON.stringify(['prime-video', 'B04A826A41', 'movie', null, null, 5400000, null, 'US', 'included']);
  const items = [{ releaseId: release, name: 'Highlights', version: 1, displayVersion: 4, ready: true },
    { releaseId: '68683756-0000-4000-8000-000000000009', name: 'Older server', version: 2, ready: true }];
  const discovery = createCatalogDiscovery({ id: 'a'.repeat(32) }, { pairingOrigin: 'https://example.test', deviceLinkLifetimeSeconds: 60 },
    { journal: { read: async () => ({ active: { token: 'b'.repeat(64) } }) }, fetcher: async () => ({ status: 200, text: async () => JSON.stringify({ data: { state: 'paired', items } }) }) });
  const result = await discovery.discover({ state: 'idle', sourceKey: key });
  assert.equal(result.items[0].title, 'Highlights · v4'); assert.equal(result.items[0].displayVersion, 4); assert.equal(result.items[0].version, 1);
  assert.equal(result.items[1].title, 'Older server · v2'); assert.equal('displayVersion' in result.items[1], false);
  assert.deepEqual(chooserItems(result.items).map(x => x.version), ['v4', ''], 'remote rows: v4 when sent; a numeric manifest version was never shown there');
  assert.deepEqual(chooserItems([{ id: release, name: 'A', version: '1', displayVersion: 4 }, { id: 'b', name: 'B', version: '2' }]).map(x => x.version), ['v4', 'v2']);
});

test('a kept row learns its display version from the status hint; identity is unchanged', async () => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() });
  const packetKey = sourceKey(source);
  await store.upsert({ id: release, title: 'Highlights', origin: 'website', transport: 'protected', availability: 'downloaded', version: '1', sourceKey: packetKey });
  assert.equal(needsMetadata((await store.read()).library[0]), true);
  assert.deepEqual(await store.recoverMetadata([{ releaseId: release, kept: true, display: displayHint(releaseDisplay(display({ displayVersion: 4 }))) }]), [release]);
  let row = (await store.read()).library[0];
  assert.deepEqual([row.version, row.sourceKey, row.displayVersion], ['1', packetKey, 4]);
  // Reopening the packet keeps it (descriptive metadata survives upsert).
  await store.upsert({ id: release, title: 'Highlights', origin: 'website', transport: 'protected', availability: 'downloaded', version: '1', sourceKey: packetKey });
  row = (await store.read()).library[0];
  assert.equal(row.displayVersion, 4);
  // A hint with a moved position follows it.
  await store.recoverMetadata([{ releaseId: release, kept: true, display: displayHint(releaseDisplay(display({ displayVersion: 5 }))) }]);
  assert.equal((await store.read()).library[0].displayVersion, 5);
});

test('the player menu, popup, chooser, library and Edits page say v4, and fall back to the manifest version', () => {
  const library = [{ id: release, origin: 'website', transport: 'protected', version: '1', name: 'Highlights', displayVersion: 4, availability: 'downloaded', sourceKey: 'k' }];
  const playback = publicPlayback({ state: 'armed', sourceKey: 'k', editId: release, version: '1', canStop: true, currentTimeMs: 0,
    scenes: [{ type: 'REPLACE', startMs: 1000, resumeMs: 2000, status: 'pending' }] });
  const described = { ...playback, ...loadedEditMetadata(playback, library) };
  assert.equal(described.displayVersion, 4);
  assert.equal(loadedEditLabel(described), 'Highlights · v4');
  const view = viewerView({ playback: described });
  assert.equal(view.version, 'v4'); assert.equal(popupEditLine(view), 'Highlights · v4');
  // Absent (older website): the manifest version, as before.
  const old = { ...playback, ...loadedEditMetadata(playback, [{ ...library[0], displayVersion: undefined }]) };
  assert.equal(viewerView({ playback: old }).version, 'v1');
  assert.equal(shownVersion({ version: '1' }), '1'); assert.equal(shownVersion({ version: '1', displayVersion: 0 }), '1');
  // Never part of matching: same rows, same matches, with or without it.
  const kept = [{ ...library[0], title: 'Highlights' }, { ...library[0], id: '68683756-0000-4000-8000-000000000004', version: '2', displayVersion: 3, title: 'Highlights' }];
  const withShown = matchingEdits({ sourceKey: 'k' }, kept), without = matchingEdits({ sourceKey: 'k' }, kept.map(({ displayVersion, ...x }) => x));
  assert.deepEqual(withShown.map(x => x.id), without.map(x => x.id));
  assert.deepEqual(withShown.map(x => x.title).sort(), ['Highlights · v3', 'Highlights · v4']);
  assert.deepEqual(without.map(x => x.title).sort(), ['Highlights · v1', 'Highlights · v2']);
  const rows = downloadedRows({ library, vault: [{ releaseId: release, bytes: 1 }] });
  assert.equal(rows[0].version, '4');
  assert.equal(downloadedRows({ library: [{ ...library[0], displayVersion: undefined }], vault: [{ releaseId: release, bytes: 1 }] })[0].version, '1');
});
