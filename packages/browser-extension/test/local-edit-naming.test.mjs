import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewerStore } from '../src/viewer-store.mjs';
import { sourceKey } from '../src/viewer-model.mjs';
import { importLocalEdit, localRows } from '../src/local-library.mjs';
import { viewerView, sceneJump, popupEditLine } from '../src/viewer-display.mjs';
import { menuMarkup } from '../src/viewer-overlay.mjs';
import { fakeIndexedDB } from './helpers/viewer-indexeddb.mjs';
import { ssFile, memoryRoot } from './helpers/ss-fixture.mjs';
import { harness } from './helpers/local-harness.mjs';

// 0.63.4: the local edit's name while on, Next scene in a lead-in, and neutral
// wording for unsigned local files.
const RILEY = { service: 'prime-video', territory: 'US', service_content_id: 'amzn1.dv.gti.676a72dd-aeb9-449b-8f90-49e8f9e06d4b', title: 'Orbit Station',
  season: 1, episode: 1, expected_runtime_ms: 2709693, runtime_tolerance_ms: 1000, service_tier: 'ad-free', version_tag: 'creator-reported' };
const live = sourceKey({ serviceId: 'prime-video', activeItemId: RILEY.service_content_id, mediaType: 'episode', season: 1, episode: 1, runtimeMs: 2_709_500, versionTag: null, territory: null, plan: null });

test('a local edit that is on is named "Local: <name>" in the player menu and toolbar, never "Your edit"', async t => {
  const store = createViewerStore({ indexedDB: fakeIndexedDB() }), root = memoryRoot();
  const made = await ssFile({ packetId: 'riley-local', title: 'Tilly, the Tin Courier', source: RILEY });
  await importLocalEdit(made.file, { store, root, preferences: {}, validate: async () => ({ ok: true }) });
  const h = await harness(t, { store });
  const { p } = h.player(1, live);
  await h.send('local-watch', { archiveId: made.archiveId }, h.settings);
  // The player reports the packet's own edit id and version once it is on.
  Object.assign(p, { editId: 'riley-local', version: '1' });
  const playback = (await h.send('snapshot', {}, h.top(1))).value.playback;
  assert.equal(playback.editName, 'Local: Tilly, the Tin Courier');
  const view = viewerView({ playback: { ...playback, state: 'armed', scenes: [] } });
  assert.equal(view.name, 'Local: Tilly, the Tin Courier');
  assert.match(menuMarkup(view).head, /<p class="ename" title="Local: Tilly, the Tin Courier">Local: Tilly, the Tin Courier<span class="v">v1<\/span>/);
  assert.equal(popupEditLine(view), 'Local: Tilly, the Tin Courier · v1');
  assert.doesNotMatch(menuMarkup(view).head, /Your edit/);
  // Another edit playing in that tab (a different edit id) is not given the local name.
  Object.assign(p, { editId: 'someone-else' });
  assert.equal((await h.send('snapshot', {}, h.top(1))).value.playback.editName, undefined);
});

test('one Next after Tilly scene 5 lands on scene 6; scene 7 takes a second Next (step-through by design) or a row tap', () => {
  const scene = (startMs, resumeMs, status = 'pending') => ({ type: 'REPLACE', startMs, resumeMs, status });
  // Tilly revision 3 starts (ms), lead-in 5 s; scenes 1–5 played.
  const scenes = [scene(1_192_617, 1_199_248, 'played'), scene(1_232_782, 1_237_912, 'played'), scene(1_246_462, 1_252_552, 'played'), scene(1_932_475, 1_937_814, 'played'),
    scene(2_041_613, 2_047_119, 'played'), scene(2_154_570, 2_160_910), scene(2_193_275, 2_198_864)];
  // At 34:13 (after scene 5, "Next: 6 of 7 in 1m 42s"): Next goes to scene 6's lead-in, 35:49.6.
  assert.deepEqual(sceneJump(scenes, { currentMs: 2_053_000, leadInMs: 5000 }, 'next'), { index: 5, targetMs: 2_149_570 });
  // From scene 6's jump point a second Next steps on to scene 7's lead-in (36:28.3), the landing the desktop saw.
  assert.deepEqual(sceneJump(scenes, { currentMs: 2_149_570, leadInMs: 5000 }, 'next'), { index: 6, targetMs: 2_188_275 });
  // A tap on row 7 lands there directly.
  assert.deepEqual(sceneJump(scenes, { currentMs: 2_053_000, leadInMs: 5000 }, 6), { index: 6, targetMs: 2_188_275 });
});

test('an unsigned local file reads "Unsigned", a site-signed one "Signed"', () => {
  const base = { archiveId: 'a'.repeat(64), packetId: 'p', revision: 1, name: 'Tilly', sourceKey: 'k', bytes: 1, conflict: false, updatedFrom: null };
  assert.deepEqual(localRows([{ ...base, signature: { status: 'unsigned' } }])[0].status, { kind: 'unsigned', label: 'Unsigned' });
  assert.deepEqual(localRows([{ ...base, signature: { status: 'verified', signer: 'site', keyId: 'k' } }])[0].status, { kind: 'ready', label: 'Signed' });
});
