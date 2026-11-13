import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSourceCompatibility, RUNTIME_TOLERANCE_FLOOR_MS } from '../src/source-identity.mjs';
import { sourceMismatchCode, viewerFailureMessage } from '../src/viewer-model.mjs';
import { controllerFailureCode } from '../src/viewer-client.mjs';
import { failureCause } from '../src/viewer-load-error.mjs';
import { problemFor, viewerView } from '../src/viewer-display.mjs';
import { createPacketSessionController } from '../src/packet-session-controller.mjs';
import { PacketPlaybackJournal } from '../src/packet-playback-journal.mjs';
import { OperationContext } from '../src/operation-context.mjs';
import { ManifestActionScheduler } from '../src/manifest-action-scheduler.mjs';
import { ManifestActionExecutor } from '../src/manifest-action-executor.mjs';
import { createGuardedExecutor } from '../src/playback-session.mjs';
import { withCatalogActivity } from '../src/catalog-activity-executor.mjs';

// 0.62.2 on real Prime: Watch with edit failed with "The edit could not be turned on. Check your
// account link and connection…". The Developer panel said "Source check failed: runtime-mismatch":
// the edit was published for 2,620,032 ms with 1 s of slack and Prime reported 2,619,000 ms.
const GTI = 'amzn1.dv.gti.642b66cd-63e6-4cd1-8c97-8e8ba3e95185';
const expected = { serviceId: 'prime-video', serviceContentId: GTI, mediaType: 'episode', season: 1, episode: 4, runtimeMs: 2_701_032, runtimeToleranceMs: 1000 };
const observed = runtimeMs => ({ serviceId: 'prime-video', activeItemId: GTI, mediaType: 'episode', season: 1, episode: 4, runtimeMs });

test("Prime's runtime drift between sessions no longer refuses a matching episode; a reading far off still does", () => {
  assert.equal(RUNTIME_TOLERANCE_FLOOR_MS, 2_500);
  for (const runtimeMs of [2_700_000, 2_701_032, 2_703_000])
    assert.equal(evaluateSourceCompatibility(observed(runtimeMs), expected).status, 'compatible', String(runtimeMs));
  assert.deepEqual(evaluateSourceCompatibility(observed(2_716_016), expected), { status: 'incompatible', reason: 'runtime-mismatch' }, "Prime's reading during the intro");
  assert.equal(evaluateSourceCompatibility(observed(2_700_000), { ...expected, runtimeToleranceMs: 20_000 }).status, 'compatible', 'a wider published tolerance still applies');
  assert.equal(evaluateSourceCompatibility({ ...observed(2_701_032), activeItemId: 'amzn1.dv.gti.other' }, expected).reason, 'active-item-mismatch', 'the title must still match exactly');
});

test('a failed source check names its kind, has its own sentence and keeps the reason as the cause', () => {
  assert.equal(sourceMismatchCode('runtime-mismatch'), 'viewer-runtime-mismatch');
  for (const reason of ['active-item-mismatch', 'season-mismatch', 'episode-mismatch', 'media-type-mismatch']) assert.equal(sourceMismatchCode(reason), 'viewer-episode-mismatch');
  assert.equal(sourceMismatchCode('plan-mismatch'), 'viewer-source-check-failed');
  const error = Object.assign(Error('viewer-runtime-mismatch'), { detail: 'runtime-mismatch' });
  assert.equal(controllerFailureCode('arm', error), 'viewer-runtime-mismatch');
  assert.equal(failureCause(error), 'runtime-mismatch');
  assert.match(viewerFailureMessage('viewer-runtime-mismatch'), /slightly different version of this episode/);
  for (const code of ['viewer-runtime-mismatch', 'viewer-episode-mismatch', 'viewer-source-check-failed', 'viewer-arm-failed', 'viewer-action-failed', 'viewer-source-unavailable'])
    assert.doesNotMatch(viewerFailureMessage(code), /account link/, code);
  assert.equal(problemFor('viewer-runtime-mismatch').fix.act, 'find');
});

test('an unknown arm failure is viewer-arm-failed, and its words survive in diagnostics without addresses or IDs', () => {
  assert.equal(controllerFailureCode('arm', Error('Something unexpected happened')), 'viewer-arm-failed');
  assert.equal(failureCause(Error('Source check failed: runtime-mismatch')), 'Source-check-failed:-runtime-mismatch');
  assert.equal(failureCause(Error('Could not read https://www.amazon.com/gp/video/detail/B0486E72D6 now')), 'Could-not-read-now');
  assert.equal(failureCause(Error(`Clip ${GTI} for 642b66cd-63e6-4cd1-8c97-8e8ba3e95185 missing`)), 'Clip-for-missing');
  assert.equal(failureCause(Error('x'.repeat(200) + ' tail')).length <= 80, true);
  assert.equal(failureCause(Error('viewer-not-ready')), 'viewer-not-ready');
});

test('turning on an edit after every scene has passed works; the menu offers Jump to scene 1', async () => {
  const actions = [{ id: 's1', type: 'REPLACE', triggerMs: 2_182_621, resumeMs: 2_198_345, clipUrl: 'asset:a' }, { id: 's2', type: 'REPLACE', triggerMs: 2_198_595, resumeMs: 2_205_185, clipUrl: 'asset:b' }];
  for (const trust of ['catalog', 'local-user']) {
    const node = () => ({ disabled: false, textContent: '', hidden: false, addEventListener() {}, replaceChildren() {} });
    const state = { session: { packet: { manifest: { segments: actions.map(a => ({ segment_id: a.id, action: a.type })) } }, trust, assetUrls: new Map() }, scheduler: null, arming: null };
    const controller = createPacketSessionController({ state, operations: new OperationContext(), journal: new PacketPlaybackJournal(),
      ui: { armButton: node(), cancelButton: node(), navigation: node(), navigationList: node(), navigationOutput: node(), packetOutput: node(), panelHost: { dataset: {} } },
      engine: { async preload() {}, async cancelPreload() {}, arm() {}, async execute() { return { status: 'success' }; }, async cancel() {} },
      adapter: { async seek() {} }, overlay: { async clear() {}, async catalogActivity() {} },
      commandAdapter: { readState: () => ({ currentTimeMs: 2_220_000, paused: false }) },
      assertSource: async () => ({ catalogActions: actions.map(a => ({ ...a })) }),
      deps: { ManifestActionExecutor, ManifestActionScheduler, createGuardedExecutor, withCatalogActivity, compileLocalUserEditActions: () => actions.map(a => ({ ...a })) } });
    await controller.arm();
    assert.deepEqual(state.scheduler.snapshot().statuses, { s1: 'skipped', s2: 'skipped' }, trust);
  }
  const view = viewerView({ playback: { state: 'armed', sourceKey: 'k', editId: 'e', canStop: true, currentTimeMs: 2_220_000, skippedCount: 2,
    scenes: actions.map(a => ({ type: a.type, startMs: a.triggerMs, resumeMs: a.resumeMs, status: 'skipped' })) } });
  assert.equal(view.kind, 'behind');
  assert.equal(`${view.status.strong}${view.status.rest}`, 'No more scenes ahead · 2 behind');
  assert.deepEqual(view.progress, { played: 0, total: 2 }, 'the progress bar stays while scenes are behind');
});
