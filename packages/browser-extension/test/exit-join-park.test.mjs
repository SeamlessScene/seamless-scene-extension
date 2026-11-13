import test from 'node:test';
import assert from 'node:assert/strict';
import { StandardTransitionAdapter } from '../src/standard-transition-adapter.mjs';
import { TransitionEngine } from '../src/transition-engine.mjs';
import { MetricsRecorder } from '../src/metrics.mjs';
import { EXIT_PARK_AUDIO_START_MS, EXIT_NATIVE_RAMP_MS, EXIT_SILENT_GAIN } from '../src/audio-crossfade.mjs';

// 0.66.2: the hold before an unprepared scene and the exit park, at their edges (a hold during
// staging, a parked start that would be heard, a cancelled parked exit). Each test drives the real
// adapter; the engine tests drive the real engine on top of it.

const turn = () => new Promise(resolve => setImmediate(resolve));
const turns = async (count = 6) => { for (let i = 0; i < count; i += 1) await turn(); };
const SEGMENT = { id: 'segment-1', triggerMs: 3000, resumeMs: 8000, clipUrl: 'fixture.mp4', gainDb: -6 };

// A page with a native player (frame callbacks driven by hand) and a document that can hold the
// cover host, the real adapter on it, and optionally the real engine with a scripted renderer.
function page({ currentTime = 2.8 } = {}) {
  const frames = new Map(); let id = 0; const plays = [], seeks = [];
  const player = new EventTarget();
  Object.assign(player, { muted: false, paused: false, seeking: false, playbackRate: 1, currentTime, readyState: 4, volume: 1,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }),
    requestVideoFrameCallback(callback) { frames.set(++id, callback); return id; }, cancelVideoFrameCallback(handle) { frames.delete(handle); },
    pause() { this.paused = true; }, play() { plays.push(Math.round(this.currentTime * 1000)); this.paused = false; return Promise.resolve(); } });
  const root = { append(node) { node.isConnected = true; node.parentNode = this; }, moveBefore(node) { node.parentNode = this; } };
  const document = { documentElement: root, fullscreenElement: null, pictureInPictureElement: null, defaultView: {}, visibilityState: 'visible',
    createElement: () => ({ style: {}, dataset: {}, isConnected: false, remove() { this.isConnected = false; } }) };
  const adapter = new StandardTransitionAdapter({ document, passiveAdapter: { activePlayer: () => player },
    commandAdapter: { readState: () => ({ currentTimeMs: Math.round(player.currentTime * 1000), paused: player.paused, muted: player.muted, volume: player.volume, readyState: 4 }),
      pause: async () => { player.paused = true; }, play: async () => { plays.push(Math.round(player.currentTime * 1000)); player.paused = false; },
      // `slowSeek` (a promise set on the returned page) keeps a seek running, as on a slow decoder.
      seekToWithPlaybackWarmup: async target => { seeks.push(target); if (h.slowSeek) { player.seeking = true; await h.slowSeek; player.seeking = false; } player.currentTime = target / 1000; } } });
  const present = (mediaTime, presentedFrames, { now = performance.now(), shown = now } = {}) => {
    for (const [handle, callback] of [...frames]) { frames.delete(handle); callback(now, { mediaTime, presentedFrames, expectedDisplayTime: shown }); }
  };
  const h = { player, adapter, document, frames, present, plays, seeks, slowSeek: null };
  return h;
}

function withEngine(h, overrides = {}) {
  const calls = []; let now = 0;
  const overlay = {
    async prepare() { calls.push('prepare'); }, async mount() { calls.push('overlay-mount'); }, async configureAudio() {},
    async show() { calls.push('overlay-show'); }, async unmount() { calls.push('unmount'); }, play: async () => ({}),
    async stop() { calls.push('overlay-stop'); }, async teardown() { calls.push('overlay-teardown'); }, ...overrides };
  const metrics = new MetricsRecorder({ now: () => ++now, wallClock: () => '2026-11-11T00:00:00.000Z' });
  const engine = new TransitionEngine({ adapter: h.adapter, overlay, metrics, now: () => ++now, joinSeekDelayMs: 0 });
  return Object.assign(h, { engine, overlay, calls, metrics });
}

// Hold: the engine registers the hold-only watch before `prepare`. When the trigger frame arrived
// during `prepare`, the hold stopped native, and staging the host then released it: native played
// on, uncovered, through removed footage until the transition's own pause (~90-140 ms).
test('hold: a hold-only cut that fires while the stage is still preparing stays in force when the host is staged', async () => {
  let finishPrepare; const preparing = new Promise(resolve => { finishPrepare = resolve; });
  const h = withEngine(page(), { prepare: () => preparing });
  const woken = []; h.adapter.stateSubscribers.add(state => woken.push(state.event));
  const staging = h.engine.stage(SEGMENT);
  await turns();
  assert.equal(h.adapter.plannedCut?.holdOnly, true, 'watching native while the clip is prepared');
  h.present(2.917, 1); h.present(2.958, 2); // the last frame before the 3.0 s trigger
  assert.equal(h.player.paused, true);
  assert.equal(h.adapter.cutHoldOnly(3000), true);
  assert.deepEqual(woken, ['planned-cut']);
  finishPrepare(); // the stage goes on: host, mount, show
  assert.equal(await staging, true);
  assert.deepEqual(h.plays, [], 'native was never played again: no removed footage ran uncovered');
  assert.equal(h.player.paused, true);
  assert.equal(h.adapter.cutHoldOnly(3000), true, 'the hold survives staging the host');
  assert.equal(h.adapter.plannedCut, null, 'no second watch is registered behind a hold already in force');
  assert.equal(h.frames.size, 0);
  assert.equal(h.adapter.stagedHost?.style.opacity, '0', 'the host is staged, hidden');
  assert.equal(h.adapter.stagedHost.style.visibility, 'visible');
  // The transition the cut woke adopts the hold as its own pause: the viewer was playing.
  const snapshot = await h.adapter.snapshot();
  assert.equal(snapshot.paused, false);
  await h.adapter.pause();
  assert.equal(h.adapter.cutHold, null); assert.equal(h.player.paused, true);
  assert.deepEqual(h.plays, []);
});

test('hold: staging the host alone still releases a hold it was not asked to keep, and never hides a host a hold-only cut did not reveal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = page();
  h.adapter.planHold(3000); h.present(2.917, 1); h.present(2.958, 2);
  assert.equal(h.player.paused, true);
  await h.adapter.stageOverlayHost(undefined, { keepCutHold: true });
  assert.equal(h.player.paused, true); assert.equal(h.adapter.cutHoldOnly(3000), true);
  // Nothing adopts it: the existing 2 s expiry resumes native; the staged host stays as staged.
  let released = 0; h.adapter.cutHold.onReleased = () => { released += 1; };
  t.mock.timers.tick(2000);
  assert.equal(h.player.paused, false); assert.equal(released, 1);
  assert.equal(h.adapter.stagedHost.style.visibility, 'visible', 'opacity 0, not visibility:hidden (0.62.18)');
  assert.equal(h.adapter.stagedHost.style.opacity, '0');
  h.adapter.unstageOverlayHost();
  // The default is unchanged: a stage for anything else releases a hold at once.
  h.player.currentTime = 2.8;
  h.adapter.planHold(3000); h.present(2.917, 3); h.present(2.958, 4);
  assert.equal(h.player.paused, true);
  await h.adapter.stageOverlayHost();
  assert.equal(h.player.paused, false);
  h.adapter.unstageOverlayHost();
});

test('hold: a hold-only cut that nothing adopts leaves the engine without a planned hold', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = withEngine(page(), { mount: async () => { throw new Error('mount failed'); } });
  await assert.rejects(h.engine.stage(SEGMENT));
  assert.equal(h.engine.holdPlanned, true, 'a failed stage keeps watching native');
  h.present(2.917, 1); h.present(2.958, 2);
  assert.equal(h.player.paused, true); assert.equal(h.engine.holdPlanned, true);
  t.mock.timers.tick(2000);
  assert.equal(h.player.paused, false);
  assert.equal(h.engine.holdPlanned, false);
});

// Parked start: the park relies on native not being heard at the viewer's level before its ramp.
// A warm-up made while Smooth audio was off or the tab was hidden (both can change during the
// awaited join seek) unmutes native at
// the viewer's level without a hold; if fades were allowed again by the pre-roll's start, parked
// native started early at full level from join - park.
async function parkedExit(h, { beforeWarm = () => {}, afterWarm = () => {}, parkMs = 65, endInMs = 60 } = {}) {
  const snapshot = await h.adapter.snapshot(); await h.adapter.pause(); await h.adapter.setMuted(true);
  h.adapter.overlayHost = await h.adapter.mountOverlayHost();
  h.player.currentTime = 15 - parkMs / 1000; // the join seek: parked before the 15.0 s join
  beforeWarm();
  const warmed = h.adapter.warmNativeOutput('paused-at-join');
  afterWarm();
  const audible = () => !h.player.paused && h.player.muted !== true && h.player.volume > 0.01;
  assert.equal(h.adapter.prerollNative(performance.timeOrigin + performance.now() + endInMs, { joinMs: 15_000, parkMs }), true);
  return { snapshot, warmed, audible };
}

test('parked start: parked native warmed without a hold (tab hidden, or Smooth audio off, during the join seek) is not started early', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cases = {
    'tab hidden at the warm-up, visible again at the start': h => ({ beforeWarm: () => { h.document.visibilityState = 'hidden'; }, afterWarm: () => { h.document.visibilityState = 'visible'; } }),
    'Smooth audio off at the warm-up, on again at the start': h => ({ beforeWarm: () => { h.adapter.setCrossfadeEnabled(false); }, afterWarm: () => { h.adapter.setCrossfadeEnabled(true); } })
  };
  for (const [name, toggles] of Object.entries(cases)) {
    const h = page(); h.adapter.setExitRevealPolicy('precise');
    const { warmed, audible } = await parkedExit(h, toggles(h));
    assert.equal(warmed, true, name);
    assert.equal(h.adapter.nativeWarm.smooth, false, `${name}: warmed at the viewer's level, no hold`);
    assert.equal(h.player.muted, false); assert.equal(h.player.volume, 1);
    t.mock.timers.tick(1); // the lead is longer than the time left: the pre-roll would start now
    assert.equal(h.player.paused, true, `${name}: no early start before the join`);
    assert.equal(audible(), false);
    assert.deepEqual(h.plays, []);
    assert.equal(h.adapter.nativePreroll, null, 'restore seeks native to the join itself');
    assert.equal(h.adapter.overlayHost.style.visibility, 'visible');
  }
});

test('parked start: a viewer volume change under the warm hold also refuses the early start; a held or still-muted native starts as before', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // The viewer changed the volume while native waited under the hold: the hold is no longer ours.
  const changed = page(); changed.adapter.setExitRevealPolicy('precise');
  await parkedExit(changed, { afterWarm: () => { changed.player.volume = 0.6; } });
  t.mock.timers.tick(1);
  assert.equal(changed.player.paused, true);
  assert.equal(changed.adapter.nativePreroll, null);
  // Smooth audio on throughout: held at -60 dB, native starts early and is not heard at the viewer's level until its ramp.
  const held = page(); held.adapter.setExitRevealPolicy('precise');
  const first = await parkedExit(held);
  assert.equal(held.adapter.nativeWarm.hold.active, true);
  t.mock.timers.tick(1);
  assert.equal(held.adapter.nativePreroll?.started, true);
  assert.equal(held.player.paused, false); assert.equal(first.audible(), false, 'playing before the join at -60 dB');
  // Not warmed at all (the mute ledger still holds it): it starts early, muted until its ramp.
  const muted = page(); muted.adapter.setExitRevealPolicy('precise');
  await muted.adapter.snapshot(); await muted.adapter.pause(); await muted.adapter.setMuted(true);
  muted.adapter.overlayHost = await muted.adapter.mountOverlayHost();
  muted.player.currentTime = 14.935;
  muted.adapter.prerollNative(performance.timeOrigin + performance.now() + 60, { joinMs: 15_000, parkMs: 65 });
  t.mock.timers.tick(1);
  assert.equal(muted.adapter.nativePreroll?.started, true);
  assert.equal(muted.player.muted, true);
});

// Cancelled exit: the join seek parks native before the join. A transition cancelled after that
// seek for a reason that keeps native's own time (a viewer seek, a source, page or player change) did not seek
// again, so native came back from join - park: up to 150 ms of removed footage, seen and heard.
async function parkedTransition(t, { segment = SEGMENT } = {}) {
  let endPlay; const playing = new Promise(resolve => { endPlay = resolve; });
  const h = withEngine(page({ currentTime: 3.0 }), { play: () => playing });
  h.adapter.setExitRevealPolicy('precise');
  h.engine.arm(segment);
  const running = h.engine.execute(3000);
  for (let i = 0; i < 40 && !h.seeks.length; i += 1) await turn();
  await turns();
  assert.deepEqual(h.seeks, [segment.resumeMs - 65], 'the join seek parked native 65 ms before the join');
  assert.equal(h.player.paused, true);
  return Object.assign(h, { running, endPlay });
}

test('cancelled parked exit: an exit cancelled after the parked seek for a time-preserving reason resumes native at the join, not before it', async t => {
  for (const reason of ['viewer-source-changed', 'viewer-page-restored', 'native-seek']) {
    const h = await parkedTransition(t);
    assert.equal(h.engine.cancel(reason), true);
    assert.equal((await h.running).status, 'cancelled');
    assert.deepEqual(h.seeks, [7935, 8000], `${reason}: native is taken to the join`);
    assert.deepEqual(h.plays, [8000], `${reason}: and plays from there, never from the parked position`);
    assert.equal(h.player.paused, false); assert.equal(h.player.muted, false);
    assert.equal(h.adapter.overlayHost, null);
  }
});

test("cancelled parked exit: the viewer's own seek target is never overridden", async t => {
  for (const viewerTime of [1.2, 7.7, 8.0, 8.004, 52.5]) {
    const h = await parkedTransition(t);
    h.player.currentTime = viewerTime; // the viewer seeked while the clip played
    h.engine.cancel('native-seek');
    assert.equal((await h.running).status, 'cancelled');
    assert.deepEqual(h.seeks, [7935], `${viewerTime}: no seek of ours after the viewer's`);
    assert.deepEqual(h.plays, [Math.round(viewerTime * 1000)]);
  }
});

test('cancelled parked exit: a pre-roll already playing the parked stretch under the cover is withdrawn and native rejoins at the join', async t => {
  const h = await parkedTransition(t);
  // The clip is about to end: native starts early from the parked position, covered.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(h.adapter.prerollNative(performance.timeOrigin + performance.now() + 60, { joinMs: 8000, parkMs: 65 }), true);
  t.mock.timers.tick(1);
  assert.equal(h.adapter.nativePreroll?.started, true);
  h.player.currentTime = 7.96; // 40 ms before the join, still covered
  t.mock.timers.reset();
  h.plays.length = 0;
  h.engine.cancel('viewer-player-changed');
  assert.equal((await h.running).status, 'cancelled');
  assert.deepEqual(h.seeks, [7935, 8000]);
  assert.deepEqual(h.plays, [8000]);
  assert.equal(h.player.muted, false); assert.equal(h.player.volume, 1, "the viewer's level is back");
});

test('cancelled parked exit: an unparked exit, a changed player context and an explicit stop recover exactly as before', async t => {
  // Exit reveal 'new' does not park: a time-preserving cancel leaves native where it is.
  let endPlay; const h = withEngine(page({ currentTime: 3.0 }), { play: () => new Promise(resolve => { endPlay = resolve; }) });
  h.adapter.setExitRevealPolicy('new');
  h.engine.arm(SEGMENT);
  const running = h.engine.execute(3000);
  for (let i = 0; i < 40 && !h.seeks.length; i += 1) await turn();
  await turns();
  h.engine.cancel('viewer-source-changed');
  assert.equal((await running).status, 'cancelled');
  assert.deepEqual(h.seeks, [8000]); assert.deepEqual(h.plays, [8000]);
  // The player context was invalidated (the element changed): nothing of ours is seeked.
  const changed = await parkedTransition(t);
  changed.adapter.invalidateContext();
  changed.engine.cancel('viewer-player-changed');
  assert.equal((await changed.running).status, 'cancelled');
  assert.deepEqual(changed.seeks, [7935]);
  // An explicit stop goes back to where native paused (the engine's own target), as before.
  const stopped = await parkedTransition(t);
  stopped.engine.cancel('user-cancelled-from-panel');
  assert.equal((await stopped.running).status, 'cancelled');
  assert.deepEqual(stopped.seeks, [7935, 3000]);
  assert.deepEqual(stopped.plays, [3000]);
});

// Short clip, slow seek: the renderer's ending notice (400 ms before the clip's end) can arrive
// while the join seek is still running. The pre-roll planned then must already know native is
// being parked; otherwise that exit is treated as unparked (its ramp waits for the join, the park
// is missing from the timing export) although native starts before the join.
async function noticeDuringSeek(t) {
  let endPlay, finishSeek;
  // From here the timers are moved by hand (the engine's step watchdogs included).
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = withEngine(page({ currentTime: 3.0 }), { onLocalEnding: null, play: () => new Promise(resolve => { endPlay = resolve; }) });
  h.adapter.setExitRevealPolicy('precise');
  h.slowSeek = new Promise(resolve => { finishSeek = resolve; });
  h.engine.arm(SEGMENT);
  const running = h.engine.execute(3000);
  for (let i = 0; i < 40 && !h.seeks.length; i += 1) await turn();
  await turns();
  assert.deepEqual(h.seeks, [SEGMENT.resumeMs - 65], 'the join seek, parked 65 ms before the join, is under way');
  assert.equal(h.player.seeking, true);
  assert.equal(typeof h.overlay.onLocalEnding, 'function');
  // And the page clock.
  const clock = { now: performance.now() };
  t.mock.method(performance, 'now', () => clock.now);
  const endAtPerf = clock.now + 400;
  h.overlay.onLocalEnding(performance.timeOrigin + endAtPerf);
  const go = ms => { clock.now += ms; t.mock.timers.tick(ms); };
  // Native advancing 1 ms of media per ms, the ramp's timer running with it.
  const run = ms => { for (let i = 0; i < ms; i += 1) { h.player.currentTime = Math.round(h.player.currentTime * 1000 + 1) / 1000; go(1); } };
  return Object.assign(h, { running, endPlay: () => endPlay({}), finishSeek: async () => { finishSeek(); await turns(); }, clock, endAtPerf, go, run });
}

test('exit park: an ending notice during the join seek still plans a parked pre-roll, and the park reaches the timing export', async t => {
  const h = await noticeDuringSeek(t);
  assert.equal(h.adapter.nativePreroll?.parkMs, 65, 'the pre-roll planned during the seek knows the park');
  await h.finishSeek(); // 100 ms later the seek lands: native is paused 65 ms before the join
  assert.equal(h.player.currentTime, 7.935); assert.equal(h.player.paused, true);
  h.go(400 - 105); // the usual lead before the clip's end
  const preroll = h.adapter.nativePreroll;
  assert.equal(preroll?.started, true); assert.equal(h.player.paused, false);
  assert.deepEqual(h.plays, [7935], 'started from the parked position');
  assert.equal(preroll.fadeBaseMediaMs, EXIT_PARK_AUDIO_START_MS, "the ramp is set on native's clock from the parked exit's start, not from the join");
  // Native's clock starts 40 ms after play() and runs to 30 ms before the join: the ramp is over.
  h.go(40); h.run(5);
  assert.ok(h.player.volume <= EXIT_SILENT_GAIN + 1e-9, 'held at -60 dB up to the ramp base');
  h.run(EXIT_NATIVE_RAMP_MS + 2); // one timer tick of slack
  assert.equal(h.player.currentTime, 7.972);
  assert.equal(h.player.volume, 1, "at the viewer's level before the join, when the clip's own audio has ended");
  h.run(28); h.go(3);
  h.present(8.0, 11, { now: h.endAtPerf + 3, shown: h.endAtPerf + 6 }); // the join frame at the clip's end
  h.present(8.042, 12, { now: h.endAtPerf + 3, shown: h.endAtPerf + 6 }); // parked: native's next frame confirms it is on screen
  assert.equal(h.adapter.overlayHost.style.visibility, 'hidden');
  t.mock.timers.reset();
  h.endPlay();
  assert.equal((await h.running).status, 'success');
  assert.deepEqual(h.seeks, [7935], 'no second seek');
  const exit = h.metrics.snapshot().cycles.at(-1).audioFade.exit;
  assert.equal(exit.parkMs, 65, 'the export names the park');
  assert.equal(exit.fadeBaseMediaMs, EXIT_PARK_AUDIO_START_MS);
  assert.equal(exit.pausedVsJoinMs, -65);
  assert.equal(exit.uncover.frameVsJoinFrames, 0, 'the join frame is the one revealed');
});

test('exit park: a join seek still running at the pre-roll start leaves native paused; it is taken to the join, unheard before it', async t => {
  const h = await noticeDuringSeek(t);
  h.go(400 - 105); // the pre-roll's start: native is still seeking
  assert.equal(h.adapter.nativePreroll, null, 'no early start');
  assert.deepEqual(h.plays, []);
  await h.finishSeek();
  assert.equal(h.player.paused, true);
  assert.ok(h.player.volume <= EXIT_SILENT_GAIN + 1e-9 || h.player.muted === true);
  t.mock.timers.reset();
  h.endPlay();
  const done = h.running;
  for (let i = 0; i < 40 && h.seeks.length < 2; i += 1) await turn();
  assert.deepEqual(h.seeks, [7935, 8000], 'restore seeks to the join itself');
  h.present(8.0, 11); h.present(8.042, 12);
  assert.equal((await done).status, 'success');
  assert.deepEqual(h.plays, [8000], 'native plays from the join, never from the parked position');
  assert.equal(h.player.muted, false); assert.equal(h.player.volume, 1);
});
