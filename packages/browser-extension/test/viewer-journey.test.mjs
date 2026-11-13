import test from 'node:test';
import assert from 'node:assert/strict';
import { editProgress, publicPlayback, indicator } from '../src/viewer-model.mjs';
import { viewerView, popupPlan } from '../src/viewer-display.mjs';

const actions = [{ id: 'a', triggerMs: 10_000, resumeMs: 15_000 }, { id: 'b', triggerMs: 30_000, resumeMs: 30_000 }];

test('scenes behind the playhead are counted and a fully played edit is finished', () => {
  assert.deepEqual(editProgress({ statuses: { a: 'skipped', b: 'pending' } }, actions, 20_000), { skippedCount: 1, finished: false });
  assert.deepEqual(editProgress({ statuses: { a: 'completed', b: 'completed' } }, actions, 31_000), { skippedCount: 0, finished: true });
  assert.equal(editProgress({ statuses: { a: 'completed', b: 'completed' }, runningActionId: 'b' }, actions, 31_000).finished, false);
  assert.equal(editProgress({ statuses: { a: 'skipped', b: 'skipped' } }, actions, 40_000).finished, false, 'nothing was actually watched');
  assert.equal(publicPlayback({ state: 'finished', skippedCount: 2 }).skippedCount, 2);
  assert.equal(indicator({ state: 'finished' }).chip, 'Finished');
});

test('the popup always offers the one step that unblocks the viewer, in order', () => {
  const linked = { state: 'saved' }, playing = { state: 'idle', sourceKey: 'k' };
  const plan = (playback, matches = [], context = {}) => popupPlan(viewerView({ playback: publicPlayback(playback), matches }), { account: linked, ...context });
  assert.equal(plan(playing, [], { account: { state: 'unpaired' } }).main.act, 'link');
  assert.equal(plan({ state: 'unavailable' }, [], { onSupportedSite: true, siteAllowed: false }).main.label, 'Allow Prime Video');
  assert.match(plan({ state: 'unavailable' }, [], { onSupportedSite: true, siteAllowed: true }).sub, /Press play/);
  assert.equal(plan({ state: 'unavailable' }, [], { onSupportedSite: true, siteAllowed: true }).main.label, 'Find an edit', 'press play is a status line, not a missing button');
  const one = plan(playing, [{ id: 'r1', title: 'Edit', name: 'Edit', version: '1' }]);
  assert.equal(one.main.label, 'Watch with edit'); assert.equal(one.main.releaseId, 'r1'); assert.deepEqual(one.row.map(b => b.label), ['Change edit…']);
  assert.equal(plan(playing, [{ id: 'r1' }, { id: 'r2' }]).list, true);
  assert.equal(plan(playing, []).main.label, 'Find an edit');
  const behind = plan({ state: 'armed', sourceKey: 'k', skippedCount: 2, scenes: [{ type: 'REPLACE', startMs: 1000, resumeMs: 2000, status: 'skipped' }] });
  assert.equal(behind.main.label, 'Jump to scene 1'); assert.deepEqual(behind.row.map(b => b.label), ['Next scene', 'Stop edit', 'Change edit…']);
  assert.equal(plan({ state: 'armed', sourceKey: 'k' }).main.label, 'Stop edit');
  assert.equal(plan({ state: 'finished', sourceKey: 'k' }).main.label, 'Watch again');
  assert.equal(plan({ state: 'idle' }).main.label, 'Find an edit');
  assert.equal(popupPlan(viewerView({ playback: publicPlayback(playing) }), { fixtureOnly: true, account: { state: 'unpaired' } }).main.act, 'find', 'the private test build has no account step');
});

test('removing an edit a player still holds says what to do', async () => {
  const { viewerFailureMessage } = await import('../src/viewer-model.mjs');
  assert.match(viewerFailureMessage(Error('vault-release-open')), /Stop it there/);
  assert.match(viewerFailureMessage(Error('protected-owner-busy')), /Prime Video tab/);
  assert.equal(viewerFailureMessage(Error('protected-owner-busy')), viewerFailureMessage(Error('viewer-owner-busy')), 'one wording for one situation');
});
