import test from 'node:test';
import assert from 'node:assert/strict';
import { registerViewerService } from '../src/viewer-service.mjs';
import { EXECUTING_BUILD } from '../src/build-info.mjs';
import { createViewerStore } from '../src/viewer-store.mjs';
import { sourceKey } from '../src/viewer-model.mjs';
import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';

// P3 (0.63.0): local edits in the player: "Local: <name>", switching, the Advanced switch,
// same-name disambiguation, catalog twins offered once, Watch from the Local tab, remembered
// choices and continuation into the next episode.
import { GTI, key, packetKey, row, event, until, harness } from './helpers/local-harness.mjs';

test('local edits matching the episode are offered as "Local: <name>", load from their copy, and switch like server edits', async t => {
  const h = await harness(t, { rows: [row(1), row(2, { name: 'Gate Cut', sourceKey: packetKey(5) })] });
  const { p } = h.player(1, key(4, 2_701_400));
  const snap = await h.send('snapshot', {}, h.top(1));
  assert.deepEqual(snap.value.matches.map(m => [m.id, m.name ?? m.title]), [[`local:${row(1).archiveId}`, 'Local: Tilly']]);
  const r = await h.send('command', { command: 'watch', releaseId: `local:${row(1).archiveId}`, generation: '1' }, h.top(1));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(h.calls.find(c => c.method === 'load-local').args, { archiveId: row(1).archiveId });
  assert.equal(p.state, 'armed');
  const [stored] = (await h.store.localEdits()).filter(x => x.archiveId === row(1).archiveId);
  assert.ok(stored.lastWatchedAt > 0, 'last watched is recorded on the local row');
  assert.equal((await h.store.read()).selections[key(4, 2_701_400)].id, `local:${row(1).archiveId}`, 'the choice is remembered per episode');
});

test('Advanced → Show the Local tab off hides local edits in the player', async t => {
  const h = await harness(t, { rows: [row(1)], prefs: { showLocal: false } });
  h.player(1, key(4));
  assert.deepEqual((await h.send('snapshot', {}, h.top(1))).value.matches, []);
});

test('two local edits with the same name on the same episode are told apart (by creator, else by number)', async t => {
  const h = await harness(t, { rows: [row(1, { creatorName: 'Dana' }), row(2, { creatorName: 'Sam' }), row(3), row(4)] });
  h.player(1, key(4));
  const names = (await h.send('snapshot', {}, h.top(1))).value.matches.map(m => m.name);
  assert.deepEqual(names, ['Local: Tilly · Dana', 'Local: Tilly · Sam', 'Local: Tilly · 3', 'Local: Tilly · 4']);
});

test('a local edit identical to a kept catalog edit is offered once, as the catalog edit', async t => {
  const release = '11111111-1111-4111-8111-111111111111';
  const catalog = { id: release, title: 'Tilly (catalog)', origin: 'website', transport: 'protected', availability: 'downloaded', version: '1', sourceKey: key(4), editSignature: row(1).editSignature };
  const h = await harness(t, { rows: [row(1, { alsoInCatalog: release }), row(2, { name: 'Other' })], library: [catalog] });
  h.player(1, key(4));
  const ids = (await h.send('snapshot', {}, h.top(1))).value.matches.map(m => m.id);
  assert.ok(ids.includes(release));
  assert.ok(!ids.includes(`local:${row(1).archiveId}`), 'the identical local copy is not listed twice');
  assert.ok(ids.includes(`local:${row(2).archiveId}`), 'a different local edit is still offered');
});

test('Watch in the Local tab turns the edit on in a tab playing its episode, or opens the episode and turns it on when it plays', async t => {
  const h = await harness(t, { rows: [row(1)] });
  const { p } = h.player(1, key(4));
  const now = await h.send('local-watch', { archiveId: row(1).archiveId }, h.settings);
  assert.equal(now.ok, true, JSON.stringify(now));
  assert.equal(p.state, 'armed');
  assert.deepEqual(h.updates[0], [1, { active: true }]);
  // No tab plays episode 5: the episode opens, and the edit turns on once a player reports it.
  const h2 = await harness(t, { rows: [row(5, { sourceKey: packetKey(5), streamingUrl: 'https://www.amazon.com/gp/video/detail/amzn1.dv.gti.156bb3f0-8b02-4990-8542-3545fff9e0b8' })] });
  const later = await h2.send('local-watch', { archiveId: row(5).archiveId }, h2.settings);
  assert.equal(later.value.message, 'Opening the episode. The edit turns on when you press play.');
  assert.equal(h2.created.length, 1);
  const { p: p2, controller } = h2.player(2, key(4));
  p2.sourceKey = key(5); p2.state = 'idle';
  controller.onMessage.emit({ status: { state: 'idle', sourceKey: key(5) }, build: EXECUTING_BUILD });
  await until(() => p2.state === 'armed');
  assert.deepEqual(h2.calls.find(c => c.method === 'load-local').args, { archiveId: row(5).archiveId });
  const missing = await h2.send('local-watch', { archiveId: 'f'.repeat(64) }, h2.settings);
  assert.deepEqual([missing.ok, missing.code], [false, 'viewer-local-missing']);
});

test('a remembered local choice turns on by itself, and continuation picks the same creator’s local edit of the next episode', async t => {
  const h = await harness(t, { rows: [row(1, { creatorName: 'Dana' })], prefs: { autoArm: true } });
  await h.store.remember(key(4), `local:${row(1).archiveId}`, false, '');
  const { p } = h.player(1, key(4));
  await until(() => p.state === 'armed');
  assert.ok(h.calls.some(c => c.method === 'load-local'));
  const h2 = await harness(t, { rows: [row(1, { creatorName: 'Dana' }), row(2, { creatorName: 'Dana', name: 'Next', sourceKey: packetKey(5) })], prefs: { continueEdits: true } });
  const { p: q, controller } = h2.player(1, key(4));
  await h2.send('command', { command: 'watch', releaseId: `local:${row(1).archiveId}`, generation: '1' }, h2.top(1));
  assert.equal(q.state, 'armed');
  // Status heartbeats while the local edit is on (its packet's own edit ID).
  controller.onMessage.emit({ status: { state: 'armed', sourceKey: key(4), editId: 'edit-1' }, build: EXECUTING_BUILD });
  controller.onMessage.emit({ status: { state: 'armed', sourceKey: key(4), editId: 'edit-1' }, build: EXECUTING_BUILD });
  await new Promise(r => setTimeout(r, 30));
  // Prime moves to the next episode in the same tab.
  Object.assign(q, { state: 'idle', sourceKey: key(5), editId: null, canStop: false, canArm: false, generation: '2' });
  controller.onMessage.emit({ status: { state: 'idle', sourceKey: key(5) }, build: EXECUTING_BUILD });
  await until(() => h2.calls.filter(c => c.method === 'load-local').length === 2);
  assert.deepEqual(h2.calls.filter(c => c.method === 'load-local').at(-1).args, { archiveId: row(2).archiveId });
});
